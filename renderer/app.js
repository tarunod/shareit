const api = window.socketApp || window.shareit;

const state = {
  currentUser: null,
  peers: [],
  conversations: [],
  messages: [],
  inbox: [],
  transfers: [],
  sharedFolders: [],
  receivedFolders: [],
  syncProgress: {},
  masterFolder: 'C:\\Socket',
  activeWorkspace: 'home',
  activeConversationId: null,
  queuedAttachments: [],
  chatDropActive: false,
  bootstrapError: null,
  notificationsOpen: false,
  windowState: { isMaximized: false },
};

const rail = document.getElementById('left-rail');
const threadRail = document.getElementById('thread-rail');
const stage = document.getElementById('main-stage');
const toastStack = document.getElementById('toast-stack');
const notificationAnchor = document.getElementById('notification-anchor');
const notificationButton = document.getElementById('btn-notifications');
const maximizeButton = document.getElementById('btn-maximize');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  return (name || '?').slice(0, 1).toUpperCase();
}

function formatTime(value, withDay = false) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', withDay ? {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  } : {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function icon(name) {
  const icons = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    chats: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    transfers: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    shared: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.82 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
    inbox: '<path d="M4 5h16v10H15l-3 3-3-3H4Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.5 16.9l.06-.06A1.65 1.65 0 0 0 4.9 15a1.65 1.65 0 0 0-1.51-1H3.3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.9 9a1.65 1.65 0 0 0-.33-1.82L4.5 7.1A2 2 0 1 1 7.33 4.3l.06.06A1.65 1.65 0 0 0 9.2 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 1 1 19.9 7.1l-.06.06A1.65 1.65 0 0 0 19.5 9a1.65 1.65 0 0 0 1.51 1h.09a2 2 0 1 1 0 4H21a1.65 1.65 0 0 0-1.6 1Z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    file: '<path d="M8 3h6l4 4v14H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/>',
    attach: '<path d="M16.5 6.5 9 14a3 3 0 1 0 4.24 4.24l7.07-7.07a5 5 0 0 0-7.07-7.07L5.46 11.88a7 7 0 1 0 9.9 9.9L21 16.14"/>',
    sync: '<path d="M3 12a9 9 0 0 1 15-6"/><path d="M21 4v5h-5"/><path d="M21 12a9 9 0 0 1-15 6"/><path d="M3 20v-5h5"/>',
    send: '<path d="M3 20 21 12 3 4l2 7 10 1-10 1Z"/>',
    bell: '<path d="M15 17H5l1.4-1.4A2 2 0 0 0 7 14.2V10a5 5 0 1 1 10 0v4.2a2 2 0 0 0 .6 1.4L19 17h-4"/><path d="M9 17a3 3 0 0 0 6 0"/>',
    minimize: '<path d="M5 12h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    restore: '<path d="M9 9h10v10"/><path d="M15 15H5V5h10"/>',
    close: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
    accept: '<path d="M5 13 9 17 19 7"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    open: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.dot}</svg>`;
}

function setWindowIcons() {
  notificationButton.querySelector('.icon-host').innerHTML = icon('bell');
  const pendingCount = state.inbox.filter((item) => item.status === 'pending').length;
  notificationButton.dataset.count = pendingCount ? String(pendingCount) : '';
  notificationButton.classList.toggle('has-count', pendingCount > 0);
  maximizeButton.querySelector('.outline').innerHTML = '';
  maximizeButton.querySelector('.outline').classList.toggle('restore-shape', state.windowState.isMaximized);
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add('leave');
    setTimeout(() => el.remove(), 220);
  }, 2200);
}

