(() => {
  const $ = (id) => document.getElementById(id);

  const updateDot = $('updateDot');
  const appVersion = $('appVersion');

  const vpnBadge = $('vpnBadge');
  const vpnBadgeText = $('vpnBadgeText');
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
  const vpnDetail = $('vpnDetail');

  const magnetInput = $('magnetInput');
  const addMagnetBtn = $('addMagnetBtn');
  const chooseTorrentFileBtn = $('chooseTorrentFileBtn');
  const openFolderBtn = $('openFolderBtn');
  const torrentRows = $('torrentRows');

  const downloadDirText = $('downloadDirText');
  const chooseDownloadDirBtn = $('chooseDownloadDirBtn');
  const autoThrottleToggle = $('autoThrottleToggle');
  const autoPercentInput = $('autoPercentInput');
  const manualCapInput = $('manualCapInput');
  const measuredHint = $('measuredHint');

  let pendingOvpn = null; // { filename, text } picked but not yet saved
  let currentSettings = null;
  let hasConfig = false;

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
    vpnBadge.classList.remove('vpn-badge--down', 'vpn-badge--connecting', 'vpn-badge--up');
    if (status.status === 'connected') {
      vpnBadge.classList.add('vpn-badge--up');
      vpnBadgeText.textContent = status.ip ? `VPN connected · ${status.ip}` : 'VPN connected';
    } else if (status.status === 'connecting' || status.status === 'reconnecting') {
      vpnBadge.classList.add('vpn-badge--connecting');
      vpnBadgeText.textContent = status.status === 'reconnecting' ? 'VPN reconnecting…' : 'VPN connecting…';
    } else {
      vpnBadge.classList.add('vpn-badge--down');
      vpnBadgeText.textContent = 'VPN not connected';
    }
    vpnDetail.textContent = status.lastError ? `Last error: ${status.lastError}` : '';

    connectBtn.disabled = status.status === 'connecting' || status.status === 'connected';
    const isUp = status.status === 'connected' || status.status === 'connecting' || status.status === 'reconnecting';
    connectBtn.classList.toggle('vpn-actions--hidden', !hasConfig || isUp);
    disconnectBtn.classList.toggle('vpn-actions--hidden', !isUp);
  }

  function renderVpnConfigState() {
    ovpnFilename.textContent = pendingOvpn ? pendingOvpn.filename
      : (hasConfig && currentSettings ? `Saved: ${currentSettings.vpn.filename}` : 'No config uploaded yet');
    vpnAuthRow.classList.toggle('form-row--hidden', !(pendingOvpn || hasConfig));
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
      vpnError.textContent = e.message;
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
      vpnError.textContent = e.message;
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
      vpnError.textContent = e.message;
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
    vpnError.textContent = '';
    try {
      await window.bitty.torrents.addMagnet(magnet);
      magnetInput.value = '';
    } catch (e) {
      vpnError.textContent = e.message;
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
        vpnError.textContent = e.message;
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
    };
    return `<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">${icons[kind]}</svg>`;
  }

  let removeArmed = null; // infoHash currently showing the confirm state

  function renderTorrents(torrents) {
    if (!torrents.length) {
      torrentRows.innerHTML = '<tr class="empty-row"><td colspan="6">No torrents yet. Add a magnet link or a .torrent file above.</td></tr>';
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
              aria-label="${t.paused ? 'Resume' : 'Pause'} ${escapeHtml(t.name)}" title="${t.paused ? 'Resume' : 'Pause'}">
              ${svgIcon(t.paused ? 'resume' : 'pause')}
            </button>
            <button class="icon-btn ${removeArmed === t.infoHash ? 'danger-armed' : ''}" data-action="remove" data-hash="${t.infoHash}"
              aria-label="Remove ${escapeHtml(t.name)}" title="Remove">
              ${removeArmed === t.infoHash ? '✓' : svgIcon('remove')}
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
      if (removeArmed === hash) {
        removeArmed = null;
        await window.bitty.torrents.remove(hash, false);
      } else {
        removeArmed = hash;
        setTimeout(() => { if (removeArmed === hash) removeArmed = null; }, 4000);
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

  function applySettings(s) {
    currentSettings = s;
    hasConfig = s.vpn.hasConfig;
    downloadDirText.textContent = s.downloadDir || '';
    autoThrottleToggle.checked = !!s.autoThrottleEnabled;
    autoPercentInput.value = s.autoThrottlePercent;
    manualCapInput.value = s.speedCapKBps;
    autoPercentInput.disabled = !autoThrottleToggle.checked;
    manualCapInput.disabled = autoThrottleToggle.checked;
    renderVpnConfigState();
  }

  window.bitty.settings.onSettings(applySettings);

  const RING_CIRCUMFERENCE = 50.27; // 2 * PI * r(8), matches style.css
  const ringProgressEl = updateDot.querySelector('.ring-progress');

  const UPDATE_TOOLTIPS = {
    'up-to-date': 'Up to date',
    available: 'Update available, click to download',
    downloading: 'Downloading update',
    ready: 'Click to restart the app',
    error: "Can't connect to GitHub",
  };

  function renderUpdateStatus(status) {
    appVersion.textContent = `v${status.version || '0.0.0'}`;
    updateDot.dataset.state = status.state;
    updateDot.setAttribute('aria-label', UPDATE_TOOLTIPS[status.state] || 'Checking for updates');
    updateDot.title = UPDATE_TOOLTIPS[status.state] || '';
    if (status.state === 'downloading') {
      const offset = RING_CIRCUMFERENCE * (1 - (status.progress || 0));
      ringProgressEl.style.strokeDashoffset = String(offset);
    }
  }

  updateDot.addEventListener('click', () => {
    const state = updateDot.dataset.state;
    if (state === 'available') window.bitty.updater.download();
    else if (state === 'ready') window.bitty.updater.restart();
  });
  window.bitty.updater.onStatus(renderUpdateStatus);

  (async () => {
    const s = await window.bitty.settings.get();
    applySettings(s);
    renderVpnBadge(await window.bitty.vpn.status());
    renderUpdateStatus(await window.bitty.updater.status());
  })();
})();
