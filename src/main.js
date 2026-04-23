const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('./server');
const { PeerDiscovery } = require('./discovery');
const { SyncManager } = require('./sync');
const { store } = require('./store');
const logger = require('./logger');

let mainWindow;
let tray;
let peerDiscovery;
let syncManager;
let server;

const MASTER_FOLDER = 'C:\\ShareIt';

// Ensure master folder exists
if (!fs.existsSync(MASTER_FOLDER)) {
  fs.mkdirSync(MASTER_FOLDER, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0d0f1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open ShareIt', click: () => { logger.info('Main', 'Opening from tray'); mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Open Master Folder', click: () => { logger.info('Main', 'Opening master folder from tray'); shell.openPath(MASTER_FOLDER); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { logger.info('Main', 'Quitting app from tray'); app.quit(); process.exit(0); } },
  ]);
  tray.setToolTip('ShareIt - LAN Folder Sync');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { logger.info('Main', 'Double-clicked tray'); mainWindow.show(); });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();
  createTray();

  // Start the local HTTP + WebSocket server
  server = await createServer(mainWindow);

  // Start peer discovery
  peerDiscovery = new PeerDiscovery(mainWindow, server.port);
  peerDiscovery.start();

  // Start sync manager
  syncManager = new SyncManager(mainWindow, MASTER_FOLDER, peerDiscovery);
  syncManager.start();

  // Initialize Auto-Updater
  setupAutoUpdater(mainWindow);
});

app.on('before-quit', () => {
  if (peerDiscovery) peerDiscovery.stop();
  if (syncManager) syncManager.stop();
});

// IPC Handlers
function registerHandlers() {
  ipcMain.handle('get-user-info', () => {
    return store.getUserInfo();
  });

  ipcMain.handle('set-user-info', (_, info) => {
    store.setUserInfo(info);
    if (peerDiscovery) peerDiscovery.updateUserInfo(info);
    return true;
  });

  ipcMain.handle('get-peers', () => {
    return peerDiscovery ? peerDiscovery.getPeers() : [];
  });

  ipcMain.handle('get-shared-folders', () => {
    return store.getSharedFolders();
  });

  ipcMain.handle('get-received-folders', () => {
    return store.getReceivedFolders();
  });

  ipcMain.handle('get-sync-progress', () => {
    return syncManager ? syncManager.getProgress() : {};
  });

  ipcMain.handle('force-sync', () => {
    logger.info('IPC', 'Manual force sync triggered by user');
    if (syncManager) syncManager.syncReceivedFolders();
    return true;
  });

  ipcMain.handle('pick-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select File to Share',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Folder to Share',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('share-folder', async (_, { folderPath, peerIds }) => {
    const userInfo = store.getUserInfo();
    const stats = fs.statSync(folderPath);
    const type = stats.isDirectory() ? 'folder' : 'file';
    const folder = {
      id: require('crypto').randomUUID(),
      path: folderPath,
      name: path.basename(folderPath),
      type: type,
      sharedBy: userInfo,
      sharedAt: Date.now(),
      peers: peerIds,
    };
    store.addSharedFolder(folder);
    if (syncManager) syncManager.watchFolder(folder);
    if (peerDiscovery) {
      peerDiscovery.sendAccessRequest(folder, peerIds);
    }
    return folder;
  });

  ipcMain.handle('stop-sharing', (_, folderId) => {
    logger.info('IPC', `Stopping sharing for folder ID ${folderId}`);
    store.removeSharedFolder(folderId);
    if (syncManager) syncManager.unwatchFolder(folderId);
    return true;
  });

  ipcMain.handle('open-synced-folder', (_, folderId) => {
    const folders = store.getReceivedFolders();
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
      logger.info('IPC', `Opening received folder: ${folder.syncPath}`);
      shell.openPath(folder.syncPath);
      return true;
    }
    return false;
  });

  ipcMain.handle('accept-access', (_, request) => {
    logger.info('IPC', `Accepting access for folder ${request.folderName} from ${request.ownerInfo.name}`);
    store.addReceivedFolder({
      id: request.folderId,
      name: request.folderName,
      type: request.type || 'folder',
      syncPath: path.join(MASTER_FOLDER, request.ownerInfo.name || 'Unknown', request.folderName),
      ownerInfo: request.ownerInfo,
      ownerHost: request.ownerHost,
      ownerPort: request.ownerPort,
      acceptedAt: Date.now(),
      status: 'pending-sync',
    });
    if (peerDiscovery) peerDiscovery.sendAccessResponse(request, true);
    if (syncManager) syncManager.syncReceivedFolders();
    return true;
  });

  ipcMain.handle('reject-access', (_, request) => {
    logger.info('IPC', `Rejecting access for folder ${request.folderName} from ${request.ownerInfo.name}`);
    if (peerDiscovery) peerDiscovery.sendAccessResponse(request, false);
    return true;
  });

  ipcMain.handle('open-master-folder', () => {
    shell.openPath(MASTER_FOLDER);
  });

  ipcMain.handle('get-master-folder', () => MASTER_FOLDER);

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow.hide());
}

// --- Auto Updater ---
function setupAutoUpdater(mainWindow) {
  if (process.defaultApp || /[\\/]electron-prebuilt[\\/]/.test(process.execPath) || /[\\/]electron[\\/]/.test(process.execPath)) {
    logger.info('Updater', 'Skipping auto-update in development mode');
    return;
  }

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logger.info('Updater', 'Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    logger.info('Updater', `Update available: ${info.version}`);
    mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('Updater', 'Update not available.');
  });

  autoUpdater.on('error', (err) => {
    logger.error('Updater', `Update error: ${err.message}`);
    mainWindow.webContents.send('update-error', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    logger.info('Updater', `Download progress: ${progressObj.percent.toFixed(2)}%`);
    mainWindow.webContents.send('update-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Updater', 'Update downloaded; will install now');
    mainWindow.webContents.send('update-downloaded', info);
  });

  ipcMain.handle('check-for-updates', () => {
    autoUpdater.checkForUpdatesAndNotify();
  });

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  // Check on startup
  autoUpdater.checkForUpdatesAndNotify();
}

registerHandlers();
}
