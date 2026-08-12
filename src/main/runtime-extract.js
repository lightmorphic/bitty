// When packaged as an AppImage, this process runs from a FUSE mount
// (/tmp/.mount_*) that's private to the user who mounted it, root cannot
// read into it even via pkexec. So before we ever elevate, we extract the
// AppImage's contents to a plain, world-readable directory and launch the
// privileged helper from there instead of the live mount path.
//
// In dev (npm start, not an AppImage at all) none of this applies: the
// checkout is already a normal, root-readable directory.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function ensureExtractedRuntime(app) {
  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath) {
    return {
      execPath: process.execPath,
      mainJsPath: path.join(__dirname, 'main.js'),
      workerScriptPath: path.join(__dirname, '..', 'worker', 'torrent-worker.js'),
    };
  }

  const cacheDir = path.join(app.getPath('userData'), 'runtime-extract', app.getVersion());
  const squashDir = path.join(cacheDir, 'squashfs-root');
  const marker = path.join(cacheDir, '.extracted');

  if (!fs.existsSync(marker)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    execFileSync(appImagePath, ['--appimage-extract'], { cwd: cacheDir, stdio: 'ignore' });
    // Extraction preserves the squashfs image's original permissions, which
    // aren't guaranteed to be root-readable. Broaden explicitly so pkexec's
    // root process can traverse and execute everything it needs.
    execFileSync('chmod', ['-R', 'a+rX', cacheDir]);
    fs.writeFileSync(marker, '');
  }

  return {
    execPath: path.join(squashDir, 'bitty'),
    mainJsPath: path.join(squashDir, 'resources', 'app.asar', 'src', 'main', 'main.js'),
    workerScriptPath: path.join(squashDir, 'resources', 'app.asar', 'src', 'worker', 'torrent-worker.js'),
  };
}

module.exports = { ensureExtractedRuntime };
