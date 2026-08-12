// Runs inside the network namespace as the invoking user (privileges
// dropped by the helper via setpriv before exec). This is the only
// process that ever opens a torrent socket, and it can physically only
// reach the internet through the VPN tunnel — the namespace's killswitch
// enforces that, not this file. This file just talks WebTorrent and
// reports state back to the main (unprivileged, un-namespaced) process.

const WebTorrent = require('webtorrent');
const { createServer } = require('../main/ndjson-socket');

const socketPath = process.env.BITTY_WORKER_SOCKET;
if (!socketPath) { process.stderr.write('BITTY_WORKER_SOCKET not set\n'); process.exit(1); }

let client = new WebTorrent({ maxConns: 55 });
let downloadDir = process.env.HOME + '/Downloads';

// Throttling: either a flat manual cap, or "auto" mode which limits to a
// percentage of the connection's real observed capacity. There's no
// external speed-test call (that would mean an outbound connection beyond
// the torrent traffic itself) — capacity is inferred from how fast this
// app's own transfers actually run when nothing is holding them back.
let throttle = { mode: 'auto', manualCapKBps: 0, autoPercent: 50 };
let measuredCapacityBps = 0;
let remeasuring = true;
let lastRemeasure = 0;

function combinedSpeedBps() {
  return client.torrents.reduce((s, t) => s + t.downloadSpeed + t.uploadSpeed, 0);
}

function applyThrottle() {
  if (throttle.mode === 'manual') {
    const capBps = throttle.manualCapKBps > 0 ? throttle.manualCapKBps * 1024 : -1;
    client.throttleDownload(capBps);
    client.throttleUpload(capBps);
    return;
  }
  if (!measuredCapacityBps || remeasuring) {
    client.throttleDownload(-1);
    client.throttleUpload(-1);
  } else {
    const capBps = Math.max(16 * 1024, Math.round(measuredCapacityBps * (throttle.autoPercent / 100)));
    client.throttleDownload(capBps);
    client.throttleUpload(capBps);
  }
}

setInterval(() => {
  if (throttle.mode !== 'auto') return;
  const now = Date.now();
  const sample = combinedSpeedBps();
  if (sample > measuredCapacityBps) measuredCapacityBps = sample;
  if (remeasuring && now - lastRemeasure > 12000) { remeasuring = false; applyThrottle(); }
  if (!remeasuring && now - lastRemeasure > 5 * 60 * 1000) { remeasuring = true; lastRemeasure = now; applyThrottle(); }
}, 2000);

function serializeTorrent(t) {
  return {
    infoHash: t.infoHash,
    name: t.name || '(fetching metadata…)',
    progress: t.progress,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    numPeers: t.numPeers,
    length: t.length || 0,
    downloaded: t.downloaded || 0,
    done: t.done,
    paused: !!t.paused,
    path: t.path,
  };
}

function broadcast(clients) {
  const msg = {
    type: 'torrents',
    torrents: client.torrents.map(serializeTorrent),
    throttle: { ...throttle, measuredCapacityBps, remeasuring },
  };
  const line = JSON.stringify(msg) + '\n';
  for (const conn of clients) { try { conn.write(line); } catch (_) {} }
}

const clients = new Set();
setInterval(() => broadcast(clients), 1000);

function addTorrent(idOrMagnetOrBuffer, opts, respond) {
  try {
    client.add(idOrMagnetOrBuffer, { path: downloadDir, ...opts }, (t) => {
      respond({ ok: true, infoHash: t.infoHash });
    });
  } catch (e) {
    respond({ ok: false, error: e.message });
  }
}

function handleMessage(msg, reply, conn) {
  clients.add(conn);
  conn.on('close', () => clients.delete(conn));
  const respond = (payload) => reply({ replyTo: msg.id, ...payload });
  switch (msg.type) {
    case 'add-magnet':
      addTorrent(msg.magnet, {}, respond);
      break;
    case 'add-torrent-file': {
      const buf = Buffer.from(msg.base64, 'base64');
      addTorrent(buf, {}, respond);
      break;
    }
    case 'pause': {
      const t = client.get(msg.infoHash);
      if (t) { t.pause(); t.paused = true; }
      respond({ ok: !!t });
      break;
    }
    case 'resume': {
      const t = client.get(msg.infoHash);
      if (t) { t.resume(); t.paused = false; }
      respond({ ok: !!t });
      break;
    }
    case 'remove': {
      const t = client.get(msg.infoHash);
      if (t) {
        client.remove(msg.infoHash, { destroyStore: !!msg.deleteFiles }, () => respond({ ok: true }));
      } else respond({ ok: false, error: 'not found' });
      break;
    }
    case 'set-download-dir':
      downloadDir = msg.path;
      respond({ ok: true });
      break;
    case 'set-throttle':
      throttle = { mode: msg.mode, manualCapKBps: msg.manualCapKBps || 0, autoPercent: msg.autoPercent || 50 };
      if (throttle.mode === 'auto') { remeasuring = true; lastRemeasure = Date.now(); measuredCapacityBps = 0; }
      applyThrottle();
      respond({ ok: true });
      break;
    case 'list':
      respond({ ok: true, torrents: client.torrents.map(serializeTorrent) });
      break;
    default:
      respond({ ok: false, error: 'unknown message type ' + msg.type });
  }
}

createServer(socketPath, handleMessage);

process.on('SIGTERM', () => { client.destroy(() => process.exit(0)); setTimeout(() => process.exit(0), 2000); });
