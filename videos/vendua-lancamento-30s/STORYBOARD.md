---
format: 1080x1920
duration: 30s
message: 'O Duá, o vendedor com inteligência artificial do Venduá, atende o WhatsApp da sua loja e fecha o pedido. Comece pelo Venduá Bandeira, 14 dias grátis, sem cartão.'
arc: meet the AI seller → it sells (price from the menu, upsell, Pix) → you can take over → CTA
audience: Brazilian food sellers who sell by WhatsApp (doceiras, marmitarias, hamburguerias, padarias)
mode: autonomous
music: energetic Brazilian pop-funk launch bed, 128 BPM, full energy from the first frame, ducked under every line; every cut lands on its eighth-note grid
---

# Venduá — Lançamento, corte de 30 s sobre IA (Reel, 29.1 s, 9:16)

The AI cut of `videos/vendua-lancamento`: the Duá, the AI seller on the store's WhatsApp. A new
opening line introduces him; then the main film's Duá sequence (Caio's voice note, the sale on the
real conversation, the one-tap takeover) and its end card, with the same takes, bed and sound. The
feature header reads "IA · O Duá vende" instead of "2 · O Duá vende". Truthfulness, assets and
numbers are the main film's (`../vendua-lancamento/STORYBOARD.md`).

## Video direction

- **Palette** (frame.md): cream `canvas` with static paper grain on frames 1 (after its night open)
  to 8; `surface` cards; `ink` forest type, numerals and buttons; `spark` lime only on something
  alive or new (the feature disc, chips, rings, the push edge, the trial chip), always behind forest
  text. Frame 1 opens on `night`; Frame 9 is on `night` with `night-ink` type and the lime mark.
- **Type** by role from frame.md: numerals/titles in Space Grotesk 600, labels and chips in Figtree.
  No serif in this film. Visible text is short keyword copy; the captions carry the sentences.
- **Canvas and keep-out**: 1080×1920. Readable content in y 250–1280, x 72–940. Captions own
  y 1300–1520 on frames 1–8. Frame 9 has no captions.
- **The feature header**: frames 2–8 carry a header row once their title compacts: a 92 px lime disc
  with the feature numeral, then the feature name, at y 250–342 (see the brief for exact geometry).
  It is identical across a feature's frames, so cuts inside a feature don't jump.
- **Motion grammar (frenético)**: arrivals 0.18–0.28 s slams (`expo.out`/`power4.out`, from scale
  ~1.12 or a 60–120 px drop, shadow e2→e1 inside the same 0.2 s); punch-ins on stressed words (1→1.05
  in 0.1 s, back in 0.25 s); shakes on hits (fixed decaying offsets, ≤12 px, ≤0.8°, 0.25 s); camera
  moves on screens are `coordinate-target-zoom` punch-ins on the exact real UI the voice names.
  Never bouncy. Transform and opacity only. Every entrance a `fromTo`. No exits except Frame 9.
- **Reveal model**: nothing appears before the voice names it; something moves on every beat; no
  hold longer than ~0.6 s except the end card's last ~1.6 s.
- **Rhythm**: 128 BPM (beat 0.469 s, eighth 0.234 s). All cuts are on the grid. Whooshes peak on the
  cuts 1→2, 3→4 and 6→7; an accent lands each feature numeral and the end card.
- **Sound**: the premium set (soft, tonal, under the voice) plus a soft printer and an order-ready
  chime. One sound per moment.
- **Negative list**: no WhatsApp/Instagram UI or green, no fake screens, no redrawn app UI (the push
  card is the only system UI), no AI images or photos, no glow or sparkles, no all-caps or eyebrow
  labels, no lazy breathing, no screensaver motion, no repeat/yoyo, no randomness.

## Frame 1 — Conheça o Duá

- scene: "IA · O Duá vende" slams in with Duá; the shop's phone shows Caio's real voice note, the camera punches into it while it plays and Duá listens
- voiceover: "Conheça o Duá: o vendedor com inteligência artificial do Venduá, no WhatsApp da sua loja. — Oi, tudo bem? Tem bolo de cenoura com brigadeiro pra hoje?"
- duration: 9.609s
- transition_in: cut
- status: animated
- src: compositions/frames/01-dua.html
- type: feature_showcase
- persuasion: Recognition (the voice note every seller gets) → relief (someone answers it)
- beat: curiosity
- asset_candidates: assets/screens/dua-conversa-1-audio.webp — Vendedor conversation with Caio: his voice note 0:04 with transcript "Oi, tudo bem? Tem bolo de cenoura com brigadeiro pra hoje?", "Duá atendendo", floor "O Duá está atendendo · assumir"; assets/dua/avatar-feliz.webp — Duá happy

narrativeRole: feature 2 opens — the AI seller on the store's own WhatsApp, meeting the real voice note.
keyMessage: "Duá answers your WhatsApp."

