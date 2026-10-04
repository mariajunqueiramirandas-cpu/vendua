---
format: 1080x1920
duration: 64s
message: 'Chegou o Venduá: a loja online com um vendedor no WhatsApp e uma cozinha que vê tudo na hora. Comece pelo Venduá Bandeira, 14 dias grátis, sem cartão.'
arc: launch hook → the three features in the order a store lives them (open the store → sell → cook) → CTA
audience: Brazilian food sellers who sell by WhatsApp (doceiras, marmitarias, hamburguerias, padarias)
mode: autonomous
music: energetic Brazilian pop-funk launch bed, 128 BPM, full energy from the first frame, ducked under every line; every cut lands on its eighth-note grid
---

# Venduá — Lançamento (Reel, ~64 s, 9:16, frenético cut)

A launch announcement that opens each of the three features up and shows how it works, on real
screens. The spine is **one order**: Caio's voice note becomes order #30 (R$ 62,50) in Frame 4–5,
the owner can take over in Frame 6, #30 lands on the phone, is accepted and printed in Frame 7, and
cooks, goes Pronto and reaches Caio's own phone in Frame 8. Frames 2–3 set the store up first.

**Truthfulness.** Every screen is a real capture of Venduá's admin, kitchen display or storefront
running the fictional dev store Bolos da Nena (`capture/extracted/asset-descriptions.md`). Caio is
fictional; his order's numbers are what Core rendered: #30, 1× Bolo de cenoura com brigadeiro
R$ 45,00, 1× Fatia de chocolate R$ 9,50, entrega R$ 8,00, total R$ 62,50, paid by Pix. The push is
Core's real push text. The pickup board is not used (it would show a delivery as "pronto para
retirar"). No prices or plans beyond the decided CTA.

**Shared brief for frame builders:** `.hyperframes/frame-brief.md` (stage boxes, motion grammar,
components, the cue table). Every Scene time below is a word start from `audio/cues.json`.

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

## Frame 1 — Chegou

- scene: On night, the lime check slams in and draws, "venduá." lands big; the ground flips to cream and three real screens fan in on "loja", "vendedor", "cozinha"
- voiceover: "Chegou o Venduá! A sua loja online, com um vendedor que nunca larga o WhatsApp e uma cozinha que vê tudo na hora."
- duration: 7.500s
- transition_in: cut
- status: animated
- src: compositions/frames/01-chegou.html
- type: hook
- persuasion: Launch novelty + the promise in one breath
- beat: arrival
- asset_candidates: assets/brand/mark-lime.svg — the Venduá check in lime; assets/screens/vitrine-cardapio-750.webp — the real storefront's Cardápio (the "loja online"); assets/screens/dua-conversa-2-preco.webp — the Duá answering Caio with "R$ 45,00" (the "vendedor"); assets/screens/cozinha-phone.webp — the kitchen display on a phone, #30 Caio (the "cozinha")

narrativeRole: stop the scroll with the launch, then preview all three features as one product.
keyMessage: "Venduá is here: store + seller + kitchen."

- blueprint: compose
- focal: the logo, then the three-card fan
- roles: mark-lime.svg = logo mark (night); the three screens = mini devices in a fan (supporting)
- sfx: accent (0.0), pop-1 (1.866 "loja"), pop-2 (2.986 "vendedor"), pop-3 (5.246 "cozinha"), whoosh (7.35, into the cut)

Scene 1 (0.0–1.45s): night ground. At 0.0 the lime check slams in (scale 1.3→1, 0.2 s) centered at x 506, y 640, 260 px box, and draws itself (`svg-path-draw`, 0.25 s); at 0.70 ("Venduá!") "venduá." (Space Grotesk 700, 168 px, night-ink, the final dot lime) slams in below it at y ~840 with a hard punch (1→1.06→1) and a shake.
Scene 2 (1.45–1.75s): the ground flips to cream (`theme-crossfade-morph`, 0.25 s) while the logo compacts to a small lockup at the top (mark 64 px + "venduá." 64 px, ink, centered x 506, y 270) — it stays there.
Scene 3 (1.866–6.55s): three mini devices (frame.md `device`, each 250 px wide, real screens at native aspect, ~523 px tall) fan in, one per word: "loja" 1.866 → left card (x 101, y 470, −5°) vitrine-cardapio; "vendedor" 2.986 → middle card (x 381, y 430, 0°, on top) dua-conversa-2-preco; "cozinha" 5.246 → right card (x 661, y 470, +5°) cozinha-phone. Each arrives with `kinetic-beat-slam` from 100 px below at scale 1.12 + a spark-chip label under it at y ~1060 ("loja", "vendedor", "cozinha", Figtree 650, 34 px). On "WhatsApp" 4.45 the middle card punches. On "hora." 6.55 all three punch together with one shake.
Scene 4 (6.8–7.5s): a slow push-in on the whole fan (1→1.04), still moving into the cut.

