# Audio measurements for Reel work (needs numpy and ffmpeg):
#
#   python videos/tools/measure.py tempo  bed.mp3 [90:180]   # BPM (0.05 steps) + first beat, for a cut grid
#   python videos/tools/measure.py levels voice.mp3 [0.1]    # dB per window: pauses, tails, fades
#   python videos/tools/measure.py loop   bed.mp3 99.4 1.629 # bar-aligned loop points with matching harmony
#
# `tempo` scans a BPM range (default 90-180: below it, half-tempo wins on most beds) against the
# onset flux; trust a result that lands on a round number (ElevenLabs Music honours the BPM in its
# prompt). `loop` needs the BPM and a downbeat time.
import subprocess
import sys

import numpy as np

SR = 22050


def load(path, sr=SR):
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def flux(x, hop=64, nfft=1024):
    frames = np.lib.stride_tricks.sliding_window_view(x, nfft)[::hop] * np.hanning(nfft)
    mag = np.abs(np.fft.rfft(frames, axis=1))
    return np.maximum(0, np.diff(np.log1p(mag * 10), axis=0)).sum(axis=1), SR / hop


def tempo(path, lo=90.0, hi=180.0):
    f, fps = flux(load(path))
    best = (0, 0, 0)
    for bpm in np.arange(lo, hi + 0.01, 0.05):
        period = 60 / bpm
        for off in np.arange(0, period, 0.004):
            t = np.arange(off, len(f) / fps - 0.01, period)
            score = f[(t * fps).astype(int)].mean()
            if score > best[0]:
                best = (score, bpm, off)
    _, bpm, off = best
    print(f"{bpm:.2f} BPM, first beat at {off:.3f} s (beat {60 / bpm:.4f} s, eighth {30 / bpm:.4f} s)")


def levels(path, win=0.1):
    x = load(path, 16000)
    n = int(16000 * win)
    db = [20 * np.log10(np.sqrt(np.mean(x[i * n : (i + 1) * n] ** 2)) + 1e-9) for i in range(len(x) // n)]
    print(f"{len(x) / 16000:.2f} s, {win} s windows:", " ".join(str(int(d)) for d in db))


def loop(path, bpm, downbeat):
    x = load(path)
    bar = 4 * 60 / bpm
    nb = int((len(x) / SR - downbeat) / bar)

    def chroma(a, b):
        seg = x[int(a * SR) : int(b * SR)]
        n = 4096
        m = np.abs(np.fft.rfft(np.lib.stride_tricks.sliding_window_view(seg, n)[::1024] * np.hanning(n), axis=1)).mean(axis=0)
        fq = np.fft.rfftfreq(n, 1 / SR)
        ok = (fq > 80) & (fq < 2000)
        c = np.zeros(12)
        np.add.at(c, np.round(12 * np.log2(fq[ok] / 440)).astype(int) % 12, m[ok])
        return c / np.linalg.norm(c)

    head = [chroma(downbeat + i * bar, downbeat + i * bar + bar / 2) for i in range(nb)]
    pairs = sorted((1 - float(np.dot(head[k + 1], head[j])), k, j) for k in range(2, nb - 1) for j in range(1, k - 1))
    for cost, k, j in pairs[:5]:
        print(f"after bar {k} jump back to bar {j} ({k + 1 - j}-bar loop): cost {cost:.4f}")


if __name__ == "__main__":
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "tempo":
        lo, hi = (map(float, sys.argv[3].split(":")) if len(sys.argv) > 3 else (90.0, 180.0))
        tempo(path, lo, hi)
    elif cmd == "levels":
        levels(path, float(sys.argv[3]) if len(sys.argv) > 3 else 0.1)
    elif cmd == "loop":
        loop(path, float(sys.argv[3]), float(sys.argv[4]))
    else:
        sys.exit(__doc__)
