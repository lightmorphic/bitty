#!/usr/bin/env bash
# Points electron-builder at a current AppImage launcher before it builds.
#
# electron-builder still bundles the 2019 launcher, which links against libfuse2
# at run time. libfuse2 is end-of-life and is not installed by default on current
# distros, so that build refuses to start on a clean machine. The type2-runtime
# launcher has libfuse3 built into it and needs nothing installed.
#
# This has to run before electron-builder, not after: the launcher is part of the
# finished file, so swapping it afterwards would invalidate the checksum and the
# block map that auto-update relies on. Instead we replace the launcher sitting
# in electron-builder's own cache, and let it build on top of that.
set -euo pipefail

RUNTIME_URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"

CACHE_DIR="${ELECTRON_BUILDER_CACHE:-$HOME/.cache/electron-builder}"
mapfile -t TARGETS < <(find "$CACHE_DIR" -type f -name 'runtime-x64' 2>/dev/null)

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "no electron-builder appimage runtime cached yet; run a build once first" >&2
  exit 1
fi

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

for TARGET in "${TARGETS[@]}"; do
  if cmp -s "$WORK/runtime" "$TARGET"; then
    echo "fuse3 launcher already in place: $TARGET"
    continue
  fi
  cp "$WORK/runtime" "$TARGET"
  chmod +x "$TARGET"
  echo "fuse3 launcher installed: $TARGET"
done
