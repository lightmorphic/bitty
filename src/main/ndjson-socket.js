const net = require('net');

// Minimal newline-delimited-JSON request/response + event protocol over a
// unix domain socket. Used for main<->helper and main<->worker IPC, since
// none of these processes share an Electron renderer context.

function createServer(socketPath, onMessage) {
  const fs = require('fs');
  try { fs.unlinkSync(socketPath); } catch (_) {}
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        onMessage(msg, (reply) => {
          try { conn.write(JSON.stringify(reply) + '\n'); } catch (_) {}
        }, conn);
      }
    });
  });
  server.listen(socketPath);
  fs.chmodSync(socketPath, 0o600);
  return server;
}

// Client that connects, sends {type,...}, resolves on the first reply with
// a matching id. Also emits 'event' for unsolicited server pushes (status).
class Client {
  constructor(socketPath) {
    this.socketPath = socketPath;
    this.conn = null;
    this.buf = '';
    this.pending = new Map();
    this.nextId = 1;
    this.listeners = { event: [], close: [] };
  }

  on(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); }

  _emit(name, arg) { (this.listeners[name] || []).forEach((fn) => fn(arg)); }

  connect(retries = 20, delayMs = 250) {
    return new Promise((resolve, reject) => {
      const attempt = (left) => {
        const conn = net.createConnection(this.socketPath);
        conn.once('connect', () => {
          this.conn = conn;
          conn.on('data', (chunk) => this._onData(chunk));
          conn.on('close', () => { this.conn = null; this._emit('close'); });
          resolve();
        });
        conn.once('error', () => {
          if (left <= 0) return reject(new Error('could not connect to ' + this.socketPath));
          setTimeout(() => attempt(left - 1), delayMs);
        });
      };
      attempt(retries);
    });
  }

  _onData(chunk) {
    this.buf += chunk.toString('utf8');
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }
      if (msg.replyTo && this.pending.has(msg.replyTo)) {
        const { resolve } = this.pending.get(msg.replyTo);
        this.pending.delete(msg.replyTo);
        resolve(msg);
      } else {
        this._emit('event', msg);
      }
    }
  }

  request(type, payload = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.conn) return reject(new Error('not connected'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout waiting for ' + type));
      }, timeoutMs);
      this.pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
      this.conn.write(JSON.stringify({ id, type, ...payload }) + '\n');
    });
  }
}

module.exports = { createServer, Client };
