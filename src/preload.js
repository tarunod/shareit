const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),
  setUserInfo: (info) => ipcRenderer.invoke('set-user-info', info),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  getPeers: () => ipcRenderer.invoke('get-peers'),
  getSharedFolders: () => ipcRenderer.invoke('get-shared-folders'),
  getReceivedFolders: () => ipcRenderer.invoke('get-received-folders'),
  getConversations: () => ipcRenderer.invoke('get-conversations'),
  getMessages: (conversationId) => ipcRenderer.invoke('get-messages', conversationId),
  getInboxItems: () => ipcRenderer.invoke('get-inbox-items'),
  sendMessage: (payload) => ipcRenderer.invoke('send-message', payload),
  sendFiles: (payload) => ipcRenderer.invoke('send-files', payload),
  markConversationRead: (conversationId) => ipcRenderer.invoke('mark-conversation-read', conversationId),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  resolvePathKinds: (paths) => ipcRenderer.invoke('resolve-path-kinds', paths),
  shareFolder: (data) => ipcRenderer.invoke('share-folder', data),
  openReceivedFolder: (id) => ipcRenderer.invoke('open-received-folder', id),
  savePastedImage: (payload) => ipcRenderer.invoke('save-pasted-image', payload),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  stopSharing: (id) => ipcRenderer.invoke('stop-sharing', id),
  acceptAccess: (request) => ipcRenderer.invoke('accept-access', request),
  rejectAccess: (request) => ipcRenderer.invoke('reject-access', request),
  checkForUpdates: (payload) => ipcRenderer.invoke('check-for-updates', payload),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  skipUpdateVersion: (version) => ipcRenderer.invoke('skip-update-version', version),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_, err) => cb(err)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, progress) => cb(progress)),
  on: (channel, callback) => {
    const validChannels = [
      'peers-updated',
      'peer-presence-updated',
      'message-received',
      'conversation-updated',
      'inbox-updated',
      'access-accepted',
      'access-rejected',
      'new-notification',
      'app-notification',
      'window-state-changed',
      'update-status',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },
};

contextBridge.exposeInMainWorld('socketApp', api);
contextBridge.exposeInMainWorld('shareit', api);
