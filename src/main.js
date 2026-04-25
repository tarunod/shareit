const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const chokidar = require('chokidar');
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createServer } = require('./server');
const { PeerDiscovery } = require('./discovery');
const { store, getConversationId } = require('./store');
const logger = require('./logger');

let mainWindow;
let tray;
let peerDiscovery;
let server;
let devReloader;
let devReloadRestarting = false;
let updateCheckTimer = null;
let autoUpdaterConfigured = false;
const promptedAccessRequests = new Set();
const notificationDedup = new Map();
const updateStatusState = {
  status: 'idle',
  title: 'Updater idle',
  message: '',
  progress: 0,
  version: null,
  releaseDate: null,
  canDownload: false,
  canInstall: false,
  isSkipped: false,
  checkedAt: null,
};

const APP_ICON_PATH = path.join(__dirname, '../img/socket_icon.png');

function getAppIcon() {
  if (!fs.existsSync(APP_ICON_PATH)) return nativeImage.createEmpty();
  return nativeImage.createFromPath(APP_ICON_PATH);
}

function emitConversations() {
  mainWindow.webContents.send('conversation-updated', store.getConversations());
}

function emitInbox() {
  mainWindow.webContents.send('inbox-updated', store.getInboxItems());
}

function emitWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window-state-changed', {
    isMaximized: mainWindow.isMaximized(),
  });
}

function isWindowForeground() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isVisible() && !mainWindow.isMinimized();
}

function notifyApp(event) {
  const dedupeKey = event?.dedupeKey || `${event?.type || 'info'}:${event?.title || ''}:${event?.message || ''}`;
  const dedupeMs = Number(event?.dedupeMs) > 0 ? Number(event.dedupeMs) : 12000;
  const now = Date.now();
  const lastSeen = notificationDedup.get(dedupeKey) || 0;
  if (now - lastSeen < dedupeMs) return;
  notificationDedup.set(dedupeKey, now);

  const settings = store.getSettings();
  const soundEnabled = settings.notificationSoundEnabled !== false;
  const payload = {
    id: event.id || crypto.randomUUID(),
    type: event.type || 'info',
    title: event.title || 'Socket',
    message: event.message || '',
    at: Date.now(),
    playSound: soundEnabled,
    level: event.level || 'info',
    dedupeKey,
  };

  if (isWindowForeground()) {
    mainWindow.webContents.send('app-notification', payload);
    return;
  }

  if (Notification.isSupported()) {
    const desktop = new Notification({
      title: payload.title,
      body: payload.message,
      silent: !soundEnabled,
      icon: APP_ICON_PATH,
    });
    desktop.show();
  }
}

function emitUpdateStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  Object.assign(updateStatusState, status || {});
  mainWindow.webContents.send('update-status', {
    ...updateStatusState,
  });
}

function currentUpdateStatus() {
  return { ...updateStatusState };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    frame: false,
    backgroundColor: '#0b0d11',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: APP_ICON_PATH,
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);
  mainWindow.on('restore', emitWindowState);
  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  tray = new Tray(getAppIcon());
  tray.setToolTip('Socket - Local network messaging and file sharing');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Socket', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]));
  tray.on('double-click', () => mainWindow.show());
}

function createSharedItem(folderPath, peerIds, sendRequest = true) {
  const userInfo = store.getUserInfo();
  const stats = fs.statSync(folderPath);
  const type = stats.isDirectory() ? 'folder' : 'file';
  const folder = {
    id: crypto.randomUUID(),
    path: folderPath,
    name: path.basename(folderPath),
    type,
    sharedBy: userInfo,
    sharedAt: Date.now(),
    peers: peerIds,
  };

  store.addSharedFolder(folder);
  if (sendRequest && peerDiscovery) peerDiscovery.sendAccessRequest(folder, peerIds);
  return folder;
}

