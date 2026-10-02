---
version: alpha
name: Venduá — Frame (Reel, 1080×1920)
description: >
  Venduá's own design system at video scale, for one 9:16 Instagram Reel. Seeded from the
  blue-professional preset by build-frame.mjs, then rewritten by hand because the brand's roles
  don't map onto a one-accent deck: forest is the voice, lime is electricity (rare, only where
  something is alive or new), warm paper with soft forest-tinted depth. Source of truth:
  apps/admin/src/ui/theme.css (copied in site/src/lib/styles/theme.css) and
  docs/merchant-admin-design.md §4–§5, §9; site/README.md "Visual rules".
unit: the frame — 1080×1920 (9:16) only
principle: paper and light · forest is the voice · lime only where something is alive · numbers come from the screens

colors:
  canvas: "#f7f4ea"
  ink: "#123c32"
  surface: "#fffdf8"
  surface-sunken: "#efe9d8"
  ink-muted: "#4f6a5e"
  line: "rgba(18, 60, 50, 0.12)"
  line-strong: "rgba(18, 60, 50, 0.2)"
  spark: "#d9f875"
  spark-soft: "#f0fcc9"
  on-spark: "#123c32"
  novo-ink: "#2f4a00"
  night: "#0a100d"
  night-surface: "#131d18"
  night-ink: "#f7f4ea"
  night-muted: "#9dafa4"
  success: "#1f7a4d"

radii:
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  full: "999px"

shadows:
  e1: "0 1px 2px rgb(18 60 50 / .06), 0 4px 16px rgb(18 60 50 / .05)"
  e2: "0 2px 4px rgb(18 60 50 / .08), 0 12px 32px rgb(18 60 50 / .10)"
  e3: "0 8px 16px rgb(18 60 50 / .10), 0 24px 64px rgb(18 60 50 / .16)"
  device: "inset 0 0 0 1.5px rgb(255 255 255 / .08), 0 8px 16px rgb(18 60 50 / .12), 0 30px 70px rgb(18 60 50 / .22)"

typography:
  # display + numerals: Space Grotesk 600–700, tight; body + UI: Figtree; moments: Instrument Serif italic
  hero: { fontFamily: "Space Grotesk Variable", cqw: 11.5, weight: 600, lineHeight: 1.02, tracking: "-0.035em", color: "ink" }
  title: { fontFamily: "Space Grotesk Variable", cqw: 8.2, weight: 600, lineHeight: 1.06, tracking: "-0.03em", color: "ink" }
  subtitle: { fontFamily: "Space Grotesk Variable", cqw: 5.6, weight: 600, lineHeight: 1.15, tracking: "-0.02em", color: "ink" }
  numeral: { fontFamily: "Space Grotesk Variable", cqw: 9.0, weight: 600, lineHeight: 1.0, tracking: "-0.02em", color: "ink", tnum: true }
  moment: { fontFamily: "Instrument Serif", cqw: 8.6, weight: 400, italic: true, lineHeight: 1.05, color: "ink" }
  body: { fontFamily: "Figtree Variable", cqw: 4.4, weight: 500, lineHeight: 1.35, color: "ink-muted" }
  label: { fontFamily: "Figtree Variable", cqw: 3.9, weight: 650, lineHeight: 1.2, color: "ink" }
  caption: { fontFamily: "Figtree Variable", cqw: 6.0, weight: 750, lineHeight: 1.15, tracking: "-0.01em", color: "ink" }
  meta: { fontFamily: "Figtree Variable", cqw: 3.3, weight: 500, lineHeight: 1.2, color: "ink-muted", tnum: true }

spacing:
  gutter: "6.7cqw" # 72px on 1080
  safe-top: "12.5cqh" # Reels top bar (profile, audio) — 240px
  safe-bottom: "20cqh" # Reels caption + buttons — 384px; nothing load-bearing below 80% height
  safe-right: "13cqw" # Reels action column (like/comment/share) — 140px on the right edge
  grid: "4px base: 4 8 12 16 20 24 32 40 56 72"

