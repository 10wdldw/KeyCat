#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
version=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$root/win/package.json")-1
arch=$(dpkg --print-architecture)
if [ "$arch" != amd64 ]; then
    echo 'This package is currently built for amd64.' >&2
    exit 1
fi

cargo build --manifest-path "$root/win/Cargo.toml" --locked --release
binary="$root/win/target/release/keycat"
staging=$(mktemp -d)
trap 'python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$staging"' EXIT
cd "$staging"
mkdir -p debian package/DEBIAN
cat > debian/control <<'CONTROL'
Source: keycat
Section: utils
Priority: optional
Maintainer: KeyCat Linux maintainers <328748532+10wdldw@users.noreply.github.com>

Package: keycat
Architecture: amd64
Description: desktop cat that responds to keyboard and mouse activity
CONTROL
depends=$(dpkg-shlibdeps -O -e"$binary")
depends=${depends#shlibs:Depends=}
test -n "$depends"
install -Dm755 "$binary" package/usr/bin/keycat
install -Dm644 "$root/packaging/deb/com.ellobok.keycat.desktop" package/usr/share/applications/com.ellobok.keycat.desktop
install -Dm644 "$root/win/icons/icon.png" package/usr/share/icons/hicolor/512x512/apps/com.ellobok.keycat.png
cat > package/DEBIAN/control <<CONTROL
Package: keycat
Version: $version
Section: utils
Priority: optional
Architecture: $arch
Maintainer: KeyCat Linux maintainers <328748532+10wdldw@users.noreply.github.com>
Depends: $depends, libayatana-appindicator3-1
Homepage: https://github.com/10wdldw/KeyCat
Description: desktop cat that responds to keyboard and mouse activity
 KeyCat displays a desktop cat with a configurable outline and frame rate.
CONTROL
mkdir -p "$root/dist"
dpkg-deb --root-owner-group --build package "$root/dist/keycat_${version}_${arch}.deb"
