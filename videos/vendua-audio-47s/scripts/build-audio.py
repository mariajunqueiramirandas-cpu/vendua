# The frenético mix, in three steps from the raw takes in audio/takes/ (gitignored):
#
#   python scripts/build-audio.py sfx      # the chosen ElevenLabs SFX takes into audio/sfx/
#   python scripts/build-audio.py voices   # process the six lines into audio/vo/
#   (Whisper the six files into audio/frames/whisper-words.json, line-relative, mapped onto
#    the approved script's spelling)
#   python scripts/build-audio.py mix      # frame voices, the ducked bed, cues.json, audio_meta.json
#
# Needs ffmpeg with rubberband. Every cut lands on the 128 BPM bed's eighth-note grid, and the
# SFX hang off the words that trigger them, so a retaken line keeps them in sync.
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "audio"
SR = 44100
BPM = 128
EIGHTH = 60 / BPM / 2
BED = "takes/v2/music128-a.mp3"  # ElevenLabs Music v2.5, 128.0 BPM, no fade
BED_FIRST_BEAT = 0.432
FRAMES = [
    # (frame, eighths, voice lead, voice file, captions)
    (1, 30, 0.10, "l1-luiz", True),
    (2, 25, 0.05, "l2-narrator", True),
    (3, 13, 0.05, "l3-narrator", True),
    (4, 11, 0.05, "l4-narrator", True),
    (5, 10, 0.05, "l5-narrator", True),
    (6, 28, 0.10, "l6-narrator", False),  # the end card carries its own words
]
TRIM = (
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse"
)
PAUSE = "silenceremove=stop_periods=-1:stop_duration=0.2:stop_threshold=-40dB:stop_silence=0.14"
RB = "pitchq=quality:transients=crisp:formant=preserved"
PHONE = "highpass=f=220,lowpass=f=5200,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120"
# energetic v2 takes: Luiz is Talis; the narrator is Bruna da Costa (the author's pick, via the
# API on the Creator plan). Lines 3 and 6 spell "Vendu-á" so the stress lands on the á. Line 5 is
# the v3 rewrite: "cai prontinho no seu celular" (the old "chega sozinho" read as if Venduá delivered).
VOICES = {
    "l1-luiz": ("takes/v2/l1-luiz-a.mp3", f"{PAUSE},{TRIM},rubberband=tempo=1.1:{RB},{PHONE}"),
    "l2-narrator": ("takes/v2/bruna-l2.mp3", f"{PAUSE},{TRIM}"),
    "l3-narrator": ("takes/v2/bruna-l3-1.mp3", f"{TRIM},rubberband=tempo=1.08:{RB}"),
    "l4-narrator": ("takes/v2/bruna-l4.mp3", TRIM),
    "l5-narrator": ("takes/v3/l5p-1.mp3", f"{PAUSE},{TRIM},rubberband=tempo=1.08:{RB}"),
    "l6-narrator": ("takes/v2/bruna-l6.mp3", f"{PAUSE},{TRIM}"),
}
# Frame 2's burst: nine notes on the beats (frame 2 starts on a beat)
NOTE_TIMES = [k * 2 * EIGHTH for k in range(1, 10)]
WHOOSH_PEAK = 0.15  # the whoosh swells to its peak 0.15 s in: it starts that much before its cut
# (frame, sfx, at, volume): `at` is seconds into the frame, or ("w", i) for word i's start.
# The v3 set is soft and tonal (clicks, glassy plucks, a silky air whoosh, a sine bloom, chimes) and
# sits low: one sound per moment, the voice always on top.
SFX = (
    [(1, "tap", 0.04, 0.45)]
    + [(2, f"pop-{i % 4 + 1}", t, 0.3) for i, t in enumerate(NOTE_TIMES)]
    + [(2, "accent", ("w", 15), 0.3)]  # "fila"
    + [(3, "whoosh", -WHOOSH_PEAK, 0.32), (3, "accent", ("w", 2), 0.28), (3, "tap", ("w", 7), 0.4)]
    + [(4, "whoosh", -WHOOSH_PEAK, 0.28), (4, "swipe", ("w", 1), 0.35), (4, "pago", ("w", 3), 0.42)]
    + [(5, "whoosh", -WHOOSH_PEAK, 0.3), (5, "pedido-novo", ("w", 2), 0.45), (5, "buzz", ("w", 2), 0.22)]
    + [(6, "accent", 0.0, 0.4), (6, "swipe", ("w", 5), 0.3), (6, "tap", ("w", 9), 0.38)]
)


