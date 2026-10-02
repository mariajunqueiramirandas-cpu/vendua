# Checks that nothing crosses a cut in an assembled Reel project (stdlib only):
#
#   python videos/tools/cutcheck.py videos/<project> [--bpm 128]
#
# Reads audio/cues.json (the frame schedule), audio_meta.json, caption_groups.json and index.html,
# and fails when a voice word, a caption or an SFX start falls outside its frame, a caption shows on
# a caption-free frame (`words: []`), index.html mounts a frame off the schedule, or (with --bpm) a
# frame is not a whole number of eighth notes. Each of these shipped once on vendua-audio-47s. A
# caption carried over a cut into another captioned frame is only a warning.
import json
import re
import sys
from pathlib import Path

EPS = 0.002  # index.html writes starts with 3 decimals


def main(root, bpm=None):
    root = Path(root)
    cues = json.loads((root / "audio/cues.json").read_text())
    meta = json.loads((root / "audio_meta.json").read_text())
    groups = json.loads((root / "caption_groups.json").read_text())["groups"]
    frames = {int(k): (v["start_s"], v["start_s"] + v["duration_s"]) for k, v in cues["frames"].items()}
    bad = []

    if bpm:
        eighth = 30 / bpm
        for f, v in cues["frames"].items():
            n = v["duration_s"] / eighth
            if abs(n - round(n)) > 1e-6:
                bad.append(f"frame {f}: {v['duration_s']} s is {n:.3f} eighths, not a whole number")

    for f, v in cues["frames"].items():
        for w in v["words"]:
            if w["start"] < 0 or w["end"] > v["duration_s"] + EPS:
                bad.append(f"frame {f}: word {w['text']!r} {w['start']}-{w['end']} s outside 0-{v['duration_s']}")

    silent = {v["frame"] for v in meta["voices"] if not v["words"]}
    warn = []
    # the caption skin holds a group 0.3 s past its end (clipped by the next group's start), and the
    # last group to its own end: what is visible must stay inside the group's own frame
    for i, g in enumerate(groups):
        s, e = frames[g["frame"]]
        shown = g["end"] if i == len(groups) - 1 else min(groups[i + 1]["start"], g["end"] + 0.3)
        if g["start"] < s - EPS:
            bad.append(f"caption {g['text']!r} starts at {g['start']} s, before frame {g['frame']} ({s:.3f})")
        elif shown > e + EPS:
            # into a caption-free frame (the end card) it is a bug; into the next captioned frame, during
            # its transition, it is a one- or two-frame carry-over worth knowing about
            into = next((f for f, (fs, fe) in frames.items() if fs <= e + EPS < fe), None)
            msg = f"caption {g['text']!r} shows until {shown:.3f} s, {shown - e:.3f} s past the cut into frame {into}"
            (bad if into in silent else warn).append(msg)
    for g in groups:
        if g["frame"] in silent:
            bad.append(f"caption {g['text']!r} sits on caption-free frame {g['frame']}")

    for x in meta["sfx"]:
        s, e = frames[x["frame"]]
        if not 0 <= x["offset_s"] < e - s:
            bad.append(f"sfx {x['file']} at {x['offset_s']} s lies outside its host frame {x['frame']}")

    html = (root / "index.html").read_text()
    # a frame may run past its cut by its outgoing transition, so only the mount start is checked
    for m in re.finditer(r'data-composition-src="compositions/frames/0?(\d+)-[^"]*"\s+data-start="([\d.]+)"', html):
        f, start = int(m[1]), float(m[2])
        if abs(start - frames[f][0]) > EPS:
            bad.append(f"index.html mounts frame {f} at {start}, the schedule starts it at {frames[f][0]:.3f}")
    if "cdn.jsdelivr.net" in html:
        bad.append("index.html still loads GSAP from the CDN")

    for w in warn:
        print("!", w)
    for b in bad:
        print("✗", b)
    print(f"cutcheck: {len(frames)} frames, {len(groups)} captions, {len(meta['sfx'])} sfx, {len(warn)} warnings — {'FAIL' if bad else 'ok'}")
    return 1 if bad else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    bpm = None
    if "--bpm" in args:
        i = args.index("--bpm")
        bpm = float(args[i + 1])
        del args[i : i + 2]
    sys.exit(main(args[0], bpm))
