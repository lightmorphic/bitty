#!/usr/bin/env bash
# Builds and publishes a GitHub release for the current package.json version.
#
# Talks to the API with curl rather than the gh CLI, so releasing needs nothing
# installed beyond curl and node. Set GH_TOKEN to a token with contents write
# access on this repo.
#
# The upload happens here rather than through electron-builder's --publish,
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

: "${GH_TOKEN:?set GH_TOKEN to a GitHub token with contents write access}"

REPO="lightmorphic/bitty"
API="https://api.github.com/repos/$REPO"
UPLOADS="https://uploads.github.com/repos/$REPO"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

api() { curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$@"; }
json() { node -p "JSON.parse(require('fs').readFileSync(0,'utf8'))$1" ; }

bash scripts/bundle-openvpn.sh
npx electron-builder --linux AppImage --publish never
bash scripts/fuse3-appimage.sh

cp "dist/Bitty-$VERSION.AppImage" "dist/Bitty.AppImage"

NOTES=$(awk "/^## $VERSION/{flag=1;next}/^## /{flag=0}flag" CHANGELOG.md)
BODY=$(node -e 'process.stdout.write(JSON.stringify({tag_name:process.argv[1],name:process.argv[2],body:process.argv[3],draft:false,prerelease:false}))' "$TAG" "$VERSION" "$NOTES")

EXISTING=$(api "$API/releases/tags/$TAG" | json '.id ?? ""')
if [ -n "$EXISTING" ]; then
  RELEASE_ID=$(api -X PATCH "$API/releases/$EXISTING" -d "$BODY" | json '.id')
else
  RELEASE_ID=$(api -X POST "$API/releases" -d "$BODY" | json '.id')
fi
[ -n "$RELEASE_ID" ] || { echo "could not create or find release $TAG" >&2; exit 1; }

# Uploading an asset name that already exists is an error rather than a
# replace, so clear the old one first. Re-releasing the same tag is normal
# here, since the unversioned copy is replaced on every release.
upload() {
  local FILE="$1" NAME TYPE OLD
  NAME=$(basename "$FILE")
  case "$NAME" in
    *.yml) TYPE="text/yaml" ;;
    *) TYPE="application/octet-stream" ;;
  esac
  OLD=$(api "$API/releases/$RELEASE_ID/assets" | json ".find(a => a.name === '$NAME')?.id ?? ''")
  [ -n "$OLD" ] && api -X DELETE "$API/releases/assets/$OLD" >/dev/null
  echo "uploading $NAME"
  curl -sS --fail-with-body -X POST \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Content-Type: $TYPE" \
    --data-binary @"$FILE" \
    "$UPLOADS/releases/$RELEASE_ID/assets?name=$NAME" >/dev/null
}

upload "dist/Bitty-$VERSION.AppImage"
upload "dist/Bitty.AppImage"
upload "dist/latest-linux.yml"

echo "Released $TAG: https://github.com/$REPO/releases/tag/$TAG"