function addAttachmentMessages(peer, sharedItems, deliveryStatus = 'requested') {
  const messages = [];
  for (const item of sharedItems) {
    const message = store.addOutgoingMessage({
      peer,
      type: 'attachment',
      text: '',
      attachments: [{
        id: item.id,
        name: item.name,
        path: item.path,
        resourceType: item.type,
      }],
      meta: { shareId: item.id, resourceType: item.type, deliveryStatus },
    });
    messages.push(message);
  }
  return messages;
}

function sendMessagePayload(payload) {
  const onlinePeer = peerDiscovery?.getPeerById(payload.peerId);
  const peer = onlinePeer || store.getPeerRecord(payload.peerId);
  if (!peer) throw new Error('Selected peer is unknown');
  const isOnline = !!onlinePeer;

  if (payload.text && payload.text.trim()) {
    const message = store.addOutgoingMessage({
      peer,
      type: 'text',
      text: payload.text.trim(),
      attachments: [],
      meta: { deliveryStatus: isOnline ? 'sent' : 'queued' },
    });
    if (isOnline) {
      peerDiscovery.sendDirectMessage(peer.id, {
        id: message.id,
        type: 'text',
        text: message.text,
        attachments: [],
        createdAt: message.createdAt,
      });
    } else {
      store.addOutboxItem({
        peerId: peer.id,
        kind: 'text',
        messageId: message.id,
        text: message.text,
        createdAt: message.createdAt,
      });
    }
  }

  const attachmentPaths = payload.attachments || [];
  if (attachmentPaths.length > 0) {
    const sharedItems = attachmentPaths.map((filePath) => createSharedItem(filePath, [peer.id], isOnline));
    addAttachmentMessages(peer, sharedItems, isOnline ? 'requested' : 'queued');
    if (!isOnline) {
      for (const item of sharedItems) {
        store.addOutboxItem({
          peerId: peer.id,
          kind: 'share',
          folderId: item.id,
          createdAt: Date.now(),
        });
      }
    }
  }

  emitConversations();
  return { conversationId: getConversationId(peer.id) };
}

function flushQueuedForPeer(peer) {
  if (!peerDiscovery || !peer?.id) return;
  const queuedItems = store.getOutboxItems(peer.id);
  for (const item of queuedItems) {
    try {
      if (item.kind === 'text') {
        peerDiscovery.sendDirectMessage(peer.id, {
          id: item.messageId,
          type: 'text',
          text: item.text,
          attachments: [],
          createdAt: item.createdAt,
          meta: { deliveredFromQueue: true },
        });
        store.removeOutboxItem(item.id);
      }
      if (item.kind === 'share') {
        const folder = store.getSharedFolders().find((entry) => entry.id === item.folderId);
        if (!folder) {
          store.removeOutboxItem(item.id);
          continue;
        }
        peerDiscovery.sendAccessRequest(folder, [peer.id]);
        store.removeOutboxItem(item.id);
      }
    } catch (error) {
      logger.warn('Outbox', `Failed to flush queued ${item.kind} for ${peer.name || peer.id}: ${error.message}`);
    }
  }
  if (queuedItems.length) {
    emitConversations();
  }
}

function requestURL(url, responseHandler) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      responseHandler(response, resolve, reject);
    });
    req.on('error', reject);
  });
}

function fetchJSON(url) {
  return requestURL(url, (response, resolve, reject) => {
    let data = '';
    response.on('data', (chunk) => { data += chunk; });
    response.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    response.on('error', reject);
  });
}

function downloadFile(url, targetPath) {
  return requestURL(url, (response, resolve, reject) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const file = fs.createWriteStream(targetPath);
    response.pipe(file);
    file.on('finish', () => {
      file.close(resolve);
    });
    file.on('error', reject);
    response.on('error', reject);
  });
}

function getPeerDownloadHost(request) {
  let host = request.ownerHost;
  if (peerDiscovery && request.ownerInfo?.id) {
    const currentPeer = peerDiscovery.getPeers().find((peer) => peer.id === request.ownerInfo.id);
    if (currentPeer?.ip) host = currentPeer.ip;
  }
  if (!host || host === 'undefined') host = '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return host;
}

