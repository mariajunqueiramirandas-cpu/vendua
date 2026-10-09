"""Untrusted audio bytes -> mono float32 at 16 kHz.

16 kHz mono WAV (PCM16 or float32) is parsed directly. Everything else (WhatsApp's Ogg/Opus
voice notes, mp3, m4a...) is decoded in-process by libav through PyAV: spawning an ffmpeg
process cost more per note than the decoding itself. The demuxer is picked from the file's
magic bytes (libav never probes) and nested opens are refused, so a crafted playlist or
concat file can't make libav read other files or URLs.
48 kHz audio (all Opus) is brought to 16 kHz by an exact 3:1 polyphase decimator; other rates
go through libswresample.
"""

from __future__ import annotations

import io
import struct

import av
import numpy as np

SAMPLE_RATE = 16_000



def _container(data: bytes) -> str | None:
    """libav demuxer for the audio files a voice note or an upload comes as; None = refuse."""
    head = data[:12]
    if head[:4] == b"OggS":
        return "ogg"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"\x1aE\xdf\xa3":
        return "matroska"
    if head[4:8] == b"ftyp":
        return "mp4"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:5] == b"#!AMR":
        return "amr"
    if head[:4] == b"caff":
        return "caf"
    if len(head) > 1 and head[0] == 0xFF and head[1] & 0xF6 == 0xF0:
        return "aac"  # ADTS
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    return None


class AudioError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _lowpass(taps: int = 97, cutoff: float = 7600.0, rate: float = 48_000.0) -> np.ndarray:
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cutoff / rate * n) * np.kaiser(taps, 8.0)
    return (h / h.sum()).astype(np.float32)


# 97 taps: the filter delay (48 samples) is a whole number of output samples
_H = _lowpass()
_PHASES = [_H[p::3] for p in range(3)]


def decimate3(x: np.ndarray) -> np.ndarray:
    """48 kHz -> 16 kHz: low-pass (flat to 7 kHz, -80 dB past 9 kHz), keep every third sample.

    Polyphase, so only the kept samples are computed: y[m] = sum_p (h_p * x_p)[m + 16] with
    h_p = h[p::3] and x_p[i] = x[3i - p]."""
    m = len(x) // 3
    x = np.ascontiguousarray(x, dtype=np.float32)
    zero = np.zeros(1, np.float32)
    streams = (x[0::3], np.concatenate([zero, x[2::3]]), np.concatenate([zero, x[1::3]]))
    delay = (len(_H) - 1) // 6
    y = np.zeros(m, np.float32)
    for hp, xp in zip(_PHASES, streams):
        full = np.convolve(xp, hp)
        y += full[delay : delay + m]
    return y