- blueprint: compose
- focal: the shop's phone at the PHONE box, the voice-note bubble
- roles: dua-conversa-1-audio.webp = phone screen; avatar-feliz.webp = Duá cutout (listening)
- sfx: accent (0.0), pop-1 (0.72 "Duá"), pop-2 (2.02 "inteligência"), pop-4 (4.28 "WhatsApp"), tap (5.696, Caio's play)
- handoff_out: phone (frame.md device) — at 9.609 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-1-audio.webp at camera 1×, still; feature header "IA · O Duá vende" at the brief's header geometry, opacity 1, still; Duá listening badge — avatar-feliz 132 px at x 120, y 1110 (top-left), scale 1, opacity 1, still

Scene 1 (0.0–2.7s): at 0.08 ("Dois:") the lime disc "2" slams in big (300 px, x 72, y 300); "O Duá vende" (title, 104 px) lands word by word on "Duá" 1.00 and "vende" 1.30, and avatar-feliz pops beside the title on "Duá" 1.00 (`spring-pop-entrance`); at 2.34 ("WhatsApp.") a spark-chip "no WhatsApp da loja" shoots out under the title.
Scene 2 (2.7–3.0s): the title block compacts into the header (0.25 s); the shop's phone slams up into the PHONE box on the conversation screen.
Scene 3 (3.018–6.5s): on the play tap (3.018) a tap ring lands on the voice note's play button and the camera punches to 1.7× on the voice-note bubble + transcript (`coordinate-target-zoom`, 0.28 s). While Caio talks (3.20–6.55), a "listening" badge rises at the phone's lower left: avatar-feliz (132 px, x 120, y 1110) with five lime bars beside it whose heights follow `audio/f04-envelope.json` (frame-relative, 30 fps). Punch-ins on "cenoura" 5.06 and "hoje?" 6.22.
Scene 4 (6.5–6.797s): the camera returns to 1× (0.25 s) to the handoff state.

Built as the main film's Frame 4 with its choreography time-remapped onto this line (the WARP
table in `01-dua.html`): the "IA" disc slams on "Conheça" 0.12, "O Duá" lands on "Duá" 0.72, "vende"
on "vendedor" 1.42, the lockup punches on "inteligência" 2.02, the disc on "artificial" 2.58, Duá on
"Venduá" 3.40, the chip "no WhatsApp da loja" on "WhatsApp" 4.28 and punches on "loja." 4.98; the
title compacts at 5.20; the play tap at 5.696; Caio talks 5.876–9.35, with everything in Scene 3
2.678 s later than above.

## Frame 2 — O Duá vende

- scene: The real conversation grows: Duá's price R$ 45,00, the slice offer R$ 9,50, Core's summary R$ 62,50, the Pix card — each punched on as it is named
- voiceover: "Ele ouve o áudio e responde na hora, com o preço do seu cardápio, sem chute. Oferece uma fatia a mais, fecha o pedido e manda o Pix."
- duration: 8.672s
- transition_in: cut
- status: animated
- src: compositions/frames/02-dua-vende.html
- type: feature_showcase
- persuasion: Proof by demonstration (the whole sale, real figures)
- beat: amazement
- asset_candidates: assets/screens/dua-conversa-2-preco.webp — Duá: "Oi! Sou o Duá, assistente virtual da Bolos da Nena." / "Tem sim! O bolo de cenoura com brigadeiro inteiro sai R$ 45,00."; assets/screens/dua-conversa-3-adicional.webp — "Quer levar também uma fatia de chocolate para comer hoje? Sai R$ 9,50." / Caio "Quero a fatia também" / "É para entregar ou você vem buscar?"; assets/screens/dua-conversa-4-resumo.webp — "A entrega aí fica R$ 8,00" + Core's summary card (R$ 45,00, R$ 9,50, entrega R$ 8,00, Total R$ 62,50); assets/screens/dua-conversa-5-pix.webp — "Pedido #30 feito", the Pix cards "Pix do pedido #30 · R$ 62,50" and copia e cola

narrativeRole: feature 2 in depth — answer, price from the menu, upsell, close, Pix.
keyMessage: "It sells like your best salesperson, with your real prices."

- blueprint: compose
- focal: the shop's phone at the PHONE box
- roles: the four screens in order = the phone's screen states
- sfx: pop-2 (1.16 "responde"), pop-3 (5.305 "fatia"), pago (7.725 "Pix")
- handoff_in: phone — at 0.0 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-1-audio.webp at camera 1×, still; header "IA · O Duá vende" at the brief's header geometry, opacity 1, still; listening badge avatar-feliz 132 px at x 120, y 1110, scale 1, opacity 1, still
- handoff_out: phone — at 8.672 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-5-pix.webp at camera 1×, still; header unchanged, opacity 1, still; no badge