# The v3 sounds (prompts in videos/README.md): each take is trimmed to its attack, band-limited so
# nothing is brittle or boomy, faded, and peak-limited to -3 dB; the pops are one pluck pitched up a
# minor-pentatonic step each. (out, take, highpass, lowpass, fade start, fade, length, gain dB)
SFX_TAKES = [
    ("tap", "tap-a", 120, 9000, 0.1, 0.08, 0.2, 6),
    ("swipe", "swipe-b", 150, 10000, 0.2, 0.1, 0.32, 0),
    ("whoosh", "whoosh-b", 180, 9000, 0.35, 0.15, 0.5, 0),
    ("accent", "accent-b", 0, 9000, 0.45, 0.25, 0.7, 6),
    ("pago", "pago-b", 200, 11000, 0.55, 0.2, 0.75, 8),
    ("pedido-novo", "pedido-b", 200, 11000, 0.45, 0.2, 0.65, 0),
    ("buzz", "buzz-b", 60, 4000, 0.45, 0.12, 0.58, 0),
] + [(f"pop-{i + 1}", "pop-a", 200, 10000, 0.18, 0.1, 0.3, 8, st) for i, st in enumerate([0, 3, 5, 7])]


def ff(*args):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *map(str, args)], check=True)


def dur(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return float(out)


def sfx():
    for out, take, hp, lp, fade_at, fade, length, gain, *pitch in SFX_TAKES:
        chain = ["silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005"]
        if pitch:
            chain.append(f"rubberband=pitch={2 ** (pitch[0] / 12)}")
        if hp:
            chain.append(f"highpass=f={hp}")
        chain += [f"lowpass=f={lp}", f"afade=t=out:st={fade_at}:d={fade}", f"atrim=0:{length}"]
        if gain:
            chain.append(f"volume={gain}dB")
        chain.append("alimiter=limit=0.7:level=false")
        ff("-i", A / f"takes/v3-sfx/{take}.mp3", "-af", ",".join(chain), "-c:a", "libmp3lame", "-b:a", "192k", A / f"sfx/{out}.mp3")
        print(f"{out}: {dur(A / f'sfx/{out}.mp3'):.2f}s")


def voices():
    for name, (src, chain) in VOICES.items():
        ff("-i", A / src, "-af", f"{chain},aresample={SR}", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "160k", A / f"vo/{name}.mp3")
        print(f"{name}: {dur(A / f'vo/{name}.mp3'):.2f}s")


def mix():
    words = json.loads((A / "frames/whisper-words.json").read_text())
    start, cues, meta_voices, frame_start, frame_words = 0.0, {"frames": {}, "sfx": []}, [], {}, {}
    for frame, eighths, lead, name, captions in FRAMES:
        length = round(eighths * EIGHTH, 6)
        vo = A / f"vo/{name}.mp3"
        assert lead + dur(vo) < length, f"frame {frame}: the voice overruns {length}s"
        ff(
            "-f", "lavfi", "-t", lead, "-i", f"anullsrc=r={SR}:cl=mono",
            "-i", vo,
            "-f", "lavfi", "-t", length, "-i", f"anullsrc=r={SR}:cl=mono",
            "-filter_complex", f"[0][1][2]concat=n=3:v=0:a=1,atrim=0:{length}",
            "-c:a", "libmp3lame", "-b:a", "160k", A / f"frames/f0{frame}-voice.mp3",
        )
        ws = [
            {"id": f"w{frame}-{i}", "text": w["w"], "start": round(lead + w["s"], 2), "end": round(lead + w["e"], 2)}
            for i, w in enumerate(words[name])
        ]
        cues["frames"][str(frame)] = {"start_s": round(start, 6), "duration_s": length, "lead_s": lead, "words": ws}
        meta_voices.append({"frame": frame, "path": f"audio/frames/f0{frame}-voice.mp3", "duration_s": length, "words": ws if captions else []})
        frame_start[frame], frame_words[frame] = start, ws
        start += length
    total = round(start, 6)
    cues["total_s"] = total

    inputs = []
    for frame, *_ in FRAMES:
        inputs += ["-i", A / f"frames/f0{frame}-voice.mp3"]
    ff(*inputs, "-filter_complex", f"concat=n={len(FRAMES)}:v=0:a=1,aresample={SR},pan=stereo|c0=c0|c1=c0", A / "voice-guide.wav")
    ff(
        "-ss", BED_FIRST_BEAT, "-i", A / BED, "-i", A / "voice-guide.wav",
        "-filter_complex",
        f"[0]aresample={SR},aformat=channel_layouts=stereo,volume=0.5,afade=t=out:st={total - 0.4}:d=0.4[m];"
        "[1]aformat=channel_layouts=stereo[k];"
        "[m][k]sidechaincompress=threshold=0.02:ratio=4:attack=12:release=220[d]",
        "-map", "[d]", "-t", total, "-c:a", "libmp3lame", "-b:a", "192k", A / "music-bed.mp3",
    )
    (A / "voice-guide.wav").unlink()

    sfx = []
    for frame, name, at, volume in SFX:
        rel = frame_words[frame][at[1]]["start"] if isinstance(at, tuple) else at
        exact = frame_start[frame] + rel
        abs_s = round(exact, 3)
        # a sound before its frame (a whoosh into a cut) belongs to the frame that is playing; pick
        # it from the unrounded time, or a sound on a cut at 20.859375 lands in the frame before
        host = max(f for f, s in frame_start.items() if s <= exact + 1e-6)
        f = f"audio/sfx/{name}.mp3"
        offset = round(exact - frame_start[host], 3)
        sfx.append({"frame": host, "file": f, "offset_s": offset, "duration_s": round(dur(ROOT / f), 2), "volume": volume})
        cues["sfx"].append({"frame": host, "name": name, "offset_s": offset, "abs_s": abs_s})
    (A / "cues.json").write_text(json.dumps(cues, ensure_ascii=False, indent=2) + "\n")
    meta = {
        "bgm": {
            "path": "audio/music-bed.mp3",
            "volume": 1,
            "query": "ElevenLabs Music v2.5, 128 BPM funk-pop from its first beat, ducked under the voices",
            "duration_s": total,
        },
        "bgm_pending": False,
        "voices": meta_voices,
        "sfx": sfx,
    }
    (ROOT / "audio_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    envelope(FRAMES[0][1] * EIGHTH)
    print(f"total {total}s, frames at", {f: round(s, 3) for f, s in frame_start.items()})


def envelope(length, fps=30):
    # Frame 1's waveform bars follow Luiz's loudness (30 fps, 0..1 against the 95th percentile)
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", A / "frames/f01-voice.mp3", "-f", "s16le", "-ac", "1", "-ar", "48000", "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    w, n = 48000 // fps, int(round(length * fps))
    rms = np.array([np.sqrt(np.mean(x[i * w : (i + 1) * w] ** 2)) if (i + 1) * w <= len(x) else 0.0 for i in range(n)])
    env = np.clip(rms / np.percentile(rms[rms > 0], 95), 0, 1)
    env = np.round(np.convolve(env, [0.25, 0.5, 0.25], mode="same"), 3)
    out = {"fps": fps, "duration_s": round(length, 3), "source": "audio/frames/f01-voice.mp3", "values": env.tolist()}
    (A / "f01-envelope.json").write_text(json.dumps(out))


if __name__ == "__main__":
    {"sfx": sfx, "voices": voices, "mix": mix}[sys.argv[1]]()
