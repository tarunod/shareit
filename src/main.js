const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createServer } = require('./server');
const { PeerDiscovery } = require('./discovery');
const { SyncManager } = require('./sync');
const { store, getConversationId } = require('./store');
const logger = require('./logger');

let mainWindow;
let tray;
let peerDiscovery;
let syncManager;
let server;
let devReloader;
let devReloadRestarting = false;

const APP_ICON_PATH = path.join(__dirname, '../img/socket_icon.png');

function getAppIcon() {
  if (!fs.existsSync(APP_ICON_PATH)) return nativeImage.createEmpty();
  return nativeImage.createFromPath(APP_ICON_PATH);
}

function getMasterFolder() {
  const folder = store.getMasterFolder();
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
}

function emitConversations() {
  mainWindow.webContents.send('conversation-updated', store.getConversations());
}

function emitTransfers() {
  mainWindow.webContents.send('transfer-updated', store.getTransfers());
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
  tray.setToolTip('Socket - Local network messaging and transfers');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Socket', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Open Master Folder', click: () => shell.openPath(getMasterFolder()) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]));
  tray.on('double-click', () => mainWindow.show());
}

function createSharedItem(folderPath, peerIds) {
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
  if (syncManager) syncManager.watchFolder(folder);
  if (peerDiscovery) peerDiscovery.sendAccessRequest(folder, peerIds);
  return folder;
}

function addAttachmentMessages(peer, sharedItems) {
  for (const item of sharedItems) {
    store.addOutgoingMessage({
      peer,
      type: 'attachment',
      text: '',
      attachments: [{
        id: item.id,
        name: item.name,
        path: item.path,
        resourceType: item.type,
      }],
      meta: { transferId: item.id, resourceType: item.type },
    });
    store.upsertTransfer({
      id: item.id,
      kind: 'share',
      folderId: item.id,
      folderName: item.name,
      peerId: peer.id,
      peerName: peer.name,
      status: 'requested',
      percent: 0,
      resourceType: item.type,
    });
  }
}

function sendMessagePayload(payload) {
  const peer = peerDiscovery?.getPeerById(payload.peerId);
  if (!peer) throw new Error('Selected peer is not currently available on your network');

  if (payload.text && payload.text.trim()) {
    const message = store.addOutgoingMessage({
      peer,
      type: 'text',
      text: payload.text.trim(),
      attachments: [],
    });
    peerDiscovery.sendDirectMessage(peer.id, {
      id: message.id,
      type: 'text',
      text: message.text,
      attachments: [],
      createdAt: message.createdAt,
    });
  }

  const attachmentPaths = payload.attachments || [];
  if (attachmentPaths.length > 0) {
    const sharedItems = attachmentPaths.map((filePath) => createSharedItem(filePath, [peer.id]));
    addAttachmentMessages(peer, sharedItems);
  }

  emitConversations();
  emitTransfers();
  return { conversationId: getConversationId(peer.id) };
}

