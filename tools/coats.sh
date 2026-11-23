#!/bin/sh
# Renders the cat once per look in built-in browser tab $1 -> snaps/coats.jpg.
# Each further argument is a `cat.options` object, e.g. '{"coat":"orange","pattern":"tabby"}'.
# Needs tools/serve.py running.
set -eu
TAB="$1"; shift
# CROP=x,y,w,h (frame px) zooms in, e.g. CROP=190,60,160,163 for the head.
CROP="${CROP:+&crop=$CROP}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/snaps/coats"
mkdir -p "$OUT"
rm -f "$OUT"/*.png
js() { cxb browser js "$1" --tab "$TAB" >/dev/null; }

cxb browser viewport --width 360 --height 368 --tab "$TAB" >/dev/null
cxb browser goto "http://127.0.0.1:8765/index.html?dev&nopointer&bg=f8d987$CROP&v=$(date +%s)" --tab "$TAB" >/dev/null
sleep 1
i=0
for o in "$@"; do
  js "cat.reset(); cat.options($o); cat.cursor(175, 60); return 1"
  sleep 0.8
  cxb browser screenshot --tab "$TAB" --out "$OUT/$(printf %02d $i).png" >/dev/null
  i=$((i + 1))
done

uv run --quiet --with pillow python - "$OUT" "$ROOT/snaps/coats.jpg" <<'EOF'
import sys, glob
from PIL import Image
out, dest = sys.argv[1:]
files = sorted(glob.glob(f"{out}/*.png"))
w, h = 360, 368
cols = min(4, len(files))
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols, h * rows), "white")
for i, f in enumerate(files):
    sheet.paste(Image.open(f).convert("RGB").resize((w, h)), ((i % cols) * w, (i // cols) * h))
sheet.save(dest, quality=90)
print(dest)
EOF
