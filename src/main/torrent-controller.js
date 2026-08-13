const paths = require('./paths');
const { Client } = require('./ndjson-socket');

class TorrentController {
  constructor(onTorrents) {
    this.onTorrents = onTorrents;
    this.client = null;
  }

  async connectIfNeeded() {
    if (this.client) return true;
    const client = new Client(paths.workerSocket);
    try {
      await client.connect(10, 300);
    } catch (_) {
      return false;
    }
    this.client = client;
    client.on('event', (msg) => {
      if (msg.type === 'torrents') this.onTorrents && this.onTorrents({ torrents: msg.torrents, throttle: msg.throttle });
    });
    client.on('close', () => { this.client = null; });
    return true;
  }

  async addMagnet(magnet) {
    if (!(await this.connectIfNeeded())) throw new Error('torrent engine not running (connect the VPN first)');
    const res = await this.client.request('add-magnet', { magnet });
    if (!res.ok) throw new Error(res.error);
    return res;
  }

  async addTorrentFile(base64) {
    if (!(await this.connectIfNeeded())) throw new Error('torrent engine not running (connect the VPN first)');
    const res = await this.client.request('add-torrent-file', { base64 });
    if (!res.ok) throw new Error(res.error);
    return res;
  }

  async pause(infoHash) { return this._simple('pause', { infoHash }); }
  async resume(infoHash) { return this._simple('resume', { infoHash }); }
  async remove(infoHash, deleteFiles) { return this._simple('remove', { infoHash, deleteFiles }); }
  async setDownloadDir(path_) { return this._simple('set-download-dir', { path: path_ }); }
  async setThrottle(mode, manualCapKBps, autoPercent) {
    return this._simple('set-throttle', { mode, manualCapKBps, autoPercent });
  }
  async resumeSaved() { return this._simple('resume-saved', {}); }

  async _simple(type, payload) {
    if (!this.client) throw new Error('torrent engine not running');
    const res = await this.client.request(type, payload);
    if (!res.ok) throw new Error(res.error || (type + ' failed'));
    return res;
  }
}

module.exports = { TorrentController };