components:
  voice-note:
    backgroundColor: "{colors.surface}"
    rounded: "{radii.xl} {radii.xl} {radii.xl} {radii.sm}"
    shadow: "{shadows.e2}"
    parts: "round play button (ink fill, cream triangle) · waveform of ~44 rounded bars (ink-muted at rest; played part ink; the bar under the playhead spark-highlighted) · duration in meta tnum ("0:47", counting) · small avatar dot of the sender (initials only, no photo)"
    description: "Generic chat voice-note bubble drawn in Venduá"s paper language. Never WhatsApp"s green, tail, ticks, layout or icons; no app chrome around it."
  device:
    frame: "CSS phone like site/src/lib/components/Phone.svelte — bezel linear-gradient(150deg, #34413b 0%, #121a16 45%, #0b100d 100%), padding 3.2% of width, outer radius 16% of width, screen radius 13%, island pill 30% wide, shadow {shadows.device}"
    screen: "a real admin screenshot (assets/screens/*-750.webp, 750×1624) at its native aspect, never cropped into a fake UI, never redrawn"
    size: "about 70% of the frame height when it is the focal"
  push:
    backgroundColor: "rgba(255, 253, 248, 0.86) + backdrop blur"
    rounded: "{radii.lg}"
    shadow: "{shadows.e3}"
    content: "app "Minha loja" + the Venduá mark, title "Pedido #29 chegou", body "Luiz · R$ 219,00 · entrega", one action "aceitar" — Core's real push text only"
  spark-chip:
    backgroundColor: "{colors.spark}"
    textColor: "{colors.on-spark}"
    rounded: "{radii.full}"
    description: "Lime pill with forest text: the one way lime carries words (a keyword landing, the trial line). Lime text on cream is never allowed."
  primary-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{radii.md}"
    description: "Forest button with cream label, lowercase-first ("criar minha loja")."
  logo:
    parts: "the check mark (one stroked path M32 48 L61 88 L98 34, round caps, stroke 17 on a 128 box — assets/brand/mark-*.svg) + "venduá." in Space Grotesk 700, letter-spacing -0.035em; on night the mark and the final dot are spark"
  paper-grain:
    description: "2–3% noise on the cream canvas via one inline SVG feTurbulence filter, static (seeded), never animated. Off on night."
---

# Venduá — Frame (Reel, 1080×1920)

## Brand adaptation (read first; the frontmatter is the source of truth)

Seeded from the **blue-professional** preset by `build-frame.mjs` (its cream ground, pill chrome and
Space Grotesk carried over), then rewritten by hand. The preset is a one-accent consulting deck, and
the remix made lime the text accent and Space Grotesk the body face; Venduá's system needs forest
as the voice, lime only as a fill, Figtree for body, and no uppercase eyebrows. Everything below is
Venduá's, from `docs/merchant-admin-design.md` and `site/README.md`.

## The idea: paper and light

Surfaces are warm paper (cream) stacked with soft, believable depth; the store's content (real
screens, names, prices) sits on top at full strength. **Forest** (`ink`, `#123c32`) is the voice of
the brand: headings, numerals, buttons. **Lime is electricity** (`spark`, `#d9f875`): it appears
only where something is alive or new — the voice note while it plays, the word being spoken, a new
order, the free-trial line. Because lime is rare, it always means something. Lime is always a fill
behind forest text, never text on cream.

**Noite** (`night`) is available for one contrast moment (the closing card): there lime becomes the
primary color, cream is the ink, and depth comes from lighter surfaces, not shadows.

## The frame

