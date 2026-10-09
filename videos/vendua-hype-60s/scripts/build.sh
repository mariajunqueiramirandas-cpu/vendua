#!/usr/bin/env bash
# Assemble index.html from STORYBOARD.md + frames, vendor GSAP, and run `hyperframes check`.
#   scripts/build.sh [--snapshots]
set -euo pipefail
cd "$(dirname "$0")/.."
SK=../../.agents/skills/music-to-video/scripts
node "$SK/assemble-index.mjs" --storyboard STORYBOARD.md --hyperframes . --audiomap audiomap.json | tail -4
python3 - <<'PY'
import json
import re
from pathlib import Path
p = Path("index.html")
s = p.read_text()
s, n = re.subn(r'<script src="https://cdn\.jsdelivr\.net/npm/gsap@[^"]*/dist/gsap\.min\.js"[^>]*></script>',
               '<script src="assets/vendor/gsap.min.js"></script>', s)
s = s.replace('data-track-index="11" data-volume="0.9"', 'data-track-index="11" data-volume="1"')  # mastered to −14 LUFS
s = s.replace('<html lang="en">', '<html lang="pt-BR">')
# seam transitions (scripts/seams.js): hold the outgoing frames past their cut, on top
seams = Path("scripts/seams.js").read_text()
holds = json.loads(re.search(r"SEAM_HOLDS (\{.*\})", seams).group(1))
# earlier frames stack above later ones, so a held frame always covers the one starting under it
ids = re.findall(r'id="el-(\d\d-[a-z]+)"', s)
css = "".join(f"      #el-{fid} {{ z-index: {len(ids) - i}; }}\n" for i, fid in enumerate(ids))
for fid, hold in holds.items():
    pat = re.compile(r'(id="el-%s"[^>]*?data-duration=")([0-9.]+)"' % re.escape(fid), re.S)
    s, k = pat.subn(lambda m: f'{m.group(1)}{round(float(m.group(2)) + hold, 4)}"', s)
    assert k == 1, fid
s = s.replace("    </style>", css + "    </style>", 1)
anchor = 'window.__timelines["main"] = gsap.timeline({ paused: true });'
assert anchor in s
s = s.replace(anchor, anchor + "\n" + seams)
p.write_text(s)
print(f"vendored GSAP ({n} tag), bgm at volume 1, {len(holds)} seam holds")
PY
if [ "${1:-}" = "--snapshots" ]; then
  timeout 600 npx hyperframes check . --snapshots 2>&1 | tail -40
else
  timeout 600 npx hyperframes check . 2>&1 | tail -40
fi
