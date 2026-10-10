#!/usr/bin/env bash
# Snapshot one frame on its own: scripts/preview-frame.sh <frame_id> <duration_s> <t1,t2,...> (frame-LOCAL seconds)
# Mounts compositions/frames/<frame_id>.html alone in .preview/<frame_id>/ and writes PNGs + sheet.png there.
set -euo pipefail
ID=$1 DUR=$2 AT=$3
ROOT=$(cd "$(dirname "$0")/.." && pwd)
P="$ROOT/.preview/$ID"
rm -rf "$P/snapshots"; mkdir -p "$P"
ln -sfn "$ROOT/assets" "$P/assets"
ln -sfn "$ROOT/compositions" "$P/compositions"
cat > "$P/index.html" <<HTML
<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1080, height=1920" />
<script src="assets/vendor/gsap.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#0a100d}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="$DUR" data-width="1080" data-height="1920">
<div id="f" class="clip" data-composition-id="$ID" data-composition-src="compositions/frames/$ID.html" data-start="0" data-duration="$DUR" data-track-index="1" data-width="1080" data-height="1920"></div>
</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, {duration:$DUR},0);window.__timelines["main"]=tl;</script></body></html>
HTML
cd "$P"
timeout 180 npx hyperframes snapshot . --at "$AT" --no-end -o snapshots --describe false 2>&1 | tail -3
ls snapshots/*.png | head -40
# contact sheet, 4 per row, each scaled to 270x480
python3 - "$P/snapshots" <<'PY'
import sys, subprocess, glob
d=sys.argv[1]; fs=sorted(glob.glob(d+"/*.png"))
fs=[f for f in fs if not f.endswith("sheet.png")]
if not fs: sys.exit()
inputs=[]; 
for f in fs: inputs+=["-i",f]
n=len(fs); cols=min(4,n); rows=(n+cols-1)//cols
filt="".join(f"[{i}]scale=270:480,drawtext=text='{i}':x=8:y=8:fontsize=28:fontcolor=red[s{i}];" for i in range(n))
# pad grid with black
lay="|".join(f"{(i%cols)*270}_{(i//cols)*480}" for i in range(n))
filt+="".join(f"[s{i}]" for i in range(n))+f"xstack=inputs={n}:layout={lay}:fill=black" if n>1 else "[s0]null"
subprocess.run(["ffmpeg","-nostdin","-loglevel","error","-y",*inputs,"-filter_complex",filt,d+"/sheet.png"],check=True)
print("sheet:", d+"/sheet.png")
PY
