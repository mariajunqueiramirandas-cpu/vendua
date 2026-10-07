"""HTTP front of the engine. Internal only: Core is the one caller.

  POST /v1/transcribe   body = the audio file's bytes, Authorization: Bearer $STT_SECRET
                        -> {text, confidence, language, seconds[, words]}   (?words=1 for words)
                        x-stt-phrases: percent-encoded JSON array of phrases to boost (a
                        store's product names), at most 300 of up to 80 characters
  GET  /healthz         -> 200 once the model is loaded and warm

Transcripts are shoppers' words: never logged, never kept.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from . import audio
from .batcher import Batcher, BatchStats, Overloaded
from .boost import MAX_PHRASE_CHARS, MAX_PHRASES
from .cpus import cpu_budget
from .engine import Engine


def parse_phrases(header: str | None) -> list[str] | None:
    """The x-stt-phrases header -> phrases; ValueError when malformed or past the caps."""
    if not header:
        return []
    phrases = json.loads(unquote(header, errors="strict"))
    if not isinstance(phrases, list) or len(phrases) > MAX_PHRASES:
        raise ValueError("phrases")
    out = []
    for p in phrases:
        if not isinstance(p, str) or len(p) > MAX_PHRASE_CHARS:
            raise ValueError("phrase")
        if p.strip():
            out.append(" ".join(p.split()))
    return out


def log(level: str, msg: str, **fields) -> None:
    sys.stdout.write(json.dumps({"level": level, "msg": msg, "t": round(time.time(), 3), **fields}) + "\n")
    sys.stdout.flush()


class Config:
    def __init__(self, env: dict[str, str]):
        self.secret = env.get("STT_SECRET", "")
        host, _, port = env.get("STT_ADDR", "0.0.0.0:8792").rpartition(":")
        self.addr = (host or "0.0.0.0", int(port))
        self.model_dir = env.get("STT_MODEL_DIR", "/models")
        self.threads = int(env.get("STT_THREADS", "0")) or cpu_budget()
        self.max_batch = int(env.get("STT_MAX_BATCH", "8"))
        self.max_wait_ms = float(env.get("STT_MAX_WAIT_MS", "0"))
        self.max_queue = int(env.get("STT_MAX_QUEUE", "64"))
        # Core stores voice notes up to 180 s and 8 MB (store-whatsapp/content.ts)
        self.max_seconds = float(env.get("STT_MAX_SECONDS", "200"))
        self.max_bytes = int(env.get("STT_MAX_BYTES", str(10 * 1024 * 1024)))
        self.request_timeout = float(env.get("STT_REQUEST_TIMEOUT_S", "120"))


class App:
    def __init__(self, cfg: Config, batcher: Batcher, boost=None):
        self.cfg = cfg
        self.batcher = batcher
        # built on the request thread (cached per phrase list), so the engine thread never waits
        self.boost = boost or (lambda phrases: None)
        self.ready = False
        # ffmpeg runs on the request threads; keep it from starving the engine's cores
        self.decoders = threading.BoundedSemaphore(max(2, cfg.threads))


class Handler(BaseHTTPRequestHandler):
    server_version = "vendua-stt"
    protocol_version = "HTTP/1.1"
    timeout = 30  # per socket read: a stalled client can't hold a thread forever
    app: App

    def log_message(self, format, *args):  # noqa: A002 — stdlib signature
        pass

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _fail(self, status: int, code: str) -> None:
        self._send(status, {"error": code})

    def do_GET(self):
        if urlsplit(self.path).path != "/healthz":
            return self._fail(404, "not_found")
        if not self.app.ready:
            return self._fail(503, "warming_up")
        self._send(200, {"ok": True, "queue": self.app.batcher.depth})

    def do_POST(self):
        started = time.monotonic()
        url = urlsplit(self.path)
        if url.path != "/v1/transcribe":
            self.close_connection = True
            return self._fail(404, "not_found")
        status, code, seconds = self._transcribe(url.query)
        log(
            "info" if status < 500 else "warn",
            "transcribe",
            status=status,
            code=code,
            audio_s=round(seconds, 2),
            ms=round((time.monotonic() - started) * 1000),
        )

    def _transcribe(self, query: str) -> tuple[int, str, float]:
        cfg = self.app.cfg
        if not cfg.secret:
            self.close_connection = True
            self._fail(503, "not_configured")
            return 503, "not_configured", 0.0
        auth = self.headers.get("authorization", "")
        if not hmac.compare_digest(auth.encode(), f"Bearer {cfg.secret}".encode()):
            self.close_connection = True
            self._fail(401, "unauthorized")
            return 401, "unauthorized", 0.0
        if not self.app.ready:
            self.close_connection = True
            self._fail(503, "warming_up")
            return 503, "warming_up", 0.0
        try:
            length = int(self.headers.get("content-length", ""))
        except ValueError:
            self.close_connection = True
            self._fail(411, "length_required")
            return 411, "length_required", 0.0
        if length > cfg.max_bytes or length < 0:
            self.close_connection = True
            self._fail(413, "too_big")
            return 413, "too_big", 0.0
        body = self.rfile.read(length)
        if len(body) != length:
            self.close_connection = True
            self._fail(400, "short_body")
            return 400, "short_body", 0.0
        try:
            phrases = parse_phrases(self.headers.get("x-stt-phrases"))
        except (ValueError, UnicodeDecodeError):
            self._fail(400, "bad_phrases")
            return 400, "bad_phrases", 0.0
        try:
            with self.app.decoders:
                wave = audio.decode(body, cfg.max_seconds)
        except audio.AudioError as e:
            status = 413 if e.code == "too_long" else 422 if e.code != "decode_timeout" else 503
            self._fail(status, e.code)
            return status, e.code, 0.0
        seconds = wave.size / audio.SAMPLE_RATE
        try:
            future = self.app.batcher.submit(wave, self.app.boost(phrases) if phrases else None)
        except Overloaded:
            self._fail(503, "overloaded")
            return 503, "overloaded", seconds
        try:
            tr = future.result(timeout=cfg.request_timeout)
        except FutureTimeout:
            future.cancel()
            self._fail(503, "timeout")
            return 503, "timeout", seconds
        except Exception as err:  # noqa: BLE001
            log("error", "inference failed", err=repr(err)[:300])
            self._fail(500, "inference_failed")
            return 500, "inference_failed", seconds
        out = {
            "text": tr.text,
            "confidence": None if tr.confidence is None else round(tr.confidence, 4),
            "language": None,  # Parakeet v3 detects among its 25 languages but doesn't report it
            "seconds": round(tr.seconds, 3),
        }
        if parse_qs(query).get("words") == ["1"]:
            out["words"] = [{"word": w.word, "start": w.start, "confidence": round(w.confidence, 4)} for w in tr.words]
        self._send(200, out)
        return 200, "ok", seconds


def build(cfg: Config, engine) -> tuple[ThreadingHTTPServer, App]:
    def on_batch(s: BatchStats) -> None:
        log(
            "debug",
            "batch",
            size=s.size,
            audio_s=round(s.audio_seconds, 2),
            pad=round(1 - s.audio_seconds / s.padded_seconds, 3) if s.padded_seconds else 0,
            run_ms=round(s.run_seconds * 1000),
            rtfx=round(s.audio_seconds / s.run_seconds, 1) if s.run_seconds else None,
            wait_ms=round(s.waited_seconds * 1000),
        )

    batcher = Batcher(
        engine.transcribe,
        max_batch=cfg.max_batch,
        max_queue=cfg.max_queue,
        max_wait_ms=cfg.max_wait_ms,
        on_batch=on_batch if os.environ.get("LOG_LEVEL") == "debug" else None,
    )
    app = App(cfg, batcher, getattr(engine, "boost", None))
    handler = type("BoundHandler", (Handler,), {"app": app})
    httpd = ThreadingHTTPServer(cfg.addr, handler)
    httpd.daemon_threads = True
    return httpd, app


def serve(cfg: Config) -> None:
    t = time.monotonic()
    engine = Engine(cfg.model_dir, cfg.threads)
    httpd, app = build(cfg, engine)
    threading.Thread(target=httpd.serve_forever, name="http", daemon=True).start()
    engine.warmup()
    app.ready = True
    log(
        "info",
        "ready",
        addr=f"{cfg.addr[0]}:{cfg.addr[1]}",
        threads=cfg.threads,
        load_s=round(time.monotonic() - t, 1),
        secret=bool(cfg.secret),
    )
    threading.Event().wait()


if __name__ == "__main__":
    serve(Config(dict(os.environ)))
