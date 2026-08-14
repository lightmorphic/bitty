(() => {
  const $ = (id) => document.getElementById(id);

  const updateDot = $('updateDot');
  const appVersion = $('appVersion');

  const vpnStatusCard = $('vpnStatusCard');
  const vpnStatusLabel = $('vpnStatusLabel');
  const vpnStatusDetail = $('vpnStatusDetail');
  const chooseOvpnBtn = $('chooseOvpnBtn');
  const ovpnFilename = $('ovpnFilename');
  const vpnAuthRow = $('vpnAuthRow');
  const vpnUsername = $('vpnUsername');
  const vpnPassword = $('vpnPassword');
  const saveVpnBtn = $('saveVpnBtn');
  const connectBtn = $('connectBtn');
  const disconnectBtn = $('disconnectBtn');
  const forgetVpnBtn = $('forgetVpnBtn');
  const vpnError = $('vpnError');

  const magnetInput = $('magnetInput');
  const addMagnetBtn = $('addMagnetBtn');
  const chooseTorrentFileBtn = $('chooseTorrentFileBtn');
  const openFolderBtn = $('openFolderBtn');
  const torrentRows = $('torrentRows');
  const torrentError = $('torrentError');

  const settingsBtn = $('settingsBtn');
  const settingsOverlay = $('settingsOverlay');
  const settingsCloseBtn = $('settingsCloseBtn');
  const downloadDirText = $('downloadDirText');
  const chooseDownloadDirBtn = $('chooseDownloadDirBtn');
  const autoThrottleToggle = $('autoThrottleToggle');
  const autoPercentInput = $('autoPercentInput');
  const manualCapInput = $('manualCapInput');
  const measuredHint = $('measuredHint');
  const trayIconStyleSelect = $('trayIconStyleSelect');

  let pendingOvpn = null; // { filename, text } picked but not yet saved
  let currentSettings = null;
  let hasConfig = false;

  // Electron's IPC rejections stringify as "Error invoking remote method
  // 'x': Error: <actual message>", strip that down to just the message
  // an end user should see.
  function cleanErrorMessage(e) {
    const raw = (e && e.message) || String(e);
    const match = raw.match(/Error:\s*(.+)$/s);
    return match ? match[1].trim() : raw;
  }

  function fmtSpeed(bps) {
    if (!bps || bps <= 0) return '0 KB/s';
    const kb = bps / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB/s`;
    return `${(kb / 1024).toFixed(1)} MB/s`;
  }
  function fmtBytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function renderVpnBadge(status) {
    vpnStatusCard.classList.remove('vpn-status-card--down', 'vpn-status-card--connecting', 'vpn-status-card--up');
    if (status.status === 'connected') {
      vpnStatusCard.classList.add('vpn-status-card--up');
      vpnStatusLabel.textContent = 'VPN connected';
      vpnStatusDetail.textContent = status.ip ? `Torrenting through ${status.ip}` : 'Torrenting is active';
    } else if (status.status === 'connecting' || status.status === 'reconnecting') {
      vpnStatusCard.classList.add('vpn-status-card--connecting');
      vpnStatusLabel.textContent = status.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
      vpnStatusDetail.textContent = 'Torrenting stays blocked until the tunnel is up';
    } else {
      vpnStatusCard.classList.add('vpn-status-card--down');
      vpnStatusLabel.textContent = 'VPN not connected';
      vpnStatusDetail.textContent = status.lastError || 'Torrenting is blocked until this is connected';
    }

    connectBtn.disabled = status.status === 'connecting' || status.status === 'connected';
    const isUp = status.status === 'connected' || status.status === 'connecting' || status.status === 'reconnecting';
    connectBtn.classList.toggle('vpn-actions--hidden', !hasConfig || isUp);
    disconnectBtn.classList.toggle('vpn-actions--hidden', !isUp);
  }

  function renderVpnConfigState() {
    ovpnFilename.textContent = pendingOvpn ? pendingOvpn.filename
      : (hasConfig && currentSettings ? `Saved: ${currentSettings.vpn.filename}` : 'No config uploaded yet');
    vpnAuthRow.classList.toggle('stack--hidden', !(pendingOvpn || hasConfig));
    saveVpnBtn.classList.toggle('vpn-actions--hidden', !pendingOvpn);
    forgetVpnBtn.classList.toggle('vpn-actions--hidden', !hasConfig);
    if (hasConfig && currentSettings && currentSettings.vpn.username) {
      vpnUsername.value = currentSettings.vpn.username;
    }
  }

  chooseOvpnBtn.addEventListener('click', async () => {
    vpnError.textContent = '';
    try {
      const picked = await window.bitty.vpn.chooseOvpnFile();
      if (!picked) return;
      pendingOvpn = picked;
      renderVpnConfigState();
    } catch (e) {
      vpnError.textContent = cleanErrorMessage(e);
    }
  });

  saveVpnBtn.addEventListener('click', async () => {
    vpnError.textContent = '';
    try {
      const s = await window.bitty.vpn.saveConfig({
        filename: pendingOvpn ? pendingOvpn.filename : undefined,
        text: pendingOvpn ? pendingOvpn.text : undefined,
        username: vpnUsername.value || undefined,
        password: vpnPassword.value || undefined,
      });
      currentSettings = s;
      hasConfig = s.vpn.hasConfig;
      pendingOvpn = null;
      vpnPassword.value = '';
      renderVpnConfigState();
      renderVpnBadge(await window.bitty.vpn.status());
    } catch (e) {
      vpnError.textContent = cleanErrorMessage(e);
    }
  });

  forgetVpnBtn.addEventListener('click', async () => {
    const s = await window.bitty.vpn.clearConfig();
    currentSettings = s;
    hasConfig = false;
    vpnUsername.value = '';
    vpnPassword.value = '';
    renderVpnConfigState();
    renderVpnBadge(await window.bitty.vpn.status());
  });

  connectBtn.addEventListener('click', async () => {
    vpnError.textContent = '';
    connectBtn.disabled = true;
    try {
      await window.bitty.vpn.connect();
    } catch (e) {
      vpnError.textContent = cleanErrorMessage(e);
      connectBtn.disabled = false;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    await window.bitty.vpn.disconnect();
  });

  window.bitty.vpn.onStatus((status) => renderVpnBadge(status));

  addMagnetBtn.addEventListener('click', async () => {
    const magnet = magnetInput.value.trim();
    if (!magnet) return;
    torrentError.textContent = '';
    try {
      await window.bitty.torrents.addMagnet(magnet);
      magnetInput.value = '';
    } catch (e) {
      torrentError.textContent = cleanErrorMessage(e);
    }
  });
  magnetInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMagnetBtn.click(); });

  chooseTorrentFileBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.torrent';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      try {
        await window.bitty.torrents.addFile(file.name, base64);
      } catch (e) {
        torrentError.textContent = cleanErrorMessage(e);
      }
    });
    input.click();
  });

  openFolderBtn.addEventListener('click', () => window.bitty.openDownloadDir());

  function svgIcon(kind) {
    const icons = {
      pause: '<path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor"/>',
      resume: '<path d="M6 4l9 6-9 6V4z" fill="currentColor"/>',
      remove: '<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      trash: '<path d="M5 6.5h10M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M8.5 9.5v5M11.5 9.5v5M6 6.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    };
    return `<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">${icons[kind]}</svg>`;
  }

  let deleteArmed = null; // infoHash currently showing the "delete files too" confirm state

  const EMPTY_STATE_HTML = `<tr class="empty-row"><td colspan="6">
    <div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="17" stroke="currentColor" stroke-width="1.6" opacity="0.35"/>
        <path d="M13 20.5 18 25.5 27.5 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
      </svg>
      <p>No torrents yet</p>
      <span class="hint">Paste a magnet link or upload a .torrent file above to get started</span>
    </div>
  </td></tr>`;

  function renderTorrents(torrents) {
    if (!torrents.length) {
      torrentRows.innerHTML = EMPTY_STATE_HTML;
      return;
    }
    torrentRows.innerHTML = '';
    for (const t of torrents) {
      const tr = document.createElement('tr');
      const pct = Math.round((t.progress || 0) * 100);
      tr.innerHTML = `
        <td>${escapeHtml(t.name)}</td>
        <td>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="hint">${pct}% · ${fmtBytes(t.downloaded)} / ${fmtBytes(t.length)}</span>
        </td>
        <td>${fmtSpeed(t.downloadSpeed)}</td>
        <td>${fmtSpeed(t.uploadSpeed)}</td>
        <td>${t.numPeers}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-action="${t.paused ? 'resume' : 'pause'}" data-hash="${t.infoHash}"
              aria-label="${t.paused ? 'Resume' : 'Pause'} ${escapeHtml(t.name)}" data-tooltip="${t.paused ? 'Resume' : 'Pause'}">
              ${svgIcon(t.paused ? 'resume' : 'pause')}
            </button>
            <button class="icon-btn" data-action="remove" data-hash="${t.infoHash}"
              aria-label="Remove ${escapeHtml(t.name)} from the list (keeps downloaded files)" data-tooltip="Remove from list (keeps files)">
              ${svgIcon('remove')}
            </button>
            <button class="icon-btn ${deleteArmed === t.infoHash ? 'danger-armed' : ''}" data-action="delete" data-hash="${t.infoHash}"
              aria-label="Delete ${escapeHtml(t.name)} and its downloaded files" data-tooltip="Delete torrent and files">
              ${deleteArmed === t.infoHash ? '✓' : svgIcon('trash')}
            </button>
          </div>
        </td>`;
      torrentRows.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  torrentRows.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, hash } = btn.dataset;
    if (action === 'pause') await window.bitty.torrents.pause(hash);
    else if (action === 'resume') await window.bitty.torrents.resume(hash);
    else if (action === 'remove') {
      // Non-destructive (files stay on disk), no confirm needed.
      await window.bitty.torrents.remove(hash, false);
    } else if (action === 'delete') {
      if (deleteArmed === hash) {
        deleteArmed = null;
        await window.bitty.torrents.remove(hash, true);
      } else {
        deleteArmed = hash;
        setTimeout(() => { if (deleteArmed === hash) deleteArmed = null; }, 4000);
      }
    }
  });

  window.bitty.torrents.onUpdate(({ torrents, throttle }) => {
    renderTorrents(torrents);
    if (throttle) {
      if (throttle.mode === 'auto') {
        measuredHint.textContent = throttle.remeasuring
          ? 'Measuring your connection speed…'
          : throttle.measuredCapacityBps
            ? `Measured ~${fmtSpeed(throttle.measuredCapacityBps)}, limiting to ${throttle.autoPercent}% (${fmtSpeed(throttle.measuredCapacityBps * throttle.autoPercent / 100)})`
            : 'Waiting for transfer activity to measure your connection…';
      } else {
        measuredHint.textContent = '';
      }
    }
  });

  chooseDownloadDirBtn.addEventListener('click', async () => {
    const s = await window.bitty.settings.chooseDownloadDir();
    currentSettings = s;
    downloadDirText.textContent = s.downloadDir;
  });

  async function pushThrottleSettings() {
    const mode = autoThrottleToggle.checked ? 'auto' : 'manual';
    const autoPercent = Math.min(100, Math.max(1, Number(autoPercentInput.value) || 50));
    const manualCapKBps = Math.max(0, Number(manualCapInput.value) || 0);
    autoPercentInput.disabled = !autoThrottleToggle.checked;
    manualCapInput.disabled = autoThrottleToggle.checked;
    await window.bitty.torrents.setThrottle(mode, manualCapKBps, autoPercent);
  }
  autoThrottleToggle.addEventListener('change', pushThrottleSettings);
  autoPercentInput.addEventListener('change', pushThrottleSettings);
  manualCapInput.addEventListener('change', pushThrottleSettings);

  trayIconStyleSelect.addEventListener('change', () => {
    window.bitty.settings.update({ trayIconStyle: trayIconStyleSelect.value });
  });

  function applySettings(s) {
    currentSettings = s;
    hasConfig = s.vpn.hasConfig;
    downloadDirText.textContent = s.downloadDir || '';
    autoThrottleToggle.checked = !!s.autoThrottleEnabled;
    autoPercentInput.value = s.autoThrottlePercent;
    manualCapInput.value = s.speedCapKBps;
    autoPercentInput.disabled = !autoThrottleToggle.checked;
    manualCapInput.disabled = autoThrottleToggle.checked;
    trayIconStyleSelect.value = s.trayIconStyle || 'color';
    renderVpnConfigState();
  }

  window.bitty.settings.onSettings(applySettings);

  function openSettings() {
    settingsOverlay.classList.remove('modal-overlay--hidden');
  }
  function closeSettings() {
    settingsOverlay.classList.add('modal-overlay--hidden');
  }
  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('modal-overlay--hidden')) closeSettings();
  });

  const RING_CIRCUMFERENCE = 50.27; // 2 * PI * r(8), matches style.css
  const ringProgressEl = updateDot.querySelector('.ring-progress');

  const UPDATE_TOOLTIPS = {
    checking: 'Checking for updates',
    'up-to-date': 'Up to date',
    available: 'Update available, click to download',
    downloading: 'Downloading update',
    ready: 'Click to restart the app',
    error: "Can't connect to GitHub, click to retry",
  };

  let lastUpdateState = null;
  let checkingStartedAt = null;
  const MIN_CHECKING_MS = 900; // GitHub answers fast enough that the pulse would otherwise barely flash

  function renderUpdateStatus(status) {
    if (status.state === 'checking') {
      checkingStartedAt = Date.now();
      applyUpdateStatus(status);
      return;
    }
    if (checkingStartedAt !== null) {
      const elapsed = Date.now() - checkingStartedAt;
      checkingStartedAt = null;
      if (elapsed < MIN_CHECKING_MS) {
        setTimeout(() => applyUpdateStatus(status), MIN_CHECKING_MS - elapsed);
        return;
      }
    }
    applyUpdateStatus(status);
  }

  function applyUpdateStatus(status) {
    appVersion.textContent = `v${status.version || '0.0.0'}`;
    const previousState = lastUpdateState;
    lastUpdateState = status.state;
    updateDot.dataset.state = status.state;
    updateDot.setAttribute('aria-label', UPDATE_TOOLTIPS[status.state] || 'Checking for updates');
    updateDot.setAttribute('data-tooltip', UPDATE_TOOLTIPS[status.state] || 'Checking for updates');
    if (status.state === 'downloading') {
      const offset = RING_CIRCUMFERENCE * (1 - (status.progress || 0));
      ringProgressEl.style.strokeDashoffset = String(offset);
    }
    // A check that was already running (the dot pulsing) just landed on
    // up-to-date: surface that as a result, not just something you'd only
    // see by happening to still be hovering.
    if (previousState === 'checking' && status.state === 'up-to-date' && window.bittyTooltip) {
      window.bittyTooltip.showTransient(updateDot, 'Up to date', 2200);
    }
  }

  updateDot.addEventListener('click', () => {
    const state = updateDot.dataset.state;
    if (state === 'available') window.bitty.updater.download();
    else if (state === 'ready') window.bitty.updater.restart();
    else if (state === 'downloading' || state === 'checking') return; // already in progress
    else window.bitty.updater.check(); // up-to-date, error, or unknown: check right now
  });
  window.bitty.updater.onStatus(renderUpdateStatus);

  (async () => {
    const s = await window.bitty.settings.get();
    applySettings(s);
    renderVpnBadge(await window.bitty.vpn.status());
    renderUpdateStatus(await window.bitty.updater.status());
  })();
})();