async function downloadAcceptedShare(request, destinationPath) {
  const host = getPeerDownloadHost(request);
  const baseUrl = `http://${host}:${request.ownerPort}`;
  logger.info('Share', `Downloading ${request.folderName} from ${baseUrl}`);

  const fileList = await fetchJSON(`${baseUrl}/list/${request.folderId}`);
  const files = fileList.files || [];

  for (const file of files) {
    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
    const targetPath = request.type === 'file'
      ? destinationPath
      : path.join(destinationPath, file.path.replace(/\//g, path.sep));
    await downloadFile(`${baseUrl}/file/${request.folderId}/${encodedPath}`, targetPath);
  }
}

async function chooseShareDestination(request) {
  const downloadsDir = app.getPath('downloads');
  const itemName = request.folderName || 'Shared item';
  const itemType = request.type || 'folder';

  if (itemType === 'file') {
    const options = {
      title: `Save ${itemName}`,
      defaultPath: path.join(downloadsDir, itemName),
      buttonLabel: 'Save',
    };
    const result = mainWindow && mainWindow.isVisible()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : result.filePath;
  }

  const options = {
    properties: ['openDirectory', 'createDirectory'],
    title: `Choose where to save ${itemName}`,
    buttonLabel: 'Choose folder',
    defaultPath: downloadsDir,
  };
  const result = mainWindow && mainWindow.isVisible()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths?.[0]) return null;
  return path.join(result.filePaths[0], itemName);
}

function finishAcceptedDownload(request, destinationPath) {
  downloadAcceptedShare(request, destinationPath).then(() => {
    store.updateReceivedFolder(request.folderId, { status: 'downloaded', downloadedAt: Date.now() });
  }).catch((error) => {
    logger.error('Share', `Download failed for ${request.folderName}: ${error.message}`);
    store.updateReceivedFolder(request.folderId, { status: 'error', error: error.message });
  });
}

async function acceptAccessRequest(request) {
  const destinationPath = await chooseShareDestination(request);
  if (!destinationPath) return false;

  const receivedFolder = {
    id: request.folderId,
    name: request.folderName,
    type: request.type || 'folder',
    savePath: destinationPath,
    ownerInfo: request.ownerInfo,
    ownerHost: request.ownerHost,
    ownerPort: request.ownerPort,
    acceptedAt: Date.now(),
    status: 'accepted',
  };
  store.addReceivedFolder(receivedFolder);
  store.updateInboxItem(request.requestId, { status: 'accepted' });
  store.addSystemMessage({
    peer: request.ownerInfo,
    text: `You accepted ${request.folderName}. Download is starting locally.`,
    meta: {
      kind: 'access-accepted-local',
      folderId: request.folderId,
      requestId: request.requestId,
      request,
    },
  });
  if (peerDiscovery) peerDiscovery.sendAccessResponse(request, true);
  finishAcceptedDownload(request, destinationPath);
  emitInbox();
  emitConversations();
  return true;
}

function rejectAccessRequest(request) {
  store.updateInboxItem(request.requestId, { status: 'rejected' });
  store.addSystemMessage({
    peer: request.ownerInfo,
    text: `You declined ${request.folderName}.`,
    meta: {
      kind: 'access-rejected-local',
      folderId: request.folderId,
      requestId: request.requestId,
      request,
    },
  });
  if (peerDiscovery) peerDiscovery.sendAccessResponse(request, false);
  emitInbox();
  emitConversations();
  return true;
}

async function promptForAccessRequest(request) {
  if (!request?.requestId || promptedAccessRequests.has(request.requestId)) return;
  promptedAccessRequests.add(request.requestId);

  const senderName = request.ownerInfo?.name || 'A peer';
  const options = {
    type: 'question',
    buttons: ['Accept', 'Later', 'Reject'],
    defaultId: 0,
    cancelId: 1,
    title: 'Incoming file share',
    message: `${senderName} wants to share "${request.folderName}" with you.`,
    detail: 'Accept to choose where to save it, or handle it later from the app.',
  };
  const result = mainWindow && mainWindow.isVisible()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);

  if (result.response === 0) await acceptAccessRequest(request);
  if (result.response === 2) rejectAccessRequest(request);
}

