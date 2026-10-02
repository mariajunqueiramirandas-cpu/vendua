---
format: 1080x1920
duration: 29s
message: 'Seu cardápio, preços e Pix num link só, e o cliente para de mandar áudio. Teste o Venduá Basic grátis por 14 dias, sem cartão.'
arc: PAS — hook (the voice note) → pain → one link → cardápio, preço, Pix → the order arrives → CTA
audience: Brazilian food sellers (doceiras, marmitarias, hamburguerias, padarias) who take orders by DM and voice note
mode: collaborative
music: energetic Brazilian funk-pop bed, 128 BPM, full energy from the first frame, ducked under every line; every cut lands on its eighth-note grid
---

# Venduá — "O áudio de 47 segundos" (Reel, ~29 s, 9:16, frenético cut)

One customer, Luiz, sends the voice note every merchant knows. The narrator answers for the
merchant: one link. The same Luiz then orders by himself (order #29 on the real screens: 2× Bolo de
chocolate molhadinho among his items), so the story closes on the customer who asked.

Reels safe area: everything load-bearing between 12.5% and 80% of the height, clear of the right
action column (frame.md). Captions: word-timed, Figtree 750 at 66px, in the band y 1300–1520; frame
content ends at y 1280. No captions on Frame 6 (the card is the caption).

**Spine.** The voice note is the hero prop: it plays (1), multiplies (2) and condenses into the link
(3); the link grows into the customer's phone (4); the merchant's phone takes over (5); Luiz, who
asked in 1, is the order that arrives in 5.

**Bans.** No WhatsApp look (green, ticks, tails, icons). No fake storefront or admin UI: real
captures only. No glow, sparkles, all-caps or eyebrow labels. No slideshow (every beat continues
the last one) and no screensaver motion (things move when the voice names them).

**Held frame.** The last ~1.2 s of Frame 6: nothing moves while "Link na bio · @vendua.digital" holds.

**Truthfulness.** The screens are real captures of Venduá's admin and storefront running the
fictional dev store Bolos da Nena; the push is Core's real payload text. Luiz and his voice note are
fictional; the product numbers (R$ 48,00, R$ 219,00, #29) come from the captured screens. The
voice-note durations (0:47 in Frame 1; 0:32, 1:12, 0:58, 2:05, 0:41, 1:36, 0:19, 3:02, 0:54 in
Frame 2) are scenario props, approved by the author on 2026-10-02 (the last five with the frenético
burst); they claim nothing about Venduá.

Sketches: `storyboard.html` (v1).

## Locked

The sketch sheet (`storyboard.html` v1) was confirmed on 2026-10-02: placement, hierarchy and copy of
all six frames are locked. Build dresses those layouts; it never redraws them.

## Changes from v1

- Narrator voice: Adriane (ElevenLabs), because Bruna da Costa needs a Creator plan; Luiz: Talis.
- Real voice timing made the film 36.1 s (frames 8.35 / 7.4 / 3.7 / 4.4 / 3.4 / 8.85 s), not ~27 s.
- Frame 4 shows the real storefront (captured), not the admin.
- **Frenético cut (2026-10-02, the author: "muito lento"):** same script, ~29 s. New energetic
  takes for every line (lines 3 and 6 spell "Vendu-á" so the stress lands on the á; the author
  picked the takes), a 128 BPM funk-pop bed from the first frame, cuts on the bed's grid, fast
  arrivals with punch-ins and shakes, Frame 2 grows into a burst of ten notes. Layouts unchanged.

## Video direction

- **Palette** (frame.md): cream `canvas` ground with paper grain on frames 1–5, `surface` cards and
  bubbles, `ink` forest for type, numerals and buttons; `spark` lime only on something alive or
  new — the playhead, the "new" dots, the link pill, the Pix highlight, the push edge, the trial
  chip — always behind forest text. Frame 6 is on `night` with `night-ink` type and the lime mark.
- **Type** by role from frame.md: `title`/`subtitle`/`numeral` in Space Grotesk 600, `label`/`meta`
  in Figtree. No serif in this film. No visible narration sentences: captions are the root track.
- **Canvas and keep-out**: 1080×1920. Everything readable sits in y 250–1280 and x 72–940 (Reels UI
  covers the top 240, the bottom 20% and the right 140 px). The caption pill owns y 1300–1520; only
  backgrounds may run behind it. No captions over Frame 6.
- **Timing source**: `audio/cues.json` holds every word's frame-relative start (Whisper on the real
  voice files) and every SFX hit. Each Scene below already uses those times; reveals land on them.
