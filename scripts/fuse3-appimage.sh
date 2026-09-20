#!/usr/bin/env bash
# Re-stamps a freshly built AppImage with a current, self-contained launcher.
#
# electron-builder 26 only ships the 2019 AppImage launcher, which links against
# libfuse2 at run time. libfuse2 is end-of-life and is no longer installed by
# default on current distros, so that build dies at startup with a bare
# "AppImages require FUSE" message before any of our code runs. The
# type2-runtime launcher has libfuse3 built into it and needs nothing on the
# host. (electron-builder 27 makes this the default and this script can go
# then; the option exists in 26's source but isn't wired up to anything.)
#
# An AppImage is <launcher ELF><squashfs payload>, with electron-builder's
# update block map appended after that, so the swap is: cut the launcher off
# the front and the block map off the back, put the new launcher on, then
# restate the size and checksum that auto-update checks against.
#
# The block map is not rebuilt. It only exists to let an update download just
# the changed blocks; without it electron-updater downloads the whole file,
# which is the right trade for not hand-rolling a format we don't own.
set -euo pipefail
cd "$(dirname "$0")/.."

RUNTIME_URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"
VERSION=$(node -p "require('./package.json').version")
APPIMAGE="dist/Bitty-$VERSION.AppImage"
YML="dist/latest-linux.yml"

[ -f "$APPIMAGE" ] || { echo "no $APPIMAGE - run electron-builder first" >&2; exit 1; }
[ -f "$YML" ] || { echo "no $YML" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/runtime" "$RUNTIME_URL"

# Sanity-check the download: ELF magic, then the AppImage type 2 magic at byte 8.
read -r -a MAGIC < <(od -A n -t x1 -N 12 "$WORK/runtime")
if [ "${MAGIC[0]}${MAGIC[1]}${MAGIC[2]}${MAGIC[3]}" != "7f454c46" ] \
   || [ "${MAGIC[8]}${MAGIC[9]}${MAGIC[10]}" != "414902" ]; then
  echo "downloaded runtime is not an AppImage type 2 runtime" >&2
  exit 1
fi

OFFSET=$("$APPIMAGE" --appimage-offset)
TOTAL=$(stat -c %s "$APPIMAGE")
BLOCKMAP=$(awk '/blockMapSize:/{print $2}' "$YML")
: "${BLOCKMAP:=0}"
PAYLOAD=$((TOTAL - OFFSET - BLOCKMAP))

dd if="$APPIMAGE" of="$WORK/payload" bs=4M iflag=skip_bytes,count_bytes,fullblock \
   skip="$OFFSET" count="$PAYLOAD" status=none

cat "$WORK/runtime" "$WORK/payload" > "$WORK/out"
chmod +x "$WORK/out"

# Confirm the result actually mounts and lists before we let it replace the
# build; a silently truncated payload would otherwise ship.
"$WORK/out" --appimage-offset >/dev/null
mv "$WORK/out" "$APPIMAGE"

NEW_SIZE=$(stat -c %s "$APPIMAGE")
NEW_SHA=$(openssl dgst -sha512 -binary "$APPIMAGE" | base64 -w0)

node -e '
const fs = require("fs");
const [yml, size, sha] = [process.argv[1], process.argv[2], process.argv[3]];
const out = fs.readFileSync(yml, "utf8")
  .split("\n")
  .filter((l) => !l.includes("blockMapSize:"))
  .map((l) => (l.includes("sha512:") ? l.replace(/sha512: .*/, `sha512: ${sha}`) : l))
  .map((l) => (l.includes("size:") ? l.replace(/size: .*/, `size: ${size}`) : l))
  .join("\n");
fs.writeFileSync(yml, out);
' "$YML" "$NEW_SIZE" "$NEW_SHA"

rm -f dist/*.blockmap

echo "fuse3 launcher stamped onto $APPIMAGE ($NEW_SIZE bytes)"