## Frame 2 — Loja no ar

- scene: "1 · Loja no ar" slams in; then the real Duá setup screen: the camera starts on Duá's greeting, pans to "Sua loja, ao vivo" and punches on the store name, colors and menu as they are named
- voiceover: "Um: a sua loja no ar em cerca de uma hora. Você conversa com o Duá, e ele monta tudo: nome, cores, cardápio."
- duration: 8.203s
- transition_in: zoom-through 0.25s
- status: animated
- src: compositions/frames/02-loja-no-ar.html
- type: feature_showcase
- persuasion: Effort reduction (an hour, in a conversation)
- beat: possibility
- asset_candidates: assets/screens/boasVindasDesktop-creme-2880.webp — the desktop setup: Duá's chat "Oi, Nena! Meu nome é Duá. Vou montar a sua loja junto com você…" on the left, "Sua loja, ao vivo" phone on the right (Bolos da Nena, "Bolo de vó, feito hoje.", Hoje 7h–21h, product cards with prices); assets/dua/avatar-ola.webp — Duá waving

narrativeRole: feature 1 — a store exists in about an hour, set up by talking.
keyMessage: "Talk to Duá; the store builds itself."

- blueprint: compose
- focal: the desktop setup screen, framed as a wide device card
- roles: boasVindasDesktop-creme-2880.webp = hero screen (a browser-less rounded card, 868 px wide); avatar-ola.webp = Duá cutout (supporting)
- sfx: accent (0.08 "Um"), tap (4.15 "Duá"), pop-1 (5.79 "nome"), pop-2 (6.43 "cores"), pop-4 (7.03 "cardápio")
- handoff_out: none (clean cut)

Scene 1 (0.0–3.1s): at 0.08 ("Um:") the lime disc with "1" (Space Grotesk 600) slams in big (disc 300 px, x 72, y 300); "Loja no ar" (title, 104 px) lands word by word beside/below it on "loja" 0.98 and "ar" 1.46; at 2.24 ("uma hora.") a spark-chip "em cerca de 1 hora" shoots out from its left edge under the title, punch on 2.52.
Scene 2 (3.1–3.4s): the title block compacts into the feature header (brief: header geometry) in 0.25 s.
Scene 3 (3.25–4.9s): the setup screen card (868×542, x 72, y 420, radius 24, shadow e2→e1) slams up on "Você" 3.25. Camera (inside the card, `coordinate-target-zoom`) starts at 1.9× on Duá's avatar and greeting bubble; at "Duá" 4.15 Duá's own avatar cutout (avatar-ola, 150 px) pops out over the card's top-left corner with `spring-pop-entrance`.
Scene 4 (4.87–7.6s): on "monta" 4.87 the camera pans right to the "Sua loja, ao vivo" phone (1.6×); "nome" 5.79 → punch on "Bolos da Nena" + spark-chip "nome" pops under the card (x 72, y 1000); "cores" 6.43 → punch on the green header/"Hoje: 7h–21h" chip + spark-chip "cores" (next to the first); "cardápio" 7.03 → camera slides down to the product grid with prices + spark-chip "cardápio". Chips land with `kinetic-beat-slam`, ≤0.2 s each.
Scene 5 (7.6–8.203s): settled on the grid, a small continuous drift (≤20 px) into the cut.

## Frame 3 — Pix na sua conta

