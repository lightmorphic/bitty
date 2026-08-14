// The one deliberate exception to "nothing calls out except the VPN
// tunnel": checking GitHub Releases for a newer build. This talks
// directly to api.github.com / github.com over the main process's normal
// (non-namespaced) network path, same as any other desktop app checking
// for updates. It never touches the VPN or the isolated namespace.
//
// Follows Charlie's standard update-widget states: up-to-date, available
// (needs a click to start the download), downloading (progress-driven,
// no click), ready (needs a click to restart), error. Downloads are
// explicitly NOT automatic, the dot's "available" state is what triggers
// downloadUpdate().

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

class UpdaterController {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.status = { state: 'unknown', version: null, newVersion: null, progress: 0, error: null };
    this.autoUpdater = null;
    this.timer = null;
  }

  init(appVersion) {
    this.status.version = appVersion;
    const { autoUpdater } = require('electron-updater');
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => this._set({ state: 'checking' }));
    autoUpdater.on('update-available', () => this._set({ state: 'available', error: null }));
    autoUpdater.on('update-not-available', () => this._set({ state: 'up-to-date', error: null }));
    autoUpdater.on('download-progress', (p) => this._set({ state: 'downloading', progress: p.percent / 100 }));
    autoUpdater.on('update-downloaded', (info) => this._set({ state: 'ready', newVersion: info.version }));
    autoUpdater.on('error', (err) => this._set({ state: 'error', error: err.message }));

    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  _set(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus && this.onStatus(this.status);
  }

  check() {
    if (!this.autoUpdater) return;
    this.autoUpdater.checkForUpdates().catch((err) => this._set({ state: 'error', error: err.message }));
  }

  download() {
    if (!this.autoUpdater) return;
    this.autoUpdater.downloadUpdate().catch((err) => this._set({ state: 'error', error: err.message }));
  }

  restartAndInstall() {
    if (!this.autoUpdater) return;
    this.autoUpdater.quitAndInstall();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { UpdaterController };
