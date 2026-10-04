---
format: 1080x1920
duration: 15s
message: 'Chegou o Venduá: a loja online com um vendedor no WhatsApp e uma cozinha que vê tudo na hora. Comece pelo Venduá Bandeira, 14 dias grátis, sem cartão.'
arc: launch announcement → CTA
audience: Brazilian food sellers who sell by WhatsApp (doceiras, marmitarias, hamburguerias, padarias)
mode: autonomous
music: energetic Brazilian pop-funk launch bed, 128 BPM, full energy from the first frame, ducked under every line; every cut lands on its eighth-note grid
---

# Venduá — Lançamento, corte de 15 s (Reel, 14.5 s, 9:16)

The 15 s cut of `videos/vendua-lancamento`: only the announcement, nothing in depth. It is that
film's Frame 1 (the launch: the logo, then the store, the seller and the kitchen as three real
screens) cut straight to its Frame 9 (the end card), with the same takes, bed and sound. The
frames are the main film's files, unchanged; only the mix is rebuilt for two frames.

## Video direction

- **Palette** (frame.md): cream `canvas` with static paper grain on frame 1 (after its night open); `surface` cards; `ink` forest type, numerals and buttons; `spark` lime only on something
  alive or new (the feature disc, chips, rings, the push edge, the trial chip), always behind forest
  text. Frame 1 opens on `night`; Frame 9 is on `night` with `night-ink` type and the lime mark.
- **Type** by role from frame.md: numerals/titles in Space Grotesk 600, labels and chips in Figtree.
  No serif in this film. Visible text is short keyword copy; the captions carry the sentences.
- **Canvas and keep-out**: 1080×1920. Readable content in y 250–1280, x 72–940. Captions own
  y 1300–1520 on frame 1. Frame 2 (the end card) has no captions.
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
- sfx: accent (0.0), pop-1 (1.866 "loja"), pop-2 (2.986 "vendedor"), pop-3 (5.246 "cozinha"), whoosh (7.35, into the cut to the end card)

Scene 1 (0.0–1.45s): night ground. At 0.0 the lime check slams in (scale 1.3→1, 0.2 s) centered at x 506, y 640, 260 px box, and draws itself (`svg-path-draw`, 0.25 s); at 0.70 ("Venduá!") "venduá." (Space Grotesk 700, 168 px, night-ink, the final dot lime) slams in below it at y ~840 with a hard punch (1→1.06→1) and a shake.
Scene 2 (1.45–1.75s): the ground flips to cream (`theme-crossfade-morph`, 0.25 s) while the logo compacts to a small lockup at the top (mark 64 px + "venduá." 64 px, ink, centered x 506, y 270) — it stays there.
Scene 3 (1.866–6.55s): three mini devices (frame.md `device`, each 250 px wide, real screens at native aspect, ~523 px tall) fan in, one per word: "loja" 1.866 → left card (x 101, y 470, −5°) vitrine-cardapio; "vendedor" 2.986 → middle card (x 381, y 430, 0°, on top) dua-conversa-2-preco; "cozinha" 5.246 → right card (x 661, y 470, +5°) cozinha-phone. Each arrives with `kinetic-beat-slam` from 100 px below at scale 1.12 + a spark-chip label under it at y ~1060 ("loja", "vendedor", "cozinha", Figtree 650, 34 px). On "WhatsApp" 4.45 the middle card punches. On "hora." 6.55 all three punch together with one shake.
Scene 4 (6.8–7.5s): a slow push-in on the whole fan (1→1.04), still moving into the cut.

## Frame 2 — Venduá Bandeira

- scene: On night, the lime check draws, "venduá." lands; "Comece pelo Venduá Bandeira" slams in word by word; a lime chip "14 dias grátis, sem cartão."; "Link na bio · @vendua.digital"; held
- voiceover: "Venduá. Comece pelo Venduá Bandeira: catorze dias grátis, sem cartão."
- duration: 7.031s
- transition_in: cut
- status: animated
- src: compositions/frames/02-bandeira.html
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
