/**
 * sync.js — File sync engine using chokidar for watching and HTTP for fetching
 * Syncs received folders into C:\ShareIt\<folderName>\
 */
const chokidar = require('chokidar');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');
const { store } = require('./store');
const logger = require('./logger');

class SyncManager {
  constructor(mainWindow, masterFolder, peerDiscovery, notifyApp) {
    this.mainWindow = mainWindow;
    this.masterFolder = masterFolder;
    this.peerDiscovery = peerDiscovery;
    this.notifyApp = notifyApp;
    this.watchers = new Map(); // folderId -> chokidar watcher
    this.progress = new Map(); // folderId -> progress info
    this.syncTimers = new Map(); // folderId -> interval
    this.lastNotifiedStatus = new Map();
  }

  start() {
    // Watch shared folders for changes
    this.watchSharedFolders();

    // Periodically sync received folders
    this.syncReceivedFolders();
    setInterval(() => this.syncReceivedFolders(), 15000); // Re-sync every 15s
  }

  watchSharedFolders() {
    const sharedFolders = store.getSharedFolders();
    for (const folder of sharedFolders) {
      this.watchFolder(folder);
    }
  }

  watchFolder(folder) {
    if (this.watchers.has(folder.id)) return;
    if (!fs.existsSync(folder.path)) return;

    const watcher = chokidar.watch(folder.path, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    watcher.on('all', (event, filePath) => {
      const relPath = path.relative(folder.path, filePath).replace(/\\/g, '/');
      logger.info('Sync', `File ${event}: ${relPath} in folder ${folder.name}`);
      // Notify discovery module (if available globally)
      // Discovery will push to peers
      this.mainWindow.webContents.send('sync-notify', {
        folderId: folder.id,
        folderName: folder.name,
        event,
        file: relPath,
      });
    });

    this.watchers.set(folder.id, watcher);
  }

  unwatchFolder(folderId) {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(folderId);
      logger.info('Sync', `Unwatched folder ${folderId}`);
    }
  }

  async syncReceivedFolders() {
    const receivedFolders = store.getReceivedFolders();
    for (const folder of receivedFolders) {
      if (folder.status === 'revoked') continue;
      this.syncFolder(folder);
    }
  }

