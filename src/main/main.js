// Entry point. Two completely different lives, chosen at spawn time:
//
//  1. Normal launch (double-click the AppImage): full Electron GUI app.
//  2. `--bitty-helper` (spawned by us, via pkexec, with
//     ELECTRON_RUN_AS_NODE=1): no GUI at all, just the privileged
//     network/VPN helper. See src/helper/helper.js, nothing Electron-y
//     is imported on this path.

if (process.argv.includes('--bitty-helper')) {
  require('../helper/helper.js').start(process.argv);
} else {
  runApp();
}

function runApp() {
  const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
  const path = require('path');
  const fs = require('fs');

  const { Settings } = require('./settings');
  const { VpnController } = require('./vpn-controller');
  const { TorrentController } = require('./torrent-controller');
  const { parseOvpn } = require('./ovpn-parse');

  // Nothing this app does needs GPU-accelerated web content, autofill,
  // or any of Electron's own network features (spellcheck downloads,
  // crash reporter uploads). Turn all of it off: the only outbound
  // connection this process should ever be party to is the one made by
  // the sandboxed torrent worker through the VPN tunnel.
  app.commandLine.appendSwitch('disable-http-cache');
  app.setPath('crashDumps', path.join(app.getPath('temp'), 'bitty-crashdumps'));

  let mainWindow;
  let settings;
  let vpn;
  let torrents;

  function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  app.whenReady().then(() => {
    settings = new Settings(app.getPath('userData'), safeStorage);
    if (!settings.data.downloadDir) {
      settings.update({ downloadDir: path.join(app.getPath('home'), 'Downloads') });
    }

    vpn = new VpnController((status) => {
      send('vpn-status', status);
      if (status.status === 'connected') onVpnConnected();
    });
    torrents = new TorrentController((list) => send('torrents', list));

    async function onVpnConnected() {
      const ok = await torrents.connectIfNeeded();
      if (!ok) return; // worker not up yet; will retry on the next 'connected' event if it flaps
      const s = settings.data;
      await torrents.setDownloadDir(s.downloadDir).catch(() => {});
      await torrents.setThrottle(
        s.autoThrottleEnabled ? 'auto' : 'manual',
        s.speedCapKBps,
        s.autoThrottlePercent,
      ).catch(() => {});
    }

    mainWindow = new BrowserWindow({
      width: 980,
      height: 720,
      minWidth: 720,
      minHeight: 480,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.webContents.once('did-finish-load', () => {
      send('settings', settings.get());
      send('vpn-status', vpn.status);
    });
  });

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:update', (_e, patch) => settings.update(patch));

  ipcMain.handle('settings:choose-download-dir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.data.downloadDir,
    });
    if (res.canceled || !res.filePaths[0]) return settings.get();
    const s = settings.update({ downloadDir: res.filePaths[0] });
    if (torrents.client) await torrents.setDownloadDir(res.filePaths[0]).catch(() => {});
    return s;
  });

  ipcMain.handle('vpn:choose-ovpn-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'OpenVPN config', extensions: ['ovpn', 'conf'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const filePath = res.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    try {
      parseOvpn(text); // validate before we accept it
    } catch (e) {
      throw new Error('That file doesn\'t look like a valid .ovpn config: ' + e.message);
    }
    return { filename: path.basename(filePath), text };
  });

  ipcMain.handle('vpn:save-config', async (_e, { filename, text, username, password }) => {
    return settings.saveVpnConfig({ ovpnText: text, filename, username, password });
  });

  ipcMain.handle('vpn:clear-config', async () => {
    await vpn.disconnect().catch(() => {});
    return settings.clearVpnConfig();
  });

  ipcMain.handle('vpn:connect', async () => {
    const secrets = settings.loadVpnSecrets();
    if (!secrets) throw new Error('Upload a VPN config first.');
    await vpn.connect(secrets);
    return vpn.status;
  });

  ipcMain.handle('vpn:disconnect', async () => {
    await vpn.disconnect();
    return vpn.status;
  });

  ipcMain.handle('vpn:status', () => vpn.status);

  ipcMain.handle('torrents:add-magnet', async (_e, magnet) => torrents.addMagnet(magnet));
  ipcMain.handle('torrents:add-file', async (_e, { name, base64 }) => torrents.addTorrentFile(base64));
  ipcMain.handle('torrents:pause', async (_e, infoHash) => torrents.pause(infoHash));
  ipcMain.handle('torrents:resume', async (_e, infoHash) => torrents.resume(infoHash));
  ipcMain.handle('torrents:remove', async (_e, { infoHash, deleteFiles }) => torrents.remove(infoHash, deleteFiles));
  ipcMain.handle('torrents:set-throttle', async (_e, { mode, manualCapKBps, autoPercent }) => {
    settings.update({
      autoThrottleEnabled: mode === 'auto',
      speedCapKBps: manualCapKBps,
      autoThrottlePercent: autoPercent,
    });
    if (torrents.client) return torrents.setThrottle(mode, manualCapKBps, autoPercent);
    return { ok: true };
  });

  ipcMain.handle('shell:open-download-dir', () => shell.openPath(settings.data.downloadDir));

  let quitting = false;
  app.on('before-quit', async (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    if (vpn) await vpn.teardown().catch(() => {});
    app.exit(0);
  });

  app.on('window-all-closed', () => app.quit());
}
