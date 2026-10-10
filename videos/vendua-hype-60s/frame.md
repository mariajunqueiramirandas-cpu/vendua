---
name: Venduá — Hype 60 (Stories ad)
canvas: 1080x1920 @ 30fps, 60.000 s, 128 BPM (beat 0.46875 s, bar 1.875 s, 32 bars)
fonts:
  display: "'Space Grotesk', system-ui, sans-serif" # assets/fonts/space-grotesk-latin-wght-normal.woff2 (variable 300–700)
  body: "'Figtree', system-ui, sans-serif" # assets/fonts/figtree-latin-wght-normal.woff2 (variable 300–900)
  moment: "'Instrument Serif'" # assets/fonts/instrument-serif-latin-400-italic.woff2 — ONLY inside drawn app UI greetings, never headlines
palette:
  night: "#0a100d" # default background of the film
  forest: "#123c32" # brand green (ink on light, panels on night)
  forest-deep: "#0d2f27"
  spark: "#d9f875" # lime — the brand's one loud colour: slams, highlights, the check mark
  spark-soft: "#f0fcc9"
  cream: "#f7f4ea" # text on night; background of "day" frames
  surface: "#fffdf8" # cards / app surfaces
  muted-on-night: "#b9c6bf"
  ink-muted: "#4f6a5e"
  success: "#1f7a4d"
  whatsapp: "#25d366" # only on the WhatsApp header/send button inside the drawn chat
---

# Venduá — the film's design system (every frame-worker reads this first)

This is a 60-second, 9:16 **Instagram Stories ad** for Venduá: an online store + a phone app for
small food businesses (doceiras, marmitarias, hamburguerias, padarias), with **Duá**, an AI
seller that answers the store's customers on WhatsApp. Language: **pt-BR**. Fast, fluid, modern,
loud. It is watched with the **sound off** half the time, so the type carries the whole story; the
music (128 BPM, generated in code) is cut to the same grid as the visuals.

## Canvas, safe area, timing