- 1080×1920, `container-type: size` on every frame ground; frame-relative units are `cqw`/`cqh`.
- **Reels safe area** (the platform's own UI sits on top): keep everything load-bearing between
  `safe-top` (12.5% height) and `safe-bottom` (bottom 20%), and clear of the right action column
  (`safe-right`, 13% width). Captions sit above the bottom 20%, never under the action column.
- Gutter 72 px. 4 px grid. Nested radius = outer − padding, so corners stay concentric.
- Legibility floor: anything load-bearing ≥ 3.3cqw (36 px); captions ≥ 6cqw.

## Typography

Three voices, each with one job:

- **Space Grotesk Variable** 600: headlines and numerals (`R$ 45,00`, `#29`, `0:47`), tight tracking
  (−0.02 to −0.035em), tabular numerals where they line up or change.
- **Figtree Variable**: body, labels, captions. Warm, round, full pt-BR diacritics.
- **Instrument Serif italic**: moments only (a greeting, a celebration). At most once in the video.

Sentence case everywhere; buttons and labels lowercase-first ("aceitar", "criar minha loja"). No
all-caps, no eyebrow labels above headings, no single italic or highlighted word inside a headline
(a lime chip carries a whole short line instead), no sparkle bullets, no pulsing dots.

## Depth and shape

Depth is light, not lines: the three forest-tinted shadows `e1`–`e3`, never grey, never hard offsets.
Radii 10 / 16 / 24 / 32 / full. Hairlines are `line` (forest 12%). The device frame is the site's CSS
phone. Paper grain on cream, static.

## Motion (the brand's own system)

Motion explains what happened; it is never decoration. Only transform and opacity animate.

- `quick` 180 ms and `smooth` 280 ms on `cubic-bezier(.2,.8,.2,1)`; `spring` (stiffness 380,
  damping 30) for arrivals — a card or a screen settling in; `bouncy` (500/22) for one celebration at
  most.
- An arrival drops in with a spring and lands with a shadow bloom `e2` → `e1`; a lime edge fades out
  over ~1 s (the admin's "an order arrives", §6.3).
- Numbers roll like an odometer when they change.
- Nothing loops forever; the waveform moves only while the voice plays.

## Sound (the brand's own two sounds)

From `docs/merchant-admin-design.md` §5.2: short, warm, marimba-like, never a system beep.

- **"Pedido novo"**: a rising two-note chime — the order arriving.
- **"Pago"**: a soft single note — a Pix confirming.

Other effects in the video (play tap, waveform, page/screen movement) follow the same character:
soft, wooden, close-miked, no harsh UI clicks.

## Voice and copy

Warm, direct, brief, like a helpful friend who runs a shop. "Você", present tense. Money as
`R$ 1.234,56`. Never platform words (SaaS, tenant, slug, webhook), never "sem taxa", never "sob
medida"; the only "grátis" is "14 dias grátis". Numbers on screen come from the real screens and
`capture/extracted/asset-descriptions.md`; nothing invented.

## Imagery

The product appears only as real admin screens of the fictional store Bolos da Nena, inside the CSS
phone. The only UI drawn in code is the generic voice-note bubble and system UI (the push with Core's
text). Duá (`assets/dua/`) may appear, never mirrored or recolored. No photos, people, AI images,
stock, logos of other companies, or fake testimonials/numbers.

## Pre-render self-audit

- **Lime** appears only on something alive or new, and always as a fill behind forest.
- **Safe area**: nothing load-bearing in the bottom 20%, the top 12.5% or the right action column.
- **Screens** are real, uncropped into fake UI, at native aspect, inside the CSS phone.
- **Type**: Space Grotesk headlines/numerals, Figtree body/captions, serif italic at most once,
  sentence case, no all-caps.
- **Depth**: forest-tinted shadows only; soft radii; no hard outlines.
- **Fabrication**: every figure traces to a real screen or the brief.

## Font loading (auto-generated, italic added)

The brand fonts ship as local files in `assets/fonts/` — do NOT link Google Fonts for them. Paste this `<style>` into every frame's `<head>`/`<template>` (captions use the same files) so `font-family` resolves in preview, snapshot, and render alike:

```html
<style>
  @font-face {
    font-family: 'Space Grotesk Variable';
    font-style: normal;
    font-display: block;
    font-weight: 300 700;
    src: url('assets/fonts/captured-space-grotesk-latin-wght-normal.woff2')
      format('woff2-variations');
  }
  @font-face {
    font-family: 'Figtree Variable';
    font-style: normal;
    font-display: block;
    font-weight: 300 900;
    src: url('assets/fonts/captured-figtree-latin-wght-normal.woff2') format('woff2-variations');
  }
  @font-face {
    font-family: 'Instrument Serif';
    font-style: normal;
    font-display: block;
    font-weight: 400;
    src: url('assets/fonts/captured-instrument-serif-latin-400-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Instrument Serif';
    font-style: italic;
    font-display: block;
    font-weight: 400;
    src: url('assets/fonts/captured-instrument-serif-latin-400-italic.woff2') format('woff2');
  }
</style>
```
