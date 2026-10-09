"""Parakeet-TDT inference: waveforms in, transcripts out, a whole batch per call."""

from __future__ import annotations

import json
import math
import re
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort

from .audio import chunks, speech_span
from .boost import BoostCache, PhraseBoost
from .cpus import cpu_budget
from .decoder import Hypothesis, TdtDecoder

SAMPLE_RATE = 16_000
FRAME_SECONDS = 0.08  # 10 ms features, 8x subsampling
_SPACES = re.compile(r"\A\s|\s\B|(\s)\b")


# Utterance confidence for Core's "< 0.7: ask the shopper to confirm" gate. The lowest word's
# entropy confidence ranks bad transcripts best (FLEURS pt-BR, Opus: AUROC 0.80 vs 0.77 for
# exp(mean log-prob), which never went below 0.9 and so never tripped the gate). Raw values
# crowd near 0, so they are mapped monotonically, the model's gate_raw (manifest.json) -> 0.7.
# For the base model that is the worst 15% of FLEURS (11.4% mean WER below it, 3.7% above).
DEFAULT_GATE_RAW = 0.0057


def gate_scale(raw: float, gate: float = DEFAULT_GATE_RAW) -> float:
    if raw < gate:
        return 0.7 * raw / gate
    return 0.7 + 0.3 * math.log(raw / gate) / math.log(1 / gate)


# log-prob bonus for a piece that starts / continues a boosted phrase
BOOST_START = 1.5
BOOST_STEP = 3.0


@dataclass
class Word:
    word: str
    start: float  # seconds
    confidence: float  # the lowest of its pieces' entropy confidences
    prob: float = 1.0  # the lowest of its pieces' probabilities (the older measure, for evals)


@dataclass
class Transcript:
    text: str
    confidence: float | None
    seconds: float
    words: list[Word]
    logprob_confidence: float | None = None  # exp(mean token log-prob), Whisper's scale


def _session(path: Path, threads: int) -> ort.InferenceSession:
    o = ort.SessionOptions()
    o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    o.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    o.intra_op_num_threads = threads
    o.inter_op_num_threads = 1
    o.log_severity_level = 3
    return ort.InferenceSession(str(path), o, providers=["CPUExecutionProvider"])


class Engine:
    def __init__(self, model_dir: str | Path, threads: int | None = None, trim: bool = True):
        d = Path(model_dir)
        self.threads = threads or cpu_budget()
        self.trim = trim
        manifest = d / "manifest.json"
        meta = json.loads(manifest.read_text()) if manifest.exists() else {}
        self.gate = meta.get("gate_raw", DEFAULT_GATE_RAW)
        self.model = meta.get("model")
        self.pre = _session(d / "preprocessor.onnx", self.threads)
        self.enc = _session(d / "encoder.int8.onnx", self.threads)
        with np.load(d / "decoder.npz") as w:
            self.dec = TdtDecoder({k: w[k] for k in w.files})
        self.vocab: dict[int, str] = {}
        pieces: dict[str, int] = {}
        for line in (d / "vocab.txt").read_text(encoding="utf-8").splitlines():
            tok, idx = line.rsplit(" ", 1)
            self.vocab[int(idx)] = tok.replace("\u2581", " ")
            if not (tok.startswith("<") and tok.endswith(">")):
                pieces[tok] = int(idx)
        self._boosts = BoostCache(pieces, BOOST_START, BOOST_STEP)
        self._boost_lock = threading.Lock()

    def boost(self, phrases: list[str]) -> PhraseBoost | None:
        """The boosting automaton for a phrase list (cached); safe from any thread."""
        with self._boost_lock:
            return self._boosts.get(phrases)

    def warmup(self) -> None:
        self.transcribe([np.zeros(SAMPLE_RATE, np.float32)])

    def transcribe(
        self, waves: list[np.ndarray], boosts: list[PhraseBoost | None] | None = None
    ) -> list[Transcript]:
        """Mono float32 16 kHz waveforms; the batch is padded to its longest member."""
        seconds = [len(w) / SAMPLE_RATE for w in waves]
        spans = [speech_span(w) if self.trim else (0, len(w)) for w in waves]
        boosts = boosts or [None] * len(waves)
        # long notes are decoded as pause-split chunks in the same batch, then stitched
        segs: list[tuple[int, int]] = []  # (note, start sample in the original wave)
        pieces, seg_boosts = [], []
        for i, (w, (a, b)) in enumerate(zip(waves, spans)):
            for c0, c1 in chunks(w[a:b]):
                segs.append((i, a + c0))
                pieces.append(w[a + c0 : a + c1])
                seg_boosts.append(boosts[i])
        lens = np.array([len(p) for p in pieces], np.int64)
        batch = np.zeros((len(pieces), max(int(lens.max()), SAMPLE_RATE // 10)), np.float32)
        for k, p in enumerate(pieces):
            batch[k, : len(p)] = p
        feats, feat_lens = self.pre.run(None, {"waveforms": batch, "waveforms_lens": lens})
        enc, enc_lens = self.enc.run(None, {"audio_signal": feats, "length": feat_lens})
        hyps = self.dec.decode(np.ascontiguousarray(enc.transpose(0, 2, 1)), enc_lens, seg_boosts)
        merged = [Hypothesis() for _ in waves]
        for (i, start), h in zip(segs, hyps):
            m = merged[i]
            shift = start / SAMPLE_RATE / FRAME_SECONDS
            m.tokens += h.tokens
            m.frames += [f + shift for f in h.frames]
            m.logprobs += h.logprobs
            m.confidences += h.confidences
        return [self._text(h, sec) for h, sec in zip(merged, seconds)]

    def _text(self, h, seconds: float) -> Transcript:
        pieces = [self.vocab[t] for t in h.tokens]
        text = _SPACES.sub(lambda m: " " if m.group(1) else "", "".join(pieces))
        words: list[Word] = []
        for piece, frame, conf, lp in zip(pieces, h.frames, h.confidences, h.logprobs):
            if piece.startswith(" ") or not words:
                words.append(Word(piece.strip(), round(frame * FRAME_SECONDS, 2), conf, math.exp(lp)))
            else:
                words[-1].word += piece
                words[-1].confidence = min(words[-1].confidence, conf)
                words[-1].prob = min(words[-1].prob, math.exp(lp))
        lp = math.exp(sum(h.logprobs) / len(h.logprobs)) if h.logprobs else None
        conf = gate_scale(min(w.confidence for w in words), self.gate) if words else None
        return Transcript(text=text, confidence=conf, seconds=seconds, words=words, logprob_confidence=lp)
