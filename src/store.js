/**
 * store.js — Simple JSON-based persistent store
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.shareit');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let data = {
  userInfo: null,
  sharedFolders: [],
  receivedFolders: [],
};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const store = {
  getUserInfo() {
    if (!data.userInfo) {
      // Generate default user info
      data.userInfo = {
        id: require('crypto').randomUUID(),
        name: os.userInfo().username,
        hostname: os.hostname(),
        avatar: null,
      };
      save();
    }
    return data.userInfo;
  },

  setUserInfo(info) {
    data.userInfo = { ...data.userInfo, ...info };
    save();
  },

  getSharedFolders() {
    return data.sharedFolders || [];
  },

  addSharedFolder(folder) {
    data.sharedFolders = data.sharedFolders || [];
    data.sharedFolders.push(folder);
    save();
  },

  removeSharedFolder(folderId) {
    data.sharedFolders = (data.sharedFolders || []).filter(f => f.id !== folderId);
    save();
  },

  getReceivedFolders() {
    return data.receivedFolders || [];
  },

  addReceivedFolder(folder) {
    data.receivedFolders = data.receivedFolders || [];
    // Avoid duplicates
    if (!data.receivedFolders.find(f => f.id === folder.id)) {
      data.receivedFolders.push(folder);
      save();
    }
  },

  updateReceivedFolder(folderId, updates) {
    data.receivedFolders = (data.receivedFolders || []).map(f =>
      f.id === folderId ? { ...f, ...updates } : f
    );
    save();
  },

  removeReceivedFolder(folderId) {
    data.receivedFolders = (data.receivedFolders || []).filter(f => f.id !== folderId);
    save();
  },
};

module.exports = { store };
