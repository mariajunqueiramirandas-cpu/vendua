# The launch mix, from the raw eleven_v4 takes in audio/takes/ (gitignored; lines.tsv holds the
# prompts):
#
#   python scripts/build-audio.py sfx      # the chosen SFX takes into audio/sfx/ (new sounds only;
#                                          # the premium set is copied from vendua-audio-47s)
#   python scripts/build-audio.py voices   # each chosen line into audio/vo/
#   python scripts/build-audio.py words    # Whisper the lines, mapped onto the script's spelling
#   python scripts/build-audio.py mix      # frame voices, the ducked bed, cues.json, audio_meta.json
#
# The voice is the clock: each frame is its lines plus a lead and a tail, rounded up to whole
# eighth notes of the 128 BPM bed, so every cut lands on the grid without trimming a word. Nothing
# is sped up. SFX hang off the words that trigger them, so a retaken line keeps them in sync.
import difflib
import json
import math
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "audio"
SR = 44100
BPM = 128
EIGHTH = 60 / BPM / 2
BED = "takes/music/bed-a.mp3"  # ElevenLabs Music, 128.0 BPM, even energy to 70 s, no fade
BED_FIRST_BEAT = 0.224
GAP = 0.14  # between two lines of one frame
TAIL = 0.12
# frame: (name, lead, [lines], captions, hold) — hold is extra time after the last word
FRAMES = {
    1: ("chegou", 0.12, ["L01", "L02"], True, 0.0),
    2: ("loja-no-ar", 0.08, ["L03", "L04"], True, 0.0),
    3: ("pix", 0.08, ["L05"], True, 0.0),
    4: ("dua-whatsapp", 0.08, ["L06", "C01"], True, 0.0),
    5: ("dua-vende", 0.08, ["L07", "L08"], True, 0.0),
    6: ("assumir", 0.08, ["L09"], True, 0.0),
    7: ("cozinha", 0.08, ["L10", "L11"], True, 0.0),
    8: ("relogio", 0.08, ["L12", "L13"], True, 0.0),
    9: ("bandeira", 0.12, ["L14"], False, 1.6),  # the end card carries its own words
}
TRIM = (
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse"
)
PAUSE = "silenceremove=stop_periods=-1:stop_duration=0.2:stop_threshold=-40dB:stop_silence=0.14"
PHONE = "highpass=f=300,lowpass=f=4200,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120"
# the chosen take of each line (two per line, picked on Whisper wording and length; L04-d and
# L14-d are the "Du-á" / "Vendu-á!" retakes). C01 is Caio's voice note: Talis, phone band.
TAKES = {
    "L01": "L01-a", "L02": "L02-a", "L03": "L03-a", "L04": "L04-d", "L05": "L05-a",
    "L06": "L06-a", "C01": "C01-b", "L07": "L07-b", "L08": "L08-b", "L09": "L09-a",
    "L10": "L10-b", "L11": "L11-a", "L12": "L12-b", "L13": "L13-a", "L14": "L14-d",
}
WHOOSH_PEAK = 0.15  # the whoosh swells to its peak 0.15 s in: it starts that much before its cut
# (frame, sfx, at, volume): `at` is seconds into the frame, or (line, i) for word i of that line.
# Soft and tonal, under the voice: one sound per moment, an accent (never an impact) on the logo.
SFX = [
    # "loja", "vendedor", "cozinha"
    (1, "accent", 0.0, 0.4), (1, "pop-1", ("L02", 2), 0.28), (1, "pop-2", ("L02", 6), 0.28),
    (1, "pop-3", ("L02", 14), 0.28),
    # "Um", "Duá", "nome", "cores", "cardápio"
    (2, "whoosh", -WHOOSH_PEAK, 0.3), (2, "accent", ("L03", 0), 0.3), (2, "tap", ("L04", 4), 0.38),
    (2, "pop-1", ("L04", 9), 0.26), (2, "pop-2", ("L04", 10), 0.26), (2, "pop-4", ("L04", 11), 0.26),
    # "link", "Pix"
    (3, "swipe", ("L05", 4), 0.32), (3, "pago", ("L05", 10), 0.42),
    # "Dois", Caio's play button just before he talks
    (4, "whoosh", -WHOOSH_PEAK, 0.3), (4, "accent", ("L06", 0), 0.3), (4, "tap", ("C01", 0, -0.18), 0.4),
    # "responde", "fatia", "Pix"
    (5, "pop-2", ("L07", 5), 0.28), (5, "pop-3", ("L08", 2), 0.28), (5, "pago", ("L08", 11), 0.4),
    # "toque"
    (6, "tap", ("L09", 4), 0.42),
    # "Três", "pedido", "toque", "imprime"
    (7, "whoosh", -WHOOSH_PEAK, 0.3), (7, "accent", ("L10", 0), 0.3),
    (7, "pedido-novo", ("L11", 1), 0.42), (7, "tap", ("L11", 9), 0.4), (7, "print", ("L11", 13), 0.4),
    # "relógio", "toque", "cliente"
    (8, "pop-1", ("L12", 8), 0.26), (8, "tap", ("L13", 3), 0.4), (8, "pronto", ("L13", 6), 0.4),
    (9, "accent", 0.0, 0.42), (9, "swipe", ("L14", 4), 0.28),
]
# new sounds for this video (prompts in the commit that added them; the rest is the premium set)
# (out, take, highpass, lowpass, fade start, fade, length, gain dB)
SFX_TAKES = [
    ("print", "print-a", 200, 9000, 0.9, 0.25, 1.15, 4),
    ("pronto", "pronto-b", 200, 11000, 0.8, 0.25, 1.05, 0),
]
# a line cut short at the silence before its last words (L02 loses "Olha só!": 65 s → ~63 s)
CUT = {"L02": 5.68}
# what each line says, spelled the way the captions show it
SCRIPT = {
    "L01": "Chegou o Venduá!",
    "L02": "A sua loja online, com um vendedor que nunca larga o WhatsApp e uma cozinha que vê tudo na hora.",
    "L03": "Um: a sua loja no ar em cerca de uma hora.",
    "L04": "Você conversa com o Duá, e ele monta tudo: nome, cores, cardápio.",
    "L05": "O cliente pede pelo link, sem cadastro, e paga no Pix, direto na sua conta do Mercado Pago.",
    "L06": "Dois: o Duá vende por você no WhatsApp.",
    "C01": "Oi, tudo bem? Tem bolo de cenoura com brigadeiro pra hoje?",
    "L07": "Ele ouve o áudio e responde na hora, com o preço do seu cardápio, sem chute.",
    "L08": "Oferece uma fatia a mais, fecha o pedido e manda o Pix.",
    "L09": "Precisou de você? Um toque, e você assume a conversa.",
    "L10": "Três: a cozinha vê o pedido na hora.",
    "L11": "O pedido cai no seu celular, você aceita num toque, e a comanda imprime sozinha.",
    "L12": "Na tela da cozinha, cada pedido tem um relógio que avisa antes de atrasar.",
    "L13": "Ficou pronto? Um toque, e o cliente fica sabendo.",
    "L14": "Venduá. Comece pelo Venduá Bandeira: catorze dias grátis, sem cartão.",
}


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
    for out, take, hp, lp, fade_at, fade, length, gain in SFX_TAKES:
        chain = ["silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005"]
        if hp:
            chain.append(f"highpass=f={hp}")
        chain += [f"lowpass=f={lp}", f"afade=t=out:st={fade_at}:d={fade}", f"atrim=0:{length}"]
        if gain:
            chain.append(f"volume={gain}dB")
        chain.append("alimiter=limit=0.7:level=false")
        ff("-i", A / f"takes/sfx/{take}.mp3", "-af", ",".join(chain), "-c:a", "libmp3lame", "-b:a", "192k", A / f"sfx/{out}.mp3")
        print(f"{out}: {dur(A / f'sfx/{out}.mp3'):.2f}s")


