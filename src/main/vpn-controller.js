const { spawn } = require('child_process');
const paths = require('./paths');
const { Client } = require('./ndjson-socket');

class VpnController {
  constructor(onStatus, runtimePaths) {
    this.onStatus = onStatus;
    this.runtimePaths = runtimePaths;
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
      const { execPath, mainJsPath, workerScriptPath, openvpnDir } = this.runtimePaths;
      const args = [
        '/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1',
        execPath, mainJsPath,
        '--bitty-helper',
        `--parent-pid=${process.pid}`,
        `--uid=${process.getuid()}`,
        `--gid=${process.getgid()}`,
        `--home=${process.env.HOME}`,
        `--helper-socket=${paths.helperSocket}`,
        `--worker-socket=${paths.workerSocket}`,
        `--worker-script=${workerScriptPath}`,
        `--openvpn-dir=${openvpnDir}`,
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

      // pkexec asks for a password before the helper even starts, so the
      // socket can't appear until that's answered, however long it takes.
      // This used to give up after 10 seconds; anyone slower at typing got
      // a failed connect, the next attempt spawned a second helper (polkit
      // had cached the password by then, so silently), and that second one
      // took over the socket from the first. The app then talked to a
      // helper with no VPN while the VPN and torrent worker ran under the
      // first, and nothing downloaded. Wait for as long as pkexec is alive.
      const client = new Client(paths.helperSocket);
      const waitForSocket = () => client.connect(0, 0).catch(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          throw new Error('VPN helper exited before it was ready');
        }
        return new Promise((r) => setTimeout(r, 250)).then(waitForSocket);
      });
      waitForSocket().then(() => {
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
