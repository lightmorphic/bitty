const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  downloadDir: null, // set to ~/Downloads on first run by main.js
  speedCapKBps: 0, // 0 = unlimited
  autoThrottleEnabled: true,
  autoThrottlePercent: 50,
  trayIconStyle: 'color', // 'color' | 'mono'
  vpn: { hasConfig: false, filename: null, username: null },
};

class Settings {
  constructor(userDataDir, safeStorage) {
    this.file = path.join(userDataDir, 'settings.json');
    this.safeStorage = safeStorage;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...DEFAULTS, ...raw, vpn: { ...DEFAULTS.vpn, ...(raw.vpn || {}) } };
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  get() {
    // never return raw secret material to the renderer
    const { vpn, ...rest } = this.data;
    return { ...rest, vpn: { hasConfig: vpn.hasConfig, filename: vpn.filename, username: vpn.username } };
  }

  update(patch) {
    for (const key of ['downloadDir', 'speedCapKBps', 'autoThrottleEnabled', 'autoThrottlePercent', 'trayIconStyle']) {
      if (patch[key] !== undefined) this.data[key] = patch[key];
    }
    this._save();
    return this.get();
  }

  // ovpnText/password: empty/undefined means "keep what's already stored"
  saveVpnConfig({ ovpnText, filename, username, password }) {
    const enc = (s) => (this.safeStorage.isEncryptionAvailable()
      ? this.safeStorage.encryptString(s).toString('base64')
      : Buffer.from(s, 'utf8').toString('base64'));

    if (ovpnText) {
      this.data.vpn.ovpnEncrypted = enc(ovpnText);
      this.data.vpn.filename = filename || 'config.ovpn';
      this.data.vpn.hasConfig = true;
    }
    if (username !== undefined && username !== null) {
      this.data.vpn.username = username;
      this.data.vpn.usernameEncrypted = username ? enc(username) : undefined;
    }
    if (password) {
      this.data.vpn.passwordEncrypted = enc(password);
    }
    this._save();
    return this.get();
  }

  loadVpnSecrets() {
    const dec = (b64) => {
      const buf = Buffer.from(b64, 'base64');
      return this.safeStorage.isEncryptionAvailable() ? this.safeStorage.decryptString(buf) : buf.toString('utf8');
    };
    const v = this.data.vpn;
    if (!v.hasConfig || !v.ovpnEncrypted) return null;
    return {
      ovpnText: dec(v.ovpnEncrypted),
      username: v.usernameEncrypted ? dec(v.usernameEncrypted) : null,
      password: v.passwordEncrypted ? dec(v.passwordEncrypted) : null,
    };
  }

  clearVpnConfig() {
    this.data.vpn = { ...DEFAULTS.vpn };
    this._save();
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
