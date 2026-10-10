---
name: vendua-reel
description: Make a Venduá marketing video (Instagram Reel/Story, promo, feature or trial ad) with HyperFrames. Use whenever a Venduá video is requested or an existing one under videos/ is changed, and before generating any voice, music or sound effect for it — it sets the house defaults (frenético pace, "Vendu-á" pronunciation, 128 BPM grid) and asks the author to choose the voice, music and SFX source before any audio is made.
---

# Venduá Reels

The playbook is `videos/README.md`: read it first. This skill is the checklist.

## Route

1. Load `/hyperframes`, then the `product-launch-video` workflow, as usual: its steps, scripts and
   gates still apply. This skill only overrides its defaults and its audio path.
2. Start the project by copying from `videos/vendua-audio-47s/`: `frame.md` (Venduá tokens at Reel
   scale, Reels safe area), `.hyperframes/caption-skin.html` (caption band y 1300–1520),
   `assets/vendor/gsap.min.js`, `assets/fonts/`, `scripts/build-audio.py`. Then edit them.

## Defaults (ask only to change them)

- 1080×1920, pt-BR, 25–30 s, **frenético**: cuts on a 128 BPM eighth-note grid, 0.2 s slams,
  punch-ins and shakes, no hold over ~0.5 s except the end card (~1.2 s, the CTA must read).
- Narrator and customer voices: **not chosen**. Ask the author which voices to use before generating.
- **The voice sets the pace**: generate the lines first, then size each frame to its line (voice +
  short lead/tail, rounded up to whole eighths). Never speed a take up or cut it to fit a planned
  frame; if it is too slow, generate a faster take or trim words.
- The brand is said **ven-du-Á**: spell it `Vendu-á` in every TTS prompt (`Ven-du-á` on
  a TTS model that says "Vendu-á" as "Van-duá" at a sentence start or before a plan name, where
  `Ven-du-á` is safer) and have the author hear one line with it before generating the rest.
- Sound effects are the premium set: soft, tonal UI sounds mixed low under the voice, one per
  moment, an accent (never an impact) on the logo. Prompts and processing are in
  `videos/README.md` → Premium SFX; `scripts/build-audio.py sfx` rebuilds them from the takes.
- Read every line as a stranger would before generating it: a verb like "chega" can sound like
  Venduá delivers. Say where the order lands (the shop's phone), not how it travels.
- Real captures only; prices, plans and dates on screen are the author's decision.

## Audio source: ask first

- Before any voice, music or SFX is generated, ask the author which provider and voices to use, and
  record the answer in the project's `BRIEF.md`. Never reuse a provider key, a voice ID or a tool
  from an older commit.
- Save raw takes in the project's gitignored `audio/takes/`. Batch 3–4 calls at a time, run them in
  one shell (a trailing `&` loses `cd` and `export`).

## Order of work

Brief → voice + pronunciation test → all lines → Whisper words mapped onto the script →
`build-audio.py voices`/`mix` (bed on its first beat, frame lengths from the voice lengths rounded up to whole eighths, SFX on words) →
storyboard with numeric seams → one Haiku agent per frame at `xhigh` from a shared brief file (tell them to
wrap their browser checks in `timeout 120`; a hung agent can be stopped and its frame finished by
hand) → `videos/tools/build-reel.sh <project> --bpm 128 --snapshots <dir>` (assembly, checks and
the cut check in one command; it must pass) → look at the cut snapshots → draft render to the
author → final render, −14 LUFS with gain + limiter, commit `renders/<name>.mp4`. The gotchas list
in `videos/README.md` covers the failures each step hit last time.
