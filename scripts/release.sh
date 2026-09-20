#!/usr/bin/env bash
# Builds and publishes a GitHub release for the current package.json version.
#
# The upload is done here with gh rather than by electron-builder's --publish,
# because the AppImage gets its launcher swapped after electron-builder has
# finished with it (see fuse3-appimage.sh) and only the finished file, and the
# latest-linux.yml written against it, should ever reach the release.
#
# Every release carries two AppImage copies, by design:
#   Bitty-<version>.AppImage   the pinned, versioned copy (also what
#                              electron-updater's latest-linux.yml points at)
#   Bitty.AppImage             an unversioned copy that always matches the
#                              newest release, for a stable download link
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

if ! command -v gh >/dev/null; then
  echo "gh CLI is required" >&2
  exit 1
fi

export GH_TOKEN="${GH_TOKEN:-$(gh auth token)}"

bash scripts/bundle-openvpn.sh
npx electron-builder --linux AppImage --publish never
bash scripts/fuse3-appimage.sh

cp "dist/Bitty-$VERSION.AppImage" "dist/Bitty.AppImage"

NOTES=$(awk "/^## $VERSION/{flag=1;next}/^## /{flag=0}flag" CHANGELOG.md)

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" --draft=false --title "$VERSION" --notes "$NOTES"
else
  gh release create "$TAG" --title "$VERSION" --notes "$NOTES"
fi

gh release upload "$TAG" \
  "dist/Bitty-$VERSION.AppImage" \
  "dist/Bitty.AppImage" \
  dist/latest-linux.yml \
  --clobber

echo "Released $TAG: https://github.com/lightmorphic/bitty/releases/tag/$TAG"