function getPeerConversationEntries() {
  const map = new Map(state.conversations.map((conversation) => [conversation.peerId, conversation]));
  for (const peer of state.peers) {
    if (!map.has(peer.id)) {
      map.set(peer.id, {
        id: `peer:${peer.id}`,
        peerId: peer.id,
        peerName: peer.name,
        peerHostname: peer.hostname,
        peerIp: peer.ip,
        unreadCount: 0,
        lastMessageAt: 0,
        lastMessagePreview: '',
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

function getActiveConversation() {
  return getPeerConversationEntries().find((conversation) => conversation.id === state.activeConversationId) || null;
}

function isPeerOnline(peerId) {
  return state.peers.some((peer) => peer.id === peerId);
}

function getAttachmentName(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || 'Attachment';
}

async function queueAttachmentPaths(paths) {
  const uniquePaths = [...new Set((paths || []).filter(Boolean))];
  if (!uniquePaths.length) return 0;

  let resolved = uniquePaths.map((filePath) => ({
    path: filePath,
    name: getAttachmentName(filePath),
    kind: 'file',
  }));

  if (api.resolvePathKinds) {
    try {
      const entries = await api.resolvePathKinds(uniquePaths);
      if (Array.isArray(entries) && entries.length) {
        resolved = entries.map((entry) => ({
          path: entry.path,
          name: entry.name || getAttachmentName(entry.path),
          kind: entry.kind === 'folder' ? 'folder' : 'file',
        }));
      }
    } catch (error) {
      // Keep fallback classification when path resolution is unavailable.
    }
  }

  const existing = new Set(state.queuedAttachments.map((item) => item.path));
  const additions = resolved.filter((entry) => entry.path && !existing.has(entry.path));
  state.queuedAttachments.push(...additions);
  return additions.length;
}

function getRecentEvents() {
  const events = [];

  for (const item of state.inbox) {
    events.push({
      id: `inbox:${item.id}`,
      kind: 'request',
      title: item.folderName,
      subtitle: item.peerName || 'Incoming request',
      at: item.updatedAt || item.createdAt,
      status: item.status,
      requestId: item.id,
      workspace: 'home',
      request: item.request,
    });
  }

  for (const transfer of state.transfers) {
    events.push({
      id: `transfer:${transfer.id}`,
      kind: transfer.resourceType === 'folder' ? 'folder' : 'transfer',
      title: transfer.folderName || transfer.file || 'Transfer',
      subtitle: transfer.peerName || transfer.status || 'Transfer update',
      at: transfer.updatedAt || transfer.createdAt,
      status: transfer.status,
      workspace: 'transfers',
      transferId: transfer.id,
    });
  }

  for (const shared of state.sharedFolders) {
    events.push({
      id: `shared:${shared.id}`,
      kind: shared.type === 'folder' ? 'folder' : 'file',
      title: shared.name,
      subtitle: `Shared with ${(shared.peers || []).length} peer${(shared.peers || []).length === 1 ? '' : 's'}`,
      at: shared.sharedAt,
      status: 'shared',
      workspace: 'shared',
      sharedId: shared.id,
    });
  }

  return events.sort((a, b) => (b.at || 0) - (a.at || 0));
}

function getNotificationItems() {
  return getRecentEvents().slice(0, 8);
}

async function loadConversationMessages() {
  if (!state.activeConversationId) {
    state.messages = [];
    return;
  }
  state.messages = await api.getMessages(state.activeConversationId);
  await api.markConversationRead(state.activeConversationId);
  state.conversations = await api.getConversations();
}

async function hydrate() {
  if (!api) {
    throw new Error('Renderer API is unavailable. Preload did not expose the desktop bridge.');
  }

  state.currentUser = await api.getUserInfo();
  const [peers, conversations, inbox, transfers, sharedFolders, receivedFolders, syncProgress, masterFolder, windowState] = await Promise.all([
    api.getPeers(),
    api.getConversations(),
    api.getInboxItems(),
    api.getTransfers(),
    api.getSharedFolders(),
    api.getReceivedFolders(),
    api.getSyncProgress(),
    api.getMasterFolder(),
    api.getWindowState(),
  ]);

  state.peers = peers;
  state.conversations = conversations;
  state.inbox = inbox;
  state.transfers = transfers;
  state.sharedFolders = sharedFolders;
  state.receivedFolders = receivedFolders;
  state.syncProgress = syncProgress;
  state.masterFolder = masterFolder;
  state.windowState = windowState || { isMaximized: false };

  const firstConversation = getPeerConversationEntries()[0];
  if (!state.activeConversationId && firstConversation) {
    state.activeConversationId = firstConversation.id;
  }
  await loadConversationMessages();
  state.bootstrapError = null;
  renderAll();
}

function renderNotificationPopup() {
  const items = getNotificationItems();
  notificationAnchor.innerHTML = state.notificationsOpen ? `
    <section class="notification-popover">
      <header class="popover-header">
        <strong>Notifications</strong>
        <span>${items.length}</span>
      </header>
      <div class="popover-list">
        ${items.length ? items.map((item) => `
          ${item.kind === 'request' && item.status === 'pending' ? `
            <div class="popover-item request-item" data-event-id="${item.id}">
              <span class="popover-item-icon">${icon('bell')}</span>
              <span class="popover-item-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.subtitle)}</small>
              </span>
              <span class="popover-item-time">${formatTime(item.at)}</span>
              <span class="popover-item-actions">
                <button class="inline-action success" data-accept-request="${item.requestId}" type="button" title="Accept">${icon('accept')}</button>
                <button class="inline-action" data-reject-request="${item.requestId}" type="button" title="Reject">${icon('close')}</button>
              </span>
            </div>
          ` : `
            <button class="popover-item" type="button" data-open-workspace="${item.workspace}" data-event-id="${item.id}">
              <span class="popover-item-icon">${icon(item.kind === 'request' ? 'bell' : item.kind)}</span>
              <span class="popover-item-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.subtitle)}</small>
              </span>
              <span class="popover-item-time">${formatTime(item.at)}</span>
            </button>
          `}
        `).join('') : `<div class="popover-empty">No notifications</div>`}
      </div>
    </section>
  ` : '';
}

function renderLeftRail() {
  if (state.bootstrapError) {
    rail.innerHTML = `<div class="rail-error">Renderer Error</div>`;
    return;
  }

    const navItems = [
      ['home', 'Home', 'home', 0],
      ['chats', 'Chats', 'chats', state.conversations.filter((item) => item.unreadCount).length],
      ['transfers', 'Transfers', 'transfers', state.transfers.filter((item) => item.status === 'syncing').length],
      ['shared', 'Shared', 'shared', state.sharedFolders.length],
    ];

    rail.innerHTML = `
      <div class="rail-top">
        <div class="rail-nav rail-nav-expanded">
        ${navItems.map(([id, label, iconName, count]) => `
          <button class="rail-nav-btn ${state.activeWorkspace === id ? 'active' : ''}" data-workspace="${id}" type="button" title="${label}">
            <span class="icon-wrap">${icon(iconName)}</span>
            <span class="rail-label">${label}</span>
            ${count ? `<span class="rail-count">${count}</span>` : ''}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="rail-bottom">
      <button class="rail-utility rail-utility-wide" data-action="manual-sync" type="button" title="Sync now">
        <span class="icon-wrap">${icon('sync')}</span>
        <span class="rail-label">Sync now</span>
      </button>
      <button class="rail-utility rail-utility-wide" data-action="open-master" type="button" title="Open master folder">
        <span class="icon-wrap">${icon('folder')}</span>
        <span class="rail-button-copy">
          <strong class="rail-label">Open folder</strong>
          <small title="${escapeHtml(state.masterFolder || '')}">${escapeHtml(state.masterFolder || '')}</small>
        </span>
      </button>
      <button class="rail-profile-row ${state.activeWorkspace === 'settings' ? 'active' : ''}" data-workspace="settings" type="button" title="Open settings">
        <span class="profile-avatar">${initials(state.currentUser?.name)}</span>
        <span class="rail-profile-copy">
          <strong>${escapeHtml(state.currentUser?.name || 'Unknown')}</strong>
          <small>Profile and settings</small>
        </span>
      </button>
    </div>
  `;
}

function renderThreadRail() {
  if (state.bootstrapError) {
    threadRail.innerHTML = `<div class="thread-header compact"><strong>Reload required</strong></div>`;
    return;
  }

  const conversations = getPeerConversationEntries();
  const onlinePeerIds = new Set(state.peers.map((peer) => peer.id));

  if (state.activeWorkspace === 'home') {
    const recentConversations = conversations.slice(0, 8);
    threadRail.innerHTML = `
      <div class="thread-header compact">
        <strong>Recent chats</strong>
      </div>
      <div class="thread-list">
        ${recentConversations.length ? recentConversations.map((conversation) => `
          <button class="thread-card" data-open-chat="${conversation.id}" type="button">
            <div class="thread-card-avatar">${initials(conversation.peerName)}</div>
            <div class="thread-card-copy">
              <div class="thread-card-top">
                <strong>${escapeHtml(conversation.peerName)}</strong>
                <span class="presence-dot ${onlinePeerIds.has(conversation.peerId) ? 'online' : ''}"></span>
              </div>
              <p>${escapeHtml(conversation.lastMessagePreview || conversation.peerIp || 'No messages yet')}</p>
            </div>
            ${conversation.unreadCount ? `<span class="thread-unread">${conversation.unreadCount}</span>` : ''}
          </button>
        `).join('') : `<div class="thread-empty compact-empty"><p>No recent chats</p></div>`}
      </div>
    `;
    return;
  }

  if (state.activeWorkspace === 'chats') {
    threadRail.innerHTML = `
      <div class="thread-header compact">
        <strong>Direct Messages</strong>
      </div>
      <div class="thread-list">
        ${conversations.length ? conversations.map((conversation) => `
          <button class="thread-card ${state.activeConversationId === conversation.id ? 'active' : ''}" data-conversation="${conversation.id}" type="button">
            <div class="thread-card-avatar">${initials(conversation.peerName)}</div>
            <div class="thread-card-copy">
              <div class="thread-card-top">
                <strong>${escapeHtml(conversation.peerName)}</strong>
                <span class="presence-dot ${onlinePeerIds.has(conversation.peerId) ? 'online' : ''}"></span>
              </div>
              <p>${escapeHtml(conversation.lastMessagePreview || conversation.peerIp || 'Start chat')}</p>
            </div>
            ${conversation.unreadCount ? `<span class="thread-unread">${conversation.unreadCount}</span>` : ''}
          </button>
        `).join('') : `<div class="thread-empty compact-empty"><p>No conversations</p></div>`}
      </div>
    `;
    return;
  }

  if (state.activeWorkspace === 'settings') {
    threadRail.innerHTML = `
      <div class="thread-header compact">
        <strong>Settings</strong>
      </div>
      <div class="thread-list workspace-summary-list">
        <div class="workspace-summary-card summary-stack">
          <div class="summary-row">
            <span class="summary-icon">${icon('settings')}</span>
            <span class="summary-copy">
              <strong>${escapeHtml(state.currentUser?.name || 'Unknown')}</strong>
              <p>Visible to peers on your network</p>
            </span>
          </div>
          <div class="summary-row">
            <span class="summary-icon">${icon('folder')}</span>
            <span class="summary-copy">
              <strong>Master folder</strong>
              <p>${escapeHtml(state.masterFolder || '')}</p>
            </span>
          </div>
          <div class="summary-row">
            <span class="summary-icon">${icon('home')}</span>
            <span class="summary-copy">
              <strong>${escapeHtml(state.currentUser?.hostname || '')}</strong>
              <p>Current device</p>
            </span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const workspaceSummaries = {
    transfers: ['Transfers', state.transfers.length || Object.keys(state.syncProgress).length, 'Recent sync and share activity'],
    shared: ['Shared', state.sharedFolders.length, 'Items you are sharing'],
  };

  const [title, count, subtitle] = workspaceSummaries[state.activeWorkspace] || ['Workspace', 0, ''];
  threadRail.innerHTML = `
    <div class="thread-header compact">
      <strong>${title}</strong>
    </div>
    <div class="thread-list workspace-summary-list">
      <div class="workspace-summary-card">
        <strong>${count}</strong>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    </div>
  `;
}

function renderActivityRow(event) {
  return `
    <button class="activity-row" type="button" data-open-workspace="${event.workspace}">
      <span class="activity-icon">${icon(event.kind === 'request' ? 'inbox' : event.kind)}</span>
      <span class="activity-copy">
        <strong>${escapeHtml(event.title)}</strong>
        <small>${escapeHtml(event.subtitle)}</small>
      </span>
      <span class="activity-time">${formatTime(event.at, true)}</span>
    </button>
  `;
}

function renderMessageRow(message, conversation) {
  const sender = message.direction === 'outgoing' ? 'You' : message.direction === 'incoming' ? conversation.peerName : 'System';
  return `
    <article class="message-row ${message.direction === 'outgoing' ? 'outgoing' : message.direction === 'incoming' ? 'incoming' : 'system'}">
      <div class="message-bubble">
        <div class="message-meta">
          <strong>${escapeHtml(sender)}</strong>
          <span>${formatTime(message.createdAt, true)}</span>
        </div>
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}
        ${(message.attachments || []).length ? `
          <div class="attachment-list">
            ${message.attachments.map((attachment) => `
              <div class="attachment-pill">
                <span class="attachment-icon">${icon(attachment.resourceType === 'folder' ? 'folder' : 'file')}</span>
                <strong>${escapeHtml(attachment.name)}</strong>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    </article>
  `;
}

function renderHomeWorkspace() {
  const recentConversations = getPeerConversationEntries().slice(0, 4);
  const recentEvents = getRecentEvents().slice(0, 10);
  const pendingRequests = state.inbox.filter((item) => item.status === 'pending').slice(0, 3);

  return `
    <section class="workspace-shell home-shell">
      <header class="workspace-header">
        <div class="workspace-title single-line">
          <div>
            <strong>Home</strong>
            <span>${state.peers.length} peers on your network</span>
          </div>
        </div>
      </header>
      <section class="home-grid">
        <article class="surface-card">
          <div class="surface-head">
            <strong>Recent messages</strong>
          </div>
          <div class="surface-list">
            ${recentConversations.length ? recentConversations.map((conversation) => `
              <button class="surface-row" type="button" data-open-chat="${conversation.id}">
                <span class="surface-avatar">${initials(conversation.peerName)}</span>
                <span class="surface-copy">
                  <strong>${escapeHtml(conversation.peerName)}</strong>
                  <small>${escapeHtml(conversation.lastMessagePreview || 'No messages yet')}</small>
                </span>
                <span class="surface-time">${formatTime(conversation.lastMessageAt)}</span>
              </button>
            `).join('') : `<div class="empty-line">No conversations yet</div>`}
          </div>
        </article>
        <article class="surface-card">
          <div class="surface-head">
            <strong>Pending requests</strong>
          </div>
          <div class="surface-list">
            ${pendingRequests.length ? pendingRequests.map((item) => `
              <div class="surface-row static-row">
                <span class="surface-avatar icon-avatar">${icon('inbox')}</span>
                <span class="surface-copy">
                  <strong>${escapeHtml(item.folderName)}</strong>
                  <small>${escapeHtml(item.peerName || 'Incoming request')}</small>
                </span>
                <span class="surface-actions">
                  <button class="inline-action success" data-accept-request="${item.id}" type="button" title="Accept">${icon('accept')}</button>
                  <button class="inline-action" data-reject-request="${item.id}" type="button" title="Reject">${icon('close')}</button>
                </span>
              </div>
            `).join('') : `<div class="empty-line">No pending requests</div>`}
          </div>
        </article>
        <article class="surface-card wide-card">
          <div class="surface-head">
            <strong>Activity</strong>
          </div>
          <div class="activity-list">
            ${recentEvents.length ? recentEvents.map(renderActivityRow).join('') : `<div class="empty-line">No recent activity</div>`}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderChatWorkspace() {
  const conversation = getActiveConversation();
  if (!conversation) {
    return `
      <section class="workspace-shell empty-shell">
        <div class="thread-empty compact-empty"><p>Select a conversation</p></div>
      </section>
    `;
  }

  const online = isPeerOnline(conversation.peerId);
  return `
    <section class="workspace-shell chat-shell ${state.chatDropActive && online ? 'drop-active' : ''}">
      <header class="workspace-header">
        <div class="workspace-title">
          <div class="presence-avatar">${initials(conversation.peerName)}</div>
          <div>
            <strong>${escapeHtml(conversation.peerName)}</strong>
            <span>${online ? 'Online' : 'Offline'}${conversation.peerIp ? ` • ${escapeHtml(conversation.peerIp)}` : ''}</span>
          </div>
        </div>
        <div class="workspace-header-actions">
          <button class="header-action-btn" data-action="attach-file" type="button" title="Attach files" ${online ? '' : 'disabled'}>${icon('attach')}</button>
          <button class="header-action-btn" data-action="attach-folder" type="button" title="Attach folder" ${online ? '' : 'disabled'}>${icon('folder')}</button>
        </div>
      </header>
      <div class="chat-layout single-column" data-chat-drop-zone="true">
        <section class="chat-column">
          <div class="message-list">
            ${state.messages.length ? state.messages.map((message) => renderMessageRow(message, conversation)).join('') : `
              <div class="thread-empty compact-empty"><p>No messages yet</p></div>
            `}
          </div>
          ${state.chatDropActive && online ? `<div class="chat-drop-indicator">Drop files or folders to queue</div>` : ''}
          ${state.queuedAttachments.length ? `
            <div class="queued-strip">
              ${state.queuedAttachments.map((item) => `
                <span class="queued-chip">${icon(item.kind === 'folder' ? 'folder' : 'file')}<strong>${escapeHtml(item.name)}</strong></span>
              `).join('')}
            </div>
          ` : ''}
          <section class="composer-shell ${online ? '' : 'disabled'}">
            <textarea id="message-input" placeholder="${online ? `Message ${escapeHtml(conversation.peerName)}` : `${escapeHtml(conversation.peerName)} is offline`}" ${online ? '' : 'disabled'}></textarea>
            <div class="composer-actions">
              <div class="queued-summary">${online ? (state.queuedAttachments.length ? `${state.queuedAttachments.length} queued` : 'Ready') : 'Unavailable while offline'}</div>
              <button class="primary-btn compact-send" data-action="send-message" type="button" ${online ? '' : 'disabled'}>
                ${icon('send')}
                <span>Send</span>
              </button>
            </div>
            ${online ? '' : '<div class="composer-offline-note">Messages, files, and folders can only be sent when this peer is online.</div>'}
          </section>
        </section>
      </div>
    </section>
  `;
}

function renderTransfersWorkspace() {
  const progressEntries = Object.values(state.syncProgress || {});
  const items = state.transfers.length ? state.transfers : progressEntries;
  return `
    <section class="workspace-shell">
      <header class="workspace-header simple"><strong>Transfers</strong></header>
      <div class="stack-list">
        ${items.length ? items.map((item) => `
          <article class="stack-card">
            <div class="stack-top">
              <span class="stack-icon">${icon(item.resourceType === 'folder' ? 'folder' : 'transfers')}</span>
              <strong>${escapeHtml(item.folderName || item.file || 'Transfer')}</strong>
              <small>${escapeHtml(item.status || 'pending')}</small>
            </div>
            <div class="progress-shell"><div class="progress-fill" style="width:${Math.max(6, item.percent || 0)}%"></div></div>
          </article>
        `).join('') : `<div class="thread-empty compact-empty"><p>No transfers</p></div>`}
      </div>
    </section>
  `;
}

function renderSharedWorkspace() {
  return `
    <section class="workspace-shell">
      <header class="workspace-header simple"><strong>Shared</strong></header>
      <div class="stack-list">
        ${state.sharedFolders.length ? state.sharedFolders.map((item) => `
          <article class="stack-card">
            <div class="stack-top">
              <span class="stack-icon">${icon(item.type === 'folder' ? 'folder' : 'file')}</span>
              <strong>${escapeHtml(item.name)}</strong>
              <button class="inline-action" data-stop-share="${item.id}" type="button" title="Stop sharing">${icon('close')}</button>
            </div>
            <small>${(item.peers || []).length} peers</small>
          </article>
        `).join('') : `<div class="thread-empty compact-empty"><p>No shared items</p></div>`}
      </div>
    </section>
  `;
}

function renderSettingsWorkspace() {
  return `
    <section class="workspace-shell settings-shell">
      <header class="workspace-header simple"><strong>Settings</strong></header>
      <div class="settings-grid">
        <section class="settings-card">
          <div class="settings-section-head">
            <strong>Profile</strong>
            <small>Name broadcast to peers on your network</small>
          </div>
          <label for="settings-name">Display name</label>
          <input id="settings-name" value="${escapeHtml(state.currentUser?.name || '')}" />
          <div class="settings-actions">
            <button class="primary-btn" data-action="save-settings" type="button">Save name</button>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-section-head">
            <strong>Storage</strong>
            <small>Default location for accepted files and folders</small>
          </div>
          <label for="settings-master-folder">Master folder</label>
          <input id="settings-master-folder" value="${escapeHtml(state.masterFolder || '')}" />
          <div class="settings-actions split-actions">
            <button class="secondary-btn" data-action="browse-master-folder" type="button">Browse</button>
            <button class="secondary-btn" data-action="open-master" type="button">Open</button>
            <button class="primary-btn" data-action="save-master-folder" type="button">Save folder</button>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-section-head">
            <strong>Device</strong>
            <small>Current node details</small>
          </div>
          <div class="settings-meta">
            <div><span>${icon('home')}</span><small>${escapeHtml(state.currentUser?.hostname || '')}</small></div>
            <div><span>${icon('chats')}</span><small>${escapeHtml(state.currentUser?.id || '')}</small></div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderStage() {
  if (state.bootstrapError) {
    stage.innerHTML = `<section class="workspace-shell empty-shell"><h2>${escapeHtml(state.bootstrapError)}</h2></section>`;
    return;
  }

  if (state.activeWorkspace === 'home') {
    stage.innerHTML = renderHomeWorkspace();
    return;
  }
  if (state.activeWorkspace === 'chats') {
    stage.innerHTML = renderChatWorkspace();
    return;
  }
  if (state.activeWorkspace === 'transfers') {
    stage.innerHTML = renderTransfersWorkspace();
    return;
  }
  if (state.activeWorkspace === 'shared') {
    stage.innerHTML = renderSharedWorkspace();
    return;
  }
  stage.innerHTML = renderSettingsWorkspace();
}

function renderAll() {
  setWindowIcons();
  renderLeftRail();
  renderThreadRail();
  renderStage();
  renderNotificationPopup();
  notificationButton.classList.toggle('active', state.notificationsOpen);
}

function renderWorkspaceOnly() {
  renderStage();
  renderNotificationPopup();
  notificationButton.classList.toggle('active', state.notificationsOpen);
}

function renderRailAndNotifications() {
  renderLeftRail();
  renderNotificationPopup();
  notificationButton.classList.toggle('active', state.notificationsOpen);
}

function renderConversationShell() {
  renderLeftRail();
  renderThreadRail();
  renderStage();
  renderNotificationPopup();
  notificationButton.classList.toggle('active', state.notificationsOpen);
}

async function refreshSharedState() {
  const [sharedFolders, receivedFolders, transfers, syncProgress, inbox] = await Promise.all([
    api.getSharedFolders(),
    api.getReceivedFolders(),
    api.getTransfers(),
    api.getSyncProgress(),
    api.getInboxItems(),
  ]);
  state.sharedFolders = sharedFolders;
  state.receivedFolders = receivedFolders;
  state.transfers = transfers;
  state.syncProgress = syncProgress;
  state.inbox = inbox;
}

async function openWorkspace(workspace) {
  if (workspace === 'inbox') {
    state.notificationsOpen = true;
    renderNotificationPopup();
    notificationButton.classList.add('active');
    return;
  }
  state.activeWorkspace = workspace;
  state.chatDropActive = false;
  if (workspace === 'chats' && !state.activeConversationId) {
    const firstConversation = getPeerConversationEntries()[0];
    state.activeConversationId = firstConversation?.id || null;
    await loadConversationMessages();
  }
  state.notificationsOpen = false;
  renderAll();
}

document.body.addEventListener('click', async (event) => {
  const workspace = event.target.closest('[data-workspace]');
  if (workspace) {
    await openWorkspace(workspace.dataset.workspace);
    return;
  }

  const workspaceJump = event.target.closest('[data-open-workspace]');
  if (workspaceJump) {
    await openWorkspace(workspaceJump.dataset.openWorkspace);
    return;
  }

  const openChat = event.target.closest('[data-open-chat]');
  if (openChat) {
    state.activeConversationId = openChat.dataset.openChat;
    await openWorkspace('chats');
    return;
  }

  const conversationTrigger = event.target.closest('[data-conversation]');
  if (conversationTrigger) {
    state.activeConversationId = conversationTrigger.dataset.conversation;
    state.activeWorkspace = 'chats';
    await loadConversationMessages();
    renderAll();
    return;
  }

  if (event.target.closest('#btn-notifications')) {
    state.notificationsOpen = !state.notificationsOpen;
    renderAll();
    return;
  }

  if (!event.target.closest('.notification-popover') && !event.target.closest('#btn-notifications') && state.notificationsOpen) {
    state.notificationsOpen = false;
    renderNotificationPopup();
    notificationButton.classList.remove('active');
  }

  if (event.target.closest('[data-action="open-master"]')) {
    await api.openMasterFolder();
    return;
  }

  if (event.target.closest('[data-action="manual-sync"]')) {
    await api.forceSync();
    toast('Sync started', 'success');
    return;
  }

  if (event.target.closest('[data-action="attach-file"]')) {
    const conversation = getActiveConversation();
    if (!conversation || !isPeerOnline(conversation.peerId)) {
      toast('Peer is offline', 'error');
      return;
    }
    const files = await api.pickFile();
    if (files.length) {
      await queueAttachmentPaths(files);
      renderStage();
    }
    return;
  }

  if (event.target.closest('[data-action="attach-folder"]')) {
    const conversation = getActiveConversation();
    if (!conversation || !isPeerOnline(conversation.peerId)) {
      toast('Peer is offline', 'error');
      return;
    }
    const folder = await api.pickFolder();
    if (folder) {
      await queueAttachmentPaths([folder]);
      renderStage();
    }
    return;
  }

  if (event.target.closest('[data-action="send-message"]')) {
    const input = document.getElementById('message-input');
    const conversation = getActiveConversation();
    if (!conversation) return;
    if (!isPeerOnline(conversation.peerId)) {
      toast('Peer is offline', 'error');
      return;
    }

    const text = input?.value || '';
    if (!text.trim() && state.queuedAttachments.length === 0) {
      toast('Nothing to send', 'error');
      return;
    }

    await api.sendMessage({
      peerId: conversation.peerId,
      text,
      attachments: state.queuedAttachments.map((item) => item.path),
    });
    state.queuedAttachments = [];
    await refreshSharedState();
    state.conversations = await api.getConversations();
    await loadConversationMessages();
    renderAll();
    toast('Sent', 'success');
    return;
  }

  if (event.target.closest('[data-action="save-settings"]')) {
    const name = document.getElementById('settings-name')?.value?.trim();
    if (!name) return;
    await api.setUserInfo({ name });
    state.currentUser = await api.getUserInfo();
    renderAll();
    toast('Saved', 'success');
    return;
  }

  if (event.target.closest('[data-action="browse-master-folder"]')) {
    const folder = await api.pickMasterFolder();
    if (!folder) return;
    const input = document.getElementById('settings-master-folder');
    if (input) input.value = folder;
    return;
  }

  if (event.target.closest('[data-action="save-master-folder"]')) {
    const folder = document.getElementById('settings-master-folder')?.value?.trim();
    if (!folder) return;
    state.masterFolder = await api.setMasterFolder(folder);
    renderAll();
    toast('Folder updated', 'success');
    return;
  }

  const acceptButton = event.target.closest('[data-accept-request]');
  if (acceptButton) {
    const item = state.inbox.find((entry) => entry.id === acceptButton.dataset.acceptRequest);
    if (!item) return;
    await api.acceptAccess(item.request);
    await refreshSharedState();
    state.conversations = await api.getConversations();
    await loadConversationMessages();
    renderAll();
    toast('Accepted', 'success');
    return;
  }

  const rejectButton = event.target.closest('[data-reject-request]');
  if (rejectButton) {
    const item = state.inbox.find((entry) => entry.id === rejectButton.dataset.rejectRequest);
    if (!item) return;
    await api.rejectAccess(item.request);
    await refreshSharedState();
    state.conversations = await api.getConversations();
    renderAll();
    toast('Rejected', 'info');
    return;
  }

  const stopButton = event.target.closest('[data-stop-share]');
  if (stopButton) {
    await api.stopSharing(stopButton.dataset.stopShare);
    await refreshSharedState();
    renderAll();
    toast('Removed', 'info');
  }
});

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

stage.addEventListener('dragover', (event) => {
  if (state.activeWorkspace !== 'chats') return;
  const conversation = getActiveConversation();
  if (!conversation || !isPeerOnline(conversation.peerId)) return;
  if (!isFileDrag(event)) return;
  event.preventDefault();
});

stage.addEventListener('dragenter', (event) => {
  if (state.activeWorkspace !== 'chats') return;
  const conversation = getActiveConversation();
  if (!conversation || !isPeerOnline(conversation.peerId)) return;
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (!state.chatDropActive) {
    state.chatDropActive = true;
    renderStage();
  }
});

stage.addEventListener('dragleave', (event) => {
  if (!state.chatDropActive) return;
  if (stage.contains(event.relatedTarget)) return;
  state.chatDropActive = false;
  renderStage();
});

stage.addEventListener('drop', async (event) => {
  if (state.activeWorkspace !== 'chats') return;
  const conversation = getActiveConversation();
  state.chatDropActive = false;
  if (!conversation || !isPeerOnline(conversation.peerId)) {
    renderStage();
    return;
  }
  if (!isFileDrag(event)) {
    renderStage();
    return;
  }

  event.preventDefault();
  const paths = Array.from(event.dataTransfer?.files || []).map((entry) => entry.path).filter(Boolean);
  if (!paths.length) {
    renderStage();
    return;
  }

  const added = await queueAttachmentPaths(paths);
  renderStage();
  if (added > 0) toast(`${added} attachment${added === 1 ? '' : 's'} queued`, 'success');
});

document.getElementById('btn-minimize').addEventListener('click', () => api.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => api.maximize());
document.getElementById('btn-close').addEventListener('click', () => api.close());

api.on('peers-updated', async (peers) => {
  state.peers = peers;
  state.conversations = await api.getConversations();
  renderAll();
});

api.on('peer-presence-updated', async (peers) => {
  state.peers = peers;
  renderConversationShell();
});

api.on('conversation-updated', async (conversations) => {
  state.conversations = conversations;
  if (state.activeConversationId) {
    await loadConversationMessages();
  }
  renderConversationShell();
});

api.on('message-received', async () => {
  state.conversations = await api.getConversations();
  if (!state.activeConversationId) {
    const first = getPeerConversationEntries()[0];
    state.activeConversationId = first?.id || null;
  }
  await loadConversationMessages();
  renderConversationShell();
});

api.on('transfer-updated', async (transfers) => {
  state.transfers = Array.isArray(transfers) ? transfers : await api.getTransfers();
  state.syncProgress = await api.getSyncProgress();
  renderRailAndNotifications();
  if (state.activeWorkspace === 'home' || state.activeWorkspace === 'transfers' || state.activeWorkspace === 'shared') {
    renderStage();
  }
});

api.on('inbox-updated', (inbox) => {
  state.inbox = inbox;
  renderConversationShell();
});

api.on('access-accepted', async () => {
  await refreshSharedState();
  state.conversations = await api.getConversations();
  renderConversationShell();
});

api.on('access-rejected', async () => {
  state.conversations = await api.getConversations();
  renderConversationShell();
});

api.on('sync-progress', async (progress) => {
  state.syncProgress[progress.folderId] = progress;
  if (state.notificationsOpen) {
    renderNotificationPopup();
    notificationButton.classList.toggle('active', state.notificationsOpen);
  }
  if (state.activeWorkspace === 'home' || state.activeWorkspace === 'transfers' || state.activeWorkspace === 'shared') {
    renderStage();
  }
});

api.on('new-notification', (notification) => {
  if (notification?.message) toast(notification.message, 'info');
});

api.on('window-state-changed', (windowState) => {
  state.windowState = windowState;
  setWindowIcons();
});

hydrate().catch((error) => {
  console.error('Failed to hydrate Socket renderer:', error);
  state.bootstrapError = error.message || String(error);
  renderAll();
});
