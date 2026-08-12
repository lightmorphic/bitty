// Runs as root, launched once via pkexec by the main process. Everything
// in this file is the privilege boundary: it owns the network namespace,
// the veth pair, the killswitch firewall, the OpenVPN process, and the
// (privilege-dropped) torrent worker that lives inside the namespace.
//
// Nothing here ever touches the host's default network config beyond the
// isolated 10.200.55.0/24 link it creates for itself, and everything it
// creates is torn down on exit (normal disconnect, parent process dying,
// or SIGTERM/SIGINT).

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const net = require('net');

const {
  netnsName, hostVeth, nsVeth, hostAddr, nsAddr, subnetCidr,
} = require('../main/paths');
const { createServer } = require('../main/ndjson-socket');
const { parseOvpn } = require('../main/ovpn-parse');

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim(), status: res.status };
}

function nsExec(args, opts = {}) {
  return sh('ip', ['netns', 'exec', netnsName, ...args], opts);
}

let state = {
  networkUp: false,
  ipForwardOriginal: null,
  vpn: { status: 'disconnected', ip: null, connectedSince: null, lastError: null },
  vpnProc: null,
  vpnConfigPath: null,
  vpnAuthPath: null,
  workerProc: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  lastConnectArgs: null, // { ovpnText, username, password }, kept in memory only, for auto-reconnect
};

function log(...a) { process.stderr.write('[bitty-helper] ' + a.join(' ') + '\n'); }

function setupNetwork() {
  if (state.networkUp) return;
  sh('ip', ['netns', 'add', netnsName]);
  sh('ip', ['link', 'add', hostVeth, 'type', 'veth', 'peer', 'name', nsVeth]);
  sh('ip', ['link', 'set', nsVeth, 'netns', netnsName]);
  sh('ip', ['addr', 'add', `${hostAddr}/24`, 'dev', hostVeth]);
  sh('ip', ['link', 'set', hostVeth, 'up']);
  nsExec(['ip', 'addr', 'add', `${nsAddr}/24`, 'dev', nsVeth]);
  nsExec(['ip', 'link', 'set', nsVeth, 'up']);
  nsExec(['ip', 'link', 'set', 'lo', 'up']);

  const cur = sh('sysctl', ['-n', 'net.ipv4.ip_forward']);
  state.ipForwardOriginal = cur.out || '0';
  sh('sysctl', ['-w', 'net.ipv4.ip_forward=1']);

  sh('iptables', ['-t', 'nat', '-C', 'POSTROUTING', '-s', subnetCidr, '!', '-o', hostVeth, '-j', 'MASQUERADE']).ok
    || sh('iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-s', subnetCidr, '!', '-o', hostVeth, '-j', 'MASQUERADE']);
  sh('iptables', ['-C', 'FORWARD', '-i', hostVeth, '-j', 'ACCEPT']).ok
    || sh('iptables', ['-A', 'FORWARD', '-i', hostVeth, '-j', 'ACCEPT']);
  sh('iptables', ['-C', 'FORWARD', '-o', hostVeth, '-j', 'ACCEPT']).ok
    || sh('iptables', ['-A', 'FORWARD', '-o', hostVeth, '-j', 'ACCEPT']);

  // Baseline killswitch: until a VPN endpoint is allowlisted below, the
  // namespace can reach nothing at all except loopback.
  applyKillswitch(null, null, null);
  state.networkUp = true;
  log('network namespace + killswitch baseline up');
}

function applyKillswitch(vpnIp, vpnPort, proto) {
  const endpointRule = vpnIp
    ? `ip daddr ${vpnIp} ${proto === 'tcp' ? 'tcp' : 'udp'} dport ${vpnPort} accept`
    : '';
  const ruleset = `flush ruleset
table inet ks {
  chain output {
    type filter hook output priority 0; policy drop;
    oif "lo" accept
    oif "tun0" accept
    ${endpointRule}
  }
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    iif "tun0" accept
    ct state established,related accept
  }
}
`;
  nsExec(['nft', '-f', '-'], { input: ruleset });
}

function resolveHost(host) {
  return new Promise((resolve, reject) => {
    if (net.isIP(host)) return resolve(host);
    dns.lookup(host, { family: 4 }, (err, addr) => (err ? reject(err) : resolve(addr)));
  });
}

