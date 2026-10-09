"""One inference thread owns the cores; requests queue for it and leave in batches.

Continuous batching: an idle engine takes a request at once (no batching delay at low
traffic), and whatever queued during a run goes into the next one. A batch is the oldest
waiting request plus the queued ones nearest it in length, capped by count and by padded
audio, since every member is padded to the longest.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass, field

import numpy as np

from .engine import SAMPLE_RATE, Transcript


class Overloaded(Exception):
    pass


@dataclass
class _Job:
    wave: np.ndarray
    boost: object = None  # the engine's PhraseBoost for this request, or None
    future: Future = field(default_factory=Future)
    queued_at: float = field(default_factory=time.monotonic)


@dataclass
class BatchStats:
    size: int
    audio_seconds: float
    padded_seconds: float
    run_seconds: float
    waited_seconds: float


class Batcher:
    def __init__(
        self,
        transcribe: Callable[[list[np.ndarray], list], list[Transcript]],
        max_batch: int = 8,
        max_padded_seconds: float = 480.0,
        max_queue: int = 64,
        max_wait_ms: float = 0.0,
        on_batch: Callable[[BatchStats], None] | None = None,
    ):
        self._transcribe = transcribe
        self.max_batch = max(1, max_batch)
        self.max_padded = max_padded_seconds * SAMPLE_RATE
        self.max_queue = max_queue
        self.max_wait = max_wait_ms / 1000
        self._on_batch = on_batch
        self._queue: list[_Job] = []
        self._cv = threading.Condition()
        self._thread = threading.Thread(target=self._loop, name="stt-batcher", daemon=True)
        self._thread.start()

    def submit(self, wave: np.ndarray, boost: object = None) -> Future:
        job = _Job(wave, boost)
        with self._cv:
            if len(self._queue) >= self.max_queue:
                raise Overloaded()
            self._queue.append(job)
            self._cv.notify()
        return job.future

    @property
    def depth(self) -> int:
        with self._cv:
            return len(self._queue)

    def _take(self) -> list[_Job]:
        with self._cv:
            while not self._queue:
                self._cv.wait()
            if self.max_wait:
                deadline = self._queue[0].queued_at + self.max_wait
                while len(self._queue) < self.max_batch and (left := deadline - time.monotonic()) > 0:
                    self._cv.wait(left)
            head = self._queue[0]
            n = head.wave.size
            rest = sorted(self._queue[1:], key=lambda j: abs(j.wave.size - n))
            batch, longest = [head], n
            for j in rest:
                if len(batch) == self.max_batch:
                    break
                m = max(longest, j.wave.size)
                if m * (len(batch) + 1) > self.max_padded:
                    continue
                batch.append(j)
                longest = m
            taken = {id(j) for j in batch}
            self._queue = [j for j in self._queue if id(j) not in taken]
            return batch

    def _loop(self) -> None:
        while True:
            batch = self._take()
            batch = [j for j in batch if j.future.set_running_or_notify_cancel()]
            if not batch:
                continue
            started = time.monotonic()
            try:
                results = self._transcribe([j.wave for j in batch], [j.boost for j in batch])
            except Exception as err:  # noqa: BLE001 — the waiting requests get it
                for j in batch:
                    j.future.set_exception(err)
                continue
            for j, r in zip(batch, results):
                j.future.set_result(r)
            if self._on_batch:
                longest = max(j.wave.size for j in batch)
                self._on_batch(
                    BatchStats(
                        size=len(batch),
                        audio_seconds=sum(j.wave.size for j in batch) / SAMPLE_RATE,
                        padded_seconds=longest * len(batch) / SAMPLE_RATE,
                        run_seconds=time.monotonic() - started,
                        waited_seconds=started - min(j.queued_at for j in batch),
                    )
                )
