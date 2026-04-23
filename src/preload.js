const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shareit', {
  // User info
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),
  setUserInfo: (info) => ipcRenderer.invoke('set-user-info', info),

  // Peers
  getPeers: () => ipcRenderer.invoke('get-peers'),

  // Folders
  getSharedFolders: () => ipcRenderer.invoke('get-shared-folders'),
  getReceivedFolders: () => ipcRenderer.invoke('get-received-folders'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  shareFolder: (data) => ipcRenderer.invoke('share-folder', data),
  openMasterFolder: () => ipcRenderer.invoke('open-master-folder'),
  openSyncedFolder: (id) => ipcRenderer.invoke('open-synced-folder', id),
  getMasterFolder: () => ipcRenderer.invoke('get-master-folder'),
  stopSharing: (id) => ipcRenderer.invoke('stop-sharing', id),

  // Access requests
  acceptAccess: (id) => ipcRenderer.invoke('accept-access', id),
  rejectAccess: (id) => ipcRenderer.invoke('reject-access', id),

  // Sync
  getSyncProgress: () => ipcRenderer.invoke('get-sync-progress'),
  forceSync: () => ipcRenderer.invoke('force-sync'),

  // Update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_, err) => cb(err)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, progress) => cb(progress)),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Events from main
  on: (channel, callback) => {
    const validChannels = [
      'peers-updated',
      'access-request',
      'access-accepted',
      'access-rejected',
      'sync-progress',
      'sync-complete',
      'sync-error',
      'new-notification',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
