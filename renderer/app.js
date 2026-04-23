// Globals
let currentUser = null;
let networkPeers = [];
let selectedFolderToShare = null;
let selectedPeersToShare = new Set();
let currentAccessRequest = null;

// DOM Elements
const e = (id) => document.getElementById(id);

// Initialization
async function init() {
  try {
    // Event Bindings (Moving to top to ensure they are registered even if data loading fails)
    e('open-master-btn').addEventListener('click', () => window.shareit.openMasterFolder());
    e('open-master-btn2').addEventListener('click', () => window.shareit.openMasterFolder());
    
    e('save-settings-btn').addEventListener('click', async () => {
      const newName = e('settings-name').value.trim();
      if (newName && newName !== currentUser.name) {
        await window.shareit.setUserInfo({ name: newName });
        currentUser.name = newName;
        updateProfileUI();
        showToast('Profile updated successfully', 'success');
      }
    });

    // Share Modal Flow
    e('quick-share-btn').addEventListener('click', openShareModal);
    e('share-folder-btn').addEventListener('click', openShareModal);
    
    const pickFileBtn = e('pick-file-btn');
    if (pickFileBtn) {
      pickFileBtn.addEventListener('click', async () => {
        const path = await window.shareit.pickFile();
        if (path) {
          selectedFolderToShare = path;
          e('selected-folder-display').textContent = path;
        }
      });
    }

    const pickFolderBtn = e('pick-folder-btn');
    if (pickFolderBtn) {
      pickFolderBtn.addEventListener('click', async () => {
        const path = await window.shareit.pickFolder();
        if (path) {
          selectedFolderToShare = path;
          e('selected-folder-display').textContent = path;
        }
      });
    }
    e('send-share-btn').addEventListener('click', sendShareRequest);

    // Access Request Responses
    e('btn-accept-request').addEventListener('click', async () => {
      if (currentAccessRequest) {
        try {
          await window.shareit.acceptAccess(currentAccessRequest);
          e('request-modal').style.display = 'none';
          currentAccessRequest = null;
          refreshReceivedFolders();
        } catch (err) {
          showToast('Error accepting: ' + err.message, 'error');
        }
      }
    });
    e('btn-reject-request').addEventListener('click', async () => {
      if (currentAccessRequest) {
        try {
          await window.shareit.rejectAccess(currentAccessRequest);
          e('request-modal').style.display = 'none';
          currentAccessRequest = null;
        } catch (err) {
          showToast('Error rejecting: ' + err.message, 'error');
        }
      }
    });

    // Force Sync
    e('force-sync-btn').addEventListener('click', async () => {
      await window.shareit.forceSync();
      showToast('Manual sync triggered', 'success');
    });

    // Load User Info
    currentUser = await window.shareit.getUserInfo();
    updateProfileUI();

    // Load Initial Data
    refreshPeers();
    refreshSharedFolders();
    refreshReceivedFolders();
    refreshSyncProgress();

    // Settings Init
    e('settings-name').value = currentUser.name || '';
    e('settings-id').textContent = currentUser.id;
    e('settings-master').textContent = await window.shareit.getMasterFolder();
    // --- Auto Update Handling ---
    window.shareit.onUpdateAvailable((info) => {
      document.getElementById('update-version-text').textContent = `Version ${info.version} is available.`;
      document.getElementById('update-modal').style.display = 'flex';
      document.getElementById('update-actions').style.display = 'flex';
      document.getElementById('restart-actions').style.display = 'none';
      document.getElementById('update-progress-container').style.display = 'none';
    });

    document.getElementById('start-update-btn')?.addEventListener('click', () => {
      document.getElementById('update-actions').style.display = 'none';
      document.getElementById('update-progress-container').style.display = 'block';
      // Electron updater automatically starts download if autoDownload is true, 
      // but we can trigger a check just in case.
      window.shareit.checkForUpdates();
    });

    window.shareit.onUpdateProgress((progress) => {
      document.getElementById('update-progress-container').style.display = 'block';
      document.getElementById('update-progress-bar').style.width = `${progress.percent}%`;
      document.getElementById('update-status-text').textContent = `Downloading: ${progress.percent.toFixed(1)}% (${(progress.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s)`;
    });

    window.shareit.onUpdateDownloaded((info) => {
      document.getElementById('update-status-text').textContent = 'Update downloaded and ready to install.';
      document.getElementById('update-progress-container').style.display = 'block';
      document.getElementById('update-progress-bar').style.width = '100%';
      document.getElementById('update-progress-bar').classList.add('done');
      document.getElementById('update-actions').style.display = 'none';
      document.getElementById('restart-actions').style.display = 'flex';
    });

    document.getElementById('restart-update-btn')?.addEventListener('click', () => {
      window.shareit.quitAndInstall();
    });

    window.shareit.onUpdateError((err) => {
      showToast(`Update error: ${err}`, 'error');
      document.getElementById('update-modal').style.display = 'none';
    });

    // Listeners for Events from Main Process
    window.shareit.on('peers-updated', (peers) => {
      networkPeers = peers;
      renderPeers();
      renderDashboardPeers();
      updateStats();
    });

    window.shareit.on('access-request', (req) => {
      showAccessRequestModal(req);
    });

    window.shareit.on('access-accepted', (res) => {
      showToast(`Access granted for folder: ${res.folderName}`, 'success');
      refreshReceivedFolders();
    });

    window.shareit.on('access-rejected', (res) => {
      showToast(`Access denied for folder: ${res.folderName}`, 'error');
    });

    window.shareit.on('sync-progress', (prog) => {
      refreshSyncProgress();
      refreshReceivedFolders(); // To update status pill
    });

    window.shareit.on('new-notification', (notif) => {
      showToast(notif.message, 'info');
    });

    // Sync Poll loop (fallback if events missed)
    setInterval(refreshSyncProgress, 3000);

  } catch (err) {
    console.error('Failed to initialize app:', err);
    setTimeout(() => showToast('App Init Error: ' + err.message, 'error'), 1000);
  }
}

