# Shared brief — frame builders, Venduá launch Reel

Read this whole file first, then `.hyperframes/frame-packets/_role.md` (your role), then your packet
`.hyperframes/frame-packets/<frame_id>.md` (your frame's storyboard block, blueprint, motion
recipes), then `frame.md` (the look). PROJECT_DIR = `/home/user/vendua/videos/vendua-lancamento`.
Canvas 1080×1920, 30 fps. Captions: enabled on frames 1–8 (band y 1300–1520), disabled on 9.

## Your write boundary

Edit ONLY `compositions/frames/<frame_id>.html`. Scratch files go in `/tmp/<frame_id>/`. Never edit
STORYBOARD.md, frame.md, index.html, audio, assets or another frame; never run `transitions.mjs`,
`assemble-index.mjs`, `hyperframes render`, or anything that rewrites shared files. If you think
something outside your file is wrong, say so in your final report.

## The story and its numbers (never invent others)

One order runs through the film: Caio's voice note → order **#30**, 1× Bolo de cenoura com
brigadeiro R$ 45,00 + 1× Fatia de chocolate R$ 9,50 + entrega R$ 8,00 = **R$ 62,50**, Pix. The store
is Bolos da Nena; its link is `bolosdanena.vendua.com.br`. Duá is always "o Duá". The push is Core's
real text: title "Pedido #30 chegou", body "Caio · R$ 62,50 · entrega", action "aceitar", app
"Minha loja". The screenshots in `assets/screens/` are the product; their contents are described in
`capture/extracted/asset-descriptions.md` (asset names there use `duá-`; the staged copies are
`dua-`). Open the images you use (Read them) and measure the exact pixel boxes of whatever the
camera punches into or a ring circles — never guess coordinates.

## Timing