- scene: The customer's phone on the real storefront: a link pill lands, "sem cadastro" pops, the screen whips to checkout with Pix ringed, "na sua conta do Mercado Pago" closes it
- voiceover: "O cliente pede pelo link, sem cadastro, e paga no Pix, direto na sua conta do Mercado Pago."
- duration: 6.094s
- transition_in: cut
- status: animated
- src: compositions/frames/03-pix.html
- type: feature_showcase
- persuasion: Friction removal for the customer + money where it belongs
- beat: clarity
- asset_candidates: assets/screens/vitrine-cardapio-750.webp — the storefront's Cardápio (Bolo de cenoura com brigadeiro R$ 45,00); assets/screens/vitrine-pagamento-750.webp — checkout, Pagamento step, Pix selected (radio), "Confirmar pedido · R$ 219,00"

narrativeRole: feature 1, the customer side — order by link, no account, Pix to the merchant.
keyMessage: "The customer orders and pays without friction."

- blueprint: device-surface-showcase (Adapt)
- focal: the customer's phone (CSS device at the PHONE box)
- roles: vitrine-cardapio-750.webp = screen 1; vitrine-pagamento-750.webp = screen 2
- sfx: swipe (1.04 "link"), pago (3.04 "Pix"), whoosh (5.944, into the cut)

Adapt: one held device whose screen changes on the spoken cue; the keywords land as chips around it.
Scene 1 (0.0–1.0s): the feature header ("1 · Loja no ar") is in place from frame 0; the phone (the PHONE box from the brief) slams up from 120 px below (0.22 s) on the storefront Cardápio.
Scene 2 (1.04s): on "link," a lime link pill "bolosdanena.vendua.com.br" (Figtree 650, 34 px, mark icon) slams over the phone's top edge (centered x 506, y ~400) with a tap ring and a shake.
Scene 3 (1.78s): on "cadastro," a spark-chip "sem cadastro" pops at the phone's left edge (x 60, y ~700, −4°).
Scene 4 (3.04s): on "Pix," the screen whips to the checkout (`scale-swap-transition`, 0.2 s) and the camera punches to 1.45× on the Pix row; at 3.10 a lime ring snaps onto the Pix row with a shake.
Scene 5 (4.76–6.0s): camera back to 1×; on "Mercado" 4.76 a surface chip with a lime edge "na sua conta do Mercado Pago" slams in over the phone's bottom (y ~1130), punch on "Pago." 5.06; settle.

## Frame 4 — O Duá no WhatsApp

- scene: "2 · O Duá vende" slams in with Duá; the shop's phone shows Caio's real voice note, the camera punches into it while it plays and Duá listens
- voiceover: "Dois: o Duá vende por você no WhatsApp. — Oi, tudo bem? Tem bolo de cenoura com brigadeiro pra hoje?"
- duration: 6.797s
- transition_in: zoom-through 0.25s
- status: animated
- src: compositions/frames/04-dua-whatsapp.html
- type: feature_showcase
- persuasion: Recognition (the voice note every seller gets) → relief (someone answers it)
- beat: curiosity
- asset_candidates: assets/screens/dua-conversa-1-audio.webp — Vendedor conversation with Caio: his voice note 0:04 with transcript "Oi, tudo bem? Tem bolo de cenoura com brigadeiro pra hoje?", "Duá atendendo", floor "O Duá está atendendo · assumir"; assets/dua/avatar-feliz.webp — Duá happy

narrativeRole: feature 2 opens — the AI seller on the store's own WhatsApp, meeting the real voice note.
keyMessage: "Duá answers your WhatsApp."

