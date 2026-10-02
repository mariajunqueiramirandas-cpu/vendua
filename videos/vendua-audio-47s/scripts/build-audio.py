# The frenético mix, in two steps from the raw takes in audio/takes/ (gitignored):
#
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
    (5, 9, 0.05, "l5-narrator", True),
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
# API on the Creator plan). Lines 3 and 6 spell "Vendu-á" so the stress lands on the á.
VOICES = {
    "l1-luiz": ("takes/v2/l1-luiz-a.mp3", f"{PAUSE},{TRIM},rubberband=tempo=1.1:{RB},{PHONE}"),
    "l2-narrator": ("takes/v2/bruna-l2.mp3", f"{PAUSE},{TRIM}"),
    "l3-narrator": ("takes/v2/bruna-l3-1.mp3", f"{TRIM},rubberband=tempo=1.08:{RB}"),
    "l4-narrator": ("takes/v2/bruna-l4.mp3", TRIM),
    "l5-narrator": ("takes/v2/bruna-l5.mp3", TRIM),
    "l6-narrator": ("takes/v2/bruna-l6.mp3", f"{PAUSE},{TRIM}"),
}
# Frame 2's burst: nine notes on the beats (frame 2 starts on a beat)
NOTE_TIMES = [k * 2 * EIGHTH for k in range(1, 10)]
WHIP_PEAK = 0.25  # the whoosh peaks 0.25 s in: it starts that much before its cut
# (frame, sfx, at, volume): `at` is seconds into the frame, or ("w", i) for word i's start
SFX = (
    [(1, "tap", 0.04, 0.55)]
    + [(2, f"pop-{i % 4 + 1}", t, 0.42) for i, t in enumerate(NOTE_TIMES)]
    + [(2, "hit", ("w", 15), 0.45)]  # "fila"
    + [(3, "whip", -WHIP_PEAK, 0.45), (3, "hit", ("w", 2), 0.4), (3, "tap", ("w", 7), 0.55)]
    + [(4, "whip", -WHIP_PEAK, 0.4), (4, "swipe", ("w", 1), 0.45), (4, "swipe", ("w", 3), 0.45), (4, "pago", ("w", 3), 0.5)]
    + [(5, "whip", -WHIP_PEAK, 0.45), (5, "pedido-novo", ("w", 2), 0.6), (5, "buzz", ("w", 2), 0.45)]
    + [(6, "hit", 0.0, 0.6), (6, "whip", ("w", 5), 0.35), (6, "tap", ("w", 9), 0.45)]
)


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
        abs_s = round(frame_start[frame] + rel, 3)
        # a hit before its frame (a whoosh into a cut) belongs to the frame that is playing
        host = max(f for f, s in frame_start.items() if s <= abs_s + 1e-6)
        f = f"audio/sfx/{name}.mp3"
        offset = round(abs_s - frame_start[host], 3)
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
    {"voices": voices, "mix": mix}[sys.argv[1]]()