- Stage 1080×1920. Stories UI covers the top ~220 px (profile row) and the bottom ~340 px (the
  ad's CTA button). **Every word that must be read sits in y 250–1560 and x 64–1016.**
  Backgrounds, devices and decoration may bleed full-frame.
- 128 BPM: beat = 0.46875 s, eighth = 0.234375 s, sixteenth = 0.1171875 s, bar = 1.875 s.
  The STORYBOARD gives every anchor in **track seconds**; subtract your frame's start.
- Hard hits are 0 ms (`tl.set`). Entrances that must _land_ on a beat start 60–120 ms early.
  Nothing on screen sits still for more than ~0.5 s except the plan cards and the end card:
  something always breathes (slow 2–4 % scale drift, a parallax layer, a ticker).

## Type

- Headlines: Space Grotesk **700**, `letter-spacing: -0.045em`, `line-height: 0.9`, lowercase-first
  sentence case (never ALL CAPS), cream on night or forest on lime/cream. Hero sizes 150–230 px;
  a one-word slam can go to 300 px. Max 3 lines; break lines by hand (`<br>`), never let the
  browser wrap a headline.
- Secondary lines: Figtree 600, 52–64 px, `muted-on-night` on night, `ink-muted` on cream.
- Small labels: Figtree 600, 34–40 px. Nothing smaller than 30 px outside the drawn app UI.
- The brand mark: the check stroke `M32 48 L61 88 L98 34` (viewBox 0 0 128 128, stroke-width 17,
  round caps/joins, lime) + the word **venduá.** in Space Grotesk 700, `letter-spacing:-0.035em`,
  with the final **.** in lime. Copy this exact path; never use `assets/brand/wordmark-*.svg`
  (they need a font we don't load).
- Load fonts with `@font-face` inside your `<template>`'s `<style>`:
  `font-family:'Space Grotesk'; src:url('../../assets/fonts/space-grotesk-latin-wght-normal.woff2') format('woff2'); font-weight:300 700;`
  and `font-family:'Figtree'; src:url('../../assets/fonts/figtree-latin-wght-normal.woff2') format('woff2'); font-weight:300 900;`
  Paths are relative to `compositions/frames/` (use `../../assets/...`).

## The look

- **Night is home.** Default background `night` with one soft, fixed radial glow of `forest`
  (e.g. `radial-gradient(1200px 900px at 50% 38%, #123c32 0%, #0a100d 70%)`). Add the shared
  film grain: an absolutely positioned full-stage `<svg>` with `feTurbulence` (baseFrequency 0.9,
  numOctaves 2, stitchTiles) at `opacity:.07; mix-blend-mode:overlay`. Static — never animate the seed.
- **Lime slams.** On the drops (22.5, 41.25) and on big claims, the whole stage flips to `spark`
  with `forest` type for 0.3–2 s (0 ms flip, `palette-flip` / `flash-cut`). That flip is the
  film's signature: use it only where the storyboard says.
- **The lime marker**: an emphasized word can sit on a lime block (`background: spark; color:
forest; padding: 0 .12em; border-radius: .12em`) that wipes in left→right (`scaleX` 0→1 from the
  left, 0.18 s, `power3.out`). At most one marked word per headline.
- **Devices are real.** The product appears as the real admin screenshots in
  `assets/screens/<name>-<creme|noite>-750.webp` (750×1624) inside the CSS phone below, or as UI
  drawn in code that mirrors the real app (the chat, the lock-screen push, the kitchen board, the
  receipt, the loyalty card, the storefront). Never invent screens that contradict the real ones;
  never use photos, people, emoji or stock icons.
- **Duá** is the only character: `assets/dua/avatar-ola.webp` (waving), `avatar-pensando.webp`
  (thinking), `avatar-feliz.webp` (happy), `boas-vindas.webp`, `sucesso.webp`, `pagamento.webp`,
  `entrega.webp`, `loja.webp`, `catalogo.webp`. Never mirror, recolour or crop him through the
  face. He usually sits on a lit disc (`spark` circle) when shown as an avatar. He is masculine:
  "o Duá".

### The phone (identical in every frame — copy this)

```html
<div class="phone" style="--pw:600px">
  <!-- width drives everything -->
  <div class="phone-body">
    <div class="phone-screen">
      <span class="phone-island"></span>
      <img src="../../assets/screens/inicio-creme-750.webp" />
      <!-- or drawn UI -->
    </div>
  </div>
</div>
```

```css
.phone {
  width: var(--pw);
  aspect-ratio: 600/1290;
  position: absolute;
}
.phone-body {
  position: absolute;
  inset: 0;
  padding: calc(var(--pw) * 0.032);
  border-radius: calc(var(--pw) * 0.16);
  background: linear-gradient(150deg, #34413b 0%, #121a16 45%, #0b100d 100%);
  box-shadow:
    inset 0 0 0 2px rgb(255 255 255 / 0.16),
    0 0 0 1px rgb(255 255 255 / 0.06),
    0 40px 90px rgb(0 0 0 / 0.55);
}
.phone-screen {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: calc(var(--pw) * 0.13);
  background: #f7f4ea;
}
.phone-screen > img {
  width: 100%;
  display: block;
} /* screenshots already include the app's own top bar */
.phone-island {
  position: absolute;
  z-index: 5;
  top: calc(var(--pw) * 0.026);
  left: 50%;
  width: 30%;
  height: calc(var(--pw) * 0.074);
  transform: translateX(-50%);
  border-radius: 999px;
  background: #050807;
}
```

The 750×1624 screenshot at 560 px wide is 1213 px tall, the screen ~1214 px: it fills it. To
"scroll" a screen, translate the `<img>` up. Tilt phones in 3D with a parent `perspective:2400px`
and small `rotateY/rotateX` (≤ 14°); never more than one tilted phone on screen at once.

### Drawn app UI — use the app's own tokens

surface `#fffdf8`, bg `#f7f4ea`, ink `#123c32`, muted `#4f6a5e`, line `rgb(18 60 50 / .12)`,
primary button `#123c32` with `#fffdf8` text, chip "Novo" `#f0fcc9`, radius 16–24 px, Figtree.
Money is always `R$ 45,00` style (comma decimals, a space after `R$`).

## Motion vocabulary (use these; they are what makes the film one piece)

1. **Slam** — a word/line arrives at scale 1.18→1, `filter: blur(14px)`→0, opacity 0→1 in 0.16 s
   `power4.out`, landing exactly on its anchor (start it ~0.06 s early). Stack slams line by
   line, one per beat or eighth.
2. **Word swap** — 0 ms `tl.set` text/visibility swaps on beats (`content-swap`).
3. **Whip** — devices and big blocks enter/exit with a fast translate (300–900 px) +
   `blur(10px)` + slight skew, 0.22–0.3 s, `expo.out` in / `expo.in` out.
4. **Punch-in** — the camera wrapper (a `#cam` div holding everything but the grain) scales
   1→1.06 over a beat on a downbeat, then eases back over the bar. At most one per bar.
5. **Shake** — only on the drops (track 0.0, 3.75, 22.5, 41.25, 52.5): `#cam` jitters ±8 px /
   ±0.6° for 0.25 s with deterministic offsets (a fixed array, not `Math.random`).
6. **Lime wipe** — a full-height lime band skewed −12° crosses the stage left→right in 0.24 s;
   use it to change scenes inside a frame where the storyboard says "wipe".
7. **Count-up** — numbers roll (tl.to on a proxy object, `onUpdate` writes formatted text, and
   the final value is set with `tl.set` at the lock anchor so seeking is exact) and lock on a
   downbeat with a tiny 1.08→1 punch.

Everything is seek-safe: one paused GSAP timeline, built synchronously, no `Math.random`, no
`Date`, no CSS animations/transitions, no `requestAnimationFrame`, no `setTimeout`.

## Avoid (these read as generic AI motion — do not do them)

- Glassmorphism cards, purple/blue gradients, floating blurred blobs, lens flares, sparkles,
  confetti, particle bursts, pulsing dots, emoji, stock icons, 3D-rendered characters.
- Everything fading up from y+40 in sequence. Use slams, swaps and whips instead.
- Centered grids of identical cards. All-caps eyebrow labels above headlines. Drop shadows on text.
- Text over a busy screenshot without a solid plate. Tiny text. Rotating type for no reason.
- Holding a static layout for a whole bar with nothing moving.

## Copy rules (company decisions — do not change any copy in the storyboard)

- Brand: **Venduá** (capital V in sentences, the mark is lowercase **venduá.**). The AI is **o Duá**,
  "o vendedor com IA no WhatsApp da loja"; never call him "o Vendedor", never a person.
- The store in every screen is the fictional **Bolos da Nena** (owner Nena). Use only the numbers
  the storyboard gives (they match the screenshots).
- The only "grátis" allowed is "14 dias grátis". Never "sem taxa(s)", never "em breve".
