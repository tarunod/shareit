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
  activeWorkspace: 'chats',
  activeConversationId: null,
  queuedAttachments: [],
  bootstrapError: null,
};

const rail = document.getElementById('left-rail');
const threadRail = document.getElementById('thread-rail');
const stage = document.getElementById('main-stage');
const toastStack = document.getElementById('toast-stack');

function initials(name) {
  return (name || '?').slice(0, 1).toUpperCase();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function icon(name) {
  const icons = {
    chats: '<path d="M5 7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4l-4 3v-3H8a3 3 0 0 1-3-3Z"/>',
    transfers: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/>',
    shared: '<path d="M15 8a3 3 0 1 0-2.83-4"/><path d="M9 16a3 3 0 1 0 2.83 4"/><path d="m14 6-4 12"/>',
    inbox: '<path d="M4 6h16v10H15l-3 3-3-3H4Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.7.09 1.4.66 1.4 1.5s-.7 1.41-1.4 1.5A1.7 1.7 0 0 0 19.4 15Z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    file: '<path d="M8 3h6l4 4v14H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/>',
    attach: '<path d="M16.5 6.5 9 14a3 3 0 1 0 4.24 4.24l7.07-7.07a5 5 0 0 0-7.07-7.07L5.46 11.88a7 7 0 1 0 9.9 9.9L21 16.14"/>',
    sync: '<path d="M3 12a9 9 0 0 1 15-6"/><path d="M21 4v5h-5"/><path d="M21 12a9 9 0 0 1-15 6"/><path d="M3 20v-5h5"/>',
    send: '<path d="M3 20 21 12 3 4l2 7 10 1-10 1Z"/>',
    online: '<circle cx="12" cy="12" r="4"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>',
    close: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
    accept: '<path d="M5 13 9 17 19 7"/>',
    open: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.chats}</svg>`;
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
  const [peers, conversations, inbox, transfers, sharedFolders, receivedFolders, syncProgress, masterFolder] = await Promise.all([
    api.getPeers(),
    api.getConversations(),
    api.getInboxItems(),
    api.getTransfers(),
    api.getSharedFolders(),
    api.getReceivedFolders(),
    api.getSyncProgress(),
    api.getMasterFolder(),
  ]);

  state.peers = peers;
  state.conversations = conversations;
  state.inbox = inbox;
  state.transfers = transfers;
  state.sharedFolders = sharedFolders;
  state.receivedFolders = receivedFolders;
  state.syncProgress = syncProgress;
  state.masterFolder = masterFolder;

  const firstConversation = getPeerConversationEntries()[0];
  if (!state.activeConversationId && firstConversation) {
    state.activeConversationId = firstConversation.id;
  }
  await loadConversationMessages();
  state.bootstrapError = null;
  renderAll();
}

function renderLeftRail() {
  if (state.bootstrapError) {
    rail.innerHTML = `<div class="rail-error">Renderer Error</div>`;
    return;
  }

  const pendingInbox = state.inbox.filter((item) => item.status === 'pending').length;
  const navItems = [
    ['chats', 'Chats', 'chats', 0],
    ['transfers', 'Transfers', 'transfers', state.transfers.filter((item) => item.status === 'syncing').length],
    ['shared', 'Shared', 'shared', state.sharedFolders.length],
    ['inbox', 'Inbox', 'inbox', pendingInbox],
    ['settings', 'Settings', 'settings', 0],
  ];

  rail.innerHTML = `
    <div class="rail-top">
      <div class="rail-brand">
        <div class="brand-mark-compact">S</div>
        <div class="brand-meta">
          <strong>Socket</strong>
          <span>${state.peers.length} peers</span>
        </div>
      </div>
      <div class="rail-nav">
        ${navItems.map(([id, label, iconName, count]) => `
          <button class="rail-icon-btn ${state.activeWorkspace === id ? 'active' : ''}" data-workspace="${id}" type="button" title="${label}">
            <span class="icon-wrap">${icon(iconName)}</span>
            <span class="rail-label">${label}</span>
            ${count ? `<span class="rail-count">${count}</span>` : ''}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="rail-bottom">
      <button class="rail-utility" data-action="manual-sync" type="button" title="Sync now">${icon('sync')}</button>
      <button class="rail-utility" data-action="open-master" type="button" title="Open folder">${icon('folder')}</button>
      <div class="rail-profile" title="${escapeHtml(state.currentUser?.name || '')}">
        <div class="profile-avatar">${initials(state.currentUser?.name)}</div>
      </div>
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
  const headingMap = {
    chats: 'Messages',
    transfers: 'Transfers',
    shared: 'Shared',
    inbox: 'Inbox',
    settings: 'Settings',
  };

  threadRail.innerHTML = `
    <div class="thread-header compact">
      <strong>${headingMap[state.activeWorkspace]}</strong>
      <button class="thread-search" type="button" title="Search">${icon('search')}</button>
    </div>
    <div class="thread-list">
      ${conversations.length === 0 ? `
        <div class="thread-empty compact-empty">
          <div class="empty-icon">${icon('online')}</div>
          <p>No peers online</p>
        </div>
      ` : conversations.map((conversation) => `
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
      `).join('')}
    </div>
  `;
}

function renderMessageRow(message, conversation) {
  const sender = message.direction === 'outgoing' ? 'You' : message.direction === 'incoming' ? conversation.peerName : 'System';
  return `
    <article class="message-row ${message.direction === 'outgoing' ? 'outgoing' : message.direction === 'incoming' ? 'incoming' : 'system'}">
      <div class="message-bubble">
        <div class="message-meta">
          <strong>${escapeHtml(sender)}</strong>
          <span>${formatTime(message.createdAt)}</span>
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

function renderUtilityCard(conversation, online) {
  return `
    <aside class="utility-panel">
      <div class="utility-card">
        <div class="utility-head">
          <div class="presence-avatar small">${initials(conversation.peerName)}</div>
          <div>
            <strong>${escapeHtml(conversation.peerName)}</strong>
            <span>${online ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <div class="utility-stats">
          <div><span>${icon('online')}</span><small>${escapeHtml(conversation.peerIp || 'No IP')}</small></div>
          <div><span>${icon('sync')}</span><small>${state.queuedAttachments.length} queued</small></div>
        </div>
      </div>
      <div class="utility-card">
        <div class="utility-actions">
          <button class="icon-action-btn" data-action="attach-file" type="button" title="Attach files">
            ${icon('attach')}
            <span>Files</span>
          </button>
          <button class="icon-action-btn" data-action="attach-folder" type="button" title="Attach folder">
            ${icon('folder')}
            <span>Folder</span>
          </button>
        </div>
        <div class="queued-list compact-list">
          ${state.queuedAttachments.length ? state.queuedAttachments.map((item) => `
            <div class="queued-item">
              <span>${icon(item.kind === 'folder' ? 'folder' : 'file')}</span>
              <strong>${escapeHtml(item.name)}</strong>
            </div>
          `).join('') : '<div class="muted icon-line"><span>' + icon('attach') + '</span><small>No queued items</small></div>'}
        </div>
      </div>
    </aside>
  `;
}

function renderChatWorkspace() {
  const conversation = getActiveConversation();
  if (!conversation) {
    return `
      <section class="workspace-shell empty-shell">
        <div class="empty-icon large">${icon('chats')}</div>
        <h2>Select a peer</h2>
      </section>
    `;
  }

  const online = state.peers.some((peer) => peer.id === conversation.peerId);
  return `
    <section class="workspace-shell chat-shell">
      <header class="workspace-header">
        <div class="workspace-title">
          <div class="presence-avatar">${initials(conversation.peerName)}</div>
          <div>
            <strong>${escapeHtml(conversation.peerName)}</strong>
            <span>${online ? 'Online' : 'Offline'}${conversation.peerIp ? ` • ${escapeHtml(conversation.peerIp)}` : ''}</span>
          </div>
        </div>
      </header>
      <div class="chat-layout">
        <section class="chat-column">
          <div class="message-list">
            ${state.messages.length ? state.messages.map((message) => renderMessageRow(message, conversation)).join('') : `
              <div class="thread-empty compact-empty">
                <div class="empty-icon">${icon('chats')}</div>
                <p>No messages yet</p>
              </div>
            `}
          </div>
          <section class="composer-shell">
            <textarea id="message-input" placeholder="Message ${escapeHtml(conversation.peerName)}"></textarea>
            <div class="composer-actions">
              <div class="queued-summary">${state.queuedAttachments.length ? `${state.queuedAttachments.length} queued` : 'Ready'}</div>
              <button class="primary-btn compact-send" data-action="send-message" type="button">
                ${icon('send')}
                <span>Send</span>
              </button>
            </div>
          </section>
        </section>
        ${renderUtilityCard(conversation, online)}
      </div>
    </section>
  `;
}

function renderTransfersWorkspace() {
  const progressEntries = Object.values(state.syncProgress || {});
  return `
    <section class="workspace-shell">
      <header class="workspace-header simple">
        <strong>Transfers</strong>
      </header>
      <div class="stack-list">
        ${(state.transfers.length ? state.transfers : progressEntries).map((item) => `
          <article class="stack-card">
            <div class="stack-top">
              <span class="stack-icon">${icon(item.resourceType === 'folder' ? 'folder' : 'sync')}</span>
              <strong>${escapeHtml(item.folderName || item.file || 'Transfer')}</strong>
              <small>${escapeHtml(item.status || 'pending')}</small>
            </div>
            <div class="progress-shell"><div class="progress-fill" style="width:${Math.max(6, item.percent || 0)}%"></div></div>
          </article>
        `).join('') || `<div class="thread-empty compact-empty"><div class="empty-icon">${icon('transfers')}</div><p>No transfers</p></div>`}
      </div>
    </section>
  `;
}

function renderSharedWorkspace() {
  return `
    <section class="workspace-shell">
      <header class="workspace-header simple">
        <strong>Shared</strong>
      </header>
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
        `).join('') : `<div class="thread-empty compact-empty"><div class="empty-icon">${icon('shared')}</div><p>No shared items</p></div>`}
      </div>
    </section>
  `;
}

function renderInboxWorkspace() {
  return `
    <section class="workspace-shell">
      <header class="workspace-header simple">
        <strong>Inbox</strong>
      </header>
      <div class="stack-list">
        ${state.inbox.length ? state.inbox.map((item) => `
          <article class="stack-card">
            <div class="stack-top">
              <span class="stack-icon">${icon('inbox')}</span>
              <strong>${escapeHtml(item.folderName)}</strong>
              <small>${escapeHtml(item.status)}</small>
            </div>
            <div class="stack-actions">
              ${item.status === 'pending' ? `
                <button class="inline-action success" data-accept-request="${item.id}" type="button" title="Accept">${icon('accept')}</button>
                <button class="inline-action" data-reject-request="${item.id}" type="button" title="Reject">${icon('close')}</button>
              ` : ''}
            </div>
          </article>
        `).join('') : `<div class="thread-empty compact-empty"><div class="empty-icon">${icon('inbox')}</div><p>No requests</p></div>`}
      </div>
    </section>
  `;
}

function renderSettingsWorkspace() {
  return `
    <section class="workspace-shell settings-shell">
      <header class="workspace-header simple">
        <strong>Settings</strong>
      </header>
      <div class="settings-card">
        <label for="settings-name">Name</label>
        <input id="settings-name" value="${escapeHtml(state.currentUser?.name || '')}" />
        <button class="primary-btn" data-action="save-settings" type="button">Save</button>
      </div>
      <div class="settings-meta">
        <div><span>${icon('online')}</span><small>${escapeHtml(state.currentUser?.hostname || '')}</small></div>
        <div><span>${icon('folder')}</span><small>${escapeHtml(state.masterFolder)}</small></div>
      </div>
    </section>
  `;
}

function renderStage() {
  if (state.bootstrapError) {
    stage.innerHTML = `<section class="workspace-shell empty-shell"><h2>${escapeHtml(state.bootstrapError)}</h2></section>`;
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
  if (state.activeWorkspace === 'inbox') {
    stage.innerHTML = renderInboxWorkspace();
    return;
  }
  stage.innerHTML = renderSettingsWorkspace();
}

function renderAll() {
  renderLeftRail();
  renderThreadRail();
  renderStage();
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

document.body.addEventListener('click', async (event) => {
  const workspace = event.target.closest('[data-workspace]');
  if (workspace) {
    state.activeWorkspace = workspace.dataset.workspace;
    renderAll();
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
    const files = await api.pickFile();
    if (files.length) {
      state.queuedAttachments.push(...files.map((file) => ({ path: file, name: file.split(/[/\\]/).pop(), kind: 'file' })));
      renderStage();
    }
    return;
  }

  if (event.target.closest('[data-action="attach-folder"]')) {
    const folder = await api.pickFolder();
    if (folder) {
      state.queuedAttachments.push({ path: folder, name: folder.split(/[/\\]/).pop(), kind: 'folder' });
      renderStage();
    }
    return;
  }

  if (event.target.closest('[data-action="send-message"]')) {
    const input = document.getElementById('message-input');
    const conversation = getActiveConversation();
    if (!conversation) return;

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
  renderAll();
});

api.on('conversation-updated', async (conversations) => {
  state.conversations = conversations;
  if (state.activeConversationId) {
    await loadConversationMessages();
  }
  renderAll();
});

api.on('message-received', async () => {
  state.conversations = await api.getConversations();
  if (!state.activeConversationId) {
    const first = getPeerConversationEntries()[0];
    state.activeConversationId = first?.id || null;
  }
  await loadConversationMessages();
  renderAll();
});

api.on('transfer-updated', async (transfers) => {
  state.transfers = Array.isArray(transfers) ? transfers : await api.getTransfers();
  state.syncProgress = await api.getSyncProgress();
  if (state.activeWorkspace === 'transfers') {
    renderStage();
  }
});

api.on('inbox-updated', (inbox) => {
  state.inbox = inbox;
  renderAll();
});

api.on('access-accepted', async () => {
  await refreshSharedState();
  state.conversations = await api.getConversations();
  renderAll();
});

api.on('access-rejected', async () => {
  state.conversations = await api.getConversations();
  renderAll();
});

api.on('sync-progress', async (progress) => {
  state.syncProgress[progress.folderId] = progress;
  if (state.activeWorkspace === 'transfers') {
    renderStage();
  }
});

api.on('new-notification', () => {});

hydrate().catch((error) => {
  console.error('Failed to hydrate Socket renderer:', error);
  state.bootstrapError = error.message || String(error);
  renderAll();
});
