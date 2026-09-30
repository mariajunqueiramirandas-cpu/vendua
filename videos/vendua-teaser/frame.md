---
version: 1
name: Venduá — Frame (9:16 teaser)
description: >
  Venduá's own brand system at video scale, taken from the merchant admin and the marketing site
  (apps/admin/src/ui/theme.css, site/src/lib/styles/theme.css, site/README.md). Replaces the
  editorial-forest remix: the brand is complete and its rules outrank a preset.
unit: the frame — 1080×1920 (Instagram stories); 1cqw = 10.8px
safe_zone: text between y 250 and y 1580 (stories UI covers the top and bottom)

colors:
  green: '#123C32' # ink on cream, the ground of the dark frames
  green-deep: '#0D2F27'
  lime: '#D9F875' # the spark: the V, one focal per frame
  lime-soft: '#F0FCC9'
  cream: '#F7F4EA' # text on green, the canvas
  surface: '#FFFDF8'
  ink-muted: '#4F6A5E' # secondary text on cream
  after-muted: '#B9C6BF' # secondary text on green
  sky-0: '#FFF6EA' # the cream sky, top
  sky-1: '#FDE7D4' # the cream sky, bottom (dawn peach)
  bezel: 'linear-gradient(150deg, #34413b 0%, #121a16 45%, #0b100d 100%)'

canvas: '#123C32'

typography:
  wordmark:
    {
      fontFamily: 'Space Grotesk',
      weight: 700,
      px: 250,
      cqw: 23.1,
      tracking: '-0.06em',
      lineHeight: 0.8,
    }
  display:
    {
      fontFamily: 'Space Grotesk',
      weight: 700,
      px: 150,
      cqw: 13.9,
      tracking: '-0.04em',
      lineHeight: 1.0,
    }
  headline:
    {
      fontFamily: 'Space Grotesk',
      weight: 700,
      px: 104,
      cqw: 9.6,
      tracking: '-0.035em',
      lineHeight: 1.02,
    }
  pill: { fontFamily: 'Space Grotesk', weight: 700, px: 64, cqw: 5.9, tracking: '-0.02em' }
  body: { fontFamily: 'Figtree', weight: 500, px: 52, cqw: 4.8, lineHeight: 1.25 }
  handle: { fontFamily: 'Figtree', weight: 600, px: 44, cqw: 4.1 }

fonts:
  Space Grotesk: assets/fonts/space-grotesk.woff2 (variable wght)
  Figtree: assets/fonts/figtree.woff2 (variable wght)

components:
  v-mark: 'assets/mark-lime.svg — the V as one round-capped stroke (M32 48 L61 88 L98 34, width 17 in a 128 box); animate its stroke-dashoffset to draw it'
  wordmark: 'venduá. — lowercase, the accent a separate rounded bar (0.1em × 0.2em, rotate 38deg, at left 0.24em top -0.19em of the a), the dot its own glyph; like site Hero.svelte'
  phone: 'CSS device: bezel gradient, radius 13% of width, 2.4% bezel, screen image inside with its own radius'
  pill: 'Em breve — radius 999px, lime fill, green text, a green dot 0.32em before the text'
  dua: 'assets/dua-ola.webp — never mirrored, recolored, filtered or stretched; on green it stands on a cream surface, so Duá appears on the cream sky only'
---

# Venduá — frame layer

- Two grounds only: deep green (#123C32) with cream text, and the cream sky (sky-0 → sky-1 top to bottom)
  with green text. Lime is the one accent per frame, never a text colour on cream.
- Display type is Space Grotesk 700 with tight negative tracking, lowercase for the name, sentence case
  elsewhere. Body is Figtree. No all-caps labels, no eyebrow labels, no italic or highlighted single
  word in a headline, no Instrument Serif outside the admin screens.
- Depth: flat grounds; the only shadows are on the phone (the admin's shadow-e3) and a soft lime glow.
- Copy only from the site (`site/src/lib/content.ts`, `Hero.svelte`): no prices, no invented features,
  the only call to action is "Em breve".
