/**
 * discovery.js - UDP broadcast-based peer discovery and Socket.IO peer transport.
 */
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');
const { io: ioClient } = require('socket.io-client');
const { store } = require('./store');
const logger = require('./logger');

const BROADCAST_PORT = 34568;
const BROADCAST_INTERVAL = 3000;
const PEER_TIMEOUT = 10000;
const BEACON_TYPES = new Set(['socket-beacon', 'shareit-beacon']);

class PeerDiscovery {
  constructor(mainWindow, serverPort, notifyApp) {
    this.mainWindow = mainWindow;
    this.serverPort = serverPort;
    this.notifyApp = notifyApp;
    this.peers = new Map();
    this.socket = null;
    this.broadcastTimer = null;
    this.cleanupTimer = null;
    this.peerSockets = new Map();
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      logger.error('Discovery', `UDP error: ${err.message}`);
    });

    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (!BEACON_TYPES.has(data.type)) return;
        const myInfo = store.getUserInfo();
        if (data.id === myInfo.id) return;

        const existing = this.peers.get(data.id);
        this.peers.set(data.id, {
          ...existing,
          ...data,
          ip: rinfo.address,
          lastSeen: Date.now(),
        });

        store.syncPeerConversation(this.peers.get(data.id));
        this.emitPresenceUpdate();

        if (!existing) {
          if (this.notifyApp) {
            this.notifyApp({
              type: 'peer-joined',
              title: 'Peer joined',
              message: `${data.name} joined your local network`,
              level: 'info',
            });
          }
        }
      } catch (e) {
        logger.warn('Discovery', `Failed to process discovery packet: ${e.message}`);
      }
    });

    this.socket.bind(BROADCAST_PORT, () => {
      this.socket.setBroadcast(true);
      logger.info('Discovery', `Listening on UDP ${BROADCAST_PORT}`);
    });

    this.broadcastTimer = setInterval(() => this.broadcast(), BROADCAST_INTERVAL);
    this.broadcast();
    this.cleanupTimer = setInterval(() => this.cleanupPeers(), 5000);
  }

  emitPresenceUpdate() {
    const peers = this.getPeers();
    this.mainWindow.webContents.send('peers-updated', peers);
    this.mainWindow.webContents.send('peer-presence-updated', peers);
    this.mainWindow.webContents.send('conversation-updated', store.getConversations());
  }

  broadcast() {
    const userInfo = store.getUserInfo();
    const payload = JSON.stringify({
      type: 'socket-beacon',
      id: userInfo.id,
      name: userInfo.name,
      hostname: userInfo.hostname,
      ip: this.getLocalIP(),
      port: this.serverPort,
      avatar: userInfo.avatar || null,
    });
    const buf = Buffer.from(payload);
    const addresses = this.getBroadcastAddresses();

    for (const addr of addresses) {
      this.socket.send(buf, 0, buf.length, BROADCAST_PORT, addr, (err) => {
        if (err) logger.error('Discovery', `Broadcast error: ${err.message}`);
      });
    }
  }

  getBroadcastAddresses() {
    const addresses = [];
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const info of iface || []) {
        if (info.family === 'IPv4' && !info.internal) {
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
    if (changed) this.emitPresenceUpdate();
  }

  getPeers() {
    return Array.from(this.peers.values()).map((peer) => ({
      id: peer.id,
      name: peer.name,
      hostname: peer.hostname,
      ip: peer.ip,
      port: peer.port,
      avatar: peer.avatar,
      lastSeen: peer.lastSeen,
    }));
  }

  getPeerById(peerId) {
    return this.peers.get(peerId) || null;
  }

  updateUserInfo() {
    this.broadcast();
  }

  getPeerSocket(peer) {
    if (this.peerSockets.has(peer.id)) return this.peerSockets.get(peer.id);

    let host = peer.ip || '127.0.0.1';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;

    const socket = ioClient(`http://${host}:${peer.port}`, {
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      socket.emit('identify', store.getUserInfo());
    });

    socket.on('connect_error', (err) => {
      logger.error('Discovery', `Failed to connect to peer ${host}: ${err.message}`);
    });

    this.peerSockets.set(peer.id, socket);
    return socket;
  }

  sendDirectMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error('Peer is offline or unavailable');

    const socket = this.getPeerSocket(peer);
    const payload = {
      id: message.id || crypto.randomUUID(),
      sender: store.getUserInfo(),
      recipientPeerId: peerId,
      createdAt: message.createdAt || Date.now(),
      type: message.type || 'text',
      text: message.text || '',
      attachments: message.attachments || [],
      meta: message.meta || {},
    };

    const emit = () => socket.emit('direct-message', payload);
    if (socket.connected) emit();
    else socket.once('connect', emit);
    return payload;
  }

  sendAccessRequest(folder, peerIds) {
    const userInfo = store.getUserInfo();
    for (const peerId of peerIds) {
      const peer = this.peers.get(peerId);
      if (!peer) continue;

      const socket = this.getPeerSocket(peer);
      const request = {
        requestId: crypto.randomUUID(),
        folderId: folder.id,
        folderName: folder.name,
        folderPath: folder.path,
        type: folder.type,
        ownerInfo: userInfo,
        ownerPort: this.serverPort,
        requestedAt: Date.now(),
      };

      const emit = () => socket.emit('access-request', request);
      if (socket.connected) emit();
      else socket.once('connect', emit);
    }
  }

  sendAccessResponse(request, accepted) {
    const userInfo = store.getUserInfo();
    let host = request.ownerHost || '127.0.0.1';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;

    const socket = ioClient(`http://${host}:${request.ownerPort}`, {
      reconnection: false,
      timeout: 10000,
      transports: ['websocket'],
    });

    socket.on('connect', () => {
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
    const folder = store.getSharedFolders().find((entry) => entry.id === folderId);
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
      for (const info of iface || []) {
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
    for (const socket of this.peerSockets.values()) socket.disconnect();
  }
}

module.exports = { PeerDiscovery };
