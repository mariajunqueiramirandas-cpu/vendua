"""WER and speed on a FLEURS split: python bench.py <model dir> <fleurs lang dir> [batch] [limit]

The lang dir holds test.tsv and test/*.wav (16 kHz mono), as
huggingface.co/datasets/google/fleurs ships data/<lang>/. Normalization is lowercase with
punctuation stripped on both sides, against FLEURS' own normalized transcription column.
"""

from __future__ import annotations

import csv
import re
import sys
import time

import numpy as np

from stt.audio import decode
from stt.engine import Engine

_WORD = re.compile(r"[^\w]+", re.UNICODE)


def normalize(s: str) -> list[str]:
    return _WORD.sub(" ", s.lower()).split()


def edits(ref: list[str], hyp: list[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def read_wav(path: str) -> np.ndarray:
    with open(path, "rb") as f:
        return decode(f.read(), max_seconds=600)


def main(model_dir: str, lang_dir: str, batch: int = 8, limit: int = 0) -> None:
    rows = list(csv.reader(open(f"{lang_dir}/test.tsv", encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE))
    rows = rows[:limit] if limit else rows
    waves = [read_wav(f"{lang_dir}/test/{r[1]}") for r in rows]
    engine = Engine(model_dir)
    engine.warmup()
    order = sorted(range(len(waves)), key=lambda i: len(waves[i]))
    out: dict[int, str] = {}
    confs: list[float] = []
    t0 = time.perf_counter()
    for k in range(0, len(order), batch):
        idx = order[k : k + batch]
        for i, tr in zip(idx, engine.transcribe([waves[i] for i in idx])):
            out[i] = tr.text
            if tr.confidence is not None:
                confs.append(tr.confidence)
    elapsed = time.perf_counter() - t0
    audio = sum(len(w) for w in waves) / 16_000
    errs = words = 0
    for i, r in enumerate(rows):
        ref = normalize(r[3])
        errs += edits(ref, normalize(out[i]))
        words += len(ref)
    print(
        f"{len(rows)} utts, {audio:.0f}s audio, batch {batch}, {engine.threads} threads: "
        f"WER {errs / words * 100:.2f}%  RTFx {audio / elapsed:.1f}  "
        f"({elapsed / len(rows) * 1000:.0f} ms/utt)  mean confidence {np.mean(confs):.3f}"
    )


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], *(int(x) for x in a[2:4]))