`audio/cues.json` → `frames["<n>"]` has your frame's `duration_s`, every word's frame-relative
`start`/`end`, and `sfx` (offsets). The Scene times in your packet are those word starts. Reveal on
them (an arrival may start up to 0.04 s early so it lands on the word). Your timeline must be exactly
`duration_s` long (pad with a no-op `tl.set({}, {}, duration)` at the end). Frame 4 also has
`audio/f04-envelope.json` (30 fps loudness 0..1 of Caio's voice, frame-relative) for the listening
bars — inline the values you need into your file (no fetch at runtime: determinism).

## Shared geometry (exact; these make the cuts seamless)

- **Feature header** (frames 2–8, once the title compacts; frames 3, 5, 6, 8 have it from frame 0):
  a lime (`spark`) disc 92×92 at x 72, y 250 with the numeral (Space Grotesk 600, 58 px, `ink`,
  centered); the feature name at x 188, vertically centered on the disc (center y 296), Space Grotesk
  600, 60 px, letter-spacing −0.03em, `ink`. Names: 1 "Loja no ar", 2 "O Duá vende", 3 "A cozinha vê".
  The big title state that compacts into it (frames 2, 4, 7) is yours to design (disc 300 px at x 72,
  y 300 is the storyboard's start), but its end state must equal this header exactly.
- **PHONE box** (the shop's/customer's phone on frames 3–7): outer x 289, y 372, width 434, height
  908, frame.md `device`: bezel `linear-gradient(150deg, #34413b 0%, #121a16 45%, #0b100d 100%)`,
  padding 13.9 px (3.2%), outer radius 69 px (16%), screen 406.2×879.6 at radius 56 px (13%), island
  pill 130×34 centered 14 px from the screen top (`#0b100d`), shadow `device`. The screenshot fills
  the screen at native aspect (750×1624 → 406.2×879.6; 1 screenshot px = 0.5416 css px).
- **Camera inside a screen**: the screen clips (`overflow: hidden`); inside it a `cam` wrapper holds
  the screenshot(s); punch-ins scale/translate `cam` with `transform-origin: 0 0` and an explicit x/y
  computed from the measured target box so the target lands centered in the screen. Back to 1× means
  x 0, y 0, scale 1. Screen swaps happen inside `cam` (stack the shots, cross-swap by opacity + a
  short y slide as the storyboard says).
- **Tap ring**: a 72 px circle, 6 px `spark` border with a 2 px `ink` outer edge, at the target's
  center: scale 0.4→1.5 and opacity 1→0 over 0.35 s, plus the target presses (scale 0.94, 0.08 s,
  back 0.14 s). No cursor, no hand.
- **Lime ring** (circling a real UI element): a rounded rect 6 px `spark` stroke with a 2 px `ink`
  outline, 10 px larger than the measured box on every side, radius matched; snaps in (scale
  1.15→1, opacity 0→1, 0.15 s) with a ≤8 px shake of the whole device.
- **spark-chip**: `spark` pill, `on-spark` text, Figtree 650 at 38 px, padding 14 px 28 px, radius
  999, shadow e1. A "surface chip" is the same in `surface` with a 6 px `spark` left edge.
- **Mini device** (frame 1 only): the same device CSS scaled to the given width.
- **Tablet** (frame 8): frame.md `tablet`: 868 px wide at x 72, y 380; padding 20.8 px (2.4%), outer
  radius 43 px, screen 826.4×516.5 at radius 31 px, the same bezel and shadow, no island; screenshot
  2560×1600 fills it (1 px = 0.3228 css px).
- **Paper grain**: frame.md `paper-grain`, static, on the cream ground clip (copy the reference
  frames' inline SVG filter).

## Motion grammar (frenético; frame.md motion system at speed)

Arrivals 0.18–0.28 s `expo.out`/`power4.out` from scale ~1.12 or a 60–120 px drop, shadow e2→e1 in
the same window; punch-ins on stressed words 1→1.05 in 0.1 s, back in 0.25 s (`power2.out`); shakes
as a fixed decaying offset sequence (e.g. x 10,−8,5,−3,0 / rotation 0.6,−0.4,0.2,0 over 0.25 s);
camera punch-ins 0.24–0.3 s `expo.out`, camera returns 0.25 s `power3.inOut`. Never back/elastic/
bounce eases. Only transform and opacity. Every entrance is a `fromTo`. Something moves on every
beat; nothing holds still > ~0.6 s (frame 9's end hold excepted). No exits at the end of a frame:
the next frame cuts in over you.

## Reference implementation

`videos/vendua-audio-47s/compositions/frames/` (the last Reel, same design system) shows the
working patterns: template shape, `#root` styling, ground clip with grain, fonts `@font-face`
(`assets/fonts/captured-*.woff2`), vendored GSAP (`<script src="assets/vendor/gsap.min.js">` inside
the template — never a CDN), the CSS phone, the push card (`05-pedido-chega.html`), the end card
(`06-14-dias.html`), shakes and punch-ins. Copy patterns, not ids: prefix every id/class with your
frame_id.

## Checking your frame (wrap every browser run in `timeout 120`)

You can't run the project CLI on your frame alone. To look at it: write `/tmp/<frame_id>/test.html`
with `<base href="file:///home/user/vendua/videos/vendua-lancamento/">`, a 1080×1920 body, the
contents of your `<template>` pasted in, and a script that, after fonts load, seeks
`window.__timelines["<frame_id>"]` (`tl.seek(t)`) — then shoot stills with Playwright (the module is
at `/home/user/vendua/node_modules/.bun/playwright-core@1.63.0/node_modules/playwright-core/index.mjs`,
Chromium at `/opt/pw-browsers/chromium`, launch with `--allow-file-access-from-files`) at each
Scene's landed moment and look at them (Read). Keep it to one script run per iteration; never return
GSAP objects from `page.evaluate`. If a browser run hangs, kill only its own pid.

## Final report (under 150 words)

The file written, its timeline length, the stills you checked, and anything you could not do or
think is wrong outside your file.
