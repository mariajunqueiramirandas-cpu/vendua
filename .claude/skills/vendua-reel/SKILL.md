---
name: vendua-reel
description: Make a Venduá marketing video (Instagram Reel/Story, promo, feature or trial ad) with Remotion and a Tone.js score (videos/remotion/). Use whenever a Venduá video is requested or an existing one under videos/ is changed, and before generating any voice, music or sound effect for it — it sets the house defaults (frenético pace, "Vendu-á" pronunciation, 128 BPM grid, music and SFX scored in code) and asks the author before any voice is generated.
---

# Venduá Reels

New videos are built in **`videos/remotion/`** (Remotion + Tone.js, the author's call on
2026-10-10). Read `videos/remotion/README.md` first; `videos/README.md` keeps the house defaults and
the findings from the HyperFrames videos, which still apply to pace, copy and sound.

## Route

1. Copy `videos/remotion/src/videos/hype30/` to `src/videos/<id>/`, register it in `src/Root.tsx`.
   Don't load the HyperFrames workflows for a new video; `videos/vendua-hype-60s/` is the last
   HyperFrames project, kept for reference.
2. Write `timeline.ts` first (grid, scene spans, cues, the `SFX` list), then `score.ts`, then the
   scenes. Picture and score import the same times.

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
- Sound effects are the premium set: soft, tonal UI sounds, one per moment, in the track's key,
  each on the time of the motion it belongs to (the `play` table in `hype30/score.ts`: FM glass
  bells, pitched sine pops, filtered-noise swishes, a sub bloom on the hits).
- Read every line as a stranger would before generating it: a verb like "chega" can sound like
  Venduá delivers. Say where the order lands (the shop's phone), not how it travels.
- Real captures only; prices, plans and dates on screen are the author's decision.

## Audio source

- Music and SFX: **Tone.js, scored in code** (`score.ts`, `npm run audio -- <id>`), the default
  since 2026-10-10. Ask the author only to change it.
- Voices (narrator, customer): still **not chosen**. Ask the author before generating any, and
  record the answer in the video's folder. Never reuse a provider key or voice ID from an older commit.

## Order of work

Timeline (grid, spans, cues, copy from `site/src/lib/content.ts`) → `score.ts` → `npm run audio --
<id> --stems` and balance each effect within ~3 dB of the music → World + scenes, one at a time,
each checked with `node scripts/stills.mjs <Comp> <seconds…>` → `npm run draft` if the motion needs a
look → full render to `out/` (about 7 min; stay in the turn while it runs, because an idle cloud
container crawls) → send it to the author (re-encode under 30 MB to send). Renders aren't committed. You write the scenes yourself (UI work is Opus-grade per the
repo `CLAUDE.md`).
