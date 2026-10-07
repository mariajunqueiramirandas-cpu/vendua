#!/bin/sh
# Compiles the pinned export for both CPU variants and packs the tarballs stt.prebuilt pins.
# Usage: scripts/pack-models.sh <work dir> [model]   (needs requirements-dev, ~6 GB RAM)
# Upload the tarballs, then update PINS in stt/prebuilt.py with the printed sha256 lines.
set -eu
work=$1
model=${2:-parakeet-tdt-0.6b-v3}
python -m stt.fetch "$work/export" "$model"
for rr in 0 1; do
  STT_REDUCE_RANGE=$rr python -m stt.compile "$work/export" "$work/rr$rr" "$model"
  (cd "$work/rr$rr" && tar --sort=name --mtime=@0 --owner=0 --group=0 -cf - . | gzip -n -9) \
    >"$work/stt-models-$model-rr$rr.tar.gz"
done
sha256sum "$work"/stt-models-*.tar.gz