- blueprint: compose
- focal: the shop's phone at the PHONE box, the voice-note bubble
- roles: dua-conversa-1-audio.webp = phone screen; avatar-feliz.webp = Duá cutout (listening)
- sfx: accent (0.08 "Dois"), tap (3.018, Caio's play)
- handoff_out: phone (frame.md device) — at 6.797 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-1-audio.webp at camera 1×, still; feature header "2 · O Duá vende" at the brief's header geometry, opacity 1, still; Duá listening badge — avatar-feliz 132 px at x 120, y 1110 (top-left), scale 1, opacity 1, still

Scene 1 (0.0–2.7s): at 0.08 ("Dois:") the lime disc "2" slams in big (300 px, x 72, y 300); "O Duá vende" (title, 104 px) lands word by word on "Duá" 1.00 and "vende" 1.30, and avatar-feliz pops beside the title on "Duá" 1.00 (`spring-pop-entrance`); at 2.34 ("WhatsApp.") a spark-chip "no WhatsApp da loja" shoots out under the title.
Scene 2 (2.7–3.0s): the title block compacts into the header (0.25 s); the shop's phone slams up into the PHONE box on the conversation screen.
Scene 3 (3.018–6.5s): on the play tap (3.018) a tap ring lands on the voice note's play button and the camera punches to 1.7× on the voice-note bubble + transcript (`coordinate-target-zoom`, 0.28 s). While Caio talks (3.20–6.55), a "listening" badge rises at the phone's lower left: avatar-feliz (132 px, x 120, y 1110) with five lime bars beside it whose heights follow `audio/f04-envelope.json` (frame-relative, 30 fps). Punch-ins on "cenoura" 5.06 and "hoje?" 6.22.
Scene 4 (6.5–6.797s): the camera returns to 1× (0.25 s) to the handoff state.

## Frame 5 — O Duá vende

- scene: The real conversation grows: Duá's price R$ 45,00, the slice offer R$ 9,50, Core's summary R$ 62,50, the Pix card — each punched on as it is named
- voiceover: "Ele ouve o áudio e responde na hora, com o preço do seu cardápio, sem chute. Oferece uma fatia a mais, fecha o pedido e manda o Pix."
- duration: 8.672s
- transition_in: cut
- status: animated
- src: compositions/frames/05-dua-vende.html
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
- handoff_in: phone — at 0.0 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-1-audio.webp at camera 1×, still; header "2 · O Duá vende" at the brief's header geometry, opacity 1, still; listening badge avatar-feliz 132 px at x 120, y 1110, scale 1, opacity 1, still
- handoff_out: phone — at 8.672 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-5-pix.webp at camera 1×, still; header unchanged, opacity 1, still; no badge

Each new screen arrives like new messages: the incoming screen slides up 140 px into place while the old one fades under it (0.22 s `expo.out`), never a dissolve.
Scene 1 (0.0–1.1s): the handoff state; on "ouve" 0.26 the listening badge's bars do one last pulse and the badge drops away by 0.6 (the only element exit allowed: it is mid-frame, not the frame's exit).
Scene 2 (1.16–4.6s): on "responde" 1.16 → dua-conversa-2-preco. On "preço" 2.52 the camera punches to 1.75× on the "R$ 45,00" bubble; on "cardápio," 3.12 a spark-chip "preço do seu cardápio" slams in at the phone's left edge (x 60, y ~820) with a short forest connector line to the bubble; "chute." 3.96 punch.
Scene 3 (4.77–6.3s): camera back to 1×; on "fatia" 5.305 → dua-conversa-3-adicional and the camera punches on "Sai R$ 9,50."
Scene 4 (6.35–7.6s): on "fecha" 6.35 → dua-conversa-4-resumo; camera 1.6× on the summary card's "Total R$ 62,50".
Scene 5 (7.725–8.672s): on "Pix." 7.725 → dua-conversa-5-pix; a lime ring snaps onto the "Pix do pedido #30 · R$ 62,50" card with a shake; camera eases back to 1× by 8.5.

## Frame 6 — Você assume

- scene: The real floor bar "O Duá está atendendo · assumir" — one tap — "Você está atendendo" with the composer open
- voiceover: "Precisou de você? Um toque, e você assume a conversa."
- duration: 3.750s
- transition_in: cut
- status: animated
- src: compositions/frames/06-assumir.html
- type: feature_showcase
- persuasion: Control (the owner is never locked out)
- beat: trust
- asset_candidates: assets/screens/dua-conversa-6-assumir.webp — the thread top (Caio, "Duá atendendo") with the floor bar "O Duá está atendendo · assumir"; assets/screens/dua-conversa-7-assumido.webp — "Você está atendendo", "devolver ao Duá", composer "Escreva sua resposta…", "Pedido #30 feito · pago"

