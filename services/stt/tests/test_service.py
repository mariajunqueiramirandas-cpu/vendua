import io
import json
import shutil
import subprocess
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave

import numpy as np

from stt import audio
from stt.batcher import Batcher, Overloaded
from stt.engine import SAMPLE_RATE, Transcript
from stt.server import Config, build


def wav_bytes(samples: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def tone(seconds: float, rate: int = SAMPLE_RATE) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)


class AudioTest(unittest.TestCase):
    def test_wav_fast_path(self):
        w = audio.decode(wav_bytes(tone(1.0)), max_seconds=10)
        self.assertEqual(w.size, SAMPLE_RATE)
        self.assertAlmostEqual(float(np.abs(w).max()), 0.3, places=2)

    def test_limits(self):
        with self.assertRaises(audio.AudioError) as e:
            audio.decode(b"", 10)
        self.assertEqual(e.exception.code, "empty")
        with self.assertRaises(audio.AudioError) as e:
            audio.decode(wav_bytes(tone(3.0)), max_seconds=2)
        self.assertEqual(e.exception.code, "too_long")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_ffmpeg_path(self):
        # a WhatsApp-style voice note: Ogg/Opus at 48 kHz
        ogg = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-c:a", "libopus", "-ar", "48000", "-f", "ogg", "pipe:1"],
            input=wav_bytes(tone(2.0)),
            capture_output=True,
            check=True,
        ).stdout
        w = audio.decode(ogg, max_seconds=10)
        self.assertLess(abs(w.size - 2 * SAMPLE_RATE), SAMPLE_RATE // 10)
        resampled = audio.decode(wav_bytes(tone(1.0, 8000), 8000), max_seconds=10)
        self.assertLess(abs(resampled.size - SAMPLE_RATE), SAMPLE_RATE // 50)
        with self.assertRaises(audio.AudioError) as e:
            audio.decode(b"not audio at all" * 100, 10)
        self.assertEqual(e.exception.code, "undecodable")


class FakeEngine:
    def __init__(self, delay: float = 0.0):
        self.batches: list[int] = []
        self.delay = delay
        self.gate = threading.Event()
        self.gate.set()

    def transcribe(self, waves):
        self.gate.wait()
        time.sleep(self.delay)
        self.batches.append(len(waves))
        return [Transcript(text=f"len {w.size}", confidence=0.9, seconds=w.size / SAMPLE_RATE, words=[("len", 0.0)]) for w in waves]


class BatcherTest(unittest.TestCase):
    def test_batches_what_queued_during_a_run(self):
        eng = FakeEngine()
        eng.gate.clear()
        b = Batcher(eng.transcribe, max_batch=4)
        first = b.submit(np.zeros(100, np.float32))
        time.sleep(0.05)  # the batcher is now blocked inside the first run
        rest = [b.submit(np.zeros(100 + i, np.float32)) for i in range(6)]
        eng.gate.set()
        self.assertEqual(first.result(2).text, "len 100")
        self.assertEqual([f.result(2).text for f in rest], [f"len {100 + i}" for i in range(6)])
        self.assertEqual(eng.batches, [1, 4, 2])

    def test_groups_by_length_and_padding_budget(self):
        eng = FakeEngine()
        eng.gate.clear()
        b = Batcher(eng.transcribe, max_batch=8, max_padded_seconds=3.0)
        b.submit(np.zeros(10, np.float32))
        time.sleep(0.05)
        # 2 s and 0.5 s clips: a batch's members are padded to its longest, 3 s budget
        sizes = [2 * SAMPLE_RATE, SAMPLE_RATE // 2, SAMPLE_RATE // 2, 2 * SAMPLE_RATE]
        futs = [b.submit(np.zeros(n, np.float32)) for n in sizes]
        eng.gate.set()
        for f, n in zip(futs, sizes):
            self.assertEqual(f.result(2).text, f"len {n}")
        self.assertEqual(eng.batches, [1, 1, 2, 1])

    def test_overload(self):
        eng = FakeEngine()
        eng.gate.clear()
        b = Batcher(eng.transcribe, max_queue=2)
        b.submit(np.zeros(1, np.float32))
        time.sleep(0.05)
        b.submit(np.zeros(1, np.float32))
        b.submit(np.zeros(1, np.float32))
        with self.assertRaises(Overloaded):
            b.submit(np.zeros(1, np.float32))
        eng.gate.set()

    def test_engine_error_reaches_the_request(self):
        def boom(waves):
            raise RuntimeError("bad")

        with self.assertRaises(RuntimeError):
            Batcher(boom).submit(np.zeros(1, np.float32)).result(2)


class ServerTest(unittest.TestCase):
    def start(self, **env) -> str:
        cfg = Config({"STT_ADDR": "127.0.0.1:0", "STT_MAX_SECONDS": "5", "STT_MAX_BYTES": "1000000", **env})
        httpd, app = build(cfg, FakeEngine())
        app.ready = True
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return f"http://127.0.0.1:{httpd.server_address[1]}"

    def post(self, url: str, body: bytes, token: str | None = "s3cret"):
        req = urllib.request.Request(url + "/v1/transcribe", data=body, method="POST")
        if token:
            req.add_header("authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_transcribe(self):
        url = self.start(STT_SECRET="s3cret")
        status, body = self.post(url, wav_bytes(tone(1.0)))
        self.assertEqual(status, 200)
        self.assertEqual(body, {"text": f"len {SAMPLE_RATE}", "confidence": 0.9, "language": None, "seconds": 1.0})
        with urllib.request.urlopen(url + "/healthz", timeout=5) as r:
            self.assertEqual(r.status, 200)

    def test_rejections(self):
        url = self.start(STT_SECRET="s3cret")
        self.assertEqual(self.post(url, wav_bytes(tone(1.0)), token=None), (401, {"error": "unauthorized"}))
        self.assertEqual(self.post(url, wav_bytes(tone(1.0)), token="nope"), (401, {"error": "unauthorized"}))
        self.assertEqual(self.post(url, wav_bytes(tone(6.0))), (413, {"error": "too_long"}))
        self.assertEqual(self.post(url, b"\0" * 1_000_001), (413, {"error": "too_big"}))
        self.assertEqual(self.post(url, b""), (422, {"error": "empty"}))

    def test_idle_without_secret(self):
        url = self.start()
        self.assertEqual(self.post(url, wav_bytes(tone(1.0))), (503, {"error": "not_configured"}))


if __name__ == "__main__":
    unittest.main()