def voices():
    (A / "vo").mkdir(exist_ok=True)
    for line, take in TAKES.items():
        chain = f"{PAUSE},{TRIM}" + (f",{PHONE}" if line.startswith("C") else "")
        if line in CUT:
            chain += f",atrim=0:{CUT[line]},afade=t=out:st={CUT[line] - 0.04}:d=0.04"
        ff("-i", A / f"takes/{take}.mp3", "-af", f"{chain},aresample={SR}", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "160k", A / f"vo/{line}.mp3")
        print(f"{line}: {dur(A / f'vo/{line}.mp3'):.2f}s")


def norm(w):
    w = unicodedata.normalize("NFKD", w.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if not unicodedata.combining(c)))


def words():
    # Whisper hears "1." for "Um:", "PIX" for "Pix" and "Vendoar" for "Venduá": keep its times,
    # use the script's words. Unequal runs share the run's span in proportion to their letters.
    from faster_whisper import WhisperModel

    model = WhisperModel("small", compute_type="int8")
    out = {}
    for line in TAKES:
        segs, _ = model.transcribe(str(A / f"vo/{line}.mp3"), language="pt", word_timestamps=True)
        heard = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words]
        script = SCRIPT[line].split()
        sm = difflib.SequenceMatcher(a=[norm(h[0]) for h in heard], b=[norm(s) for s in script], autojunk=False)
        mapped = []
        for op, a0, a1, b0, b1 in sm.get_opcodes():
            if op == "equal" or (op == "replace" and a1 - a0 == b1 - b0):
                mapped += [{"w": script[b0 + k], "s": heard[a0 + k][1], "e": heard[a0 + k][2]} for k in range(b1 - b0)]
            elif b1 > b0:
                s = heard[a0][1] if a1 > a0 else (mapped[-1]["e"] if mapped else 0.0)
                e = heard[a1 - 1][2] if a1 > a0 else (heard[a0][1] if a0 < len(heard) else s + 0.3)
                weights = [max(1, len(norm(x))) for x in script[b0:b1]]
                t = s
                for x, wt in zip(script[b0:b1], weights):
                    d = (e - s) * wt / sum(weights)
                    mapped.append({"w": x, "s": t, "e": t + d})
                    t += d
        assert [m["w"] for m in mapped] == script, line
        out[line] = [{"w": m["w"], "s": round(m["s"], 3), "e": round(m["e"], 3)} for m in mapped]
        print(line, " ".join(f"{m['w']}@{m['s']:.2f}" for m in out[line]))
    (A / "frames").mkdir(exist_ok=True)
    (A / "frames/whisper-words.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")


