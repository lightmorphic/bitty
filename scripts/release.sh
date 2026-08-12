#!/usr/bin/env bash
# Builds and publishes a GitHub release for the current package.json version.
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

npx electron-builder --linux AppImage --publish always

cp "dist/Bitty-$VERSION.AppImage" "dist/Bitty.AppImage"
gh release upload "$TAG" "dist/Bitty.AppImage" --clobber

NOTES=$(awk "/^## $VERSION/{flag=1;next}/^## /{flag=0}flag" CHANGELOG.md)
gh release edit "$TAG" --draft=false --title "$VERSION" --notes "$NOTES"

echo "Released $TAG: https://github.com/lightmorphic/bitty/releases/tag/$TAG"