narrativeRole: feature 2's safety valve — one tap and the owner takes over.
keyMessage: "You can step in any time."

- blueprint: compose
- focal: the "assumir" button on the real floor bar
- roles: the two screens = before/after
- sfx: tap (1.38 "toque"), whoosh (3.6, into the cut)
- handoff_in: phone — at 0.0 s: PHONE box x 289, y 372, width 434, height 908, scale 1, rotation 0, opacity 1, screen dua-conversa-5-pix.webp at camera 1×, still; header "2 · O Duá vende", opacity 1, still

Scene 1 (0.0–1.3s): on "Precisou" 0.08 the screen slides to dua-conversa-6-assumir; the camera punches to 1.8× on the floor bar ("O Duá está atendendo" + "assumir") by 0.5.
Scene 2 (1.38s): on "toque," a tap ring (`cursor-click-ripple`, no cursor) lands on "assumir", which presses (`press-release-spring`).
Scene 3 (1.6–3.75s): at 1.6 the screen swaps to dua-conversa-7-assumido (the camera holds the same floor region, now "Você está atendendo" + composer); punch on "assume" 2.28; "conversa." 2.72 a spark-chip "você no comando" pops beside the phone (x 60, y ~760); the camera eases out to 1.2× into the cut.

## Frame 7 — A cozinha vê

- scene: "3 · A cozinha vê" slams in; the push "Pedido #30 chegou · Caio · R$ 62,50 · entrega" lands on the shop's phone, one tap accepts it, then the real Impressoras screen: EPSON automática, printing on accept
- voiceover: "Três: a cozinha vê o pedido na hora. O pedido cai no seu celular, você aceita num toque, e a comanda imprime sozinha."
- duration: 7.969s
- transition_in: zoom-through 0.25s
- status: animated
- src: compositions/frames/07-cozinha.html
- type: feature_showcase
- persuasion: Speed + zero manual steps
- beat: momentum
- asset_candidates: assets/screens/pedidos-novo-30.webp — Pedidos, Novos 2: #30 Caio (Bolo de cenoura com brigadeiro, Fatia de chocolate), R$ 62,50, Pago, "Fica pronto em 15/30/45", button "aceitar · 30 min"; assets/screens/pedido-30-aceitar.webp — the toast "Pedido #30 aceito"; assets/screens/impressoras.webp — Impressoras: Balcão conectado, EPSON TM-T20X "automática · imprimiu há 1 min", Quando imprimir "Ao aceitar o pedido"

narrativeRole: feature 3 opens — the order lands, is accepted in one tap and prints itself.
keyMessage: "From order to kitchen with one tap."

- blueprint: compose
- focal: the push card, then the "aceitar" button, then the EPSON row
- roles: pedidos-novo-30 → pedido-30-aceitar → impressoras = the phone's screen states; push = system UI (Core's text)
- sfx: accent (0.08 "Três"), pedido-novo (2.964 "pedido"), tap (5.264 "toque"), print (6.604 "imprime")
- handoff_out: feature header "3 · A cozinha vê" at the brief's header geometry, opacity 1, still (the phone does not continue)

Scene 1 (0.0–2.7s): at 0.08 ("Três:") the lime disc "3" slams in big (300 px, x 72, y 300); "A cozinha vê" (title, 104 px) lands on "cozinha" 0.88 and "vê" 1.32; at 2.12 ("hora.") a spark-chip "na hora" shoots out under it.
Scene 2 (2.7–2.95s): the title compacts into the header; the shop's phone slams into the PHONE box on pedidos-novo-30.
Scene 3 (2.964–4.5s): on "pedido" 2.964 the push card (frame.md `push`: app "Minha loja" + mark, "Pedido #30 chegou", "Caio · R$ 62,50 · entrega", action "aceitar"; 880×168 at x 100, y 370) slams down from above with its lime edge; the phone buzzes (±5 px at 3.0 and 3.15); punch on "celular," 3.84.
Scene 4 (4.56–5.8s): at 4.5 the push slides back up out of view (mid-frame); the camera punches to 1.5× on #30's card and its "aceitar · 30 min" button; on "toque," 5.264 a tap ring + press on the button and at 5.40 the screen swaps to pedido-30-aceitar (the toast "Pedido #30 aceito").
Scene 5 (5.82–7.969s): on "e a comanda" 6.08 the screen push-slides left to impressoras (camera 1×); on "imprime" 6.604 the camera punches to 1.7× on the EPSON TM-T20X row and a lime ring snaps around "automática"; on "sozinha." 6.96 a spark-chip "imprime ao aceitar" pops at the phone's right edge (x ~640, y ~980 — keep inside x 940).

