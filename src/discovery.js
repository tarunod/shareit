/**
 * discovery.js — UDP broadcast-based peer discovery on LAN
 * Each peer broadcasts its presence every 3 seconds and listens for others
 */
const dgram = require('dgram');
const os = require('os');
const { io: ioClient } = require('socket.io-client');
const { store } = require('./store');
const logger = require('./logger');

const BROADCAST_PORT = 34568;
const BROADCAST_INTERVAL = 3000;
const PEER_TIMEOUT = 10000; // Remove peer if not seen for 10s

class PeerDiscovery {
  constructor(mainWindow, serverPort) {
    this.mainWindow = mainWindow;
    this.serverPort = serverPort;
    this.peers = new Map(); // id -> peer info
    this.socket = null;
    this.broadcastTimer = null;
    this.cleanupTimer = null;
    this.pendingRequests = new Map(); // requestId -> { socket, request }
    this.peerSockets = new Map(); // peerId -> socket.io client
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      logger.error('Discovery', `UDP error: ${err.message}`);
    });

    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type !== 'shareit-beacon') return;
        const myInfo = store.getUserInfo();
        if (data.id === myInfo.id) return; // Ignore self

        const isNew = !this.peers.has(data.id);
        this.peers.set(data.id, {
          ...data,
          ip: rinfo.address,
          lastSeen: Date.now(),
        });

        if (isNew) {
          this.mainWindow.webContents.send('peers-updated', this.getPeers());
          this.mainWindow.webContents.send('new-notification', {
            type: 'peer-joined',
            message: `${data.name} joined the network`,
          });
        }
      } catch (e) {}
    });

    this.socket.bind(BROADCAST_PORT, () => {
      this.socket.setBroadcast(true);
      logger.info('Discovery', `Listening on UDP ${BROADCAST_PORT}`);
    });

    // Broadcast presence
    this.broadcastTimer = setInterval(() => this.broadcast(), BROADCAST_INTERVAL);
    this.broadcast();

    // Cleanup stale peers
    this.cleanupTimer = setInterval(() => this.cleanupPeers(), 5000);
  }

  broadcast() {
    const userInfo = store.getUserInfo();
    const localIP = this.getLocalIP();
    const payload = JSON.stringify({
      type: 'shareit-beacon',
      id: userInfo.id,
      name: userInfo.name,
      hostname: userInfo.hostname,
      ip: localIP, // Explicitly include IP
      port: this.serverPort,
      avatar: userInfo.avatar || null,
    });
    const buf = Buffer.from(payload);
    const broadcastAddresses = this.getBroadcastAddresses();
    for (const addr of broadcastAddresses) {
      this.socket.send(buf, 0, buf.length, BROADCAST_PORT, addr, (err) => {
        if (err) logger.error('Discovery', `Broadcast error: ${err.message}`);
      });
    }
  }

  getBroadcastAddresses() {
    const addresses = [];
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          // Compute broadcast address
          const parts = info.address.split('.').map(Number);
          const maskParts = info.netmask.split('.').map(Number);
          const broadcast = parts.map((p, i) => (p | (~maskParts[i] & 255))).join('.');
          addresses.push(broadcast);
        }
      }
    }
    if (addresses.length === 0) addresses.push('255.255.255.255');
    return addresses;
  }

  cleanupPeers() {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.mainWindow.webContents.send('peers-updated', this.getPeers());
    }
  }

  getPeers() {
    return Array.from(this.peers.values()).map(p => ({
      id: p.id,
      name: p.name,
      hostname: p.hostname,
      ip: p.ip,
      port: p.port,
      avatar: p.avatar,
      lastSeen: p.lastSeen,
    }));
  }

  updateUserInfo(info) {
    this.broadcast();
  }

  getPeerSocket(peer) {
    if (this.peerSockets.has(peer.id)) return this.peerSockets.get(peer.id);
    
    let host = peer.ip || '127.0.0.1';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
    
    logger.info('Discovery', `Connecting to peer socket at http://${host}:${peer.port}`);
    const socket = ioClient(`http://${host}:${peer.port}`, {
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
      transports: ['websocket'], // Force websocket
    });
    const userInfo = store.getUserInfo();
    socket.on('connect', () => {
      logger.info('Discovery', `Successfully connected to peer socket: ${host}`);
      socket.emit('identify', userInfo);
    });
    socket.on('connect_error', (err) => {
      logger.error('Discovery', `Failed to connect to peer ${host}: ${err.message}`);
    });
    this.peerSockets.set(peer.id, socket);
    return socket;
  }

  sendAccessRequest(folder, peerIds) {
    const userInfo = store.getUserInfo();
    logger.info('Discovery', `Sending access request for folder ${folder.name} to ${peerIds.length} peers`);
    for (const peerId of peerIds) {
      const peer = this.peers.get(peerId);
      if (!peer) {
        logger.warn('Discovery', `Cannot send request, peer not found: ${peerId}`);
        continue;
      }
      const requestId = require('crypto').randomUUID();
      const socket = this.getPeerSocket(peer);
      const request = {
        requestId,
        folderId: folder.id,
        folderName: folder.name,
        folderPath: folder.path,
        type: folder.type,
        ownerInfo: userInfo,
        ownerPort: this.serverPort,
        requestedAt: Date.now(),
      };
      this.pendingRequests.set(requestId, { socket, request, peer });
      
      const sendReq = () => {
        logger.info('Discovery', `Emitting access-request to peer ${peer.name} (${peer.ip})`);
        socket.emit('access-request', request);
      };

      if (socket.connected) {
        sendReq();
      } else {
        logger.info('Discovery', `Socket not connected yet, waiting for connect event to emit access-request`);
        socket.once('connect', sendReq);
      }
    }
  }

  sendAccessResponse(request, accepted) {
    const userInfo = store.getUserInfo();
    let host = request.ownerHost || '127.0.0.1';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
    
    logger.info('Discovery', `Sending access response to ${host}:${request.ownerPort}`);
    const socket = ioClient(`http://${host}:${request.ownerPort}`, {
      reconnection: false,
      timeout: 10000,
      transports: ['websocket'],
    });
    socket.on('connect', () => {
      logger.info('Discovery', `Connected to sender, emitting access-response`);
      socket.emit('access-response', {
        requestId: request.requestId,
        folderId: request.folderId,
        folderName: request.folderName,
        accepted,
        ownerInfo: userInfo,
      });
      setTimeout(() => socket.disconnect(), 1000);
    });
    socket.on('connect_error', (err) => {
      logger.error('Discovery', `Failed to send access response to ${host}: ${err.message}`);
    });
  }

  notifySyncChange(folderId, changeInfo) {
    // Notify all peers who have access to this folder
    const sharedFolders = store.getSharedFolders();
    const folder = sharedFolders.find(f => f.id === folderId);
    if (!folder) return;
    for (const peerId of folder.peers || []) {
      const peer = this.peers.get(peerId);
      if (!peer) continue;
      const socket = this.getPeerSocket(peer);
      socket.emit('sync-notify', { folderId, ...changeInfo });
    }
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          return info.address;
        }
      }
    }
    return '127.0.0.1';
  }

  stop() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.socket) this.socket.close();
    for (const s of this.peerSockets.values()) s.disconnect();
  }
}

module.exports = { PeerDiscovery };
