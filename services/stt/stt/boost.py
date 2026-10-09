"""Phrase boosting: nudges the greedy TDT search toward a store's product names.

A shallow-fusion bonus in the spirit of NeMo's GPU-PB boosting tree (Bataev et al., 2025),
for a CPU greedy decoder. The phrases become a character trie ("▁pizza▁de▁catupiry"), and
every vocabulary piece that walks the trie from a node is an edge. So any tokenization of a
phrase matches, which matters because the decoder never sees the SentencePiece model, only
its vocabulary. While a hypothesis is inside a phrase, the pieces that continue it get a
log-prob bonus; a phrase may only start at a word boundary (a "▁" piece).

The bonus changes which token wins a step, never the probabilities reported for it.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass

import numpy as np

WORD = "▁"
MAX_PHRASES = 300
MAX_PHRASE_CHARS = 80


def variants(phrase: str) -> set[str]:
    """Casings a product name is likely transcribed in: as written, lower, Title, Sentence."""
    words = phrase.split()
    if not words:
        return set()
    forms = {
        " ".join(words),
        " ".join(w.lower() for w in words),
        " ".join(w[:1].upper() + w[1:].lower() for w in words),
        " ".join([words[0][:1].upper() + words[0][1:].lower()] + [w.lower() for w in words[1:]]),
    }
    return {WORD + f.replace(" ", WORD) for f in forms}


@dataclass
class Edges:
    tokens: np.ndarray  # piece ids
    children: np.ndarray  # trie node each piece leads to
    depth: np.ndarray  # characters matched after the piece (bonus grows with it)


class PhraseBoost:
    def __init__(self, phrases: list[str], pieces: dict[str, int], start_bonus: float, step_bonus: float):
        self.start_bonus = start_bonus
        self.step_bonus = step_bonus
        children: list[dict[str, int]] = [{}]
        depth = [0]
        for p in phrases:
            for v in variants(p):
                node = 0
                for ch in v:
                    nxt = children[node].get(ch)
                    if nxt is None:
                        nxt = len(children)
                        children.append({})
                        depth.append(depth[node] + 1)
                        children[node][ch] = nxt
                    node = nxt
        longest = max((len(k) for k in pieces), default=1)
        self.edges: list[Edges] = []
        for node in range(len(children)):
            toks, kids = [], []
            # walk every path of up to `longest` characters below the node; each prefix that
            # is a vocabulary piece is an edge
            stack = [(node, "")]
            while stack:
                n, s = stack.pop()
                for ch, k in children[n].items():
                    piece = s + ch
                    tid = pieces.get(piece)
                    if tid is not None and (node != 0 or piece.startswith(WORD)):
                        toks.append(tid)
                        kids.append(k)
                    if len(piece) < longest:
                        stack.append((k, piece))
            self.edges.append(
                Edges(
                    np.array(toks, np.int64),
                    np.array(kids, np.int64),
                    np.array([depth[k] for k in kids], np.int64),
                )
            )

    def bonuses(self, states: tuple[int, ...]) -> dict[int, tuple[float, int]]:
        """piece id -> (bonus, next state) from the root and every active state."""
        out: dict[int, tuple[float, int]] = {}
        for s in (0, *states):
            e = self.edges[s]
            base = self.start_bonus if s == 0 else self.step_bonus
            for tid, child in zip(e.tokens.tolist(), e.children.tolist()):
                if tid not in out or base > out[tid][0]:
                    out[tid] = (base, child)
        return out

    def advance(self, states: tuple[int, ...], token: int) -> tuple[int, ...]:
        nxt = set()
        for s in (0, *states):
            e = self.edges[s]
            hit = np.flatnonzero(e.tokens == token)
            nxt.update(e.children[hit].tolist())
        return tuple(sorted(nxt))


class BoostCache:
    """Stores send the same catalog with every note: build each phrase list once."""

    def __init__(self, pieces: dict[str, int], start_bonus: float, step_bonus: float, size: int = 256):
        self.pieces = pieces
        self.start_bonus = start_bonus
        self.step_bonus = step_bonus
        self.size = size
        self._lru: OrderedDict[tuple[str, ...], PhraseBoost] = OrderedDict()

    def get(self, phrases: list[str]) -> PhraseBoost | None:
        key = tuple(sorted({p.strip() for p in phrases if p.strip()}))
        if not key:
            return None
        hit = self._lru.get(key)
        if hit is None:
            hit = PhraseBoost(list(key), self.pieces, self.start_bonus, self.step_bonus)
            self._lru[key] = hit
            if len(self._lru) > self.size:
                self._lru.popitem(last=False)
        else:
            self._lru.move_to_end(key)
        return hit
