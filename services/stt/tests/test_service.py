import io
import json
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import wave

import av
import numpy as np

from stt import audio
from stt.batcher import Batcher, Overloaded
from stt.engine import SAMPLE_RATE, Transcript, Word
from stt.server import Config, build


def wav_bytes(samples: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def encode(samples: np.ndarray, fmt: str, codec: str, rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with av.open(buf, "w", format=fmt) as c:
        s = c.add_stream(codec, rate=rate, layout="stereo" if channels == 2 else "mono")
        size = s.codec_context.frame_size or 1024
        planes = np.tile(samples.astype(np.float32), (channels, 1))
        for k in range(0, planes.shape[1], size):
            chunk = planes[:, k : k + size]
            if chunk.shape[1] < size and s.codec_context.frame_size:
                chunk = np.pad(chunk, ((0, 0), (0, size - chunk.shape[1])))
            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(chunk), format="fltp", layout=s.layout.name)
            frame.sample_rate = rate
            frame.pts = k
            for packet in s.encode(frame):
                c.mux(packet)
        for packet in s.encode(None):
            c.mux(packet)
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

    def test_voice_note_formats(self):
        # a WhatsApp voice note: Ogg/Opus at 48 kHz, through the polyphase decimator
        w = audio.decode(encode(tone(2.0, 48000), "ogg", "libopus", 48000), max_seconds=10)
        self.assertLess(abs(w.size - 2 * SAMPLE_RATE), SAMPLE_RATE // 10)
        self.assertAlmostEqual(float(np.abs(w[SAMPLE_RATE // 2 : SAMPLE_RATE]).max()), 0.3, delta=0.05)
        # odd rates and stereo go through libswresample
        for fmt, codec, rate in (("mp3", "libmp3lame", 44100), ("wav", "pcm_s16le", 8000)):
            w = audio.decode(encode(tone(1.0, rate), fmt, codec, rate, channels=2), max_seconds=10)
            self.assertLess(abs(w.size - SAMPLE_RATE), SAMPLE_RATE // 10, fmt)

    def test_refuses_playlists_and_garbage(self):
        for data in (
            b"#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n",
            b"ffconcat version 1.0\nfile '/etc/passwd'\n",
            b"\0" * 5000,
            encode(tone(1.0, 48000), "ogg", "libopus", 48000)[:300],
        ):
            with self.assertRaises(audio.AudioError) as e:
                audio.decode(data, 10)
            self.assertEqual(e.exception.code, "undecodable")

    def test_decimator_is_the_filter_kept_every_third_sample(self):
        x = np.random.default_rng(0).standard_normal(48_000 + 5).astype(np.float32)
        full = np.convolve(x, audio._H)[48 : 48 + len(x)][::3][: len(x) // 3]
        np.testing.assert_allclose(audio.decimate3(x), full, atol=1e-5)

    def test_speech_span(self):
        rng = np.random.default_rng(0)
        hiss = lambda s: (rng.standard_normal(int(s * SAMPLE_RATE)) * 1e-4).astype(np.float32)  # noqa: E731
        note = np.concatenate([hiss(3.0), tone(2.0), hiss(4.0)])
        a, b = audio.speech_span(note)
        self.assertAlmostEqual(a / SAMPLE_RATE, 3.0 - audio.TRIM_PAD_S, delta=0.05)
        self.assertAlmostEqual(b / SAMPLE_RATE, 5.0 + audio.TRIM_PAD_S, delta=0.05)
        # loud constant background: speech and floor aren't apart, nothing is cut
        noisy = note + (rng.standard_normal(note.size) * 0.2).astype(np.float32)
        self.assertEqual(audio.speech_span(noisy), (0, noisy.size))


class FakeEngine:
    def __init__(self, delay: float = 0.0):
        self.batches: list[int] = []
        self.delay = delay
        self.gate = threading.Event()
        self.gate.set()

    def transcribe(self, waves, boosts=None):
        self.gate.wait()
        time.sleep(self.delay)
        self.batches.append(len(waves))
        self.boosts = boosts
        return [
            Transcript(text=f"len {w.size}", confidence=0.9, seconds=w.size / SAMPLE_RATE, words=[Word("len", 0.0, 0.8)])
            for w in waves
        ]

    def boost(self, phrases):
        return tuple(phrases)


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
        def boom(waves, boosts):
            raise RuntimeError("bad")

        with self.assertRaises(RuntimeError):
            Batcher(boom).submit(np.zeros(1, np.float32)).result(2)


class ServerTest(unittest.TestCase):
    def start(self, **env) -> str:
        cfg = Config({"STT_ADDR": "127.0.0.1:0", "STT_MAX_SECONDS": "5", "STT_MAX_BYTES": "1000000", **env})
        self.engine = FakeEngine()
        httpd, app = build(cfg, self.engine)
        app.ready = True
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return f"http://127.0.0.1:{httpd.server_address[1]}"

    def post(self, url: str, body: bytes, token: str | None = "s3cret", phrases: str | None = None):
        req = urllib.request.Request(url + "/v1/transcribe", data=body, method="POST")
        if token:
            req.add_header("authorization", f"Bearer {token}")
        if phrases is not None:
            req.add_header("x-stt-phrases", phrases)
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
            self.assertEqual(json.loads(r.read()), {"ok": True, "queue": 0, "model": None})

    def test_rejections(self):
        url = self.start(STT_SECRET="s3cret")
        self.assertEqual(self.post(url, wav_bytes(tone(1.0)), token=None), (401, {"error": "unauthorized"}))
        self.assertEqual(self.post(url, wav_bytes(tone(1.0)), token="nope"), (401, {"error": "unauthorized"}))
        self.assertEqual(self.post(url, wav_bytes(tone(6.0))), (413, {"error": "too_long"}))
        self.assertEqual(self.post(url, b"\0" * 1_000_001), (413, {"error": "too_big"}))
        self.assertEqual(self.post(url, b""), (422, {"error": "empty"}))

    def test_phrases(self):
        url = self.start(STT_SECRET="s3cret")
        names = ["Pizza de Catupiry", "  X-Tudo  ", "Açaí 500 ml"]
        status, body = self.post(url + "", wav_bytes(tone(1.0)), phrases=urllib.parse.quote(json.dumps(names)))
        self.assertEqual(status, 200)
        self.assertEqual(self.engine.boosts, [("Pizza de Catupiry", "X-Tudo", "Açaí 500 ml")])
        status, body = self.post(url, wav_bytes(tone(1.0)), phrases="")
        self.assertEqual(self.engine.boosts, [None])
        for bad in ("not json", urllib.parse.quote(json.dumps(["x" * 81])), urllib.parse.quote(json.dumps(["a"] * 301)), "%7B%7D"):
            self.assertEqual(self.post(url, wav_bytes(tone(1.0)), phrases=bad), (400, {"error": "bad_phrases"}))

    def test_words(self):
        url = self.start(STT_SECRET="s3cret")
        req = urllib.request.Request(url + "/v1/transcribe?words=1", data=wav_bytes(tone(1.0)), method="POST")
        req.add_header("authorization", "Bearer s3cret")
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertEqual(json.loads(r.read())["words"], [{"word": "len", "start": 0.0, "confidence": 0.8}])

    def test_idle_without_secret(self):
        url = self.start()
        self.assertEqual(self.post(url, wav_bytes(tone(1.0))), (503, {"error": "not_configured"}))


if __name__ == "__main__":
    unittest.main()
