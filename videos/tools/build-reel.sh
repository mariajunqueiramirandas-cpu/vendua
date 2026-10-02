#!/usr/bin/env bash
# Rebuilds a Reel project after its audio or frames change, and proves nothing crosses a cut:
#
#   videos/tools/build-reel.sh videos/<project> [--bpm 128] [--snapshots DIR] [--draft OUT.mp4]
#
# assemble index.html → vendored GSAP → transitions inject + verify → captions → hyperframes check
# → cutcheck → (snapshots 0.1 s either side of every cut) → (draft render). Stops at the first
# failure. The audio steps (scripts/build-audio.py sfx|voices|mix) stay separate: they need takes
# and a Whisper pass first. Never run this while frame agents are editing (inject rewrites frames).
set -euo pipefail

[ $# -ge 1 ] || { sed -n '2,9p' "$0"; exit 2; }
PROJECT=$(cd "$1" && pwd)
shift
REPO=$(cd "$(dirname "$0")/../.." && pwd)
SK="$REPO/.agents/skills/product-launch-video/scripts"  # not the .claude symlink: main-guards compare realpaths
TOOLS="$REPO/videos/tools"
BPM="" SNAPS="" DRAFT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bpm) BPM=$2; shift 2 ;;
    --snapshots) SNAPS=$2; shift 2 ;;
    --draft) DRAFT=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
cd "$PROJECT"
step() { printf '\n▸ %s\n' "$*"; }

step assemble
node "$SK/assemble-index.mjs" --storyboard ./STORYBOARD.md --hyperframes . | tail -3

step "vendored GSAP"
python3 - <<'EOF'
import re
from pathlib import Path
p = Path("index.html")
s, n = re.subn(r'<script src="https://cdn\.jsdelivr\.net/npm/gsap@[^"]*/dist/gsap\.min\.js"[^>]*></script>',
               '<script src="assets/vendor/gsap.min.js"></script>', p.read_text())
p.write_text(s)
print(f"swapped {n} CDN tag(s)")
EOF

step transitions
node "$SK/transitions.mjs" inject --storyboard ./STORYBOARD.md --hyperframes . | tail -1
node "$SK/transitions.mjs" verify --storyboard ./STORYBOARD.md --hyperframes . | tail -1

step captions
node "$SK/captions.mjs" build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json \
  --hyperframes . --out ./caption_groups.json | tail -1

step "hyperframes check"
LOG=$(mktemp)
if ! timeout 300 npx hyperframes check >"$LOG" 2>&1; then
  tail -40 "$LOG"
  exit 1
fi
grep -E "error\(s\)|Check passed" "$LOG" || true

step cutcheck
python3 "$TOOLS/cutcheck.py" . ${BPM:+--bpm "$BPM"}

if [ -n "$SNAPS" ]; then
  step "snapshots around the cuts → $SNAPS"
  AT=$(python3 -c '
import json
c = json.load(open("audio/cues.json"))
ts = [round(v["start_s"] + d, 2) for k, v in c["frames"].items() if v["start_s"] > 0 for d in (-0.1, 0.1)]
print(",".join(map(str, ts)))')
  timeout 300 npx hyperframes snapshot --at "$AT" --no-end -o "$SNAPS" . | tail -2
fi

if [ -n "$DRAFT" ]; then
  step "draft render → $DRAFT"
  npx hyperframes render --quality draft -o "$DRAFT" . | tail -2
fi

printf '\n✓ build-reel: %s\n' "$(basename "$PROJECT")"
