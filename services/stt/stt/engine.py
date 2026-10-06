"""Parakeet-TDT inference: waveforms in, transcripts out, a whole batch per call."""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort

from .cpus import cpu_budget
from .decoder import TdtDecoder

SAMPLE_RATE = 16_000
FRAME_SECONDS = 0.08  # 10 ms features, 8x subsampling
_SPACES = re.compile(r"\A\s|\s\B|(\s)\b")


@dataclass
class Transcript:
    text: str
    confidence: float | None
    seconds: float
    words: list[tuple[str, float]]  # (word, start seconds)


def _session(path: Path, threads: int) -> ort.InferenceSession:
    o = ort.SessionOptions()
    o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    o.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    o.intra_op_num_threads = threads
    o.inter_op_num_threads = 1
    o.log_severity_level = 3
    return ort.InferenceSession(str(path), o, providers=["CPUExecutionProvider"])


class Engine:
    def __init__(self, model_dir: str | Path, threads: int | None = None):
        d = Path(model_dir)
        self.threads = threads or cpu_budget()
        self.pre = _session(d / "preprocessor.onnx", self.threads)
        self.enc = _session(d / "encoder.int8.onnx", self.threads)
        with np.load(d / "decoder.npz") as w:
            self.dec = TdtDecoder({k: w[k] for k in w.files})
        self.vocab: dict[int, str] = {}
        for line in (d / "vocab.txt").read_text(encoding="utf-8").splitlines():
            tok, idx = line.rsplit(" ", 1)
            self.vocab[int(idx)] = tok.replace("▁", " ")

    def warmup(self) -> None:
        self.transcribe([np.zeros(SAMPLE_RATE, np.float32)])

    def transcribe(self, waves: list[np.ndarray]) -> list[Transcript]:
        """Mono float32 16 kHz waveforms; the batch is padded to its longest member."""
        lens = np.array([len(w) for w in waves], np.int64)
        batch = np.zeros((len(waves), max(int(lens.max()), SAMPLE_RATE // 10)), np.float32)
        for i, w in enumerate(waves):
            batch[i, : len(w)] = w
        feats, feat_lens = self.pre.run(None, {"waveforms": batch, "waveforms_lens": lens})
        enc, enc_lens = self.enc.run(None, {"audio_signal": feats, "length": feat_lens})
        hyps = self.dec.decode(np.ascontiguousarray(enc.transpose(0, 2, 1)), enc_lens)
        return [self._text(h, n / SAMPLE_RATE) for h, n in zip(hyps, lens.tolist())]

    def _text(self, h, seconds: float) -> Transcript:
        pieces = [self.vocab[t] for t in h.tokens]
        text = _SPACES.sub(lambda m: " " if m.group(1) else "", "".join(pieces))
        words: list[tuple[str, float]] = []
        for piece, frame in zip(pieces, h.frames):
            if piece.startswith(" ") or not words:
                words.append((piece.strip(), round(frame * FRAME_SECONDS, 2)))
            else:
                words[-1] = (words[-1][0] + piece, words[-1][1])
        conf = math.exp(sum(h.logprobs) / len(h.logprobs)) if h.logprobs else None
        return Transcript(text=text, confidence=conf, seconds=seconds, words=words)


def timed(fn, *args):
    t = time.perf_counter()
    out = fn(*args)
    return out, time.perf_counter() - t