async function startOpenvpn({ ovpnText, username, password }) {
  const parsed = parseOvpn(ovpnText);
  let vpnIp, vpnPort, proto;
  let lastErr;
  for (const r of parsed.remotes) {
    try {
      vpnIp = await resolveHost(r.host);
      vpnPort = r.port;
      proto = parsed.proto;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!vpnIp) throw new Error('could not resolve any VPN remote: ' + (lastErr && lastErr.message));

  setupNetwork();
  nsExec(['ip', 'route', 'replace', `${vpnIp}/32`, 'via', hostAddr, 'dev', nsVeth]);
  applyKillswitch(vpnIp, vpnPort, proto);

  const rewritten = ovpnText
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('remote '))
    .concat([`remote ${vpnIp} ${vpnPort} ${proto}`])
    .join('\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitty-vpn-'));
  const configPath = path.join(tmpDir, 'client.ovpn');
  fs.writeFileSync(configPath, rewritten, { mode: 0o600 });
  state.vpnConfigPath = configPath;

  // script-security 1 lets OpenVPN run its own built-ins (ip/route) to set
  // up the tunnel interface, but NOT arbitrary user-defined up/down/plugin
  // scripts (that needs level 2+), so a malicious .ovpn file still can't
  // get code execution out of us, even running as root as we do here.
  const args = ['openvpn', '--config', configPath, '--script-security', '1', '--verb', '3', '--auth-nocache'];
  if (username) {
    const authPath = path.join(tmpDir, 'auth.txt');
    fs.writeFileSync(authPath, `${username}\n${password || ''}\n`, { mode: 0o600 });
    state.vpnAuthPath = authPath;
    args.push('--auth-user-pass', authPath);
  }

  state.vpn = { status: 'connecting', ip: vpnIp, connectedSince: null, lastError: null };
  const proc = spawn('ip', ['netns', 'exec', netnsName, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  state.vpnProc = proc;

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (text.includes('Initialization Sequence Completed')) {
      state.vpn.status = 'connected';
      state.vpn.connectedSince = Date.now();
      state.reconnectAttempt = 0;
      wipeAuthFile();
      broadcastStatus();
      startWorkerIfNeeded();
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('exit', (code) => {
    wipeAuthFile();
    if (state.vpn.status !== 'disconnecting-final') {
      // The tunnel is gone: stop the torrent worker immediately rather than
      // leaving it running against a namespace the firewall now blackholes.
      // The firewall/routing already guarantee zero leakage either way, but
      // this means the app visibly and fully stops the instant the VPN
      // drops, not just "stops being able to send".
      stopWorker();
      state.vpn.status = 'down';
      state.vpn.lastError = `openvpn exited (code ${code})`;
      broadcastStatus();
      scheduleReconnect();
    }
  });

  state.lastConnectArgs = { ovpnText, username, password };
}

function wipeAuthFile() {
  if (state.vpnAuthPath && fs.existsSync(state.vpnAuthPath)) {
    try { fs.unlinkSync(state.vpnAuthPath); } catch (_) {}
    state.vpnAuthPath = null;
  }
}

const MAX_RECONNECT_ATTEMPTS = 8; // stop auto-retrying eventually, don't hammer the provider on bad creds

function scheduleReconnect() {
  if (state.reconnectTimer || !state.lastConnectArgs) return;
  state.reconnectAttempt += 1;
  if (state.reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
    state.vpn.status = 'down';
    state.vpn.lastError = `gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts, check your VPN config/credentials and reconnect manually`;
    state.lastConnectArgs = null;
    broadcastStatus();
    return;
  }
  const delay = Math.min(30000, 2000 * state.reconnectAttempt);
  state.vpn.status = 'reconnecting';
  broadcastStatus();
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    stopWorker();
    startOpenvpn(state.lastConnectArgs).catch((e) => {
      state.vpn.status = 'down';
      state.vpn.lastError = e.message;
      broadcastStatus();
      scheduleReconnect();
    });
  }, delay);
}

function stopOpenvpn(final) {
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  state.lastConnectArgs = final ? null : state.lastConnectArgs;
  if (state.vpnProc) {
    state.vpn.status = final ? 'disconnecting-final' : 'disconnected';
    try { state.vpnProc.kill('SIGTERM'); } catch (_) {}
    state.vpnProc = null;
  }
  wipeAuthFile();
}