- **Motion grammar (frenético)**: arrivals are 0.18–0.28 s slams (`expo.out` / `power4.out`, from
  scale ~1.12 or a 60–120 px drop, shadow e2→e1 inside the same 0.2 s); **punch-ins** on stressed
  words (the hero scales 1→1.05 in 0.1 s and eases back in 0.25 s); **shakes** on every hit (a
  fixed, decaying offset sequence, ≤14 px and ≤0.8°, 0.25 s). Still never bouncy (no back/elastic/
  bounce). Only transform and opacity animate. Every entrance is a `fromTo`. No exits except Frame 6.
- **Reveal model**: nothing appears before the voice names it; something moves on every beat of
  frames 1–5; no hold longer than ~0.5 s except the end card's last ~1.2 s.
- **Rhythm**: 128 BPM (a beat is 0.469 s, an eighth 0.234 s). Frame 2's notes land on the beats.
  Whooshes peak on the cuts 2→3, 3→4 and 4→5; a hit lands the cut 5→6.
- **Recurring components** (frame.md `components`): the voice-note bubble (generic, never WhatsApp's
  look: no green, ticks, tails or icons), the CSS phone (site's Phone.svelte geometry, real screens
  at native aspect inside it, ~1030 px tall, centered, y 250–1280), the push card (Core's real text).
- **Negative list**: no WhatsApp/Instagram UI, no fake screens, no AI images or photos, no glow or
  sparkles, no all-caps or eyebrow labels, no lazy breathing, no back-half slow pan/push, no
  slideshow (front-load then freeze), no screensaver (things floating on their own), no repeat/yoyo,
  no randomness.

## Frame 1 — O áudio

- scene: A voice-note bubble from "L" fills the frame, "0:47"; the play button is tapped and the waveform races with the customer's voice
- voiceover: "Oi, boa tarde! Tudo bem? Então… vocês têm cardápio? Quanto tá o bolo de chocolate? Ah, e aceita Pix?"
- duration: 7.031s
- transition_in: cut
- status: animated
- src: compositions/frames/01-o-audio.html
- type: hook
- persuasion: Pain validation (the viewer's own inbox, heard)
- beat: recognition + mild dread
- asset_candidates:

narrativeRole: stop the scroll with a sound and a shape every merchant knows — the long customer voice note.
keyMessage: "This is the message you get all day."

Spoken by the customer voice (Luiz), not the narrator, over the bed from the first frame. The
duration reads 0:47 while only ~7 s play, so the long unplayed waveform is the joke.

- blueprint: compose
- focal: the voice-note bubble (drawn)
- roles: bubble = hero, drawn in Venduá paper; sender row = supporting
- sfx: tap (0.04 s, on the play button)
- handoff_out: voice-note bubble (Luiz) — at 7.031 s: x 72 px, y 638 px (top-left), width 864 px, height 367 px, scale 1, opacity 1, still (no motion)

Compose: the waveform playing is the motion, punched on the three questions.
Scene 1 (0.0–0.25s): frame 0 is the sketch's landed state (sender row "Luiz · agora", the big bubble, avatar "L", forest play button, waveform at rest, "0:47"). At 0.04 the play button takes a quick press (0.08 s down, 0.12 s back) and swaps to the pause bars.
Scene 2 (0.25–6.8s): Luiz talks, fast. The playhead steps bar by bar (≈15% of the waveform by the end), bars near it move with the voice envelope (`audio/f01-envelope.json`), the counter rolls "0:00"→"0:07". **Punch-ins** on the three questions — "cardápio?" 2.92, "chocolate?" 4.66, "Pix?" 6.22: the bubble scales to 1.05 in 0.1 s and back in 0.25 s with a small shake (≤6 px).
Scene 3 (6.8–7.031s): settled on the handoff state, still.

## Frame 2 — De novo

- scene: The bubble snaps into a pile as a burst of nine more voice notes slams in on the beat (0:32, 1:12, 0:58, 2:05, 0:41, 1:36, 0:19, 3:02, 0:54)
- voiceover: "Áudio de 47 segundos! Enquanto o bolo tá no forno. E ainda tem mais na fila!"
- duration: 6.328s
- transition_in: cut
- status: animated
- src: compositions/frames/02-de-novo.html
- type: pain_point
- persuasion: Pain agitation
- beat: overwhelm
- asset_candidates:

narrativeRole: name the cost — time the merchant doesn't have, multiplied.
keyMessage: "Answering one by one doesn't scale."

- blueprint: overwhelm-surround (Adapt)
- focal: the pile of voice notes (drawn)
- roles: Luiz's bubble = slot 0, dimmed; nine new bubbles = the burst
- sfx: pops on the beats (0.469, 0.938, 1.406, 1.875, 2.344, 2.813, 3.281, 3.75, 4.219 s), hit (5.47 s, "fila"), whip (6.078 s, into the cut)
- handoff_in: voice-note bubble (Luiz) — at 0.0 s: x 72 px, y 638 px (top-left), width 864 px, height 367 px, scale 1, opacity 1, still (no motion)

Adapt: things pile in until they crowd the frame; the pile is a messy, overlapping stack of cards (slight rotations, alternating offsets, each new one on top), not a tidy column.
Scene 1 (0.0–0.3s): Luiz's bubble snaps (0.25 s, `expo.out`) to slot 0 (648×173 at x 72, y 259, −2°), settling at opacity 0.55, scale 0.94.
Scene 2 (0.469–4.219s): on every beat a new bubble slams into its slot (from 110 px above at scale 1.12, 0.2 s `expo.out`, shadow e2→e1), lime new-dot pops 0.05 s later, the pile jolts (≤5 px). Slots, top-left px and rotation: 1 M "0:32" (230, 345, 2.5°) · 2 A "1:12" (96, 437, −1.5°) · 3 R "0:58" (262, 529, 3°) · 4 J "2:05" (120, 621, −3°) · 5 C "0:41" (210, 713, 1.5°) · 6 P "1:36" (84, 805, −2.5°) · 7 D "0:19" (250, 897, 2°) · 8 T "3:02" (140, 989, −1°) · 9 S "0:54" (220, 1081, 2.5°).
Scene 3 (5.47s): on "fila!" the hit: the whole pile shakes hard (≤14 px, ≤0.8°, decaying over 0.3 s) and punches to 1.04 and back.
Scene 4 (5.8–6.328s): the pile settles; the zoom-through takes it from 6.328.

## Frame 3 — Um link só

- scene: The pile collapses into one lime link pill, "bolosdanena.vendua.com.br", and a tap opens it
- voiceover: "Com o Venduá, você responde com um link só!"
- duration: 3.047s
- transition_in: zoom-through 0.25s
- status: animated
- src: compositions/frames/03-um-link.html
- type: product_intro
- persuasion: Friction reduction (many answers → one link)
- beat: relief
- asset_candidates: assets/loja-creme-750.webp — the Loja screen with the store's real link "bolosdanena.vendua.com.br"

narrativeRole: land the promise by beat 3 — one link replaces the replies.
keyMessage: "Your store is a link."

- blueprint: cta-morph-press (Adapt)
- focal: the lime link pill "bolosdanena.vendua.com.br"
- roles: loja-creme-750.webp = reference only (the source of the link text, not on screen)
- sfx: hit (0.29 s, the pill lands on "Venduá"), tap (2.15 s, on "link"), whip (2.797 s, into the cut)

Adapt: the pile condenses into the single thing you tap, and the tap lands — a finger-tap ring, no cursor.
Scene 1 (0.0–0.29s): ten dashed ghost outlines on Frame 2's ten slots rush into the pill's center (504, 810) and vanish by 0.27.
Scene 2 (0.29s): on "Venduá" the pill slams in (scale 1.15→1, 0.2 s `expo.out`, shadow e2→e1) with a shake (≤10 px); the mark and the link text pop in 0.05 s after.
Scene 3 (0.5–2.15s): the pill takes a small punch on "responde" (1.15).
Scene 4 (2.15s): on "link" the tap ring lands on the pill's right part, the pill presses to 0.965 and back (0.18 s), a ripple spreads and is gone by 2.55.
Scene 5 (2.55–3.047s): settled; the push-slide takes it from 3.047.

## Frame 4 — Cardápio, preço e Pix

- scene: The phone shows what the customer sees: the menu with prices, the chocolate cake's R$ 48,00, then Pix as the way to pay — one screen per spoken word
- voiceover: "Cardápio! Preço! E Pix!"
- duration: 2.813s
- transition_in: push-slide UP 0.25s
- status: animated
- src: compositions/frames/04-cardapio-preco-pix.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (each question answered by a real screen)
- beat: clarity
- asset_candidates: assets/vitrine-cardapio-750.webp — the real storefront's Cardápio with prices; assets/vitrine-produto-750.webp — Bolo de chocolate molhadinho, R$ 48,00; assets/vitrine-pagamento-750.webp — checkout's Pagamento step with Pix selected (order #29's cart, R$ 219,00)

narrativeRole: answer the three questions from Frame 1, in the same order, with proof.
keyMessage: "Everything they asked is already there."

- blueprint: device-surface-showcase (Adapt)
- focal: the customer's phone (CSS frame) showing the real storefront
- roles: vitrine-cardapio-750.webp = screen 1 (cardápio); vitrine-produto-750.webp = screen 2 (preço); vitrine-pagamento-750.webp = screen 3 (Pix)
- sfx: swipe (1.01 s), swipe + pago (1.91 s), whip (2.563 s, into the cut)

Adapt: one held device whose screen whips on the three spoken cues.
Scene 1 (0.0–1.01s): the phone is in place as the push-slide brings it up, on the cardápio screen; a punch-in on "Cardápio!" (0.05: 1→1.04 and back).
Scene 2 (1.01s): on "Preço!" the screen whips left to the product page (0.18 s `expo.out`) and the camera punches in to 1.5× on "R$ 48,00" (0.22 s `expo.out`) with a small shake.
Scene 3 (1.91s): on "Pix!" the screen whips to the payment step and the camera pulls back to the full phone (0.22 s); at 1.95 the lime ring snaps onto the Pix row (0.15 s) with a shake (≤8 px).
Scene 4 (2.3–2.813s): settled; the push-slide takes it from 2.813.

## Frame 5 — O pedido chega sozinho

- scene: A push slams in, "Pedido #29 chegou · Luiz · R$ 219,00 · entrega", with the brand's chime; the phone shows order #29 with "aceitar"
- voiceover: "E o pedido chega sozinho!"
- duration: 2.578s
- transition_in: push-slide LEFT 0.3s
- status: animated
- src: compositions/frames/05-pedido-chega.html
- type: benefit_highlight
- persuasion: Future pacing (the order without the conversation)
- beat: satisfaction + control
- asset_candidates: assets/pedido-creme-750.webp — Pedido #29, Luiz Fernando, Total R$ 219,00, "aceitar · 30 min"

narrativeRole: pay off the hook — the same Luiz now ordered by himself.
keyMessage: "No more back-and-forth."

The customer's phone slides out left and the merchant's phone slides in (push-slide LEFT), so the
two sides of the same order read as two phones.

- blueprint: compose
- focal: the push notification "Pedido #29 chegou"
- roles: pedido-creme-750.webp = the merchant's phone screen (Pedido #29, Luiz Fernando, R$ 219,00)
- sfx: pedido-novo + buzz (0.25 s, on "pedido")

Compose: the admin's own "an order arrives" moment, at speed.
Scene 1 (0.0–0.25s): the merchant's phone (same CSS frame and position as Frame 4) on the real Pedido #29 screen as the push-slide lands it.
Scene 2 (0.25s): on "pedido" the push card slams out of the island to y 270 (0.2 s `expo.out`, shadow e2→e1 on its resting e3), the 5 px lime edge fades over 0.6 s; the phone buzzes twice (±5 px at 0.27 and 0.42).
Scene 3 (1.09s): on "sozinho!" the push card punches to 1.05 and back.
Scene 4 (1.4–2.578s): settled; the cut to Frame 6 lands on a hit.

## Frame 6 — 14 dias grátis

- scene: On Noite, the Venduá mark slams in and draws; three lines land in turn: "Comece com 14 dias grátis." / "Venduá Basic, sem cartão." / "Link na bio · @vendua.digital"
- voiceover: "Comece com 14 dias grátis! Venduá Basic, sem cartão. Link na bio!"
- duration: 7.266s
- transition_in: cut
- status: animated
- src: compositions/frames/06-14-dias.html
- type: cta
- persuasion: Risk reversal (free, no card)
- beat: urgency-to-act
- asset_candidates: assets/mark-lime.svg — the Venduá check mark in lime, for night

narrativeRole: convert — the offer, the plan, where to go.
keyMessage: "Try it free for 14 days, no card."

The card text is exactly the brief's, left-aligned to stay clear of the Reels action column:
"Comece com 14 dias grátis." as the title, "Venduá Basic, sem cartão." on a lime chip, then "Link
na bio · @vendua.digital". No captions on this frame. The handle holds to the last frame.

- blueprint: titlecard-reveal (Adapt)
- focal: "Comece com 14 dias grátis."
- roles: mark-lime.svg = the Venduá mark in the logo
- sfx: hit (0.0 s, the cut), whip (2.84 s, the chip), tap (4.92 s, "Link")

Adapt: the end-card stack lands fast, word by word, then holds still so the CTA reads.
Scene 1 (0.0–0.25s): on the hit the lime check slams in (scale 1.3→1, 0.2 s) and draws itself (0.25 s); "venduá." pops beside it.
Scene 2 (0.10–2.1s): "Comece com / 14 dias grátis." slams in word by word on 0.10, 0.64, 0.82, 1.44, 1.84 (each 0.2 s from 60 px below at scale 1.08, `expo.out`); the whole stack punches to 1.03 on "grátis!" (1.84).
Scene 3 (2.84s): on "Venduá" the lime chip "Venduá Basic, sem cartão." shoots out from its left edge (0.22 s `expo.out`).
Scene 4 (4.92s): on "Link" "Link na bio · @vendua.digital" slams up (0.2 s).
Scene 5 (5.6–7.266s): the held frame — nothing moves; the last 0.3 s fade the card to night, the film's only exit.
