// Minimize-to-tray: closing the window (or clicking its own minimize
// button, which isn't cancelable, so main.js swaps it for a hide as soon
// as it fires) hides it instead of leaving a panel/taskbar entry, so the
// VPN tunnel and any in-progress torrents keep running in the background
// with nothing left visible except the tray icon. The icon doubles as a
// status glance (red/amber/green, same coding as the sidebar's VPN card,
// or a plain white dot at varying opacity in the "black and white" style)
// without opening the window.
//
// Note: on some Linux tray hosts (Cinnamon's xapp-sn-watcher among them)
// the icon may render as a generic glyph instead of the intended image.
// Investigated thoroughly: Electron's built-in Tray class only ever sends
// one icon size over D-Bus, no matter how many representations a
// nativeImage is given (confirmed directly), whereas apps that render
// correctly there are using a different, non-Electron-builtin tray
// implementation. Not fixable by changing the image; the show/hide/quit
// behaviour itself is unaffected.

class TrayController {
  constructor({ getWindow, quitApp }) {
    this.getWindow = getWindow;
    this.quitApp = quitApp;
    this.tray = null;
    this.icons = null;
    this.style = 'color';
    this.lastStatus = { status: 'disconnected', ip: null };
  }

  init(iconPaths) {
    const { Tray, Menu, nativeImage } = require('electron');
    this.Menu = Menu;
    this.icons = {
      color: {
        red: nativeImage.createFromPath(iconPaths.color.red),
        amber: nativeImage.createFromPath(iconPaths.color.amber),
        green: nativeImage.createFromPath(iconPaths.color.green),
      },
      mono: {
        red: nativeImage.createFromPath(iconPaths.mono.disconnected),
        amber: nativeImage.createFromPath(iconPaths.mono.connecting),
        green: nativeImage.createFromPath(iconPaths.mono.connected),
      },
    };
    this.tray = new Tray(this.icons.color.red);
    this.tray.setToolTip('Bitty: VPN not connected');
    this._rebuildMenu();
    this.tray.on('click', () => this.toggleWindow());
  }

  _rebuildMenu() {
    if (!this.tray) return;
    const win = this.getWindow();
    const visible = !!win && win.isVisible();
    const menu = this.Menu.buildFromTemplate([
      { label: visible ? 'Hide Bitty' : 'Show Bitty', click: () => this.toggleWindow() },
      { type: 'separator' },
      { label: 'Quit Bitty', click: () => this.quitApp() },
    ]);
    this.tray.setContextMenu(menu);
  }

  toggleWindow() {
    const win = this.getWindow();
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  }

  refreshMenu() { this._rebuildMenu(); }

  setIconStyle(style) {
    this.style = style === 'mono' ? 'mono' : 'color';
    this._applyIcon();
  }

  setVpnStatus(status) {
    this.lastStatus = status;
    this._applyIcon();
  }

  _applyIcon() {
    if (!this.tray) return;
    const status = this.lastStatus;
    const set = this.icons[this.style];
    let icon;
    let label;
    if (status.status === 'connected') {
      icon = set.green;
      label = status.ip ? `VPN connected · ${status.ip}` : 'VPN connected';
    } else if (status.status === 'connecting' || status.status === 'reconnecting') {
      icon = set.amber;
      label = status.status === 'reconnecting' ? 'VPN reconnecting…' : 'VPN connecting…';
    } else {
      icon = set.red;
      label = 'VPN not connected';
    }
    this.tray.setImage(icon);
    this.tray.setToolTip(`Bitty: ${label}`);
  }

  destroy() {
    if (this.tray) { this.tray.destroy(); this.tray = null; }
  }
}

module.exports = { TrayController };
