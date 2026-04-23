/**
 * server.js — Local Express + Socket.IO server for peer communication
 * Handles file transfer requests and sync events between peers
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { store } = require('./store');
const logger = require('./logger');

const SYNC_PORT_START = 34567;

function createServer(mainWindow) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
      cors: { origin: '*' },
    });

    let port = SYNC_PORT_START;

    const tryListen = (p) => {
      httpServer.listen(p, '0.0.0.0', () => {
        logger.info('Server', `Successfully listening on port ${p}`);
        resolve({ app, io, httpServer, port: p });
      });

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn('Server', `Port ${p} is in use, trying ${p + 1}...`);
          tryListen(p + 1);
        } else {
          logger.error('Server', `Server error: ${err.message}`);
          reject(err);
        }
      });
    };

    // REST endpoints for file chunks
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', ...store.getUserInfo() });
    });

    // Serve file chunks for sync
    app.get('/file/:folderId/*', (req, res) => {
      const { folderId } = req.params;
      const relativePath = req.params[0];
      const sharedFolders = store.getSharedFolders();
      const folder = sharedFolders.find(f => f.id === folderId);
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      
      let filePath;
      if (fs.existsSync(folder.path) && !fs.statSync(folder.path).isDirectory()) {
        filePath = folder.path;
      } else {
        filePath = path.join(folder.path, relativePath);
      }
      
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
      logger.info('Server', `Serving file chunk: ${relativePath} for folder ${folder.name}`);
      res.sendFile(filePath);
    });

    // List files in a shared folder
    app.get('/list/:folderId', (req, res) => {
      const { folderId } = req.params;
      const sharedFolders = store.getSharedFolders();
      const folder = sharedFolders.find(f => f.id === folderId);
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      try {
        const files = getAllFiles(folder.path, folder.path);
        logger.info('Server', `Listed ${files.length} files for folder ${folder.name}`);
        res.json({ files, folderName: folder.name });
      } catch (e) {
        logger.error('Server', `Failed to list files for folder ${folder.name}: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    });

    // Socket.IO events for real-time peer communication
    io.on('connection', (socket) => {
      logger.info('Server', `Peer connected: ${socket.id} (${socket.handshake.address})`);

      socket.on('identify', (peerInfo) => {
        logger.info('Server', `Peer identified as ${peerInfo.name}`);
        socket.peerInfo = peerInfo;
      });

      socket.on('access-request', (request) => {
        let ip = socket.handshake.address;
        if (ip.includes('::ffff:')) ip = ip.replace('::ffff:', '');
        logger.info('Server', `Received access request from ${ip} for folder ${request.folderName}`);
        mainWindow.webContents.send('access-request', {
          ...request,
          ownerHost: ip,
          socketId: socket.id,
        });
      });

      socket.on('access-response', (response) => {
        logger.info('Server', `Received access response for ${response.folderName}: accepted=${response.accepted}`);
        mainWindow.webContents.send('access-response', response);
        if (response.accepted) {
          mainWindow.webContents.send('access-accepted', response);
        } else {
          mainWindow.webContents.send('access-rejected', response);
        }
      });

      socket.on('sync-notify', (data) => {
        logger.info('Server', `Received sync-notify for folder ${data.folderName}: ${data.file} ${data.event}`);
        mainWindow.webContents.send('sync-notify', data);
      });

      socket.on('disconnect', () => {
        logger.info('Server', `Peer disconnected: ${socket.id}`);
      });
    });

    tryListen(port);
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

  const results = [];
  const items = fs.readdirSync(currentDir);
  for (const item of items) {
    const fullPath = path.join(currentDir, item);
    const itemStat = fs.statSync(fullPath);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (itemStat.isDirectory()) {
      results.push(...getAllFiles(baseDir, fullPath));
    } else {
      results.push({
        path: relPath,
        size: itemStat.size,
        mtime: itemStat.mtimeMs,
      });
    }
  }
  return results;
}

module.exports = { createServer };
