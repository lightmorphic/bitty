const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('bitty', {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    chooseDownloadDir: () => invoke('settings:choose-download-dir'),
    onSettings: (fn) => on('settings', fn),
  },
  vpn: {
    chooseOvpnFile: () => invoke('vpn:choose-ovpn-file'),
    saveConfig: (cfg) => invoke('vpn:save-config', cfg),
    clearConfig: () => invoke('vpn:clear-config'),
    connect: () => invoke('vpn:connect'),
    disconnect: () => invoke('vpn:disconnect'),
    status: () => invoke('vpn:status'),
    onStatus: (fn) => on('vpn-status', fn),
  },
  torrents: {
    addMagnet: (magnet) => invoke('torrents:add-magnet', magnet),
    addFile: (name, base64) => invoke('torrents:add-file', { name, base64 }),
    pause: (infoHash) => invoke('torrents:pause', infoHash),
    resume: (infoHash) => invoke('torrents:resume', infoHash),
    remove: (infoHash, deleteFiles) => invoke('torrents:remove', { infoHash, deleteFiles }),
    setThrottle: (mode, manualCapKBps, autoPercent) =>
      invoke('torrents:set-throttle', { mode, manualCapKBps, autoPercent }),
    onUpdate: (fn) => on('torrents', fn),
  },
  openDownloadDir: () => invoke('shell:open-download-dir'),
  clipboard: {
    readText: () => invoke('clipboard:read-text'),
  },
  updater: {
    status: () => invoke('updater:status'),
    check: () => invoke('updater:check'),
    download: () => invoke('updater:download'),
    restart: () => invoke('updater:restart'),
    onStatus: (fn) => on('updater-status', fn),
  },
});