// Navigation
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  e(`page-${pageId}`).classList.add('active');
  const navBtn = e(`nav-${pageId}`);
  if (navBtn) navBtn.classList.add('active');
}

// UI Updaters
function updateProfileUI() {
  e('profile-name').textContent = currentUser.name || 'Anonymous User';
  e('avatar-initials').textContent = (currentUser.name || '?').charAt(0).toUpperCase();
}

function updateStats() {
  e('stat-peers').textContent = networkPeers.length;
  e('peers-badge').textContent = networkPeers.length;
  e('peers-badge').style.display = networkPeers.length > 0 ? 'inline-block' : 'none';
}

// Renderers
function getAvatarInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function getItemIcon(type, name) {
  // Fallback: if type is missing, try to guess from name (if it has an extension, it's likely a file)
  let actualType = type;
  if (!actualType && name) {
    actualType = name.includes('.') ? 'file' : 'folder';
  }

  if (actualType === 'file') {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
    </svg>`;
  }
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
  </svg>`;
}

function renderPeers() {
  const container = e('peers-grid');
  if (networkPeers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
          <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
        </svg>
        <h3>No peers found yet</h3>
        <p>Make sure other ShareIt users are connected to the same LAN / WiFi</p>
      </div>`;
    return;
  }
  
  container.innerHTML = networkPeers.map(peer => `
    <div class="peer-card">
      <div class="peer-avatar">${getAvatarInitial(peer.name)}</div>
      <div class="peer-info">
        <div class="peer-name">${peer.name}</div>
        <div class="peer-host">${peer.hostname}</div>
        <div class="peer-ip">${peer.ip}:${peer.port}</div>
      </div>
    </div>
  `).join('');
}

function renderDashboardPeers() {
  const container = e('dashboard-peers');
  if (networkPeers.length === 0) {
    container.innerHTML = `
      <div class="empty-state small">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
          <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
        </svg>
        <p>No devices found on your network right now.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;">
      ${networkPeers.map(peer => `
        <div style="background:var(--bg-card); padding:12px; border-radius:12px; border:1px solid var(--border); min-width:160px;">
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
            <div style="width:32px; height:32px; border-radius:50%; background:rgba(79,70,229,0.1); color:var(--primary); display:flex; align-items:center; justify-content:center; font-weight:700;">
              ${getAvatarInitial(peer.name)}
            </div>
            <div style="font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${peer.name}</div>
          </div>
          <div style="font-size:11px; color:var(--text-muted); font-family:monospace;">${peer.ip}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function refreshSharedFolders() {
  const folders = await window.shareit.getSharedFolders();
  e('stat-shared').textContent = folders.length;
  
  const container = e('shared-folders-grid');
  if (folders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
        </svg>
        <h3>No shared items</h3>
        <p>Click "Share Folder / File" to share something with people on your network</p>
      </div>`;
    return;
  }
  
  container.innerHTML = folders.map(f => `
    <div class="folder-card">
      <div class="folder-header">
        <div class="folder-icon">
          ${getItemIcon(f.type, f.name)}
        </div>
        <div class="folder-info">
          <div class="folder-name">${f.name}</div>
          <div class="folder-path">${f.path}</div>
        </div>
      </div>
      <div class="folder-meta">
        <div>Shared with ${f.peers?.length || 0} peers</div>
        <div class="folder-actions">
          <button class="icon-btn" title="Stop sharing" onclick="window.stopSharingFolder('${f.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

async function refreshReceivedFolders() {
  const folders = await window.shareit.getReceivedFolders();
  e('stat-received').textContent = folders.length;
  
  const container = e('received-folders-grid');
  if (folders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        <h3>No items received yet</h3>
        <p>When someone shares something with you, it will appear here</p>
      </div>`;
    return;
  }
  
  container.innerHTML = folders.map(f => `
    <div class="folder-card">
      <div class="folder-header">
        <div class="folder-icon" style="background: rgba(16,185,129,0.1); color: var(--success);">
          ${getItemIcon(f.type, f.name)}
        </div>
        <div class="folder-info">
          <div class="folder-name">${f.name}</div>
          <div class="folder-path">${f.syncPath}</div>
        </div>
      </div>
      <div class="folder-meta">
        <div class="folder-owner">
          <div class="folder-owner-avatar">${getAvatarInitial(f.ownerInfo?.name)}</div>
          <span>${f.ownerInfo?.name || 'Unknown'}</span>
        </div>
        <div class="folder-actions">
          <button class="icon-btn" title="${f.type === 'file' ? 'Open File' : 'Open Folder'}" onclick="window.shareit.openSyncedFolder('${f.id}')">
            ${f.type === 'file' ? `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
              </svg>
            ` : `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
              </svg>
            `}
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

async function refreshSyncProgress() {
  const progressMap = await window.shareit.getSyncProgress();
  const list = Object.values(progressMap);
  
  const syncingCount = list.filter(p => p.status === 'syncing').length;
  e('stat-syncing').textContent = syncingCount;

  const renderItem = (p) => {
    const isDone = p.status === 'synced';
    const hasError = p.status === 'error';
    let statusClass = 'status-syncing';
    let statusText = `Syncing... ${p.percent}%`;
    
    if (isDone) { statusClass = 'status-synced'; statusText = 'Synced'; }
    if (hasError) { statusClass = 'status-error'; statusText = 'Error'; }

    const formatSize = (bytes) => {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    let filesHtml = '';
    if (p.syncedFiles && p.syncedFiles.length > 0) {
      filesHtml += p.syncedFiles.map(f => `
        <div style="font-size: 11px; margin-top: 4px; color: var(--text-muted); display:flex; justify-content:space-between;">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;" title="${f.name}">✅ ${f.name}</span>
          <span>${formatSize(f.size)} • from ${f.source.replace('http://', '')}</span>
        </div>
      `).join('');
    }
    if (p.currentFile) {
      filesHtml += `
        <div style="font-size: 11px; margin-top: 4px; color: var(--primary); display:flex; justify-content:space-between;">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;" title="${p.currentFile.name}">⬇️ ${p.currentFile.name}</span>
          <span>${formatSize(p.currentFile.size)} • from ${p.currentFile.source.replace('http://', '')}</span>
        </div>
      `;
    }

    return `
      <div class="sync-item">
        <div class="sync-item-icon" style="color: var(--${isDone ? 'success' : 'primary'}); background: rgba(${isDone ? '16,185,129' : '79,70,229'},0.1); padding:12px; border-radius:12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </div>
        <div class="sync-item-info">
          <div class="sync-item-header">
            <div class="sync-item-name">${p.folderName}</div>
            <div class="sync-item-status ${statusClass}">${statusText}</div>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill ${isDone ? 'done' : ''}" style="width: ${p.percent}%"></div>
          </div>
          <div style="margin-top: 8px;">
            ${filesHtml || '<div style="font-size: 11px; color: var(--text-muted);">No new files this sync.</div>'}
          </div>
        </div>
      </div>
    `;
  };

  const dbContainer = e('dashboard-sync-list');
  const syncContainer = e('sync-status-list');

  if (list.length === 0) {
    const emptyHtml = `
      <div class="empty-state small">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        <p>No sync activity yet</p>
      </div>`;
    dbContainer.innerHTML = emptyHtml;
    syncContainer.innerHTML = emptyHtml;
    return;
  }

  const itemsHtml = list.map(renderItem).join('');
  dbContainer.innerHTML = list.slice(0, 3).map(renderItem).join(''); // Top 3 on dashboard
  syncContainer.innerHTML = itemsHtml;
}

// Actions
async function refreshPeers() {
  networkPeers = await window.shareit.getPeers();
  updateStats();
  renderPeers();
  renderDashboardPeers();
}

function openShareModal() {
  selectedFolderToShare = null;
  selectedPeersToShare.clear();
  e('selected-folder-display').textContent = 'No folder selected';
  
  const list = e('peer-select-list');
  if (networkPeers.length === 0) {
    list.innerHTML = '<div class="empty-state small"><p>No peers found on LAN</p></div>';
  } else {
    list.innerHTML = networkPeers.map(p => `
      <div class="peer-select-item" onclick="togglePeerSelection('${p.id}', this)">
        <div class="peer-checkbox"></div>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:14px;">${p.name}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${p.ip}</div>
        </div>
      </div>
    `).join('');
  }
  
  e('share-modal').style.display = 'flex';
}

window.togglePeerSelection = (id, element) => {
  if (selectedPeersToShare.has(id)) {
    selectedPeersToShare.delete(id);
    element.classList.remove('selected');
  } else {
    selectedPeersToShare.add(id);
    element.classList.add('selected');
  }
};

async function sendShareRequest() {
  if (!selectedFolderToShare) {
    showToast('Please select a folder to share', 'error');
    return;
  }
  if (selectedPeersToShare.size === 0) {
    showToast('Please select at least one recipient', 'error');
    return;
  }

  const result = await window.shareit.shareFolder({
    folderPath: selectedFolderToShare,
    peerIds: Array.from(selectedPeersToShare)
  });

  if (result) {
    e('share-modal').style.display = 'none';
    showToast(`Sharing ${result.type}: ${result.name} with ${selectedPeersToShare.size} peers!`, 'success');
    refreshSharedFolders();
  }
}

window.stopSharingFolder = async (id) => {
  await window.shareit.stopSharing(id);
  showToast('Stopped sharing folder.', 'info');
  refreshSharedFolders();
};

function showAccessRequestModal(req) {
  currentAccessRequest = req;
  e('modal-request-info').textContent = `${req.ownerInfo.name} wants to share ${req.type === 'file' ? 'a file' : 'a folder'} with you.`;
  e('modal-folder-detail').innerHTML = `
    <div style="font-weight:600;font-size:16px;margin-bottom:8px;">${req.type === 'file' ? '📄' : '📁'} ${req.folderName}</div>
    <div style="font-size:12px;color:var(--text-muted);">From IP: ${req.ownerInfo.hostname}</div>
  `;
  e('request-modal').style.display = 'flex';
}

function showToast(message, type = 'info') {
  const container = e('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  if (type === 'success') {
    icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  }
  
  toast.innerHTML = `
    ${icon}
    <div style="font-size:14px;font-weight:500;">${message}</div>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Start
init();
