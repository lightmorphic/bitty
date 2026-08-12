const os = require('os');
const path = require('path');
const fs = require('fs');

const runtimeDir = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `bitty-${process.getuid()}`);
if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

module.exports = {
  runtimeDir,
  helperSocket: path.join(runtimeDir, 'bitty-helper.sock'),
  workerSocket: path.join(runtimeDir, 'bitty-worker.sock'),
  netnsName: 'bitty0',
  hostVeth: 'bitty-veth0',
  nsVeth: 'bitty-veth1',
  hostAddr: '10.200.55.1',
  nsAddr: '10.200.55.2',
  subnetCidr: '10.200.55.0/24',
};
