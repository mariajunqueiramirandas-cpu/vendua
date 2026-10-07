"""WER and speed on a FLEURS split.

  python bench.py <model dir> <fleurs lang dir> [--batch 8] [--limit N] [--out results.json]

The lang dir holds test.tsv and test/*.wav, as huggingface.co/datasets/google/fleurs ships
data/<lang>/. Normalization is lowercase with punctuation stripped on both sides, against
FLEURS' own normalized transcription column. --out keeps every clip's hypothesis, reference
and word list for the confidence and boosting evaluations.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
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


def load(lang_dir: str, limit: int = 0) -> list[list[str]]:
    # QUOTE_NONE: FLEURS fields contain bare quotes
    with open(f"{lang_dir}/test.tsv", encoding="utf-8") as f:
        rows = list(csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    return rows[:limit] if limit else rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir")
    ap.add_argument("lang_dir")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out")
    ap.add_argument("--no-trim", action="store_true")
    a = ap.parse_args()

    rows = load(a.lang_dir, a.limit)
    waves = [read_wav(f"{a.lang_dir}/test/{r[1]}") for r in rows]
    engine = Engine(a.model_dir, trim=not a.no_trim)
    engine.warmup()
    order = sorted(range(len(waves)), key=lambda i: len(waves[i]))
    out = {}
    t0 = time.perf_counter()
    for k in range(0, len(order), a.batch):
        idx = order[k : k + a.batch]
        for i, tr in zip(idx, engine.transcribe([waves[i] for i in idx])):
            out[i] = tr
    elapsed = time.perf_counter() - t0
    audio = sum(len(w) for w in waves) / 16_000
    if engine.trim:
        from stt.audio import speech_span

        kept = sum(b - a for a, b in map(speech_span, waves)) / 16_000
        print(f"trimming kept {kept / audio * 100:.1f}% of the audio")
    errs = words = 0
    for i, r in enumerate(rows):
        ref = normalize(r[3])
        errs += edits(ref, normalize(out[i].text))
        words += len(ref)
    confs = [t.confidence for t in out.values() if t.confidence is not None]
    print(
        f"{len(rows)} utts, {audio:.0f}s audio, batch {a.batch}, {engine.threads} threads: "
        f"WER {errs / words * 100:.2f}%  RTFx {audio / elapsed:.1f}  "
        f"({elapsed / len(rows) * 1000:.0f} ms/utt)  mean confidence {np.mean(confs):.3f}"
    )
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(
                [
                    {"file": r[1], "raw": r[2], "ref": r[3], "hyp": out[i].text,
                     "confidence": out[i].confidence,
                     "words": [[w.word, w.start, w.confidence, w.prob] for w in out[i].words]}
                    for i, r in enumerate(rows)
                ],
                f,
                ensure_ascii=False,
            )


if __name__ == "__main__":
    main()
