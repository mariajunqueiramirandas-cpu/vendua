#!/usr/bin/env bash
# Two-pass loudness normalization of the synthesized mix for social: -14 LUFS, -1.5 dBTP.
set -euo pipefail
cd "$(dirname "$0")"
stats=$(ffmpeg -hide_banner -i score-raw.wav -af loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | sed -n "s/.*\"$1\" : \"\(.*\)\".*/\1/p"; }
ffmpeg -loglevel error -y -i score-raw.wav -af "loudnorm=I=-14:TP=-1.5:LRA=9:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=48000" -c:a pcm_s16le score.wav
ffmpeg -hide_banner -i score.wav -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:|LRA:)" | tr -s ' '
