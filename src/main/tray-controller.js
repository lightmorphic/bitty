// Minimize-to-tray: closing the window hides it instead of quitting, so
// the VPN tunnel and any in-progress torrents keep running in the
// background. The tray icon itself doubles as a status glance (red/amber/
// green, same coding as the sidebar's VPN card) without opening the window.

class TrayController {
  constructor({ getWindow, quitApp }) {
    this.getWindow = getWindow;
    this.quitApp = quitApp;
    this.tray = null;
    this.icons = null;
  }

  init(icons) {
    const { Tray, Menu, nativeImage } = require('electron');
    this.Menu = Menu;
    this.icons = {
      red: nativeImage.createFromPath(icons.red),
      amber: nativeImage.createFromPath(icons.amber),
      green: nativeImage.createFromPath(icons.green),
    };
    this.tray = new Tray(this.icons.red);
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
    this._rebuildMenu();
  }

  setVpnStatus(status) {
    if (!this.tray) return;
    let icon;
    let label;
    if (status.status === 'connected') {
      icon = this.icons.green;
      label = status.ip ? `VPN connected · ${status.ip}` : 'VPN connected';
    } else if (status.status === 'connecting' || status.status === 'reconnecting') {
      icon = this.icons.amber;
      label = status.status === 'reconnecting' ? 'VPN reconnecting…' : 'VPN connecting…';
    } else {
      icon = this.icons.red;
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
