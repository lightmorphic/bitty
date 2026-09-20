#!/usr/bin/env bash
# Puts a copy of openvpn, and the libraries it needs, inside the AppImage.
#
# Bitty's whole purpose is the VPN, so requiring the user to install openvpn
# first defeats the point of shipping a single self-contained file. The binary
# comes from the Debian package rather than the build machine, so the version
# shipped is pinned and known; its shared libraries are taken from the build
# host, minus glibc, which stays the host's own. That puts Bitty's floor at the
# same place Electron already puts it, so it costs us no extra compatibility.
#
# Run from the repo root. Writes vendor/openvpn/, which electron-builder ships
# as extraResources.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="vendor/openvpn"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

( cd "$WORK" && apt-get download openvpn >/dev/null )
DEB=$(ls "$WORK"/openvpn_*.deb)
dpkg-deb -x "$DEB" "$WORK/pkg"

BIN="$WORK/pkg/usr/sbin/openvpn"
[ -x "$BIN" ] || { echo "no openvpn binary in $DEB" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/lib"
cp "$BIN" "$OUT/openvpn"
chmod +x "$OUT/openvpn"

# Copy every shared library it resolves to, except the ones that have to come
# from the host: glibc and the dynamic loader itself. Mixing a bundled glibc
# with the host's loader is a reliable way to break on someone else's machine.
ldd "$BIN" | awk '/=> \//{print $3}' | while read -r LIB; do
  case "$(basename "$LIB")" in
    libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|ld-linux*) continue ;;
  esac
  cp -L "$LIB" "$OUT/lib/"
done

VERSION=$(dpkg-deb -f "$DEB" Version)
printf '%s\n' "$VERSION" > "$OUT/VERSION"

echo "bundled openvpn $VERSION with $(ls "$OUT/lib" | wc -l) libraries into $OUT"
