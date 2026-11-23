#!/bin/sh
# Builds the universal app and packs dist/KeyCat.zip for a GitHub release.
# The asset name stays fixed so github.com/.../releases/latest/download/KeyCat.zip keeps working.
# Usage: sh tools/package.sh
set -eu
cd "$(dirname "$0")/.."
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Info.plist)"
sh build.sh
rm -rf dist
mkdir -p dist
# ditto keeps the bundle's symlinks and permission bits intact; zip(1) would flatten them.
ditto -c -k --keepParent build/KeyCat.app dist/KeyCat.zip
shasum -a 256 dist/KeyCat.zip | tee "dist/KeyCat-$VERSION.zip.sha256"
ls -lh dist