function registerHandlers() {
  ipcMain.handle('get-user-info', () => store.getUserInfo());
  ipcMain.handle('set-user-info', (_, info) => {
    store.setUserInfo(info);
    if (peerDiscovery) peerDiscovery.updateUserInfo(info);
    return true;
  });
  ipcMain.handle('get-settings', () => store.getSettings());
  ipcMain.handle('set-settings', (_, settingsPatch) => {
    const settings = store.setSettings(settingsPatch || {});
    if (autoUpdaterConfigured) {
      autoUpdater.autoDownload = settings.autoDownloadUpdates !== false;
    }
    if (peerDiscovery) peerDiscovery.updateUserInfo();
    return settings;
  });
  ipcMain.handle('get-update-status', () => currentUpdateStatus());
  ipcMain.handle('get-peers', () => peerDiscovery ? peerDiscovery.getPeers() : []);
  ipcMain.handle('get-shared-folders', () => store.getSharedFolders());
  ipcMain.handle('get-received-folders', () => store.getReceivedFolders());
  ipcMain.handle('get-conversations', () => store.getConversations());
  ipcMain.handle('get-messages', (_, conversationId) => store.getMessages(conversationId));
  ipcMain.handle('get-inbox-items', () => store.getInboxItems());
  ipcMain.handle('mark-conversation-read', (_, conversationId) => store.markConversationRead(conversationId));

  ipcMain.handle('send-message', async (_, payload) => {
    return sendMessagePayload(payload);
  });

  ipcMain.handle('send-files', async (_, payload) => {
    return sendMessagePayload(payload);
  });

  ipcMain.handle('pick-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Select file to send',
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder to send',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('resolve-path-kinds', (_, paths) => {
    if (!Array.isArray(paths)) return [];
    return paths
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => {
        const normalized = entry.trim();
        let kind = 'file';
        try {
          const stats = fs.statSync(normalized);
          kind = stats.isDirectory() ? 'folder' : 'file';
        } catch (error) {
          kind = 'file';
        }
        return {
          path: normalized,
          name: path.basename(normalized),
          kind,
        };
      });
  });

  ipcMain.handle('save-pasted-image', (_, payload) => {
    if (!payload || !Array.isArray(payload.bytes) || payload.bytes.length === 0) return null;
    const mimeType = payload.mimeType || 'image/png';
    const extMap = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/bmp': '.bmp',
    };
    const extension = extMap[mimeType] || '.png';
    const dir = path.join(os.tmpdir(), 'socket-clipboard');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `paste-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`);
    fs.writeFileSync(target, Buffer.from(payload.bytes));
    return target;
  });

  ipcMain.handle('share-folder', async (_, { folderPath, peerIds }) => {
    const item = createSharedItem(folderPath, peerIds);
    return item;
  });

  ipcMain.handle('stop-sharing', (_, folderId) => {
    store.removeSharedFolder(folderId);
    return true;
  });

  ipcMain.handle('open-received-folder', (_, folderId) => {
    const folder = store.getReceivedFolders().find((entry) => entry.id === folderId);
    if (!folder) return false;
    shell.openPath(folder.savePath);
    return true;
  });

  ipcMain.handle('accept-access', async (_, request) => acceptAccessRequest(request));

  ipcMain.handle('reject-access', (_, request) => rejectAccessRequest(request));

  ipcMain.handle('get-window-state', () => ({
    isMaximized: mainWindow ? mainWindow.isMaximized() : false,
  }));
  ipcMain.handle('check-for-updates', async (_, payload) => {
    if (!autoUpdaterConfigured) {
      return { skipped: true, reason: 'updater-not-configured' };
    }
    const force = !!payload?.force;
    if (force) {
      store.setSettings({ ignoredUpdateVersion: null });
    }
    store.setSettings({ lastUpdateCheckAt: Date.now() });
    await autoUpdater.checkForUpdates();
    return { ok: true };
  });
  ipcMain.handle('download-update', async () => {
    if (!autoUpdaterConfigured) return { ok: false, reason: 'updater-not-configured' };
    await autoUpdater.downloadUpdate();
    return { ok: true };
  });
  ipcMain.handle('skip-update-version', (_, version) => {
    const target = typeof version === 'string' && version.trim() ? version.trim() : null;
    store.setSettings({ ignoredUpdateVersion: target });
    emitUpdateStatus({
      status: target ? 'skipped' : 'idle',
      title: target ? 'Update skipped' : updateStatusState.title,
      message: target ? `Version ${target} is skipped.` : updateStatusState.message,
      isSkipped: !!target,
      canDownload: false,
    });
    return { ok: true, ignoredUpdateVersion: target };
  });
  ipcMain.handle('quit-and-install', () => {
    if (!autoUpdaterConfigured) return false;
    autoUpdater.quitAndInstall();
    return true;
  });

  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    emitWindowState();
  });
  ipcMain.on('window-close', () => mainWindow.hide());
}

