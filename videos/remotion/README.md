# Venduá videos in Remotion

The house toolchain for marketing videos since 2026-10-10 (the author's call, replacing
HyperFrames): **Remotion** for the picture (React, frame-driven animation, WebGL shaders),
**Tone.js** for the music and every sound effect, scored in code against the same timeline as the
picture. No voice, no third-party audio, no AI images.

## Layout

```
remotion.config.ts        browser, GL and encode settings
scripts/
  browser.mjs             which Chromium renders (cloud: Playwright's headless shell)
  render-audio.mjs        Tone.js score → offline render in Chromium → −14 LUFS WAV
  stills.mjs              stills at given seconds + one contact sheet
src/
  Root.tsx                one <Composition> per video
  lib/                    shared: brand tokens, fonts, grid, motion, WebGL, particles, phone, grain
  videos/<id>/
    timeline.ts           THE clock: scene spans, cue times, the SFX list (seconds)
    score.ts              Tone.js: music + SFX, placed from timeline.ts
    <Video>.tsx           the composition: world + scenes + audio
    scenes/*.tsx          one file per scene, each gets the global time `t`
public/                   fonts, brand marks, Duá poses, real admin captures (noite theme)
```

## Commands

```bash
cd videos/remotion && npm ci
npm run audio -- hype30            # public/hype30/score.wav (~90 s); --stems also writes music/sfx stems to out/
npm run studio                     # live preview at localhost:3000
node scripts/stills.mjs Hype30 0 3.8 15 28.5   # contact sheet in out/stills/
npm run render -- Hype30 out/hype30.mp4         # ~5 min for 30 s on 4 CPUs, software GL
npm run check                      # tsc
```

Render the audio before the studio or a render: the WAV is generated, not committed. Renders go in
`out/` (gitignored): send them to the author, don't commit MP4s.

## How a video is built

1. **Timeline first.** `timeline.ts` sets the BPM grid (128 BPM: a bar is 1.875 s, 16 bars are
   exactly 30 s), each scene's span, every cue time and the `SFX` list. Scenes import the times to
   animate, and `score.ts` imports the same times to play. Move a cue once and the picture and the
   sound move together. There is no separate step that copies cue times across.
2. **Score.** `score.ts` exports `score({ only })` and `duration`. It builds Tone.js instruments
   and schedules everything in absolute seconds. `render-audio.mjs` bundles it with esbuild, runs
   `Tone.Offline` in headless Chromium with `Math.random` seeded (same audio every run), then
   applies gain plus `alimiter` up to −14 LUFS. Balance the mix with `--stems`: measure each
   effect against the music in a short window after its cue. Effects within about 3 dB of the
   music are heard; at −12 dB they disappear.
3. **World.** One full-frame shader (`lib/shaders.ts` `LIQUID`) runs under the whole film at half
   resolution, so the background never cuts even when scenes do. Shocks on the hit list ripple it,
   and lime and night swap on the grid.
4. **Scenes.** Each scene is a `<Sequence>` and reads the global `t`. Animate only from `t`
   through `lib/motion.ts` (`tw`, `prog`, `kick`, `shake`). Use eases from `ease`, never CSS
   transitions.
5. **Check.** Run `stills.mjs` at the cuts and the key beats, look at the sheet, fix, then render.

## Rules (each one is a bug when broken)

- **Deterministic.** Remotion renders frames out of order across tabs. No `Math.random` (use
  `lib/random.ts` `rng(seed)`), no `Date.now()`, no state carried between frames. Everything comes
  from `t`.
- **WebGL.** Go through `lib/gl.tsx`. It sets `preserveDrawingBuffer` so the screenshot sees the
  frame, draws synchronously in a layout effect, and frees the context on unmount (Chromium keeps
  about 16). The cloud has no GPU: `swangle` (SwiftShader) is the default, and
  `REMOTION_GL=angle` is faster on a machine with one. Render smooth fields at `scale={0.5}`.
- **Fonts.** Space Grotesk and Figtree load through `lib/fonts.ts`, which holds rendering until
  they are in. Canvas-drawn text (the particle wordmark) waits on `fontsReady` too.
- **Stories safe area.** Readable copy goes in y 250–1560 and x 64–1016. Nothing readable goes in
  the bottom 360 px.
- **Copy.** Prices, plans and dates on screen come from `site/src/lib/content.ts` (decided copy)
  or the author. "Grátis" appears only as "14 dias grátis" (Bandeira, no card).
- **No strobes.** A full-frame colour flip happens once and holds, never repeated at sixteenths
  (photosensitivity, in an ad).
- **Real captures only.** Use the admin screens in `public/screens/` (from `site/` captures) and
  draw any UI in code with the brand tokens.

## Licence

Remotion is free for individuals and companies of up to three people. Larger companies need a
company licence (remotion.dev/license). Tone.js is MIT.

## New video

Copy `src/videos/hype30/` to `src/videos/<id>/`, rename the component, register it in `Root.tsx`,
then rewrite `timeline.ts` before touching any scene.
