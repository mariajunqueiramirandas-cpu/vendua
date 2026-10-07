"""Fetches the compiled models (what stt.compile writes) instead of the 2.5 GB fp32 export.

  python -m stt.prebuilt <base url> <out dir> [model]

The tarballs are made by `scripts/pack-models.sh`; each is pinned by sha256. rr0 is compiled
for CPUs with VNNI/AMX, rr1 (reduce_range) for any x86 CPU; STT_REDUCE_RANGE picks like compile.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tarfile
import urllib.request
from pathlib import Path

from .compile import cpu_has_vnni
from .fetch import DEFAULT

PINS = {
    ("parakeet-tdt-0.6b-v3", 0): "b2009b192a2b06833c344e687114b8a68cfbe8cfb13278fc07289917d09c0360",
    ("parakeet-tdt-0.6b-v3", 1): "71d9f34941cb69b4d5f31146d6323095d0b15866fa72ee0d574801d0fc7df043",
}


def main(base: str, out_dir: str, model: str = DEFAULT) -> None:
    forced = os.environ.get("STT_REDUCE_RANGE", "auto")
    rr = int(not cpu_has_vnni()) if forced == "auto" else int(forced)
    digest = PINS[(model, rr)]
    name = f"stt-models-{model}-rr{rr}.tar.gz"
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / (name + ".part")
    h = hashlib.sha256()
    with urllib.request.urlopen(f"{base.rstrip('/')}/{name}", timeout=60) as r, tmp.open("wb") as f:
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != digest:
        tmp.unlink()
        sys.exit(f"{name}: sha256 {h.hexdigest()} != pinned {digest}")
    with tarfile.open(tmp) as t:
        t.extractall(out, filter="data")
    tmp.unlink()
    print(f"fetched {name}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