function setupAutoUpdater() {
  if (process.defaultApp || /[\\/]electron[\\/]/.test(process.execPath)) {
    logger.info('Updater', 'Skipping auto-update in development mode');
    emitUpdateStatus({
      status: 'disabled',
      title: 'Development mode',
      message: 'Auto-update is disabled while running in development mode.',
      checkedAt: Date.now(),
      canDownload: false,
      canInstall: false,
    });
    return;
  }

  autoUpdaterConfigured = true;
  autoUpdater.logger = logger;
  const settings = store.getSettings();
  autoUpdater.autoDownload = settings.autoDownloadUpdates !== false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    store.setSettings({ lastUpdateCheckAt: Date.now() });
    emitUpdateStatus({
      status: 'checking',
      title: 'Checking for updates',
      message: 'Looking for a new release.',
      checkedAt: Date.now(),
      canDownload: false,
      canInstall: false,
      isSkipped: false,
    });
  });
  autoUpdater.on('update-available', (info) => {
    const appSettings = store.getSettings();
    const skipped = !!(appSettings.ignoredUpdateVersion && appSettings.ignoredUpdateVersion === info?.version);
    if (skipped) {
      emitUpdateStatus({
        status: 'skipped',
        title: 'Update skipped',
        message: `Version ${info?.version || 'new'} is skipped.`,
        version: info?.version || null,
        releaseDate: info?.releaseDate || null,
        isSkipped: true,
        canDownload: false,
        canInstall: false,
      });
      return;
    }
    emitUpdateStatus({
      status: autoUpdater.autoDownload ? 'downloading' : 'available',
      title: autoUpdater.autoDownload ? 'Downloading update' : 'Update available',
      message: autoUpdater.autoDownload
        ? `Downloading version ${info?.version || 'new'}.`
        : `Version ${info?.version || 'new'} is available.`,
      version: info?.version || null,
      releaseDate: info?.releaseDate || null,
      isSkipped: false,
      canDownload: autoUpdater.autoDownload ? false : true,
      canInstall: false,
    });
    notifyApp({
      type: 'update',
      title: 'Update available',
      message: `Version ${info?.version || 'new'} is available for download.`,
      level: 'info',
      dedupeKey: `update-available:${info?.version || 'unknown'}`,
      dedupeMs: 3600000,
    });
  });
  autoUpdater.on('update-not-available', () => {
    emitUpdateStatus({
      status: 'idle',
      title: 'Up to date',
      message: 'You are on the latest version.',
      checkedAt: Date.now(),
      canDownload: false,
      canInstall: false,
      isSkipped: false,
    });
  });
  autoUpdater.on('error', (err) => {
    emitUpdateStatus({
      status: 'failed',
      title: 'Update failed',
      message: err.message,
      canDownload: false,
      canInstall: false,
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus({
      status: 'downloading',
      title: 'Downloading update',
      message: `Downloaded ${Math.round(progress.percent || 0)}%.`,
      progress: Number(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond || 0,
      canDownload: false,
      canInstall: false,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({
      status: 'ready',
      title: 'Update ready',
      message: `Version ${info?.version || 'new'} is ready to install.`,
      version: info?.version || null,
      releaseDate: info?.releaseDate || null,
      progress: 100,
      canDownload: false,
      canInstall: true,
      isSkipped: false,
    });
    notifyApp({
      type: 'update',
      title: 'Update ready',
      message: `Version ${info?.version || 'new'} will install after restart.`,
      level: 'success',
      dedupeKey: `update-ready:${info?.version || 'unknown'}`,
      dedupeMs: 3600000,
    });
  });

  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(() => {
    const latestSettings = store.getSettings();
    if (latestSettings.autoCheckUpdates === false) return;
    autoUpdater.autoDownload = latestSettings.autoDownloadUpdates !== false;
    autoUpdater.checkForUpdates().catch((error) => {
      logger.warn('Updater', `Periodic check failed: ${error.message}`);
    });
  }, 30 * 60 * 1000);

  if (settings.autoCheckUpdates !== false) {
    autoUpdater.checkForUpdates().catch((error) => {
      logger.warn('Updater', `Initial check failed: ${error.message}`);
    });
  } else {
    emitUpdateStatus({
      status: 'idle',
      title: 'Auto-check disabled',
      message: 'Use Check now in Settings to fetch updates.',
      checkedAt: settings.lastUpdateCheckAt || null,
      canDownload: false,
      canInstall: false,
      isSkipped: false,
    });
  }
}

function setupDevReload() {
  if (!process.defaultApp && !/([\\/]electron[\\/])/.test(process.execPath)) return;

  const watchPaths = [
    path.join(__dirname, '..', 'renderer'),
    path.join(__dirname, 'main.js'),
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, 'server.js'),
    path.join(__dirname, 'discovery.js'),
    path.join(__dirname, 'store.js'),
    path.join(__dirname, 'logger.js'),
  ];

  let restartTimer = null;
  const scheduleRestart = (filePath) => {
    logger.info('DevReload', `Detected change in ${path.relative(path.join(__dirname, '..'), filePath)}`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (devReloadRestarting) return;
      devReloadRestarting = true;
      if (devReloader) devReloader.close();
      app.relaunch();
      app.exit(0);
    }, 300);
  };

  devReloader = chokidar.watch(watchPaths, {
    ignored: [
      /node_modules/,
      /[\\/]\.git/,
      /task_\d+_[a-z]+\.md$/i,
      /design\.md$/i,
    ],
    ignoreInitial: true,
    persistent: true,
  });

  devReloader.on('all', (_, filePath) => scheduleRestart(filePath));
  logger.info('DevReload', 'Watching local source files for changes');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerHandlers();
    createWindow();
    createTray();
    server = await createServer(mainWindow, notifyApp, promptForAccessRequest);
    peerDiscovery = new PeerDiscovery(mainWindow, server.port, notifyApp, flushQueuedForPeer);
    peerDiscovery.start();
    emitConversations();
    emitInbox();
    setupDevReload();
    setupAutoUpdater();
  });

  app.on('before-quit', () => {
    if (devReloader) devReloader.close();
    if (updateCheckTimer) clearInterval(updateCheckTimer);
    if (peerDiscovery) peerDiscovery.stop();
  });
}