function startWorkerIfNeeded() {
  if (state.workerProc) return;
  const { uid, gid, home, workerSocket, workerScript } = global.bittyHelperArgs;
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    ELECTRON_RUN_AS_NODE: '1',
    BITTY_WORKER_SOCKET: workerSocket,
  };
  const proc = spawn('ip', [
    'netns', 'exec', netnsName,
    'setpriv', '--reuid', String(uid), '--regid', String(gid), '--clear-groups', '--inh-caps=-all',
    process.execPath, workerScript,
  ], { env, stdio: 'inherit' });
  state.workerProc = proc;
  proc.on('exit', () => { state.workerProc = null; });
}

function stopWorker() {
  if (state.workerProc) {
    try { state.workerProc.kill('SIGTERM'); } catch (_) {}
    state.workerProc = null;
  }
}

function teardownNetwork() {
  sh('ip', ['link', 'del', hostVeth]);
  sh('ip', ['netns', 'del', netnsName]);
  sh('iptables', ['-t', 'nat', '-D', 'POSTROUTING', '-s', subnetCidr, '!', '-o', hostVeth, '-j', 'MASQUERADE']);
  sh('iptables', ['-D', 'FORWARD', '-i', hostVeth, '-j', 'ACCEPT']);
  sh('iptables', ['-D', 'FORWARD', '-o', hostVeth, '-j', 'ACCEPT']);
  if (state.ipForwardOriginal !== null) {
    sh('sysctl', ['-w', `net.ipv4.ip_forward=${state.ipForwardOriginal}`]);
  }
  state.networkUp = false;
}

function teardownAll() {
  stopWorker();
  stopOpenvpn(true);
  teardownNetwork();
}

let server;
const clients = new Set();

function broadcastStatus() {
  const msg = { type: 'vpn-status', vpn: state.vpn };
  for (const conn of clients) {
    try { conn.write(JSON.stringify(msg) + '\n'); } catch (_) {}
  }
}

function handleMessage(msg, reply, conn) {
  clients.add(conn);
  conn.on('close', () => clients.delete(conn));
  const respond = (payload) => reply({ replyTo: msg.id, ...payload });
  switch (msg.type) {
    case 'connect':
      startOpenvpn({ ovpnText: msg.ovpnText, username: msg.username, password: msg.password })
        .then(() => respond({ ok: true }))
        .catch((e) => respond({ ok: false, error: e.message }));
      break;
    case 'disconnect':
      stopWorker();
      stopOpenvpn(false);
      state.vpn = { status: 'disconnected', ip: null, connectedSince: null, lastError: null };
      broadcastStatus();
      respond({ ok: true });
      break;
    case 'status':
      respond({ ok: true, vpn: state.vpn, workerAlive: !!state.workerProc });
      break;
    case 'teardown':
      teardownAll();
      respond({ ok: true });
      setTimeout(() => process.exit(0), 200);
      break;
    default:
      respond({ ok: false, error: 'unknown message type ' + msg.type });
  }
}

function watchParent(parentPid) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (_) {
      log('parent process gone, tearing down and exiting');
      teardownAll();
      process.exit(0);
    }
  }, 4000);
}

function start(argv) {
  const arg = (name) => {
    const pfx = `--${name}=`;
    const found = argv.find((a) => a.startsWith(pfx));
    return found ? found.slice(pfx.length) : null;
  };
  const parentPid = Number(arg('parent-pid'));
  const uid = Number(arg('uid'));
  const gid = Number(arg('gid'));
  const home = arg('home');
  const helperSocket = arg('helper-socket');
  const workerSocket = arg('worker-socket');
  const workerScript = arg('worker-script');

  global.bittyHelperArgs = { uid, gid, home, workerSocket, workerScript };

  process.on('SIGTERM', () => { teardownAll(); process.exit(0); });
  process.on('SIGINT', () => { teardownAll(); process.exit(0); });
  process.on('uncaughtException', (e) => { log('fatal:', e.stack || e.message); teardownAll(); process.exit(1); });

  server = createServer(helperSocket, handleMessage, { uid, gid });
  if (parentPid) watchParent(parentPid);
  log('helper listening on', helperSocket, 'pid', process.pid);
}

module.exports = { start };
