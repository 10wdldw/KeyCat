#!/bin/sh
# Renders KeyCat at the reference canvas size (539x458 CSS px) in built-in browser tab $1 and pairs each
# state with the matching screenshot in ../ref (reference left, KeyCat right) in snaps/compare.jpg.
# Needs `python3 -m http.server 8765` serving ../web.
set -eu
TAB="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/snaps/cmp"
REF="$ROOT/../ref"
mkdir -p "$OUT"
js() { cxb browser js "$1" --tab "$TAB" >/dev/null; }
shot() { sleep "${2:-0.5}"; cxb browser screenshot --tab "$TAB" --out "$OUT/$1.png" >/dev/null; }

cxb browser goto "http://127.0.0.1:8765/index.html?dev&nopointer&full&bg=f8d987&v=$(date +%s)" --tab "$TAB" >/dev/null
cxb browser viewport --width 539 --height 458 --tab "$TAB" >/dev/null
sleep 1
js "cat.reset(); cat.cursor(270, 120); return 1"
shot idle 0.8
for k in KeyQ KeyP KeyZ Slash Space; do
  js "cat.reset(); cat.cursor(270, 120); cat.key('$k', true); return 1"
  shot "$k" 0.6
  js "cat.key('$k', false); return 1"
done
js "cat.reset(); cat.cursor(130, 340); cat.mouseMove(-30, 10); return 1"
shot mouse 0.9

uv run --quiet --with pillow python - "$OUT" "$REF" "$ROOT/snaps/compare.jpg" <<'EOF'
import sys
from PIL import Image
out, ref, dest = sys.argv[1:]
pairs = [("site_canvas_idle", "idle"), ("hold_KeyQ", "KeyQ"), ("hold_KeyP", "KeyP"), ("hold_KeyZ", "KeyZ"),
         ("hold_Slash", "Slash"), ("hold_Space", "Space"), ("mouse", "mouse")]
w, h = 539, 458
sheet = Image.new("RGB", (w * 4, h * 4), "white")
for i, (r, m) in enumerate(pairs):
    a = Image.open(f"{ref}/{r}.png").convert("RGB").resize((w, h))
    b = Image.open(f"{out}/{m}.png").convert("RGB").resize((w, h))
    x, y = (i % 2) * 2 * w, (i // 2) * h
    sheet.paste(a, (x, y)); sheet.paste(b, (x + w, y))
sheet.save(dest, quality=85)
EOF
echo "$ROOT/snaps/compare.jpg"