function registerHandlers() {
  ipcMain.handle('get-user-info', () => store.getUserInfo());
  ipcMain.handle('set-user-info', (_, info) => {
    store.setUserInfo(info);
    if (peerDiscovery) peerDiscovery.updateUserInfo(info);
    return true;
  });
  ipcMain.handle('get-peers', () => peerDiscovery ? peerDiscovery.getPeers() : []);
  ipcMain.handle('get-shared-folders', () => store.getSharedFolders());
  ipcMain.handle('get-received-folders', () => store.getReceivedFolders());
  ipcMain.handle('get-sync-progress', () => syncManager ? syncManager.getProgress() : {});
  ipcMain.handle('get-conversations', () => store.getConversations());
  ipcMain.handle('get-messages', (_, conversationId) => store.getMessages(conversationId));
  ipcMain.handle('get-inbox-items', () => store.getInboxItems());
  ipcMain.handle('get-transfers', () => store.getTransfers());
  ipcMain.handle('mark-conversation-read', (_, conversationId) => store.markConversationRead(conversationId));

  ipcMain.handle('send-message', async (_, payload) => {
    return sendMessagePayload(payload);
  });

  ipcMain.handle('send-files', async (_, payload) => {
    return sendMessagePayload(payload);
  });

  ipcMain.handle('force-sync', () => {
    if (syncManager) syncManager.syncReceivedFolders();
    return true;
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

  ipcMain.handle('pick-master-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select master folder',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('share-folder', async (_, { folderPath, peerIds }) => {
    const item = createSharedItem(folderPath, peerIds);
    emitTransfers();
    return item;
  });

  ipcMain.handle('stop-sharing', (_, folderId) => {
    store.removeSharedFolder(folderId);
    if (syncManager) syncManager.unwatchFolder(folderId);
    emitTransfers();
    return true;
  });

  ipcMain.handle('open-synced-folder', (_, folderId) => {
    const folder = store.getReceivedFolders().find((entry) => entry.id === folderId);
    if (!folder) return false;
    shell.openPath(folder.syncPath);
    return true;
  });

  ipcMain.handle('accept-access', (_, request) => {
    store.addReceivedFolder({
      id: request.folderId,
      name: request.folderName,
      type: request.type || 'folder',
      syncPath: path.join(getMasterFolder(), request.ownerInfo?.name || 'Unknown', request.folderName),
      ownerInfo: request.ownerInfo,
      ownerHost: request.ownerHost,
      ownerPort: request.ownerPort,
      acceptedAt: Date.now(),
      status: 'pending-sync',
    });
    store.updateInboxItem(request.requestId, { status: 'accepted' });
    store.addSystemMessage({
      peer: request.ownerInfo,
      text: `You accepted ${request.folderName}. Sync is starting locally.`,
      meta: { kind: 'access-accepted-local', folderId: request.folderId },
    });
    store.upsertTransfer({
      id: request.folderId,
      kind: 'incoming-share',
      folderId: request.folderId,
      folderName: request.folderName,
      peerId: request.ownerInfo?.id,
      peerName: request.ownerInfo?.name,
      status: 'pending-sync',
      percent: 0,
      resourceType: request.type || 'folder',
    });
    if (peerDiscovery) peerDiscovery.sendAccessResponse(request, true);
    if (syncManager) syncManager.syncReceivedFolders();
    emitInbox();
    emitConversations();
    emitTransfers();
    return true;
  });

  ipcMain.handle('reject-access', (_, request) => {
    store.updateInboxItem(request.requestId, { status: 'rejected' });
    store.addSystemMessage({
      peer: request.ownerInfo,
      text: `You declined ${request.folderName}.`,
      meta: { kind: 'access-rejected-local', folderId: request.folderId },
    });
    if (peerDiscovery) peerDiscovery.sendAccessResponse(request, false);
    emitInbox();
    emitConversations();
    return true;
  });

  ipcMain.handle('open-master-folder', () => shell.openPath(getMasterFolder()));
  ipcMain.handle('get-master-folder', () => getMasterFolder());
  ipcMain.handle('set-master-folder', (_, folderPath) => {
    if (!folderPath) return getMasterFolder();
    fs.mkdirSync(folderPath, { recursive: true });
    store.setMasterFolder(folderPath);
    if (syncManager) syncManager.setMasterFolder(folderPath);
    return folderPath;
  });
  ipcMain.handle('get-window-state', () => ({
    isMaximized: mainWindow ? mainWindow.isMaximized() : false,
  }));

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
    return;
  }

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => mainWindow.webContents.send('update-available', info));
  autoUpdater.on('error', (err) => mainWindow.webContents.send('update-error', err.message));
  autoUpdater.on('download-progress', (progress) => mainWindow.webContents.send('update-progress', progress));
  autoUpdater.on('update-downloaded', (info) => mainWindow.webContents.send('update-downloaded', info));

  ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdatesAndNotify());
  ipcMain.handle('quit-and-install', () => autoUpdater.quitAndInstall());
  autoUpdater.checkForUpdatesAndNotify();
}

function setupDevReload() {
  if (!process.defaultApp && !/([\\/]electron[\\/])/.test(process.execPath)) return;

  const watchPaths = [
    path.join(__dirname, '..', 'renderer'),
    path.join(__dirname, 'main.js'),
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, 'server.js'),
    path.join(__dirname, 'discovery.js'),
    path.join(__dirname, 'sync.js'),
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
    server = await createServer(mainWindow);
    peerDiscovery = new PeerDiscovery(mainWindow, server.port);
    peerDiscovery.start();
    syncManager = new SyncManager(mainWindow, getMasterFolder(), peerDiscovery);
    syncManager.start();
    emitConversations();
    emitInbox();
    emitTransfers();
    setupDevReload();
    setupAutoUpdater();
  });

  app.on('before-quit', () => {
    if (devReloader) devReloader.close();
    if (peerDiscovery) peerDiscovery.stop();
    if (syncManager) syncManager.stop();
  });
}
