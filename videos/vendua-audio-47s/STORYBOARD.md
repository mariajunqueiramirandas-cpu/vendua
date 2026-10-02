---
format: 1080x1920
duration: 36s
message: 'Seu cardápio, preços e Pix num link só, e o cliente para de mandar áudio. Teste o Venduá Basic grátis por 14 dias, sem cartão.'
arc: PAS — hook (the voice note) → pain → one link → cardápio, preço, Pix → the order arrives → CTA
audience: Brazilian food sellers (doceiras, marmitarias, hamburguerias, padarias) who take orders by DM and voice note
mode: collaborative
music: warm, light acoustic bed (marimba, nylon guitar, soft shaker), ~100 BPM, unhurried; silent under the voice note, enters with the narrator, ducked under every line
---

# Venduá — "O áudio de 47 segundos" (Reel, ~30 s, 9:16)

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

**Held frame.** The last ~2 s of Frame 6: nothing moves while "Link na bio · @vendua.digital" holds.

**Truthfulness.** The screens are real captures of Venduá's admin and storefront running the
fictional dev store Bolos da Nena; the push is Core's real payload text. Luiz and his voice note are
fictional; the product numbers (R$ 48,00, R$ 219,00, #29) come from the captured screens. The
voice-note durations (0:47 in Frame 1; 0:32, 1:12, 0:58, 2:05 in Frame 2) are scenario props,
approved with this plan on 2026-10-02; they claim nothing about Venduá.

Sketches: `storyboard.html` (v1).

## Locked

The sketch sheet (`storyboard.html` v1) was confirmed on 2026-10-02: placement, hierarchy and copy of
all six frames are locked. Build dresses those layouts; it never redraws them.

## Changes from v1

- Narrator voice: Adriane (ElevenLabs), because Bruna da Costa needs a Creator plan; Luiz: Talis.
- Real voice timing made the film 36.1 s (frames 8.35 / 7.4 / 3.7 / 4.4 / 3.4 / 8.85 s), not ~27 s.
- Frame 4 shows the real storefront (captured), not the admin.

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
- **Motion grammar**: smooth long-tail settles (`power3`; `expo.out` for fast arrivals), the admin's
  arrival = a short drop + shadow bloom e2→e1 (`spring-pop-entrance`, critically damped, never
  bouncy). Only transform and opacity animate. Every entrance is a `fromTo`. No exits except Frame 6.
- **Reveal model**: nothing appears before the voice names it; frames 1–5 keep something arriving
  across their whole length; holds are still (at most a subtle jitter).
- **Rhythm**: hook (1) and pile (2) are the busy part; 3 is a breather around the pill; 4 is three
  quick beats; 5 is one arrival; 6 is the calm close whose last ~1.3 s is the held frame.
- **Recurring components** (frame.md `components`): the voice-note bubble (generic, never WhatsApp's
  look: no green, ticks, tails or icons), the CSS phone (site's Phone.svelte geometry, real screens
  at native aspect inside it, ~1030 px tall, centered, y 250–1280), the push card (Core's real text).
- **Negative list**: no WhatsApp/Instagram UI, no fake screens, no AI images or photos, no glow or
  sparkles, no all-caps or eyebrow labels, no lazy breathing, no back-half slow pan/push, no
  slideshow (front-load then freeze), no screensaver (things floating on their own), no repeat/yoyo,
  no randomness.

## Frame 1 — O áudio

- scene: A voice-note bubble from "L" fills the frame, "0:47"; the play button is tapped and the waveform starts moving with the customer's voice
- voiceover: "Oi, boa tarde! Tudo bem? Então… vocês têm cardápio? Quanto tá o bolo de chocolate? Ah, e aceita Pix?"
- duration: 8.35s
- transition_in: cut
- status: built
- src: compositions/frames/01-o-audio.html
- type: hook
- persuasion: Pain validation (the viewer's own inbox, heard)
- beat: recognition + mild dread
- asset_candidates:

narrativeRole: stop the scroll with a sound and a shape every merchant knows — the long customer voice note.
keyMessage: "This is the message you get all day."

Spoken by the customer voice (Luiz), not the narrator. No music. The duration reads 0:47 while only
the first ~6 s play, so the long unplayed waveform is the joke. Captions light "cardápio",
"quanto" and "Pix" as the three questions (lime chips behind forest text).

- blueprint: compose
- focal: the voice-note bubble (drawn)
- roles: bubble = hero, drawn in Venduá paper; sender row = supporting
- sfx: tap (0.12 s, on the play button)
- handoff_out: voice-note bubble (Luiz) — at 8.35 s: x 72 px, y 638 px (top-left), width 864 px, height 367 px, scale 1, opacity 1, still (no motion)

Compose: the waveform playing is the motion; nothing else enters.
Scene 1 (0.0–0.3s): the sketch's landed state is on screen at frame 0 — "Luiz · agora" sender row and the big bubble (avatar "L", forest play button, 24-bar waveform at rest, "0:47") — paper canvas, bubble ~80% wide, upper-middle third. At 0.12 the play button takes a tap → **button press** compression then recovery (`press-release-spring`) and its triangle swaps to the pause bars.
Scene 2 (0.3–7.9s): Luiz talks. The playhead crawls left→right from bar 0 to about bar 4 (8 s of 47 s ≈ 17%): bars behind it turn forest, the bar under it wears the lime ring, and bar heights near the playhead move with the voice from the embedded loudness envelope (`audio/f01-envelope.json`, 30 fps — paste its `values` array into the script; it is data, not a network fetch). An elapsed counter "0:00"→"0:08" ticks in `meta` under the waveform, left; "0:47" stays fixed on the right. Nothing else enters; captions carry the words.
Scene 3 (7.9–8.35s): Luiz finishes ("Pix?" at 7.68); the playhead stops; still.

## Frame 2 — De novo

- scene: The bubble shrinks into a pile as more voice notes from other customers land around it (0:32, 1:12, 0:58, 2:05)
- voiceover: "Áudio de 47 segundos. Enquanto o bolo tá no forno. E ainda tem mais na fila."
- duration: 7.4s
- transition_in: cut
- status: built
- src: compositions/frames/02-de-novo.html
- type: pain_point
- persuasion: Pain agitation
- beat: overwhelm
- asset_candidates:

narrativeRole: name the cost — time the merchant doesn't have, multiplied.
keyMessage: "Answering one by one doesn't scale."

The narrator enters, warm and a little wry; the music bed starts under it.

- blueprint: overwhelm-surround (Adapt)
- focal: the pile of voice notes (drawn)
- roles: Luiz's bubble = recedes to the top; four new bubbles = the pile
- sfx: pop-1 (0.66 s), pop-2 (2.14 s), pop-3 (4.18 s), pop-4 (6.74 s)
- handoff_in: voice-note bubble (Luiz) — at 0.0 s: x 72 px, y 638 px (top-left), width 864 px, height 367 px, scale 1, opacity 1, still (no motion)

Adapt: keep the signature of things piling in until they crowd the frame; the "tools" are voice notes, and they stack as a chat column (alternating left offsets) instead of surrounding a figure.
Scene 1 (0.0–0.66s): Luiz's bubble shrinks to the pile size and lifts to the top slot (x 72, y 259, 648×173), settling at opacity 0.55 and scale 0.94 — smooth long-tail move, as the narrator says "Áudio de".
Scene 2 (0.66s): on "47" the first new bubble (M, "0:32") drops into slot 2 with a lime new-dot → **spring-pop entrance** (`spring-pop-entrance`, smooth, no overshoot) and a shadow bloom.
Scene 3 (2.14s): on "Enquanto", bubble A "1:12" drops into slot 3.
Scene 4 (4.18s): on "forno", bubble R "0:58" drops into slot 4.
Scene 5 (6.74s): on "fila", bubble J "2:05" drops into slot 5 — the column now fills y 259–1280, crowded.
Scene 6 (6.9–7.4s): hold, still. The slots and offsets are the sketch's.

## Frame 3 — Um link só

- scene: The pile condenses into one lime link pill, "bolosdanena.vendua.com.br", and a tap opens it
- voiceover: "Com o Venduá, você responde com um link só."
- duration: 3.7s
- transition_in: zoom-through
- status: built
- src: compositions/frames/03-um-link.html
- type: product_intro
- persuasion: Friction reduction (many answers → one link)
- beat: relief
- asset_candidates: assets/loja-creme-750.webp — the Loja screen with the store's real link "bolosdanena.vendua.com.br"

narrativeRole: land the promise by beat 3 — one link replaces the replies.
keyMessage: "Your store is a link."

The link text is the real one from the Loja screen. The Venduá name is spoken, not shown as a logo
yet (the logo closes the video).

- blueprint: cta-morph-press (Adapt)
- focal: the lime link pill "bolosdanena.vendua.com.br"
- roles: loja-creme-750.webp = reference only (the source of the link text, not on screen)
- sfx: whoosh (0.02 s, the pile condensing), tap (2.53 s, on "link")

Adapt: keep the signature — a pile of widgets condenses into the single thing you tap, and the tap lands — without a cursor (a finger-tap ring instead).
Scene 1 (0.0–0.46s): ghost outlines of the five bubbles (dashed forest at 22%) collapse toward the center and fade → **scale-swap** (`scale-swap-transition`) as the lime pill arrives at the center on "Venduá" (0.46), 80% wide, centered at y ~810, with the Venduá mark at its left and "bolosdanena.vendua.com.br" in Space Grotesk 600.
Scene 2 (0.46–2.5s): the pill holds still and reads.
Scene 3 (2.53s): on "link" a finger-tap ring presses the pill's right end → **cursor click + ripple** without the cursor (`cursor-click-ripple`), and the pill does a tiny **button press** (`press-release-spring`).
Scene 4 (2.9–3.7s): hold on "só." — still.

## Frame 4 — Cardápio, preço e Pix

- scene: The phone shows what the customer sees: the menu with prices, the chocolate cake's R$ 48,00, then Pix as the way to pay — one screen per spoken word
- voiceover: "Cardápio… preço… e Pix."
- duration: 4.4s
- transition_in: crossfade
- status: built
- src: compositions/frames/04-cardapio-preco-pix.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (each question answered by a real screen)
- beat: clarity
- asset_candidates: assets/vitrine-cardapio-750.webp — the real storefront's Cardápio with prices; assets/vitrine-produto-750.webp — Bolo de chocolate molhadinho, R$ 48,00; assets/vitrine-pagamento-750.webp — checkout's Pagamento step with Pix selected

narrativeRole: answer the three questions from Frame 1, in the same order, with proof.
keyMessage: "Everything they asked is already there."

The screens are the real standard storefront (the Venduá Basic look) of Bolos da Nena, captured by
`scripts/storefront-shots.mjs`: the menu, the product page, and checkout's payment step with Pix
selected.

- blueprint: device-surface-showcase (Adapt)
- focal: the customer's phone (CSS frame) showing the real storefront
- roles: vitrine-cardapio-750.webp = screen 1 (cardápio); vitrine-produto-750.webp = screen 2 (preço); vitrine-pagamento-750.webp = screen 3 (Pix)
- sfx: swipe (1.70 s), swipe (3.52 s), pago (3.83 s)

Adapt: keep the signature — one held device whose screen cycles — cycling exactly on the three spoken cues.
Scene 1 (0.0–1.70s): the phone settles in centered (y 250–1280, ~1030 px tall) as the frame crossfades in, already showing the cardápio screen (the menu with prices) on "Cardápio" (0.12). Still.
Scene 2 (1.70–3.52s): on "preço" the screen slides left inside the phone to the product page (Bolo de chocolate molhadinho, R$ 48,00); then a **zoom-to-target** punch-in (`coordinate-target-zoom`) on the price "R$ 48,00" row, modest, holding there.
Scene 3 (3.52–3.9s): on "Pix" the screen slides to the payment step (Pix selected) and the zoom eases back to the full phone; at 3.83 the Pix option row gets a lime ring that blooms and settles → **keyword glow** (`asr-keyword-glow`), with the "Pago" note.
Scene 4 (3.9–4.4s): hold, still.

## Frame 5 — O pedido chega sozinho

- scene: A push drops in, "Pedido #29 chegou · Luiz · R$ 219,00 · entrega", with the brand's two-note chime; the phone lands on order #29 with "aceitar"
- voiceover: "E o pedido chega sozinho."
- duration: 3.4s
- transition_in: push-slide LEFT
- status: built
- src: compositions/frames/05-pedido-chega.html
- type: benefit_highlight
- persuasion: Future pacing (the order without the conversation)
- beat: satisfaction + control
- asset_candidates: assets/pedido-creme-750.webp — Pedido #29, Luiz Fernando, Total R$ 219,00, "aceitar · 30 min"

narrativeRole: pay off the hook — the same Luiz now ordered by himself.
keyMessage: "No more back-and-forth."

The customer's phone slides out left and the merchant's phone slides in (push-slide LEFT), so the
two sides of the same order read as two phones. Then the admin's own "an order arrives" moment (spring drop, shadow bloom e2→e1, lime edge fading),
with its "Pedido novo" chime and a double vibration buzz.

- blueprint: compose
- focal: the push notification "Pedido #29 chegou"
- roles: pedido-creme-750.webp = the merchant's phone screen (Pedido #29, Luiz Fernando, R$ 219,00)
- sfx: swipe (0.0 s, phone in), pedido-novo (0.18 s), buzz (0.22 s)

Compose: the admin's own "an order arrives" moment on the merchant's phone.
Scene 1 (0.0–0.18s): the merchant's phone (same CSS frame and position as Frame 4) is on screen with the real Pedido #29 screen as the push-slide lands it.
Scene 2 (0.18–1.2s): the push card drops in from above to y ~270 (80% wide, over the phone's top) → **spring-pop entrance** (`spring-pop-entrance`, smooth) with a shadow bloom e2→e1 and a lime edge that fades out over ~1 s; app "Minha loja · agora", title "Pedido #29 chegou", body "Luiz · R$ 219,00 · entrega", action "aceitar". The phone gives two tiny horizontal shakes at 0.22 and 0.42 (the double buzz) — finite, low amplitude.
Scene 3 (1.2–3.4s): VO "E o pedido chega sozinho"; everything holds still.

## Frame 6 — 14 dias grátis

- scene: On Noite, the Venduá mark draws on; three calm lines land in turn: "Comece com 14 dias grátis." / "Venduá Basic, sem cartão." / "Link na bio · @vendua.digital"
- voiceover: "Comece com 14 dias grátis. Venduá Basic, sem cartão. Link na bio."
- duration: 8.85s
- transition_in: blur-crossfade
- status: built
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
- sfx: none (the music resolves)

Adapt: keep the calm end-card stack terminating on a held handle; the three lines land one per spoken sentence instead of hard-cut cards, left-aligned (x 72) to clear the Reels action column.
Scene 1 (0.0–0.3s): night ground; the lime check mark draws itself → **SVG self-draw** (`svg-path-draw`) and "venduá." fades up beside it (Space Grotesk 700, lime dot) at y ~390.
Scene 2 (0.3–2.9s): "Comece com / 14 dias grátis." (`title`, `night-ink`, two lines, y ~605) reveals word by word on its spoken words (0.30, 0.90, 1.16, 1.92, 2.42) → **per-word staggered reveal** (`dynamic-content-sequencing`).
Scene 3 (3.72s): on "Venduá", the lime chip "Venduá Basic, sem cartão." (`subtitle`, forest on lime) rises in at y ~907 (`spring-pop-entrance`, smooth).
Scene 4 (6.72s): on "Link", "Link na bio · @vendua.digital" (`label` scale, `night-ink`) fades up at y ~1091.
Scene 5 (7.5–8.85s): the held frame — nothing moves. This is the final frame: a gentle 0.4 s fade of the whole card to night at 8.45–8.85 is the only exit in the film.
