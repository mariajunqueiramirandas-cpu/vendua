"""Round trip through our own speech-to-text: how intelligible the engine's speech is, per kernel
set, decoder mode and voice, and how fast it was made.

  python bench.py speak <out> [--model-dir D] [--isa avx2] [--mode q8] [--voices a,b] [--seeds 1,2]
                              [--threads N] [--raw]
      synthesizes bench_replies.txt into <out>/<voice>/<seed>_<n>.wav and prints the speed.
      --raw skips the text normalizer (digits go to the model as they are).
  python bench.py score <stt model dir> <dir>... [--wav] [-v]
      transcribes every <dir>/<voice>/*.wav with services/stt, after a 32 kbps Ogg/Opus round
      trip like a WhatsApp voice note (--wav: as is), and prints WER, CER and the share of prices
      heard right. Writes <dir>/<voice>/scores.json.
  python bench.py compare <dir/voice> <dir/voice>
      the same clips, paired: which errs less, and a sign test.

Needs services/stt's requirements and model for `score` (python -m stt.fetch --compiled <dir>).
WER is on words after the normalizer, on both sides: the transcript's "R$ 49,90" counts as the
words the model was asked to say.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPLIES = [line for line in (HERE / "bench_replies.txt").read_text().splitlines() if line.strip()]
_PRICE = re.compile(r"R\$\s?(\d{1,3}(?:\.\d{3})+(?!\d)|\d+)(?:,(\d{1,2}))?")


def words(text: str) -> list[str]:
    from tts.text import normalize

    return re.sub(r"[^\w\s]", " ", normalize(text).lower()).split()


def edits(a: list, b: list) -> int:
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x != y))
    return d[len(b)]


def write_wav(path: Path, pcm: np.ndarray, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.astype("<i2").tobytes())


def speak(a) -> None:
    if a.mode:
        os.environ["PK_MIMI_MODE"] = a.mode
    import tts.speak
    from tts.engine import Engine
    from tts.server import split_threads
    from tts.speak import Speaker

    if a.raw:
        tts.speak.normalize = lambda t: t
    lm, mimi = split_threads(a.threads)
    e = Engine(Path(a.model_dir) / "pocket.bin", lm, mimi, 8, isa=a.isa)
    sp = Speaker.load(e, a.model_dir)
    voices = a.voices.split(",") if a.voices != "all" else sorted(e.voices)
    sp.speak("Olá! Tudo pronto por aqui.", voices[0], 60, lambda p: None)
    audio = wall = 0.0
    for voice in voices:
        out = Path(a.out) / voice
        out.mkdir(parents=True, exist_ok=True)
        for seed in (int(s) for s in a.seeds.split(",")):
            for i, text in enumerate(REPLIES):
                parts: list[np.ndarray] = []
                t = time.perf_counter()
                n, _ = sp.speak(text, voice, 120, lambda p: parts.append(p.copy()), seed=seed * 1000 + i)
                wall += time.perf_counter() - t
                audio += n / e.sample_rate
                write_wav(out / f"{seed}_{i:03d}.wav", np.concatenate(parts), e.sample_rate)
    print(f"{a.out}: {e.isa}/{e.decoder_mode} {lm}+{mimi} threads, {len(voices)} voices: "
          f"{audio:.0f} s of audio in {wall:.1f} s, RTFx {audio / wall:.1f}")


def score(a) -> None:
    sys.path.insert(0, str(HERE.parent / "stt"))
    from stt import audio as stt_audio
    from stt.engine import Engine as Stt

    from tts.audio import OggOpus
    from tts.text import money

    stt = Stt(a.stt_model, os.cpu_count())
    for d in a.dirs:
        for vdir in sorted(p for p in Path(d).iterdir() if p.is_dir()) or [Path(d)]:
            files = sorted(vdir.glob("*.wav"))
            if not files:
                continue
            clips = {}
            for k in range(0, len(files), 8):
                batch, waves = files[k : k + 8], []
                for f in batch:
                    data = f.read_bytes()
                    if not a.wav:
                        with wave.open(str(f)) as w:
                            pcm, rate = np.frombuffer(w.readframes(w.getnframes()), np.int16), w.getframerate()
                        enc = OggOpus(rate)
                        enc.write(pcm)
                        data = enc.finish()
                    waves.append(stt_audio.decode(data, 600))
                for f, tr in zip(batch, stt.transcribe(waves, [None] * len(waves))):
                    text = REPLIES[int(f.stem.split("_")[1])]
                    ref, hyp = words(text), words(tr.text)
                    said = " ".join(hyp)
                    prices = [money(int(m[1].replace(".", "")), int((m[2] or "0").ljust(2, "0"))) for m in _PRICE.finditer(text)]
                    clips[f.stem] = {
                        "words": len(ref),
                        "errors": edits(ref, hyp),
                        "chars": len(" ".join(ref)),
                        "char_errors": edits(list(" ".join(ref)), list(said)),
                        "digits": any(c.isdigit() for c in text),
                        "prices": len(prices),
                        "prices_right": sum(p in said for p in prices),
                        "heard": tr.text,
                    }
            (vdir / "scores.json").write_text(json.dumps(clips, ensure_ascii=False, indent=1))
            report(f"{vdir}", clips, a.verbose)


def report(name: str, clips: dict, verbose: bool) -> None:
    c = list(clips.values())
    w = sum(x["words"] for x in c)
    wd = sum(x["words"] for x in c if x["digits"])
    pr = sum(x["prices"] for x in c)
    print(
        f"{name:40s} WER {100 * sum(x['errors'] for x in c) / w:5.2f}%"
        f"  CER {100 * sum(x['char_errors'] for x in c) / sum(x['chars'] for x in c):5.2f}%"
        f"  with numbers {100 * sum(x['errors'] for x in c if x['digits']) / max(wd, 1):5.2f}%"
        f"  prices {sum(x['prices_right'] for x in c)}/{pr}"
        f"  clips with errors {sum(x['errors'] > 0 for x in c)}/{len(c)}"
    )
    if verbose:
        for k, x in sorted(clips.items()):
            if x["errors"]:
                print(f"    {k} {x['errors']}: {x['heard']}")


def compare(a) -> None:
    x, y = (json.loads((Path(p) / "scores.json").read_text()) for p in (a.a, a.b))
    keys = sorted(set(x) & set(y))
    better = sum(x[k]["errors"] < y[k]["errors"] for k in keys)
    worse = sum(x[k]["errors"] > y[k]["errors"] for k in keys)
    n = better + worse
    # two-sided sign test
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(min(better, worse) + 1)) / 2**n) if n else 1.0
    ex, ey = sum(x[k]["errors"] for k in keys), sum(y[k]["errors"] for k in keys)
    print(f"{len(keys)} clips: {a.a} {ex} errors, {a.b} {ey}; {a.a} better on {better}, worse on {worse} (sign test p = {p:.2f})")


def main() -> None:
    sys.path.insert(0, str(HERE))
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("speak")
    s.add_argument("out")
    s.add_argument("--model-dir", default=os.environ.get("TTS_MODEL_DIR", "/models"))
    s.add_argument("--isa")
    s.add_argument("--mode", help="decoder mode: f32, q12 or q8 (PK_MIMI_MODE)")
    s.add_argument("--voices", default="rafael", help="comma list, or all")
    s.add_argument("--seeds", default="1")
    s.add_argument("--threads", type=int, default=os.cpu_count())
    s.add_argument("--raw", action="store_true")
    s.set_defaults(fn=speak)
    s = sub.add_parser("score")
    s.add_argument("stt_model")
    s.add_argument("dirs", nargs="+")
    s.add_argument("--wav", action="store_true")
    s.add_argument("-v", "--verbose", action="store_true")
    s.set_defaults(fn=score)
    s = sub.add_parser("compare")
    s.add_argument("a")
    s.add_argument("b")
    s.set_defaults(fn=compare)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