def _wav(data: bytes) -> np.ndarray | None:
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    pos, fmt = 12, None
    while pos + 8 <= len(data):
        cid, size = data[pos : pos + 4], struct.unpack_from("<I", data, pos + 4)[0]
        body = pos + 8
        if cid == b"fmt " and size >= 16:
            fmt = struct.unpack_from("<HHIIHH", data, body)
        elif cid == b"data" and fmt:
            tag, channels, rate, _, _, bits = fmt
            if channels != 1 or rate != SAMPLE_RATE:
                return None
            pcm = data[body : body + size]
            if tag == 1 and bits == 16:
                return np.frombuffer(pcm[: len(pcm) // 2 * 2], "<i2").astype(np.float32) / 32768.0
            if tag == 3 and bits == 32:
                return np.frombuffer(pcm[: len(pcm) // 4 * 4], "<f4").astype(np.float32)
            return None
        pos = body + size + (size & 1)
    return None


def _libav(data: bytes, max_seconds: float) -> np.ndarray:
    fmt = _container(data)
    if fmt is None:
        raise AudioError("undecodable")
    try:
        with av.open(
            io.BytesIO(data),
            mode="r",
            format=fmt,
            options={"protocol_whitelist": "none"},
        ) as c:
            if not c.streams.audio:
                raise AudioError("undecodable")
            stream = c.streams.audio[0]
            stream.thread_type = "AUTO"
            rate = stream.codec_context.sample_rate or 0
            direct = rate in (SAMPLE_RATE, 3 * SAMPLE_RATE)
            out_rate = rate if direct else SAMPLE_RATE
            limit = int((max_seconds + 1) * out_rate)
            rs = None
            chunks, n = [], 0
            for frame in c.decode(stream):
                if direct and frame.format.name in ("flt", "fltp") and frame.layout.nb_channels == 1:
                    batch = [frame]  # Opus decodes to mono float already: no conversion
                else:
                    rs = rs or av.AudioResampler(format="flt", layout="mono", rate=out_rate)
                    batch = rs.resample(frame)
                for f in batch:
                    a = np.frombuffer(f.planes[0], np.float32, count=f.samples)
                    chunks.append(a)
                    n += a.size
                if n > limit:
                    break
            if rs is not None:
                chunks.extend(np.frombuffer(f.planes[0], np.float32, count=f.samples) for f in rs.resample(None))
    except AudioError:
        raise
    except (av.FFmpegError, ValueError, OSError) as e:
        raise AudioError("undecodable") from e
    if not chunks:
        raise AudioError("empty")
    wave = np.concatenate(chunks)
    return decimate3(wave) if direct and rate == 3 * SAMPLE_RATE else wave


def decode(data: bytes, max_seconds: float) -> np.ndarray:
    if not data:
        raise AudioError("empty")
    wave = _wav(data)
    if wave is None:
        wave = _libav(data, max_seconds)
    if wave.size == 0:
        raise AudioError("empty")
    if wave.size > max_seconds * SAMPLE_RATE:
        raise AudioError("too_long")
    if not np.isfinite(wave).all():
        raise AudioError("undecodable")
    return wave


TRIM_FRAME = 320  # 20 ms
TRIM_PAD_S = 0.5


def speech_span(wave: np.ndarray) -> tuple[int, int]:
    """[start, end) samples worth transcribing: leading and trailing silence cut, never inside.

    Frame energies against the clip's own noise floor (10th percentile) and speech level (99th).
    When the two aren't clearly apart (a constant background), nothing is cut. The span keeps
    TRIM_PAD_S on each side, so a soft first or last syllable survives."""
    n = wave.size // TRIM_FRAME
    if n < 10:
        return 0, wave.size
    frames = wave[: n * TRIM_FRAME].reshape(n, TRIM_FRAME)
    db = 10 * np.log10(np.mean(frames * frames, axis=1) + 1e-10)
    floor, peak = np.percentile(db, 10), np.percentile(db, 99)
    if peak - floor < 20:
        return 0, wave.size
    loud = np.flatnonzero(db > floor + 0.25 * (peak - floor))
    pad = int(TRIM_PAD_S * SAMPLE_RATE)
    start = max(0, int(loud[0]) * TRIM_FRAME - pad)
    end = min(wave.size, (int(loud[-1]) + 1) * TRIM_FRAME + pad)
    return start, end


CHUNK_MAX_S = 30.0
CHUNK_MIN_S = 15.0


def chunks(wave: np.ndarray) -> list[tuple[int, int]]:
    """Cut points for long notes: [start, end) spans of at most CHUNK_MAX_S, split at pauses.

    Parakeet's accuracy drops on long inputs (measured here: 120-180 s notes lost 1-2 WER points
    against the same speech in pieces). Each cut goes at the quietest 200 ms between
    CHUNK_MIN_S and CHUNK_MAX_S past the previous one."""
    total = wave.size
    if total <= CHUNK_MAX_S * SAMPLE_RATE:
        return [(0, total)]
    n = total // TRIM_FRAME
    frames = wave[: n * TRIM_FRAME].reshape(n, TRIM_FRAME)
    energy = np.convolve(np.mean(frames * frames, axis=1), np.ones(10) / 10, mode="same")
    per_s = SAMPLE_RATE // TRIM_FRAME
    spans, start = [], 0
    while total - start > CHUNK_MAX_S * SAMPLE_RATE:
        lo = start // TRIM_FRAME + int(CHUNK_MIN_S * per_s)
        hi = start // TRIM_FRAME + int(CHUNK_MAX_S * per_s)
        cut = (lo + int(np.argmin(energy[lo:hi]))) * TRIM_FRAME
        spans.append((start, cut))
        start = cut
    spans.append((start, total))
    return spans
