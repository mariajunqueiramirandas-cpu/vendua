#!/usr/bin/env bash
# audio/mix.wav → assets/bgm.mp3 at −14 LUFS / −1.5 dBTP: plain gain + an oversampled true-peak
# limiter (videos/README.md: one-pass loudnorm squashes the dynamics).
set -euo pipefail
cd "$(dirname "$0")/.."
lufs() { ffmpeg -nostdin -hide_banner -i "$1" -af ebur128=peak=true -f null - 2>&1 | awk '/Integrated loudness/{f=1} f&&/I:/{print $2; exit}'; }
I=$(lufs audio/mix.wav)
for pass in 1 2 3; do
  G=$(python3 -c "print(round(-14 - ($I) + ${EXTRA:-0}, 2))")
  ffmpeg -nostdin -loglevel error -y -i audio/mix.wav \
    -af "volume=${G}dB,aresample=192000,alimiter=limit=0.83:attack=1:release=60:level=disabled,aresample=48000" \
    -c:a pcm_s16le audio/master.wav
  OUT=$(lufs audio/master.wav)
  EXTRA=$(python3 -c "print(round(${EXTRA:-0} + (-14 - ($OUT)), 2))")
  echo "pass $pass: gain ${G} dB → ${OUT} LUFS"
  python3 -c "import sys; sys.exit(0 if abs(-14 - ($OUT)) < 0.3 else 1)" && break
done
ffmpeg -nostdin -loglevel error -y -i audio/master.wav -c:a libmp3lame -b:a 320k assets/bgm.mp3
ffmpeg -nostdin -hide_banner -i assets/bgm.mp3 -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak|LRA):" | tail -3
ffprobe -v error -show_entries format=duration -of csv=p=0 assets/bgm.mp3