## Frame 8 — O relógio da cozinha

- scene: The real kitchen display on a tablet: the camera reads #30's clock, then the amber and the late red tickets; #30 goes Pronto with one tap; Caio's phone shows "Pronto"
- voiceover: "Na tela da cozinha, cada pedido tem um relógio que avisa antes de atrasar. Ficou pronto? Um toque, e o cliente fica sabendo."
- duration: 7.969s
- transition_in: cut
- status: animated
- src: compositions/frames/08-relogio.html
- type: feature_showcase
- persuasion: Control under pressure (nothing slips)
- beat: confidence
- asset_candidates: assets/screens/cozinha.webp — Cozinha (2560×1600): #27 Rafael red "39:37 atrasado 10 min", #28 Mariana amber "21:37 faltam 8 min", #30 Caio green "14:37 faltam 15 min", #29 Luiz, "1 atrasado · 3 na fila"; assets/screens/cozinha-itens.webp — #30 with Bolo de cenoura ticked, "1/2", "pronto"; assets/screens/cozinha-pronto.webp — #30's ticket turned lime "#30 pronto · desfazer 5"; assets/screens/vitrine-pedido-pronto.webp — Caio's order page on the storefront: "Pedido #30 · Pronto · Chega entre 19:05 e 19:35", timeline Recebido / Confirmado / Em preparo / Pronto, Total R$ 62,50

narrativeRole: feature 3 in depth — the clock that warns, one tap to Pronto, the customer sees it.
keyMessage: "Nothing runs late without you knowing; the customer is kept in the loop."

- blueprint: compose
- focal: the tablet (frame.md `tablet`) with the kitchen display
- roles: cozinha → cozinha-itens → cozinha-pronto = the tablet's screen states; vitrine-pedido-pronto = the customer's phone (supporting, enters last)
- sfx: pop-1 (2.24 "relógio"), tap (5.755 "toque"), pronto (6.555 "cliente")
- handoff_in: feature header "3 · A cozinha vê" at the brief's header geometry, opacity 1, still

Scene 1 (0.0–1.2s): the tablet (868 px wide, x 72, y 380, landscape, frame.md `tablet`) slams up on the kitchen display; punch on "cozinha," 0.62.
Scene 2 (1.30–4.0s): the camera (inside the tablet screen) reads the tickets: on "relógio" 2.24 a 2.2× punch onto #30's green clock "14:37 · faltam 15 min"; on "antes" 3.30 it whips to #28's amber "21:37 · faltam 8 min"; on "atrasar." 3.80 it whips to #27's red striped "39:37 · atrasado 10 min" with a shake (≤10 px).
Scene 3 (4.63–6.0s): camera back to 1.3× on #30; on "Ficou" 4.63 the screen swaps to cozinha-itens (items ticked); on "toque," 5.755 a tap ring + press on #30's "pronto" and the screen swaps to cozinha-pronto (the lime "#30 pronto").
Scene 4 (6.17–7.969s): on "e o cliente" 6.17 Caio's phone (device, 560 px tall, x 560, y 700, +4°) slams up over the tablet's lower right on vitrine-pedido-pronto; on "cliente" 6.555 a lime ring snaps around "Pronto" on his screen; "sabendo." 7.07 punch.

## Frame 9 — Venduá Bandeira

- scene: On night, the lime check draws, "venduá." lands; "Comece pelo Venduá Bandeira" slams in word by word; a lime chip "14 dias grátis, sem cartão."; "Link na bio · @vendua.digital"; held
- voiceover: "Venduá. Comece pelo Venduá Bandeira: catorze dias grátis, sem cartão."
- duration: 7.031s
- transition_in: cut
- status: animated
- src: compositions/frames/09-bandeira.html
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
