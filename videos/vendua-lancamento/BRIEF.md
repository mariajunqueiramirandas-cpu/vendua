---
workflow: product-launch-video
flow: automation
storyboard: no
message: 'Chegou o Venduá: a loja online com um vendedor no WhatsApp e uma cozinha que vê tudo na hora. Comece pelo Venduá Bandeira, 14 dias grátis, sem cartão.'
destination: instagram-reels
aspect: 1080x1920
language: pt-BR
audience: 'Brazilian food sellers (doceiras, marmitarias, hamburguerias, padarias) who sell by WhatsApp'
length: 60s
angle: 'O lançamento: três recursos, mostrados por dentro'
intent: sell
cta: 'Comece pelo Venduá Bandeira / 14 dias grátis, sem cartão. / Link na bio · @vendua.digital'
---

## Intent

The author's ask (2026-10-04): a video announcing the launch of the platform that shows, really
deep, how its three coolest features work; ~60 s; eleven_v4 voices; the script, the voice prompts
and the takes made first, and the video timed to the voices after. "You have full creative
control; only give me the final product." Voices approved by ear ("the voices are perfect").

The three features, in the order a store lives them (all shipped, per the ADRs):

1. **A loja no ar em cerca de uma hora** — the Duá sets it up in a conversation (nome, cores,
   cardápio); the customer orders by link with no sign-up and pays by Pix straight into the store's
   Mercado Pago account (ADR 0019, 0021; site copy).
2. **O Duá vende no WhatsApp** — the AI seller on the store's own WhatsApp hears a voice note,
   quotes the menu's real price (Core's ledger, never a guess), offers one add-on, closes the
   order, sends the Pix; the owner takes over in one tap (ADR 0026, 0031).
3. **A cozinha vê o pedido na hora** — the order lands on the phone, one tap accepts it, the
   comanda prints by itself, the kitchen display's clock warns before an order runs late, one tap
   on Pronto and the customer knows (ADR 0027, 0029).

Closing card, exactly the decided wording (ADR 0032, site/README.md):

> **Comece pelo Venduá Bandeira**
> 14 dias grátis, sem cartão.
> Link na bio · @vendua.digital

No price on screen. Never "sem taxas". Duá is always "o Duá"/"ele".

## Assets

- Real captures of the admin, kitchen display and storefront running the fictional dev store
  Bolos da Nena (`capture/`, `scripts/capture-shots.mjs`), plus the site's admin screens.
- Brand: the lime/green check mark, "venduá." set live in Space Grotesk, the Duá mascot.

## Customizations

- ElevenLabs **eleven_v4** through `videos/tools/elevenlabs.py`: narrator Bruna da Costa
  (`[energetic, fast]`), the customer Caio's voice note by Talis (`[casual]`, phone band). Prompts
  in `audio/takes/lines.tsv`. A 128 BPM ElevenLabs Music bed, the premium SFX set plus a printer
  and an order-ready chime. `scripts/build-audio.py` rebuilds the mix.
- House defaults otherwise (videos/README.md): frenético cut on the eighth-note grid, captions in
  y 1300–1520, Reels safe area.

## Notes

- Length: the voice sets the pace; the cut is ~64 s ("Olha só!" was cut from line 2 to get there).
