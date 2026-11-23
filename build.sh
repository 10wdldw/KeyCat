#!/bin/sh
# Builds a universal (Apple silicon + Intel) KeyCat.app next to this script. Usage: ./build.sh
# macOS 13 is the floor: the x86_64 Swift compatibility libraries are not shipped for 12.
set -eu
cd "$(dirname "$0")"
APP=build/KeyCat.app
SRC="KeyMap.swift WebCatView.swift App.swift AppMenu.swift Settings.swift main.swift"
rm -rf "$APP" build/arch
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/arch
for arch in arm64 x86_64; do
    # shellcheck disable=SC2086
    xcrun swiftc -O -swift-version 5 -target "$arch-apple-macosx13.0" \
        -framework Cocoa -framework WebKit -o "build/arch/KeyCat-$arch" $SRC
done
lipo -create build/arch/KeyCat-arm64 build/arch/KeyCat-x86_64 -output "$APP/Contents/MacOS/KeyCat"
cp Info.plist "$APP/Contents/Info.plist"
mkdir -p "$APP/Contents/Resources/web"
cp web/index.html web/settings.html web/*.js web/THREE_LICENSE "$APP/Contents/Resources/web/"
sh tools/sign.sh "$APP"
echo "built $APP"
