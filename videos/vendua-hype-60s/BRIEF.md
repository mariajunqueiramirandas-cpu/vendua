---
workflow: music-to-video
flow: autonomous
storyboard: no
destination: Instagram Stories ad (conversion)
aspect: 9:16 (1080×1920, 30 fps)
length: 60.0 s (hard max 60 s)
language: pt-BR
---

# Venduá — Hype 60 (launch ad)

## Intent

A launch ad for Instagram Stories, built for conversion: hype the coolest features (Duá, the AI
seller on the store's WhatsApp; the store online; orders landing on the phone; kitchen screen,
automatic printing, loyalty card, the day's summary) and the plans (Venduá Mirim R$ 69,90/mês,
Venduá Bandeira R$ 169/mês with 14 dias grátis sem cartão), ending on "Criar minha loja" and
vendua.com.br. Fast, fluid, modern, extremely animated. The author approved every decision up
front ("I approve everything").

## Decisions (author, 2026-10-09)

- **Audio source**: music and sound effects are synthesized in code by our own engine
  (`scripts/synth.py`, numpy only). No provider, no voice, no narrator.
- **Pace**: 128 BPM, frenético, cuts on the beat grid; 60.0 s = 32 bars.
- **Copy**: plans and prices exactly as `site/src/lib/content.ts` (owner, 2026-10-03). Pangolim is
  closed for sign-up, so the ad shows Mirim and Bandeira only. "Sem comissão por pedido" follows
  the site's calculator wording; no "sem taxa", only "14 dias grátis" as free.
- **Visuals**: real admin captures of Bolos da Nena (`site/static/screens`) and UI drawn in code
  that mirrors the real app and the site's demos (chat from `site/src/lib/demos/vendedor/script.ts`).
- **Sound-off first**: every beat of the story is readable as type.
