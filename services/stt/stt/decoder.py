"""Batched greedy TDT decoding, on the weights stt.compile lifts out of the ONNX export.

Same search as NeMo's GreedyTDTInfer (and onnx-asr's loop), restructured so each step is
only what changed since the last one:
- the joint's encoder projection runs once, as one GEMM over every frame of the batch;
- the prediction network (embedding -> 2x LSTM -> joint projection) runs only when a
  non-blank token is emitted: a blank leaves it unchanged, so its output is cached;
- layer 0's input term is a per-token lookup table (embedding @ W0 folded at load);
- all live utterances step together, so the 640 x 8198 output head is a GEMM, not B GEMVs.

Per emitted token it also keeps NeMo's entropy-based confidence (Tsallis, alpha = 1/3,
exponential normalization; Laptev & Ginsburg, ICASSP 2023), which flags wrong words far
better than the token's own probability.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .boost import PhraseBoost

MAX_SYMBOLS_PER_STEP = 10
TSALLIS_ALPHA = 1 / 3


@dataclass
class Hypothesis:
    tokens: list[int] = field(default_factory=list)
    frames: list[int] = field(default_factory=list)
    logprobs: list[float] = field(default_factory=list)
    confidences: list[float] = field(default_factory=list)


def _sigmoid(x: np.ndarray) -> np.ndarray:
    np.negative(x, out=x)
    np.exp(x, out=x)
    x += 1.0
    np.reciprocal(x, out=x)
    return x


class TdtDecoder:
    def __init__(self, weights: dict[str, np.ndarray]):
        self.table0 = weights["embed"] @ weights["w0"] + weights["b0"]
        self.r0 = weights["r0"]
        self.wr1 = weights["wr1"]
        self.b1 = weights["b1"]
        self.enc_w = weights["enc_w"]
        self.enc_b = weights["enc_b"]
        self.pred_w = weights["pred_w"]
        self.pred_b = weights["pred_b"]
        self.out_w = weights["out_w"]
        self.out_b = weights["out_b"]
        self.blank = int(weights["blank"])
        self.vocab = self.blank + 1
        self.durations = np.asarray(weights["durations"], dtype=np.int64)
        a = TSALLIS_ALPHA
        self._conf_floor = float(np.exp((1 - self.vocab ** (1 - a)) / (1 - a)))  # uniform
        self.hidden = self.r0.shape[0]
        # the predictor's output before any token: the blank fed from a zero state
        z = np.zeros((1, self.hidden), np.float32)
        p, h, c = self._predict(np.array([self.blank]), z, z.copy(), z.copy(), z.copy())
        self._p0, self._h0, self._c0 = p[0], h, c

    def _lstm(self, gates: np.ndarray, c: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        # ONNX gate order: input, output, forget, cell
        H = self.hidden
        _sigmoid(gates[:, : 3 * H])
        i, o, f = gates[:, :H], gates[:, H : 2 * H], gates[:, 2 * H : 3 * H]
        g = np.tanh(gates[:, 3 * H :])
        c = f * c + i * g
        return o * np.tanh(c), c

    def _predict(
        self, tokens: np.ndarray, h0: np.ndarray, c0: np.ndarray, h1: np.ndarray, c1: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """One prediction-network step for a batch. h/c are [b, 2H] (layer 0 | layer 1)."""
        g0 = self.table0[tokens] + h0 @ self.r0
        y0, c0n = self._lstm(g0, c0)
        g1 = np.concatenate([y0, h1], axis=1) @ self.wr1
        g1 += self.b1
        y1, c1n = self._lstm(g1, c1)
        p = y1 @ self.pred_w
        p += self.pred_b
        return p, np.concatenate([y0, y1], axis=1), np.concatenate([c0n, c1n], axis=1)

    def _confidence(self, logp: np.ndarray) -> np.ndarray:
        """Tsallis-entropy confidence of each row's full token distribution, 0 (uniform) .. 1."""
        a = TSALLIS_ALPHA
        s = np.exp(logp * a).sum(axis=1)
        return (np.exp((1 - s) / (1 - a)) - self._conf_floor) / (1 - self._conf_floor)

    def decode(
        self, enc: np.ndarray, lengths: np.ndarray, boosts: list[PhraseBoost | None] | None = None
    ) -> list[Hypothesis]:
        """enc: [B, T, D] encoder output, lengths: [B] valid frames, boosts: per utterance."""
        B, T, _ = enc.shape
        H = self.hidden
        lengths = np.minimum(np.asarray(lengths, dtype=np.int64), T)
        E = (enc.reshape(B * T, -1) @ self.enc_w).reshape(B, T, -1)
        E += self.enc_b
        P = np.repeat(self._p0[None], B, axis=0)
        h = np.repeat(self._h0, B, axis=0)
        c = np.repeat(self._c0, B, axis=0)
        t = np.zeros(B, np.int64)
        symbols = np.zeros(B, np.int64)
        hyps = [Hypothesis() for _ in range(B)]
        boosts = boosts or [None] * B
        states: list[tuple[int, ...]] = [()] * B
        V = self.vocab
        live = np.flatnonzero(t < lengths)
        while live.size:
            z = E[live, t[live]]
            z += P[live]
            np.maximum(z, 0.0, out=z)
            logits = z @ self.out_w
            logits += self.out_b
            tl = logits[:, :V]
            restore = []
            for k, b in enumerate(live.tolist()):
                if boosts[b] is not None:
                    bonus = boosts[b].bonuses(states[b])
                    if bonus:
                        ids = np.fromiter(bonus, np.int64, len(bonus))
                        restore.append((k, ids, tl[k, ids].copy()))
                        tl[k, ids] += np.fromiter((v[0] for v in bonus.values()), np.float32, len(bonus))
            tok = tl.argmax(axis=1)
            for k, ids, orig in restore:
                tl[k, ids] = orig  # probabilities stay the model's own
            dur = self.durations[logits[:, V:].argmax(axis=1)]
            emit = tok != self.blank
            if emit.any():
                rows = live[emit]
                lt = tl[emit]
                m = lt.max(axis=1)
                lse = m + np.log(np.exp(lt - m[:, None]).sum(axis=1))
                logp = lt - lse[:, None]
                lp = logp[np.arange(rows.size), tok[emit]]
                conf = self._confidence(logp)
                for k, b in enumerate(rows.tolist()):
                    hy = hyps[b]
                    token = int(tok[emit][k])
                    hy.tokens.append(token)
                    hy.frames.append(int(t[b]))
                    hy.logprobs.append(float(lp[k]))
                    hy.confidences.append(float(conf[k]))
                    if boosts[b] is not None:
                        states[b] = boosts[b].advance(states[b], token)
                p, hn, cn = self._predict(tok[emit], h[rows, :H], c[rows, :H], h[rows, H:], c[rows, H:])
                P[rows], h[rows], c[rows] = p, hn, cn
                symbols[rows] += 1
            # a blank never stays on its frame; a token may, up to MAX_SYMBOLS_PER_STEP times
            adv = np.where(emit, dur, np.maximum(dur, 1))
            adv = np.where(emit & (dur == 0) & (symbols[live] >= MAX_SYMBOLS_PER_STEP), 1, adv)
            t[live] += adv
            symbols[live[adv > 0]] = 0
            live = live[t[live] < lengths[live]]
        return hyps
