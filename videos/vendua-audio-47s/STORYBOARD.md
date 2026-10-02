---
format: 1080x1920
duration: 30s
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
fictional; the numbers (R$ 48,00, R$ 219,00, #29) come from the captured screens.

Sketches: `storyboard.html` (v1).

## Frame 1 — O áudio

- scene: A voice-note bubble from "L" fills the frame, "0:47"; the play button is tapped and the waveform starts moving with the customer's voice
- voiceover: "Oi, boa tarde! Tudo bem? Então… vocês têm cardápio? Quanto tá o bolo de chocolate? Ah, e aceita Pix?"
- duration: 6s
- transition_in: cut
- status: built
- src: compositions/frames/01-o-audio.html
- type: hook
- persuasion: Pain validation (the viewer's own inbox, heard)
- beat: recognition + mild dread
- asset_candidates: none (drawn voice-note bubble, system-UI style)

narrativeRole: stop the scroll with a sound and a shape every merchant knows — the long customer voice note.
keyMessage: "This is the message you get all day."

Spoken by the customer voice (Luiz), not the narrator. No music. The duration reads 0:47 while only
the first ~6 s play, so the long unplayed waveform is the joke. Captions light "cardápio",
"quanto" and "Pix" as the three questions (lime chips behind forest text).

## Frame 2 — De novo

- scene: The bubble shrinks into a pile as more voice notes from other customers land around it (0:32, 1:12, 0:58, 2:05)
- voiceover: "Áudio de 47 segundos. Enquanto o bolo tá no forno. E ainda tem mais na fila."
- duration: 4s
- transition_in: cut
- status: built
- src: compositions/frames/02-de-novo.html
- type: pain_point
- persuasion: Pain agitation
- beat: overwhelm
- blueprint: overwhelm-surround — voice notes pile in until they bury the first one
- asset_candidates: none (drawn voice-note bubbles)

narrativeRole: name the cost — time the merchant doesn't have, multiplied.
keyMessage: "Answering one by one doesn't scale."

The narrator enters, warm and a little wry; the music bed starts under it.

## Frame 3 — Um link só

- scene: The pile condenses into one lime link pill, "bolosdanena.vendua.com.br", and a tap opens it
- voiceover: "Com o Venduá, você responde com um link só."
- duration: 3s
- transition_in: zoom-through
- status: built
- src: compositions/frames/03-um-link.html
- type: product_intro
- persuasion: Friction reduction (many answers → one link)
- beat: relief
- blueprint: cta-morph-press — the pile of widgets condenses into the one thing you tap
- asset_candidates: assets/loja-creme-750.webp — the Loja screen with the store's real link "bolosdanena.vendua.com.br"

narrativeRole: land the promise by beat 3 — one link replaces the replies.
keyMessage: "Your store is a link."

The link text is the real one from the Loja screen. The Venduá name is spoken, not shown as a logo
yet (the logo closes the video).

## Frame 4 — Cardápio, preço e Pix

- scene: The phone shows what the customer sees: the menu with prices, the chocolate cake's R$ 48,00, then Pix as the way to pay — one screen per spoken word
- voiceover: "Cardápio… preço… e Pix."
- duration: 4.5s
- transition_in: crossfade
- status: built
- src: compositions/frames/04-cardapio-preco-pix.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (each question answered by a real screen)
- beat: clarity
- blueprint: device-surface-showcase — device hero whose screen cycles on each cue
- asset_candidates: assets/cardapio-creme-750.webp — Cardápio with real prices (Bolo de chocolate molhadinho R$ 48,00); assets/inicio-creme-750.webp — Início with "1 Pix para conferir" (fallback for the Pix cue if the storefront isn't captured)

narrativeRole: answer the three questions from Frame 1, in the same order, with proof.
keyMessage: "Everything they asked is already there."

Recommended: capture the real customer storefront of Bolos da Nena (menu page and the checkout's
payment step with Pix selected) and use it here instead of the admin screens; see the plan notes.

## Frame 5 — O pedido chega sozinho

- scene: A push drops in, "Pedido #29 chegou · Luiz · R$ 219,00 · entrega", with the brand's two-note chime; the phone lands on order #29 with "aceitar"
- voiceover: "E o pedido chega sozinho."
- duration: 3.5s
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

## Frame 6 — 14 dias grátis

- scene: On Noite, the Venduá mark draws on; three calm lines land in turn: "Comece com 14 dias grátis." / "Venduá Basic, sem cartão." / "Link na bio · @vendua.digital"
- voiceover: "Comece com 14 dias grátis. Venduá Basic, sem cartão. Link na bio."
- duration: 6s
- transition_in: blur-crossfade
- status: built
- src: compositions/frames/06-14-dias.html
- type: cta
- persuasion: Risk reversal (free, no card)
- beat: urgency-to-act
- blueprint: titlecard-reveal — a calm end-card stack terminating on the held handle
- asset_candidates: assets/mark-lime.svg — the Venduá check mark in lime, for night

narrativeRole: convert — the offer, the plan, where to go.
keyMessage: "Try it free for 14 days, no card."

The card text is exactly the brief's, left-aligned to stay clear of the Reels action column:
"Comece com 14 dias grátis." as the title, "Venduá Basic, sem cartão." on a lime chip, then "Link
na bio · @vendua.digital". No captions on this frame. The handle holds to the last frame.
