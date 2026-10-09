#!/usr/bin/env bash
# Assemble index.html from STORYBOARD.md + frames, vendor GSAP, and run `hyperframes check`.
#   scripts/build.sh [--snapshots]
set -euo pipefail
cd "$(dirname "$0")/.."
SK=../../.agents/skills/music-to-video/scripts
node "$SK/assemble-index.mjs" --storyboard STORYBOARD.md --hyperframes . --audiomap audiomap.json | tail -4
python3 - <<'PY'
import re
from pathlib import Path
p = Path("index.html")
s = p.read_text()
s, n = re.subn(r'<script src="https://cdn\.jsdelivr\.net/npm/gsap@[^"]*/dist/gsap\.min\.js"[^>]*></script>',
               '<script src="assets/vendor/gsap.min.js"></script>', s)
s = s.replace('data-track-index="11" data-volume="0.9"', 'data-track-index="11" data-volume="1"')  # mastered to −14 LUFS
s = s.replace('<html lang="en">', '<html lang="pt-BR">')
p.write_text(s)
print(f"vendored GSAP ({n} tag), bgm at volume 1")
PY
if [ "${1:-}" = "--snapshots" ]; then
  timeout 600 npx hyperframes check . --snapshots 2>&1 | tail -40
else
  timeout 600 npx hyperframes check . 2>&1 | tail -40
fi
