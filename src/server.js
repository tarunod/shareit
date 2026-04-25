/**
 * server.js - Local Express + Socket.IO server for peer messaging and file sharing coordination.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { store } = require('./store');
const logger = require('./logger');

const SERVER_PORT_START = 34567;

function emitConversationState(mainWindow) {
  mainWindow.webContents.send('conversation-updated', store.getConversations());
}

function emitInboxState(mainWindow) {
  mainWindow.webContents.send('inbox-updated', store.getInboxItems());
}

function createServer(mainWindow, notifyApp, onAccessRequest) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
      cors: { origin: '*' },
    });

    function tryListen(port) {
      httpServer.listen(port, '0.0.0.0', () => {
        logger.info('Server', `Listening on port ${port}`);
        resolve({ app, io, httpServer, port });
      });

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
    }

    app.get('/health', (req, res) => {
      res.json({ status: 'ok', ...store.getUserInfo() });
    });

    app.get('/file/:folderId/*', (req, res) => {
      const { folderId } = req.params;
      const relativePath = req.params[0];
      const folder = store.getSharedFolders().find((entry) => entry.id === folderId);
      if (!folder) return res.status(404).json({ error: 'Folder not found' });

      let filePath = folder.path;
      if (fs.existsSync(folder.path) && fs.statSync(folder.path).isDirectory()) {
        filePath = path.join(folder.path, relativePath);
      }

      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
      res.sendFile(filePath);
    });

    app.get('/list/:folderId', (req, res) => {
      const folder = store.getSharedFolders().find((entry) => entry.id === req.params.folderId);
      if (!folder) return res.status(404).json({ error: 'Folder not found' });

      try {
        const files = getAllFiles(folder.path, folder.path);
        res.json({ files, folderName: folder.name });
      } catch (err) {
        logger.error('Server', `Failed to list files: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    io.on('connection', (socket) => {
      socket.on('identify', (peerInfo) => {
        socket.peerInfo = peerInfo;
      });

      socket.on('direct-message', (message) => {
        const peer = {
          ...(message.sender || {}),
          ip: socket.handshake.address?.replace('::ffff:', '') || '',
        };
        const stored = store.addIncomingMessage({
          peer,
          type: message.type || 'text',
          text: message.text || '',
          attachments: message.attachments || [],
          meta: message.meta || {},
          timestamp: message.createdAt,
        });
        emitConversationState(mainWindow);
        mainWindow.webContents.send('message-received', stored);
        if (notifyApp) {
          const attachmentCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
          const textSnippet = String(message.text || '').trim();
          const body = textSnippet
            ? textSnippet.slice(0, 120)
            : attachmentCount > 0
              ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`
              : 'New message';
          notifyApp({
            type: 'message',
            title: `Message from ${peer.name || 'Peer'}`,
            message: body,
            level: 'info',
            dedupeKey: `dm:${stored.id}`,
            dedupeMs: 600000,
          });
        }
      });

      socket.on('access-request', (request) => {
        let ip = socket.handshake.address || '';
        if (ip.includes('::ffff:')) ip = ip.replace('::ffff:', '');

        const requestWithHost = { ...request, ownerHost: ip };
        const peer = { ...(request.ownerInfo || {}), ip };
        store.upsertPeerConversation(peer);
        store.addInboxItem({
          id: requestWithHost.requestId,
          type: 'access-request',
          peerId: requestWithHost.ownerInfo?.id,
          peerName: requestWithHost.ownerInfo?.name,
          folderId: requestWithHost.folderId,
          folderName: requestWithHost.folderName,
          resourceType: requestWithHost.type,
          request: requestWithHost,
        });
        store.addSystemMessage({
          peer,
          text: `${requestWithHost.ownerInfo?.name || 'A peer'} wants to share ${requestWithHost.folderName} with you.`,
          meta: {
            kind: 'access-request',
            requestId: requestWithHost.requestId,
            folderId: requestWithHost.folderId,
            request: requestWithHost,
          },
          unread: true,
          timestamp: requestWithHost.requestedAt,
        });
        emitInboxState(mainWindow);
        emitConversationState(mainWindow);
        if (notifyApp) {
          notifyApp({
            type: 'request',
            title: 'New access request',
            message: `${requestWithHost.ownerInfo?.name || 'A peer'} wants to share ${requestWithHost.folderName}.`,
            level: 'info',
            dedupeKey: `request:${requestWithHost.requestId}`,
            dedupeMs: 600000,
          });
        }
      });

      socket.on('access-response', (response) => {
        const peer = response.ownerInfo || { id: 'unknown', name: 'Unknown peer' };
        store.addSystemMessage({
          peer,
          text: response.accepted
            ? `${peer.name} accepted your share request for ${response.folderName}.`
            : `${peer.name} declined your share request for ${response.folderName}.`,
          meta: {
            kind: 'access-response',
            folderId: response.folderId,
            requestId: response.requestId,
            accepted: !!response.accepted,
            folderName: response.folderName,
          },
          unread: true,
        });
        emitConversationState(mainWindow);
        if (notifyApp) {
          notifyApp({
            type: 'request',
            title: response.accepted ? 'Share accepted' : 'Share declined',
            message: response.accepted
              ? `${peer.name} accepted ${response.folderName}.`
              : `${peer.name} declined ${response.folderName}.`,
            level: response.accepted ? 'success' : 'info',
            dedupeKey: `access-response:${response.requestId}:${response.accepted ? 'accepted' : 'rejected'}`,
            dedupeMs: 600000,
          });
        }
        if (response.accepted) {
          mainWindow.webContents.send('access-accepted', response);
        } else {
          mainWindow.webContents.send('access-rejected', response);
        }
      });

    });

    tryListen(SERVER_PORT_START);
  });
}

function getAllFiles(baseDir, currentDir) {
  const stat = fs.statSync(currentDir);
  if (!stat.isDirectory()) {
    const rel = path.relative(baseDir, currentDir).replace(/\\/g, '/');
    return [{
      path: rel || path.basename(currentDir),
      size: stat.size,
      mtime: stat.mtimeMs,
    }];
  }

  const files = [];
  for (const item of fs.readdirSync(currentDir)) {
    const fullPath = path.join(currentDir, item);
    const itemStat = fs.statSync(fullPath);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (itemStat.isDirectory()) files.push(...getAllFiles(baseDir, fullPath));
    else files.push({ path: relPath, size: itemStat.size, mtime: itemStat.mtimeMs });
  }
  return files;
}

module.exports = { createServer };