Each new screen arrives like new messages: the incoming screen slides up 140 px into place while the old one fades under it (0.22 s `expo.out`), never a dissolve.
Scene 1 (0.0–1.1s): the handoff state; on "ouve" 0.26 the listening badge's bars do one last pulse and the badge drops away by 0.6 (the only element exit allowed: it is mid-frame, not the frame's exit).
Scene 2 (1.16–4.6s): on "responde" 1.16 → dua-conversa-2-preco. On "preço" 2.52 the camera punches to 1.75× on the "R$ 45,00" bubble; on "cardápio," 3.12 a spark-chip "preço do seu cardápio" slams in at the phone's left edge (x 60, y ~820) with a short forest connector line to the bubble; "chute." 3.96 punch.
Scene 3 (4.77–6.3s): camera back to 1×; on "fatia" 5.305 → dua-conversa-3-adicional and the camera punches on "Sai R$ 9,50."
Scene 4 (6.35–7.6s): on "fecha" 6.35 → dua-conversa-4-resumo; camera 1.6× on the summary card's "Total R$ 62,50".
Scene 5 (7.725–8.672s): on "Pix." 7.725 → dua-conversa-5-pix; a lime ring snaps onto the "Pix do pedido #30 · R$ 62,50" card with a shake; camera eases back to 1× by 8.5.

## Frame 3 — Você assume

- scene: The real floor bar "O Duá está atendendo · assumir" — one tap — "Você está atendendo" with the composer open
- voiceover: "Precisou de você? Um toque, e você assume a conversa."
- duration: 3.750s
- transition_in: cut
- status: animated
- src: compositions/frames/03-assumir.html
- type: feature_showcase
- persuasion: Control (the owner is never locked out)
- beat: trust
- asset_candidates: assets/screens/dua-conversa-6-assumir.webp — the thread top (Caio, "Duá atendendo") with the floor bar "O Duá está atendendo · assumir"; assets/screens/dua-conversa-7-assumido.webp — "Você está atendendo", "devolver ao Duá", composer "Escreva sua resposta…", "Pedido #30 feito · pago"

narrativeRole: feature 2's safety valve — one tap and the owner takes over.
keyMessage: "You can step in any time."

- blueprint: compose
- focal: the "assumir" button on the real floor bar
- roles: the two screens = before/after
- sfx: tap (1.38 "toque")
- handoff_in: phone — at 0.0 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-5-pix.webp at camera 1×, still; header "IA · O Duá vende", opacity 1, still

Scene 1 (0.0–1.3s): on "Precisou" 0.08 the screen slides to dua-conversa-6-assumir; the camera punches to 1.8× on the floor bar ("O Duá está atendendo" + "assumir") by 0.5.
Scene 2 (1.38s): on "toque," a tap ring (`cursor-click-ripple`, no cursor) lands on "assumir", which presses (`press-release-spring`).
Scene 3 (1.6–3.75s): at 1.6 the screen swaps to dua-conversa-7-assumido (the camera holds the same floor region, now "Você está atendendo" + composer); punch on "assume" 2.28; "conversa." 2.72 a spark-chip "você no comando" pops beside the phone (x 60, y ~760); the camera eases out to 1.2× into the cut.

## Frame 4 — Venduá Bandeira

- scene: On night, the lime check draws, "venduá." lands; "Comece pelo Venduá Bandeira" slams in word by word; a lime chip "14 dias grátis, sem cartão."; "Link na bio · @vendua.digital"; held
- voiceover: "Venduá. Comece pelo Venduá Bandeira: catorze dias grátis, sem cartão."
- duration: 7.031s
- transition_in: cut
- status: animated
- src: compositions/frames/04-bandeira.html
- type: cta
- persuasion: Risk reversal (free, no card)
- beat: urgency-to-act
- asset_candidates: assets/brand/mark-lime.svg — the Venduá check in lime, for night

narrativeRole: convert — the plan to start on, the trial, where to go.
keyMessage: "Start on Venduá Bandeira: 14 days free, no card."

The card text is exactly the decided wording (ADR 0032): "Comece pelo Venduá Bandeira" as the
title, "14 dias grátis, sem cartão." on a lime chip, then "Link na bio · @vendua.digital".
Left-aligned at x 72, clear of the action column. No captions on this frame.

- blueprint: titlecard-reveal (Adapt)
- focal: "Comece pelo Venduá Bandeira"
- roles: mark-lime.svg = the logo mark
- sfx: accent (0.0, the cut), swipe (2.14 "Bandeira")

Scene 1 (0.0–0.5s): night ground; the lime check slams in (scale 1.3→1, 0.2 s, 132 px box at x 72, y 330) and draws (0.25 s); on "Venduá." 0.12 "venduá." (Space Grotesk 700, 96 px, night-ink, lime final dot) pops beside it.
Scene 2 (0.84–2.3s): "Comece pelo / Venduá Bandeira" (Space Grotesk 600, 124 px, night-ink, two lines, y ~560) slams in word by word on "Comece" 0.94, "pelo" 1.40, "Venduá" 1.62, "Bandeira:" 2.14 (each 0.2 s from 60 px below at scale 1.08, `expo.out`); the stack punches to 1.03 on "Bandeira".
Scene 3 (2.86–4.7s): on "catorze" 2.86 the lime chip "14 dias grátis, sem cartão." (Figtree 750, 56 px, forest on lime) shoots out from its left edge (0.22 s); punch on "cartão." 4.54.
Scene 4 (4.9s): "Link na bio · @vendua.digital" (Figtree 650, 46 px, night-muted with the handle in night-ink) slams up.
Scene 5 (5.2–7.031s): the held frame — nothing moves; the last 0.3 s fade the card to night, the film's only exit.
