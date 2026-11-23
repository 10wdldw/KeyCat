#!/bin/sh
# Close-ups of the cat at 3x in built-in browser tab $1 -> snaps/closeup.jpg:
# head and ears, the neck, a paw on a key, the mouse in use, and the whole cat.
# Needs tools/serve.py running.
set -eu
TAB="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/snaps/close"
mkdir -p "$OUT"
js() { cxb browser js "$1" --tab "$TAB" >/dev/null; }
view() {
  cxb browser goto "http://127.0.0.1:8765/index.html?dev&nopointer&bg=f8d987&crop=$1&v=$(date +%s)" --tab "$TAB" >/dev/null
  sleep 0.8
}
shot() { sleep "${2:-0.8}"; cxb browser screenshot --tab "$TAB" --out "$OUT/$1.png" >/dev/null; }

cxb browser viewport --width 480 --height 400 --tab "$TAB" >/dev/null
view "190,60,160,133"; js "cat.reset(); cat.cursor(240, 60); return 1"; shot head
view "200,140,160,133"; js "cat.reset(); cat.cursor(240, 60); return 1"; shot neck
view "250,220,160,133"; js "cat.reset(); cat.cursor(240, 60); cat.key('KeyF', true); return 1"; shot paw 1
view "60,240,160,133"; js "cat.reset(); cat.cursor(40, 200); cat.mouseMove(-20, 5); return 1"; shot mouse 1
view "120,60,300,250"; js "cat.reset(); cat.cursor(240, 60); return 1"; shot whole

uv run --quiet --with pillow python - "$OUT" "$ROOT/snaps/closeup.jpg" <<'EOF'
import sys
from PIL import Image
out, dest = sys.argv[1:]
names = ["head", "neck", "paw", "mouse", "whole"]
w, h = 480, 400
sheet = Image.new("RGB", (w * 3, h * 2), "white")
for i, n in enumerate(names):
    im = Image.open(f"{out}/{n}.png").convert("RGB").resize((w, h))
    sheet.paste(im, ((i % 3) * w, (i // 3) * h))
sheet.save(dest, quality=88)
print(dest)
EOF
