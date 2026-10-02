---
workflow: product-launch-video
flow: automation
storyboard: yes
message: 'Seu cardápio, preços e Pix num link só, e o cliente para de mandar áudio. Teste o Venduá Basic grátis por 14 dias, sem cartão.'
destination: instagram-reels
aspect: 1080x1920
language: pt-BR
audience: 'Brazilian food sellers (doceiras, marmitarias, hamburguerias, padarias) who take orders by DM and voice note'
length: 27s
angle: 'O áudio de 47 segundos'
intent: sell
cta: 'Comece com 14 dias grátis. / Venduá Basic, sem cartão. / Link na bio · @vendua.digital'
---

## Intent

An organic Instagram Reel (also Stories) for @vendua.digital that sells Venduá Basic's 14-day free
trial, no card. Concept chosen from the pitch round, "O áudio de 47 segundos": every merchant knows
the customer voice note that asks for the menu, the price and whether you take Pix. The ad answers
it with one link. A single generic voice-note bubble (never WhatsApp's look) fills the frame and its
waveform moves with the voice; two ElevenLabs voices, the customer and then a narrator; when the
narrator says "cardápio", "preço" and "Pix", the matching real admin screen appears; styled captions
carry it with sound off. Hook: a play button and "0:47".

Closing card, exactly:

> **Comece com 14 dias grátis.**
> Venduá Basic, sem cartão.
> Link na bio · @vendua.digital

The wording matches the site ("14 dias grátis, sem cartão") and the signup's last step ("Comece com
14 dias grátis"), ADR 0025.

## Assets

- site/static/screens/\*-creme-750.webp — the real admin phone screens of the fictional store Bolos
  da Nena (registry: site/src/lib/screens.ts); the product appears only through these.
- site/static/assets/brand/ — Venduá wordmark and mark (SVG).
- site/src/lib/styles/theme.css — Venduá's design tokens (copied from apps/admin/src/ui/theme.css):
  Creme palette, Noite for dark accents; fonts Space Grotesk (display), Figtree (body), Instrument
  Serif (moments).
- site/src/lib/content.ts + screens.facts.json — the store's facts (Nena, order #29 from Luiz,
  R$ 219,00, entrega) and Core's real push text, so copy that quotes a screen matches it.

## Customizations

- Audio through ElevenLabs, not HeyGen: Luiz = Talis, narrator = Bruna da Costa (the user's first
  pick; v1 used Adriane until the user supplied a Creator-plan API key, used through
  `videos/tools/elevenlabs.py`), ElevenLabs Music v2.5 (a 128 BPM funk-pop bed, pre-mixed and ducked
  under the voices in `audio/music-bed.mp3`), ElevenLabs Sound Effects v2 for the SFX
  (`audio/sfx/`). The whole mix rebuilds with `scripts/build-audio.py`.
- Sound effects must be very good: the voice note's play tap, waveform ticks, a chime when the
  store link opens. If ElevenLabs can't make one well, synthesize it, synced to the video.
- Word-timed burned-in captions styled to the design system, inside the Reels safe zone.

## Notes

- Use Venduá's design system. No AI-generated images, no photos, no people, no fake app UI: the
  only drawn UI is the generic voice-note bubble and system UI (push notification with Core's text).
- No price on screen (R$ 39,90/mês stays off unless the user asks).
- Only Basic features: cardápio, preços, Pix, horários, pedidos. Nothing from PRO+ (own domain,
  AI-built site).
- Reels UI covers the bottom ~20% and the right edge: captions, screens and the closing card stay
  inside the safe area. Captions sit in the band y 1300–1520; the CSS-drawn phone ends above it
  (y 250–1280, about 54% of the height).
- Before posting: the live vendua.com.br must be deployed with the trial copy (on 2026-10-02 it
  still showed only R$ 39,90/mês). If staff change Basic's trial length in the CRM, this video goes
  stale with the site copy.
- Assets come from the repo, not a crawl of vendua.com.br.
