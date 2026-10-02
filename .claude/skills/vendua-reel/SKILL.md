---
name: vendua-reel
description: Make a Venduá marketing video (Instagram Reel/Story, promo, feature or trial ad) with HyperFrames and ElevenLabs. Use whenever a Venduá video is requested or an existing one under videos/ is changed, and before generating any voice, music or sound effect for it — it sets the house defaults (frenético pace, Bruna da Costa + Talis, "Vendu-á" pronunciation, 128 BPM grid) and routes all ElevenLabs work through the API key instead of the MCP connector.
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
- Narrator **Bruna da Costa** (`AKXBn24T1f9tvTDnWzWT`), customer voices **Talis**
  (`E9a8LlXPNWtyvvSoZzrb`), model `eleven_v3` with tags such as `[energetic, fast]`.
- The brand is said **ven-du-Á**: spell it `Vendu-á` in every TTS prompt and have the author hear
  one line with it before generating the rest.
- Real captures only; prices, plans and dates on screen are the author's decision.

## ElevenLabs = the API key

- Requires `ELEVENLABS_API_KEY` in the environment (the cloud environment's secret). If it is
  missing, tell the person to add it in the environment settings under that name, and do not ask
  them to paste it into the chat. Never write it into a file in the repo.
- Generate with `python videos/tools/elevenlabs.py` (`tts`, `sfx`, `music`, `whoami`). Batch 3–4
  calls at a time, run them in one shell (a trailing `&` loses `cd` and `export`), and save raw
  takes in the project's gitignored `audio/takes/`.
- Do not use the ElevenLabs MCP connector for Venduá videos: its account is the free tier and gets
  flagged from cloud sessions. The vendored `audio.mjs` ElevenLabs path is limited to
  `eleven_multilingual_v2` (no audio tags), so it is a fallback only.

## Order of work

Brief → voice + pronunciation test → all lines → Whisper words mapped onto the script →
`build-audio.py voices`/`mix` (bed on its first beat, frames in whole eighths, SFX on words) →
storyboard with numeric seams → one Opus agent per frame from a shared brief file → assemble,
local GSAP, transitions, `hyperframes check`, snapshots → draft render to the author → final
render, −14 LUFS with gain + limiter, commit `renders/<name>.mp4`. The gotchas list in
`videos/README.md` covers the failures each step hit last time.
