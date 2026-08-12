// The one deliberate exception to "nothing calls out except the VPN
// tunnel": checking GitHub Releases for a newer build. This talks
// directly to api.github.com / github.com over the main process's normal
// (non-namespaced) network path, same as any other desktop app checking
// for updates. It never touches the VPN or the isolated namespace.

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

class UpdaterController {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.status = { state: 'unknown', version: null, error: null };
    this.autoUpdater = null;
    this.timer = null;
  }

  init(appVersion) {
    this.status.version = appVersion;
    const { autoUpdater } = require('electron-updater');
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => this._set({ state: 'checking' }));
    autoUpdater.on('update-available', () => this._set({ state: 'downloading' }));
    autoUpdater.on('update-not-available', () => this._set({ state: 'up-to-date', error: null }));
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

  restartAndInstall() {
    if (!this.autoUpdater) return;
    this.autoUpdater.quitAndInstall();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { UpdaterController };