def mix():
    heard = json.loads((A / "frames/whisper-words.json").read_text())
    start, cues, meta_voices, frame_start, line_at = 0.0, {"bpm": BPM, "eighth_s": EIGHTH, "frames": {}, "sfx": []}, [], {}, {}
    for frame, (name, lead, lines, captions, hold) in FRAMES.items():
        parts, t, ws, line_cues = [], lead, [], {}
        for i, line in enumerate(lines):
            if i:
                t += GAP
            line_at[line] = (frame, t)
            d = dur(A / f"vo/{line}.mp3")
            line_cues[line] = {"start": round(t, 3), "end": round(t + d, 3), "text": SCRIPT[line]}
            ws += [
                {"id": f"w{frame}-{len(ws) + k}", "text": w["w"], "start": round(t + w["s"], 2), "end": round(t + w["e"], 2), "line": line}
                for k, w in enumerate(heard[line])
            ]
            parts.append((t, line))
            t += d
        eighths = math.ceil((t + TAIL + hold) / EIGHTH - 1e-9)
        length = round(eighths * EIGHTH, 6)
        inputs, chains = [], []
        for k, (at, line) in enumerate(parts):
            inputs += ["-i", A / f"vo/{line}.mp3"]
            chains.append(f"[{k}]aresample={SR},adelay={int(round(at * 1000))}:all=1[v{k}]")
        mixin = "".join(f"[v{k}]" for k in range(len(parts)))
        ff(
            *inputs, "-filter_complex",
            ";".join(chains) + f";{mixin}amix=inputs={len(parts)}:normalize=0,apad,atrim=0:{length}",
            "-ac", "1", "-c:a", "libmp3lame", "-b:a", "160k", A / f"frames/f{frame:02d}-voice.mp3",
        )
        cues["frames"][str(frame)] = {
            "name": name, "start_s": round(start, 6), "duration_s": length, "eighths": eighths,
            "lines": line_cues, "words": ws,
        }
        meta_voices.append({"frame": frame, "path": f"audio/frames/f{frame:02d}-voice.mp3", "duration_s": length, "words": ws if captions else []})
        frame_start[frame] = start
        start += length
    total = round(start, 6)
    cues["total_s"] = total

    inputs = []
    for frame in FRAMES:
        inputs += ["-i", A / f"frames/f{frame:02d}-voice.mp3"]
    ff(*inputs, "-filter_complex", f"concat=n={len(FRAMES)}:v=0:a=1,aresample={SR},pan=stereo|c0=c0|c1=c0", A / "voice-guide.wav")
    ff(
        "-ss", BED_FIRST_BEAT, "-i", A / BED, "-i", A / "voice-guide.wav",
        "-filter_complex",
        f"[0]aresample={SR},aformat=channel_layouts=stereo,volume=0.5,afade=t=out:st={total - 0.6}:d=0.6[m];"
        "[1]aformat=channel_layouts=stereo[k];"
        "[m][k]sidechaincompress=threshold=0.02:ratio=4:attack=12:release=220[d]",
        "-map", "[d]", "-t", total, "-c:a", "libmp3lame", "-b:a", "192k", A / "music-bed.mp3",
    )
    (A / "voice-guide.wav").unlink()

    sfx = []
    for frame, name, at, volume in SFX:
        if isinstance(at, tuple):
            line, i, *nudge = at
            f0, t0 = line_at[line]
            assert f0 == frame, (name, at)
            rel = t0 + heard[line][i]["s"] + (nudge[0] if nudge else 0)
        else:
            rel = at
        exact = frame_start[frame] + rel
        # a sound before its frame (a whoosh into a cut) belongs to the frame that is playing; pick
        # it from the unrounded time, or a sound on a cut lands in the frame before
        host = max(f for f, s in frame_start.items() if s <= exact + 1e-6)
        f = f"audio/sfx/{name}.mp3"
        offset = round(exact - frame_start[host], 3)
        sfx.append({"frame": host, "file": f, "offset_s": offset, "duration_s": round(dur(ROOT / f), 2), "volume": volume})
        cues["sfx"].append({"frame": host, "name": name, "offset_s": offset, "abs_s": round(exact, 3)})
    (A / "cues.json").write_text(json.dumps(cues, ensure_ascii=False, indent=2) + "\n")
    meta = {
        "bgm": {
            "path": "audio/music-bed.mp3",
            "volume": 1,
            "query": "ElevenLabs Music, 128 BPM Brazilian pop-funk launch bed from its first beat, ducked under the voices",
            "duration_s": total,
        },
        "bgm_pending": False,
        "voices": meta_voices,
        "sfx": sfx,
    }
    (ROOT / "audio_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    envelope()
    print(f"total {total}s")
    for f, c in cues["frames"].items():
        print(f"  frame {f} {c['name']:13} at {c['start_s']:7.3f}  {c['duration_s']:6.3f}s ({c['eighths']} eighths)")


def envelope(fps=30):
    # Caio's voice note: bubble waveform bars follow his loudness (30 fps, 0..1, frame 4 relative)
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", A / "frames/f04-voice.mp3", "-f", "s16le", "-ac", "1", "-ar", "48000", "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    c = json.loads((A / "cues.json").read_text())["frames"]["4"]
    s, e = c["lines"]["C01"]["start"], c["lines"]["C01"]["end"]
    w, n = 48000 // fps, int(round(c["duration_s"] * fps))
    rms = np.array([np.sqrt(np.mean(x[i * w : (i + 1) * w] ** 2)) if (i + 1) * w <= len(x) and s <= i / fps <= e else 0.0 for i in range(n)])
    env = np.clip(rms / np.percentile(rms[rms > 0], 95), 0, 1)
    env = np.round(np.convolve(env, [0.25, 0.5, 0.25], mode="same"), 3)
    out = {"fps": fps, "duration_s": c["duration_s"], "source": "audio/frames/f04-voice.mp3", "values": env.tolist()}
    (A / "f04-envelope.json").write_text(json.dumps(out))


if __name__ == "__main__":
    {"sfx": sfx, "voices": voices, "words": words, "mix": mix}[sys.argv[1]]()
