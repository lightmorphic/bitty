const { spawn } = require('child_process');
const path = require('path');
const paths = require('./paths');
const { Client } = require('./ndjson-socket');

class VpnController {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.helperProc = null;
    this.client = null;
    this.starting = null;
  }

  get status() {
    return this._lastStatus || { status: 'disconnected', ip: null };
  }

  async ensureHelper() {
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = this._launchHelper();
    try { await this.starting; } finally { this.starting = null; }
  }

  _launchHelper() {
    return new Promise((resolve, reject) => {
      const mainJs = path.join(__dirname, 'main.js');
      const workerScript = path.join(__dirname, '..', 'worker', 'torrent-worker.js');
      const args = [
        '/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1',
        process.execPath, mainJs,
        '--bitty-helper',
        `--parent-pid=${process.pid}`,
        `--uid=${process.getuid()}`,
        `--gid=${process.getgid()}`,
        `--home=${process.env.HOME}`,
        `--helper-socket=${paths.helperSocket}`,
        `--worker-socket=${paths.workerSocket}`,
        `--worker-script=${workerScript}`,
      ];
      const proc = spawn('pkexec', args, { stdio: ['ignore', 'inherit', 'inherit'] });
      this.helperProc = proc;
      proc.on('exit', (code) => {
        this.helperProc = null;
        this.client = null;
        this._lastStatus = { status: 'disconnected', ip: null };
        this.onStatus && this.onStatus(this._lastStatus);
        if (code !== 0 && !this._connectedOnce) {
          reject(new Error('VPN helper could not start (authorization declined or failed, exit code ' + code + ')'));
        }
      });

      const client = new Client(paths.helperSocket);
      client.connect(40, 250).then(() => {
        this.client = client;
        this._connectedOnce = true;
        client.on('event', (msg) => {
          if (msg.type === 'vpn-status') {
            this._lastStatus = msg.vpn;
            this.onStatus && this.onStatus(msg.vpn);
          }
        });
        client.on('close', () => { this.client = null; });
        resolve();
      }).catch(reject);
    });
  }

  async connect({ ovpnText, username, password }) {
    await this.ensureHelper();
    const res = await this.client.request('connect', { ovpnText, username, password }, 30000);
    if (!res.ok) throw new Error(res.error || 'connect failed');
    return res;
  }

  async disconnect() {
    if (!this.client) return;
    await this.client.request('disconnect', {}, 15000);
  }

  async teardown() {
    if (!this.client) return;
    try { await this.client.request('teardown', {}, 10000); } catch (_) {}
  }
}

module.exports = { VpnController };