  async syncFolder(folder) {
    // If it's a file, we want to save it directly into the peer's folder, not a subfolder named after the file
    let targetDir = folder.syncPath || path.join(this.masterFolder, folder.ownerInfo?.name || 'Unknown', folder.name);
    if (folder.type === 'file') {
      targetDir = path.dirname(targetDir);
    }
    fse.ensureDirSync(targetDir);

    // Try to get latest IP from discovery if available
    let host = folder.ownerHost;
    if (this.peerDiscovery && folder.ownerInfo?.id) {
      const peers = this.peerDiscovery.getPeers();
      const currentPeer = peers.find(p => p.id === folder.ownerInfo.id);
      if (currentPeer && currentPeer.ip) {
        host = currentPeer.ip;
      }
    }

    if (!host || host === 'undefined') host = '127.0.0.1';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
    const baseUrl = `http://${host}:${folder.ownerPort}`;

    try {
      // Get file list from owner
      logger.info('Sync', `Starting sync for folder ${folder.name} from ${baseUrl}`);
      const fileList = await this.fetchJSON(`${baseUrl}/list/${folder.id}`);
      const files = fileList.files || [];
      store.upsertTransfer({
        id: `sync:${folder.id}`,
        kind: 'sync',
        folderId: folder.id,
        folderName: folder.name,
        peerName: folder.ownerInfo?.name || 'Unknown peer',
        status: 'syncing',
        percent: 0,
      });
      this.notifySyncMilestone(folder, 'syncing', `Sync started for ${folder.name}`);

      this.progress.set(folder.id, {
        folderId: folder.id,
        folderName: folder.name,
        total: files.length,
        done: 0,
        status: 'syncing',
        percent: 0,
        lastSync: null,
        syncedFiles: [],
      });
      this.emitProgress(folder.id);

      let done = 0;
      for (const file of files) {
        const targetFile = path.join(targetDir, file.path.replace(/\//g, path.sep));
        const needsSync = this.needsSync(targetFile, file);

        if (needsSync) {
          logger.info('Sync', `Downloading file ${file.path} to ${targetFile}`);
          const pData = this.progress.get(folder.id);
          pData.currentFile = { name: file.path, size: file.size, source: baseUrl };
          this.emitProgress(folder.id);
          
          const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
          await this.downloadFile(`${baseUrl}/file/${folder.id}/${encodedPath}`, targetFile);
          
          pData.syncedFiles.push(pData.currentFile);
          pData.currentFile = null;
        }

        done++;
        const pData = this.progress.get(folder.id);
        this.progress.set(folder.id, {
          ...pData,
          done,
          percent: Math.round((done / files.length) * 100),
        });
        store.upsertTransfer({
          id: `sync:${folder.id}`,
          kind: 'sync',
          folderId: folder.id,
          folderName: folder.name,
          peerName: folder.ownerInfo?.name || 'Unknown peer',
          status: 'syncing',
          percent: Math.round((done / files.length) * 100),
          currentFile: file.path,
        });
        this.emitProgress(folder.id);
      }

      this.progress.set(folder.id, {
        ...this.progress.get(folder.id),
        status: 'synced',
        lastSync: Date.now(),
        percent: 100,
      });
      this.emitProgress(folder.id);
      store.updateReceivedFolder(folder.id, { status: 'synced', lastSync: Date.now() });
      store.upsertTransfer({
        id: `sync:${folder.id}`,
        kind: 'sync',
        folderId: folder.id,
        folderName: folder.name,
        peerName: folder.ownerInfo?.name || 'Unknown peer',
        status: 'synced',
        percent: 100,
        lastSync: Date.now(),
      });
      this.notifySyncMilestone(folder, 'synced', `Sync completed for ${folder.name}`);
      logger.info('Sync', `Completed sync for folder ${folder.name}`);

    } catch (err) {
      logger.error('Sync', `Error syncing ${folder.name}: ${err.message}`);
      this.progress.set(folder.id, {
        ...(this.progress.get(folder.id) || { folderId: folder.id, folderName: folder.name }),
        status: 'error',
        error: err.message,
      });
      store.upsertTransfer({
        id: `sync:${folder.id}`,
        kind: 'sync',
        folderId: folder.id,
        folderName: folder.name,
        peerName: folder.ownerInfo?.name || 'Unknown peer',
        status: 'error',
        percent: 0,
        error: err.message,
      });
      this.notifySyncMilestone(folder, 'error', `Sync failed for ${folder.name}: ${err.message}`);
      this.emitProgress(folder.id);
    }
  }

  setMasterFolder(masterFolder) {
    this.masterFolder = masterFolder;
  }

  needsSync(localPath, remoteFile) {
    if (!fs.existsSync(localPath)) return true;
    const stat = fs.statSync(localPath);
    // Sync if size differs or remote is newer
    return stat.size !== remoteFile.size || stat.mtimeMs < remoteFile.mtime;
  }

  downloadFile(url, targetPath) {
    return new Promise((resolve, reject) => {
      fse.ensureDirSync(path.dirname(targetPath));
      const file = fs.createWriteStream(targetPath);
      const protocol = url.startsWith('https') ? https : http;
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    });
  }

  fetchJSON(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      protocol.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  emitProgress(folderId) {
    const prog = this.progress.get(folderId);
    if (prog) {
      this.mainWindow.webContents.send('sync-progress', prog);
      this.mainWindow.webContents.send('transfer-updated', store.getTransfers());
    }
  }

  notifySyncMilestone(folder, status, message) {
    if (!this.notifyApp) return;
    if (this.lastNotifiedStatus.get(folder.id) === status) return;
    this.lastNotifiedStatus.set(folder.id, status);
    this.notifyApp({
      type: 'sync',
      title: status === 'error' ? 'Sync error' : status === 'synced' ? 'Sync completed' : 'Sync started',
      message,
      level: status === 'error' ? 'error' : status === 'synced' ? 'success' : 'info',
    });
  }

  getProgress() {
    const result = {};
    for (const [id, prog] of this.progress.entries()) {
      result[id] = prog;
    }
    return result;
  }

  stop() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    for (const timer of this.syncTimers.values()) {
      clearInterval(timer);
    }
  }
}

module.exports = { SyncManager };
