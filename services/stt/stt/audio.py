"""Untrusted audio bytes -> mono float32 at 16 kHz.

16 kHz mono WAV (PCM16 or float32) is parsed in-process; everything else (WhatsApp's
Ogg/Opus voice notes, mp3, m4a...) goes through ffmpeg, restricted to reading stdin so a
crafted playlist or concat file can't make it open files or URLs.
"""

from __future__ import annotations

import struct
import subprocess

import numpy as np

SAMPLE_RATE = 16_000
FFMPEG_TIMEOUT_S = 30


class AudioError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


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


def decode(data: bytes, max_seconds: float) -> np.ndarray:
    if not data:
        raise AudioError("empty")
    wave = _wav(data)
    if wave is None:
        try:
            p = subprocess.run(
                [
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-protocol_whitelist", "pipe", "-i", "pipe:0",
                    "-map", "0:a:0", "-vn", "-sn", "-dn",
                    "-t", f"{max_seconds + 1:.0f}",
                    "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
                ],
                input=data,
                capture_output=True,
                timeout=FFMPEG_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired as e:
            raise AudioError("decode_timeout") from e
        if p.returncode != 0:
            raise AudioError("undecodable")
        wave = np.frombuffer(p.stdout[: len(p.stdout) // 4 * 4], "<f4")
    if wave.size == 0:
        raise AudioError("empty")
    if wave.size > max_seconds * SAMPLE_RATE:
        raise AudioError("too_long")
    if not np.isfinite(wave).all():
        raise AudioError("undecodable")
    return wave
