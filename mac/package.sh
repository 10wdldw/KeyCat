#!/bin/sh
# Builds the universal app and packs dist/KeyCat-macOS.zip for a GitHub release.
# The asset name stays fixed so github.com/.../releases/latest/download/KeyCat-macOS.zip keeps working.
# Usage: sh mac/package.sh
set -eu
cd "$(dirname "$0")/.."
sh mac/build.sh
rm -rf dist
mkdir -p dist
# ditto keeps the bundle's symlinks and permission bits intact; zip(1) would flatten them.
ditto -c -k --keepParent build/KeyCat.app dist/KeyCat-macOS.zip
# Hash from inside dist/ so `shasum -c KeyCat-macOS.zip.sha256` works next to the download.
(cd dist && shasum -a 256 KeyCat-macOS.zip | tee KeyCat-macOS.zip.sha256)
ls -lh dist
