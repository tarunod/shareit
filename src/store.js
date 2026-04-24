/**
 * store.js - Simple JSON-backed store for local Socket state.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SOCKET_DIR = path.join(os.homedir(), '.socket');
const SOCKET_FILE = path.join(SOCKET_DIR, 'data.json');
const LEGACY_DIR = path.join(os.homedir(), '.shareit');
const LEGACY_FILE = path.join(LEGACY_DIR, 'data.json');

if (!fs.existsSync(SOCKET_DIR)) fs.mkdirSync(SOCKET_DIR, { recursive: true });

function getInitialData() {
  return {
    userInfo: null,
    settings: {
      masterFolder: 'C:\\Socket',
      avatarStyle: 'adventurer',
      avatarSeed: null,
      notificationSoundEnabled: true,
      autoAcceptTransfers: false,
      autoCheckUpdates: true,
      autoDownloadUpdates: true,
      ignoredUpdateVersion: null,
      lastUpdateCheckAt: null,
    },
    sharedFolders: [],
    receivedFolders: [],
    conversations: {},
    messages: {},
    inbox: [],
    transfers: [],
  };
}

let data = getInitialData();
const sourceFile = fs.existsSync(SOCKET_FILE) ? SOCKET_FILE : LEGACY_FILE;

if (fs.existsSync(sourceFile)) {
  try {
    data = { ...getInitialData(), ...JSON.parse(fs.readFileSync(sourceFile, 'utf8')) };
  } catch (e) {
    data = getInitialData();
  }
}

function save() {
  fs.writeFileSync(SOCKET_FILE, JSON.stringify(data, null, 2));
}

function getConversationId(peerId) {
  return `peer:${peerId}`;
}

function now() {
  return Date.now();
}

function buildDiceBearAvatar(style, seed) {
  const normalizedStyle = style || 'adventurer';
  const normalizedSeed = seed || 'socket-user';
  return `https://api.dicebear.com/9.x/${encodeURIComponent(normalizedStyle)}/svg?seed=${encodeURIComponent(normalizedSeed)}`;
}

function getDefaultAvatarSeed() {
  const fallbackName = data.userInfo?.name || os.userInfo().username || 'socket-user';
  return String(fallbackName).trim() || 'socket-user';
}

function syncUserAvatarFromSettings() {
  if (!data.userInfo) return;
  const settings = data.settings || {};
  const style = settings.avatarStyle || 'adventurer';
  const seed = settings.avatarSeed || getDefaultAvatarSeed();
  const avatar = buildDiceBearAvatar(style, seed);
  if (data.userInfo.avatar !== avatar) data.userInfo.avatar = avatar;
}

function ensureConversation(peer) {
  const peerId = peer?.id || 'unknown';
  const conversationId = getConversationId(peerId);
  const existing = data.conversations[conversationId];

  if (!existing) {
    data.conversations[conversationId] = {
      id: conversationId,
      peerId,
      peerName: peer?.name || 'Unknown peer',
      peerHostname: peer?.hostname || '',
      peerIp: peer?.ip || '',
      unreadCount: 0,
      lastMessageAt: 0,
      lastMessagePreview: '',
      createdAt: now(),
      updatedAt: now(),
    };
  } else {
    data.conversations[conversationId] = {
      ...existing,
      peerName: peer?.name || existing.peerName,
      peerHostname: peer?.hostname || existing.peerHostname,
      peerIp: peer?.ip || existing.peerIp,
      updatedAt: now(),
    };
  }

  if (!data.messages[conversationId]) {
    data.messages[conversationId] = [];
  }

  return data.conversations[conversationId];
}

function getMessagePreview(message) {
  if (message.type === 'attachment') {
    return message.attachments?.length ? `Sent ${message.attachments.length} attachment${message.attachments.length > 1 ? 's' : ''}` : 'Sent an attachment';
  }
  if (message.type === 'system' || message.type === 'transfer') {
    return message.text || 'System update';
  }
  return message.text || 'New message';
}

function addMessageInternal({ peer, direction, type, text, attachments, meta, timestamp, unread }) {
  const conversation = ensureConversation(peer);
  const message = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    peerId: conversation.peerId,
    direction,
    type: type || 'text',
    text: text || '',
    attachments: attachments || [],
    meta: meta || {},
    createdAt: timestamp || now(),
  };

  data.messages[conversation.id].push(message);
  data.conversations[conversation.id] = {
    ...conversation,
    lastMessageAt: message.createdAt,
    lastMessagePreview: getMessagePreview(message),
    unreadCount: unread ? (conversation.unreadCount || 0) + 1 : (conversation.unreadCount || 0),
    updatedAt: now(),
  };
  save();
  return message;
}

function upsertTransfer(transfer) {
  const existingIndex = data.transfers.findIndex((item) => item.id === transfer.id);
  const payload = {
    createdAt: now(),
    updatedAt: now(),
    ...transfer,
  };

  if (existingIndex === -1) {
    data.transfers.unshift(payload);
  } else {
    data.transfers[existingIndex] = {
      ...data.transfers[existingIndex],
      ...payload,
      updatedAt: now(),
    };
  }
  save();
  return data.transfers.find((item) => item.id === transfer.id);
}

const store = {
  getUserInfo() {
    let changed = false;
    if (!data.userInfo) {
      data.userInfo = {
        id: crypto.randomUUID(),
        name: os.userInfo().username,
        hostname: os.hostname(),
        avatar: null,
      };
      changed = true;
    }
    const beforeAvatar = data.userInfo.avatar;
    syncUserAvatarFromSettings();
    if (beforeAvatar !== data.userInfo.avatar) changed = true;
    if (changed) save();
    return data.userInfo;
  },

  setUserInfo(info) {
    data.userInfo = { ...data.userInfo, ...info };
    syncUserAvatarFromSettings();
    save();
  },

  getSettings() {
    let changed = false;
    if (!data.settings) {
      data.settings = {
        masterFolder: 'C:\\Socket',
        avatarStyle: 'adventurer',
        avatarSeed: null,
        notificationSoundEnabled: true,
        autoAcceptTransfers: false,
        autoCheckUpdates: true,
        autoDownloadUpdates: true,
        ignoredUpdateVersion: null,
        lastUpdateCheckAt: null,
      };
      changed = true;
    }
    const merged = {
      masterFolder: 'C:\\Socket',
      avatarStyle: 'adventurer',
      avatarSeed: null,
      notificationSoundEnabled: true,
      autoAcceptTransfers: false,
      autoCheckUpdates: true,
      autoDownloadUpdates: true,
      ignoredUpdateVersion: null,
      lastUpdateCheckAt: null,
      ...data.settings,
    };
    if (
      merged.masterFolder !== data.settings.masterFolder ||
      merged.avatarStyle !== data.settings.avatarStyle ||
      merged.avatarSeed !== data.settings.avatarSeed ||
      merged.notificationSoundEnabled !== data.settings.notificationSoundEnabled ||
      merged.autoAcceptTransfers !== data.settings.autoAcceptTransfers ||
      merged.autoCheckUpdates !== data.settings.autoCheckUpdates ||
      merged.autoDownloadUpdates !== data.settings.autoDownloadUpdates ||
      merged.ignoredUpdateVersion !== data.settings.ignoredUpdateVersion ||
      merged.lastUpdateCheckAt !== data.settings.lastUpdateCheckAt
    ) {
      changed = true;
    }
    data.settings = merged;
    const beforeAvatar = data.userInfo?.avatar;
    syncUserAvatarFromSettings();
    if (beforeAvatar !== data.userInfo?.avatar) changed = true;
    if (changed) save();
    return data.settings;
  },

  setSettings(settingsPatch) {
    data.settings = {
      ...store.getSettings(),
      ...settingsPatch,
    };
    syncUserAvatarFromSettings();
    save();
    return data.settings;
  },

  getMasterFolder() {
    return store.getSettings().masterFolder || 'C:\\Socket';
  },

  setMasterFolder(masterFolder) {
    data.settings = { ...store.getSettings(), masterFolder };
    save();
    return data.settings.masterFolder;
  },

  getSharedFolders() {
    return data.sharedFolders || [];
  },

  addSharedFolder(folder) {
    data.sharedFolders = data.sharedFolders || [];
    data.sharedFolders.unshift(folder);
    save();
  },

  removeSharedFolder(folderId) {
    data.sharedFolders = (data.sharedFolders || []).filter((folder) => folder.id !== folderId);
    save();
  },

  getReceivedFolders() {
    return data.receivedFolders || [];
  },

  addReceivedFolder(folder) {
    data.receivedFolders = data.receivedFolders || [];
    const existing = data.receivedFolders.find((item) => item.id === folder.id);
    if (existing) {
      Object.assign(existing, folder);
    } else {
      data.receivedFolders.unshift(folder);
    }
    save();
  },

  updateReceivedFolder(folderId, updates) {
    data.receivedFolders = (data.receivedFolders || []).map((folder) =>
      folder.id === folderId ? { ...folder, ...updates } : folder
    );
    save();
  },

  removeReceivedFolder(folderId) {
    data.receivedFolders = (data.receivedFolders || []).filter((folder) => folder.id !== folderId);
    save();
  },

  ensureConversation,

  syncPeerConversation(peer) {
    const conversation = ensureConversation(peer);
    save();
    return conversation;
  },

    getConversations() {
      return Object.values(data.conversations || {}).sort((a, b) => {
        const messageDelta = (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
        if (messageDelta !== 0) return messageDelta;

        const createdDelta = (b.createdAt || 0) - (a.createdAt || 0);
        if (createdDelta !== 0) return createdDelta;

        return (a.peerName || '').localeCompare(b.peerName || '');
      });
    },

  getMessages(conversationId) {
    return (data.messages && data.messages[conversationId]) || [];
  },

  addOutgoingMessage({ peer, type, text, attachments, meta }) {
    return addMessageInternal({
      peer,
      direction: 'outgoing',
      type,
      text,
      attachments,
      meta,
      unread: false,
    });
  },

  addIncomingMessage({ peer, type, text, attachments, meta, timestamp }) {
    return addMessageInternal({
      peer,
      direction: 'incoming',
      type,
      text,
      attachments,
      meta,
      timestamp,
      unread: true,
    });
  },

  addSystemMessage({ peer, text, meta, unread = false, timestamp }) {
    return addMessageInternal({
      peer,
      direction: 'system',
      type: meta?.transferId ? 'transfer' : 'system',
      text,
      attachments: [],
      meta,
      timestamp,
      unread,
    });
  },

    markConversationRead(conversationId) {
      if (!data.conversations[conversationId]) return false;
      data.conversations[conversationId].unreadCount = 0;
      save();
      return true;
    },

  getInboxItems() {
    return (data.inbox || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  addInboxItem(item) {
    const payload = {
      id: item.id || crypto.randomUUID(),
      status: item.status || 'pending',
      createdAt: item.createdAt || now(),
      updatedAt: now(),
      ...item,
    };
    data.inbox = data.inbox || [];
    const existingIndex = data.inbox.findIndex((entry) => entry.id === payload.id);
    if (existingIndex === -1) data.inbox.unshift(payload);
    else data.inbox[existingIndex] = { ...data.inbox[existingIndex], ...payload, updatedAt: now() };
    save();
    return payload;
  },

  updateInboxItem(id, updates) {
    data.inbox = (data.inbox || []).map((item) =>
      item.id === id ? { ...item, ...updates, updatedAt: now() } : item
    );
    save();
  },

  getTransfers() {
    return (data.transfers || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  upsertTransfer,
};

module.exports = { store, getConversationId };
