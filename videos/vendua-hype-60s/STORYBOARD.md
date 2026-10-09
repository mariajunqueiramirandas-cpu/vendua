---
compositionId: bgm
duration_s: 60.0
canvas: {"w": 1080, "h": 1920, "fps": 30}
style:
  font: "Space Grotesk 700 (display) / Figtree 600 (body)"
  palette: ["#0a100d", "#123c32", "#d9f875", "#f7f4ea", "#fffdf8"]
assets: "assets/screens (real admin captures of Bolos da Nena), assets/dua (Duá poses), assets/fonts"
build_notes:
  - "one paused timeline per frame, built synchronously, ending in tl.seek(0)"
  - "no remote assets; fonts and images from ../../assets/"
  - "128 BPM grid: beat 0.46875 s, bar 1.875 s; anchors below are TRACK seconds"
  - "readable copy only in y 250–1560, x 64–1016 (Stories UI zones)"
  - "each frame opens with a hit at local 0 and may start its exit whip at local end−0.15 s"
avoid:
  - "glassmorphism, gradient blobs, sparkles, confetti, emoji, pulsing dots"
  - "everything fading up from below in sequence"
  - "tiny text, text over busy screenshots without a plate, all-caps labels"
---

# Venduá — Hype 60 (Instagram Stories ad, pt-BR)

Music: generated in code, 128 BPM, 32 bars. Sections: bars 0–10 groove (full energy from the
first second), bar 11 build (snare roll + riser), bars 12–19 DROP 1, bars 20–21 breakdown
(no kick, filtered, riser in bar 21), bars 22–29 DROP 2, bar 30 last groove bar, final stab at
58.125 ringing out to 60.0. Impacts at 0.0, 3.75, 22.5, 41.25, 52.5, 58.125.

Story: hook (you cook, we sell) → brand → your store online → the order lands on your phone →
build → DROP: Duá, the AI seller on WhatsApp → smart tools → breakdown: price question, no
commission → DROP 2: the plans → CTA.

## Frame 1 — hook

- src: compositions/frames/01-hook.html
- duration: 3.75s
- span_sec: [0.0, 3.75]
- pacing: beat_cut
- mood: [hype, punchy]
- feel: full-energy groove from the very first frame, impact on 0.0
- notes: >
    Night background. Thumb-stopper. At 0.0 a hard slam of "Você cozinha." (two lines: "Você" /
    "cozinha.", ~230 px, cream) with a 0.25 s shake and a 2-frame chromatic split on the slam.
    Behind/below the text, a lock-screen-style stack area (x 90–990, y 1000–1500) where iOS-like
    push notifications drop in from the top of that area, each a rounded `surface` card (radius
    36 px, 900×170) with a small app tile (forest square, lime check mark), app name "Minha loja",
    "agora", bold title and body line — Core's real push text:
    push A at 0.9375: title "Pedido #28 chegou", body "Mariana · R$ 85,00 · entrega";
    push B at 2.8125: title "Pedido #29 chegou", body "Luiz · R$ 219,00 · entrega" (A is pushed
    down and scaled 0.94 behind it, like a real notification stack).
    At 1.875 (bar 1) the headline word-swaps (0 ms) to "A gente" / "vende." with "vende." on the
    lime marker wiping in at 2.34375. From 3.28 the whole camera starts a whip up (exit) so that at
    3.75 the frame is gone into blur.

### Groups

- **g1** — free_design
  - span_sec: [0.0, 1.875]
  - free_design: { dominant_system: "headline slam + notification drop", primitives: ["braam-punch", "screen-shake", "chromatic-split", "overlay-pop"], density_topology: "accumulate" }
  - anchors: [0.0, 0.9375]
  - copy: ["Você", "cozinha.", "Pedido #28 chegou", "Mariana · R$ 85,00 · entrega"]
- **g2** — free_design
  - span_sec: [1.875, 3.75]
  - free_design: { dominant_system: "word swap + second push + lime marker", primitives: ["content-swap", "overlay-pop", "hypercut-whip"], density_topology: "accumulate" }
  - anchors: [1.875, 2.34375, 2.8125, 3.28125]
  - copy: ["A gente", "vende.", "Pedido #29 chegou", "Luiz · R$ 219,00 · entrega"]

## Frame 2 — brand

- src: compositions/frames/02-brand.html
- duration: 3.75s
- span_sec: [3.75, 7.5]
- pacing: beat_cut
- mood: [hype, reveal]
- feel: impact on the downbeat, then the groove carries a logo build
- notes: >
    At 3.75: 0 ms flip to a full LIME stage (palette-flip) + shake. The word "venduá." builds in
    forest, Space Grotesk 700 ~250 px, centered at y≈820: the letters v-e-n-d-u-a stamp in one per
    sixteenth from 3.75 (3.75, 3.867, 3.984, 4.102, 4.219, 4.336), each dropping from y−120 with a
    hard stop; the acute accent (a rounded bar, rotate 38°, like the site's hero) drops onto the
    "a" at 4.6875 with a bounce; the lime-on-lime would vanish, so on the lime stage the final "."
    is forest and the check mark (path in frame.md) draws itself (stroke-dashoffset) left of the
    word from 4.6875 to 5.0. At 5.625 (bar 3) Duá (assets/dua/avatar-ola.webp, ~420 px) climbs out
    from BEHIND the letters (clip the box at the letters' baseline so he rises from behind them),
    waving. Tagline under it at y≈1150, Figtree 700, 64 px, forest: "Sua loja viva" (5.625) /
    "na palma da mão." (6.09375) slamming word-group by word-group. Keep a slow 3 % push on the
    whole stage. From 7.35 a lime wipe → night is NOT needed: hard cut at 7.5.

### Groups

- **g1** — free_design
  - span_sec: [3.75, 5.625]
  - free_design: { dominant_system: "per-letter logo stamp on a lime stage", primitives: ["palette-flip", "kinetic-letter-in", "screen-shake"], density_topology: "accumulate" }
  - anchors: [3.75, 3.8672, 3.9844, 4.1016, 4.2188, 4.3359, 4.6875]
  - copy: ["venduá."]
- **g2** — free_design
  - span_sec: [5.625, 7.5]
  - free_design: { dominant_system: "mascot peek + tagline slams", primitives: ["overlay-pop", "kinetic-letter-in"], density_topology: "accumulate" }
  - anchors: [5.625, 6.09375, 6.5625]
  - copy: ["Sua loja viva", "na palma da mão."]

## Frame 3 — loja

- src: compositions/frames/03-loja.html
- duration: 7.5s
- span_sec: [7.5, 15.0]
- pacing: beat_cut
- mood: [energetic, product]
- feel: steady four-on-the-floor groove with a pluck arpeggio; four one-bar scenes
- notes: >
    Night. Four one-bar scenes, each changing on the bar line (7.5, 9.375, 11.25, 13.125) with a
    whip or a lime wipe. Headline block at the top (y 260–620), phone below (phone --pw 600,
    centred, top at y≈700, may bleed off the bottom).
    S1 7.5: phone whips up showing assets/screens/boasVindas-creme-750.webp (Duá says "Oi, Nena!
    Meu nome é Duá..."). Headline slams "8 perguntinhas." (7.5) then "e sua loja tá no ar." (8.4375).
    S2 9.375: lime wipe; the phone now shows a STOREFRONT drawn in code (the shopper's view of
    Bolos da Nena): a browser-ish top bar with "bolosdanena.vendua.com.br" (types on, 9.375–9.84),
    store header (forest band, "Bolos da Nena", "Bolo de vó, feito hoje.", lime "Aberta" pill),
    then three product cards dropping in on beats 9.84375 / 10.3125 / 10.78125: "Bolo de cenoura
    com brigadeiro — R$ 45,00", "Bolo de chocolate molhadinho — R$ 48,00", "Bolo de fubá com
    goiabada — R$ 38,00" (card = surface, radius 20, a simple line-drawn cake glyph in a cream
    tile like the admin's placeholder, name Figtree 700, price), each with a forest "+" button.
    Headline: "Sua loja online." (9.375) / "com a sua cara." (9.84375, "sua cara" on the lime marker).
    S3 11.25: phone flips (3d-card-flip, rotateY) to assets/screens/cardapio-creme-750.webp. Big
    word ticker headline, 0 ms swaps on each beat: "Cardápio." (11.25) "Horários." (11.71875)
    "Cupons." (12.1875) "Pix." (12.65625, "Pix." on lime marker). Under it, Figtree 600 56 px,
    muted: "Tudo pronto pra vender."
    S4 13.125: phone punch-in to assets/screens/inicio-creme-750.webp; a lime callout plate over
    the phone counts the sales up "R$ 0,00" → "R$ 718,00" locking at 14.0625, with the label
    "vendas de hoje". Headline: "Tudo na palma" / "da mão." Exit whip from 14.85.

### Groups

- **g1** — free_design
  - span_sec: [7.5, 9.375]
  - free_design: { dominant_system: "phone whip-in + headline slams", primitives: ["hypercut-whip", "braam-punch"], density_topology: "accumulate" }
  - anchors: [7.5, 8.4375]
  - copy: ["8 perguntinhas.", "e sua loja tá no ar."]
- **g2** — free_design
  - span_sec: [9.375, 11.25]
  - free_design: { dominant_system: "drawn storefront assembling on beats", primitives: ["directional-fill", "typewriter-reveal", "staggered-reveal"], density_topology: "accumulate" }
  - anchors: [9.375, 9.84375, 10.3125, 10.78125]
  - copy: ["Sua loja online.", "com a sua cara.", "bolosdanena.vendua.com.br", "Bolos da Nena", "Bolo de vó, feito hoje.", "Bolo de cenoura com brigadeiro", "R$ 45,00", "Bolo de chocolate molhadinho", "R$ 48,00", "Bolo de fubá com goiabada", "R$ 38,00"]
- **g3** — free_design
  - span_sec: [11.25, 13.125]
  - free_design: { dominant_system: "word ticker on beats over a flipped phone", primitives: ["3d-card-flip", "content-swap"], density_topology: "replace" }
  - anchors: [11.25, 11.71875, 12.1875, 12.65625]
  - copy: ["Cardápio.", "Horários.", "Cupons.", "Pix.", "Tudo pronto pra vender."]
- **g4** — free_design
  - span_sec: [13.125, 15.0]
  - free_design: { dominant_system: "punch-in + sales count-up", primitives: ["crash-zoom-in", "value-counter"], density_topology: "accumulate" }
  - anchors: [13.125, 14.0625, 14.53125]
  - copy: ["Tudo na palma", "da mão.", "R$ 718,00", "vendas de hoje"]

## Frame 4 — pedido

- src: compositions/frames/04-pedido.html
- duration: 7.5s
- span_sec: [15.0, 22.5]
- pacing: beat_cut
- mood: [energetic, then build]
- feel: three groove bars, then bar 11 is the build — snare roll accelerating into the drop
- notes: >
    S1 15.0: a lock screen drawn in code fills a phone (--pw 640, centred, y≈620): dark
    wallpaper (forest→night gradient), big time "18:52" in Figtree 300 ~150 px, date "terça-feira,
    30 de setembro". At 15.0 the push drops in: app "Minha loja", title "Pedido #29 chegou", body
    "Luiz · R$ 219,00 · entrega", and at 15.9375 it expands to show one action button "aceitar".
    Headline at top: "Pedido novo?" (15.0) / "Cai direto" (15.46875) "no seu celular." (15.9375).
    S2 16.875: whip to a phone with assets/screens/pedido-creme-750.webp (order #29, R$ 219,00,
    Luiz Fernando, "aceitar · 30 min" button near the bottom). A drawn fingertip (a soft cream
    circle 90 px with a light ring) taps the "aceitar · 30 min" button at 17.8125: the button
    flashes lime and a check pops. Headline: "Aceita" (16.875) / "com um toque." (17.34375).
    S3 18.75: assets/screens/pedidos-creme-750.webp in the phone, and the headline is a 0 ms
    word ticker following the order's life, one per beat: "Novo." (18.75) "Preparo." (19.21875)
    "Pronto." (19.6875) "Saiu!" (20.15625, on lime marker). Under it, small: "Tudo na tela, sem
    caderninho."
    S4 BUILD 20.625–22.5: the phone flies away; night stage; one huge word per beat, each bigger
    and each with more shake, slammed centre: "E se" (20.625) "alguém" (21.09375) "vendesse"
    (21.5625) "por você?" (22.03125). From 22.03 to 22.5 the stage zooms (crash-zoom 1→1.35) and
    whites/limes out to a full lime frame on the last sixteenth (22.38) so the cut to frame 5's
    lime drop is seamless.

### Groups

- **g1** — free_design
  - span_sec: [15.0, 16.875]
  - free_design: { dominant_system: "lock screen push arrives", primitives: ["overlay-pop", "braam-punch"], density_topology: "accumulate" }
  - anchors: [15.0, 15.46875, 15.9375]
  - copy: ["Pedido novo?", "Cai direto", "no seu celular.", "18:52", "terça-feira, 29 de setembro", "Minha loja", "Pedido #29 chegou", "Luiz · R$ 219,00 · entrega", "aceitar"]
- **g2** — free_design
  - span_sec: [16.875, 18.75]
  - free_design: { dominant_system: "real order screen + tap", primitives: ["hypercut-whip", "overlay-pop"], density_topology: "accumulate" }
  - anchors: [16.875, 17.34375, 17.8125]
  - copy: ["Aceita", "com um toque."]
- **g3** — free_design
  - span_sec: [18.75, 20.625]
  - free_design: { dominant_system: "order-state word ticker", primitives: ["content-swap", "directional-fill"], density_topology: "replace" }
  - anchors: [18.75, 19.21875, 19.6875, 20.15625]
  - copy: ["Novo.", "Preparo.", "Pronto.", "Saiu!", "Tudo na tela, sem caderninho."]
- **g4** — free_design
  - span_sec: [20.625, 22.5]
  - free_design: { dominant_system: "accelerating one-word build into a lime white-out", primitives: ["braam-punch", "screen-shake", "crash-zoom-in", "flash-cut"], density_topology: "accumulate" }
  - anchors: [20.625, 21.09375, 21.5625, 22.03125, 22.38281]
  - copy: ["E se", "alguém", "vendesse", "por você?"]

## Frame 5 — dua

- src: compositions/frames/05-dua.html
- duration: 7.5s
- span_sec: [22.5, 30.0]
- pacing: beat_cut
- mood: [peak, hype]
- feel: DROP 1 — the biggest moment; supersaw chords, full drums, a lead hook
- notes: >
    22.5 DROP: starts on a full LIME stage + shake. Duá (assets/dua/avatar-ola.webp ~560 px, on a
    forest disc) slams in at centre; headline above in forest: "Conheça" / "o Duá." (22.5, the
    second line at 22.96875). Under him at 23.4375: Figtree 700 58 px forest "o vendedor com IA" /
    "no WhatsApp da sua loja". At 24.375 (bar 13) 0 ms flip to NIGHT; Duá shrinks to a 150 px
    avatar that becomes the chat's avatar, and a phone (--pw 620, centred, top y≈560, bottom may
    bleed) whips up showing a WhatsApp-style chat drawn in code: header in forest-deep with the
    back arrow, a round avatar (Duá on lime disc), "Bolos da Nena" / "online"; chat wallpaper
    #efe9d8; bubbles Figtree 30 px: incoming (Duá) surface-white on the left, outgoing (customer)
    #d9fdd3 on the right, each with a tiny time "9:41". Messages pop in (scale 0.6→1 from their
    corner, 0.14 s back.out) one per anchor and the chat scrolls up so the newest is always
    visible:
    24.375 Duá "Oi! Sou o Duá, assistente virtual da Bolos da Nena. Quer ver o que tem hoje ou já sabe o que vai pedir?"
    24.84375 me "Tem bolo de cenoura?"
    25.3125 Duá "Tem sim! O bolo de cenoura com brigadeiro inteiro sai R$ 45,00."
    25.78125 Duá "Quer levar também uma fatia de chocolate para comer hoje? Sai R$ 9,50."
    26.25 me "Quero a fatia também"
    26.71875 Duá "Anotei a fatia também. É para entregar ou você vem buscar?"
    27.1875 me "Entrega, na Rua das Acácias, 120"
    27.65625 Duá summary card: "1× Bolo de cenoura com brigadeiro R$ 45,00" / "1× Fatia de chocolate R$ 9,50" / "Entrega R$ 8,00" / "Total R$ 62,50" / "Pagamento: Pix"
    28.125 Duá "Pedido feito! Aqui está o Pix:" + a Pix card ("Pedido #30", "R$ 62,50", a mock QR made of a deterministic grid of squares, "copiar código")
    28.59375 me "Já paguei"
    29.0625 Duá "Pagamento confirmado! Seu pedido já foi para a cozinha." + order card "Pedido #30 · aceito pela loja · R$ 62,50"
    Between messages the header shows "digitando…" for Duá's replies. Over the chat, BIG kinetic
    overlay words in the top zone (y 260–520, cream 170 px with a night plate behind if needed),
    0 ms swaps: "Responde." (24.375) "Sugere." (25.78125) "Anota." (26.71875) "Fecha." (27.65625)
    "Cobra no Pix." (28.125) "Vendido." (29.0625, on lime marker + small punch). Punch-in on each
    bar line (24.375, 26.25, 28.125). Exit whip from 29.85.

### Groups

- **g1** — free_design
  - span_sec: [22.5, 24.375]
  - free_design: { dominant_system: "lime drop + mascot slam", primitives: ["system-replace", "braam-punch", "screen-shake"], density_topology: "accumulate" }
  - anchors: [22.5, 22.96875, 23.4375]
  - copy: ["Conheça", "o Duá.", "o vendedor com IA", "no WhatsApp da sua loja"]
- **g2** — free_design
  - span_sec: [24.375, 30.0]
  - free_design: { dominant_system: "hyper-speed chat + overlay verb ticker", primitives: ["overlay-pop", "content-swap", "typewriter-reveal"], density_topology: "accumulate" }
  - anchors: [24.375, 24.84375, 25.3125, 25.78125, 26.25, 26.71875, 27.1875, 27.65625, 28.125, 28.59375, 29.0625]
  - copy: ["Responde.", "Sugere.", "Anota.", "Fecha.", "Cobra no Pix.", "Vendido.", "Bolos da Nena", "online", "digitando…"]

## Frame 6 — smart

- src: compositions/frames/06-smart.html
- duration: 7.5s
- span_sec: [30.0, 37.5]
- pacing: beat_cut
- mood: [hype, confident]
- feel: DROP 1 continues; four one-bar feature hits
- notes: >
    Four one-bar scenes, one feature each, changing on the bar line with a lime wipe. Each has a
    headline at the top (y 260–560) and a hero visual below.
    S1 30.0 "Seu dia," / "resumido.": phone with assets/screens/seuDia-noite-750.webp (dark card
    "Boa noite, Nena", R$ 718,00, ▲151 %, "Resumo do dia"). Callout chips pop beside/over the
    phone on beats (lime plates, forest text, 40 px): "▲ 151% vs. semana passada" (30.46875),
    "Campeão: fatia de cenoura" (30.9375), "Pico às 18h" (31.40625).
    S2 31.875 "Tela da" / "cozinha.": a kitchen board drawn in code (a landscape tablet 960×620,
    forest-deep frame, three columns "Novos" / "Preparo" / "Prontos" in cream), order tickets
    (surface cards: "#29 Luiz", "1× Bolo de laranja com calda", "2× Bolo de milho cremoso",
    "2× Bolo de chocolate molhadinho"; "#28 Mariana", "2× Bolo de milho cremoso") — #28 slides
    from Novos to Preparo at 32.34375, #29 lands in Novos at 32.8125, #28 moves to Prontos at 33.28125.
    S3 33.75 "Comanda" / "impressa sozinha.": a small thermal printer (drawn, forest/night body,
    a slot) prints a paper receipt downward line by line on sixteenths from 33.75 to 34.9:
    print (sentence case, never all caps) "Bolos da Nena", "Pedido #29 · entrega",
    "Luiz Fernando", "1× Bolo de laranja com calda  R$ 38,00", "2× Bolo de milho cremoso  R$ 80,00",
    "2× Bolo de chocolate molhadinho  R$ 96,00", "Entrega  R$ 5,00", "Total  R$ 219,00" in a mono-ish
    Figtree 30 px on #fffdf8 paper with a torn zigzag bottom edge.
    S4 35.625 "Cartão" / "fidelidade.": a loyalty card (surface, radius 32, 880×520, "Bolos da
    Nena" + "Cartão fidelidade" + a 5×2 grid of round stamp slots); stamps (lime discs with the
    forest check mark) thump in on 35.625, 35.859, 36.094, 36.328, 36.5625, 36.797, 37.031 (eighths)
    and the line under the card swaps to "Cliente que volta." at 37.03. Exit whip from 37.35.

### Groups

- **g1** — free_design
  - span_sec: [30.0, 31.875]
  - free_design: { dominant_system: "real screen + callout pops", primitives: ["mask-reveal", "overlay-pop"], density_topology: "accumulate" }
  - anchors: [30.0, 30.46875, 30.9375, 31.40625]
  - copy: ["Seu dia,", "resumido.", "▲ 151% vs. semana passada", "Campeão: fatia de cenoura", "Pico às 18h"]
- **g2** — free_design
  - span_sec: [31.875, 33.75]
  - free_design: { dominant_system: "kitchen board tickets moving on beats", primitives: ["directional-fill", "content-swap"], density_topology: "replace" }
  - anchors: [31.875, 32.34375, 32.8125, 33.28125]
  - copy: ["Tela da", "cozinha.", "Novos", "Preparo", "Prontos", "#29 Luiz", "#28 Mariana"]
- **g3** — free_design
  - span_sec: [33.75, 35.625]
  - free_design: { dominant_system: "receipt printing line by line", primitives: ["typewriter-reveal", "staggered-reveal"], density_topology: "accumulate" }
  - anchors: [33.75, 34.21875, 34.6875, 35.15625]
  - copy: ["Comanda", "impressa sozinha.", "Bolos da Nena", "Pedido #29 · entrega", "Total  R$ 219,00"]
- **g4** — free_design
  - span_sec: [35.625, 37.5]
  - free_design: { dominant_system: "stamps thumping onto a loyalty card", primitives: ["overlay-pop", "braam-punch"], density_topology: "accumulate" }
  - anchors: [35.625, 35.859375, 36.09375, 36.328125, 36.5625, 36.796875, 37.03125]
  - copy: ["Cartão", "fidelidade.", "Cliente que volta."]

## Frame 7 — preco

- src: compositions/frames/07-preco.html
- duration: 3.75s
- span_sec: [37.5, 41.25]
- pacing: beat_cut
- mood: [tension, build]
- feel: breakdown — kick drops out, filtered chords, then a riser through bar 21 into DROP 2
- notes: >
    Night, emptier (negative space; the music breathes). 37.5: "E quanto custa" / "tudo isso?"
    (cream, 150 px) slams in two beats (37.5, 37.96875), then holds with a slow 4 % push.
    At 38.90625 a small line under it, muted: "(spoiler: cabe no bolso)". At 39.375 (bar 21, the
    riser starts) 0 ms swap to the claim, lines landing on beats: "Mensalidade fixa." (39.375) /
    "Sem comissão" (39.84375) / "por pedido." (40.3125, on the lime marker). From 40.78 the whole
    stage scales up and strobes lime/night on sixteenths (40.78, 40.90, 41.02, 41.13) and ends on a
    full lime frame so the cut to frame 8's drop lands as one hit.

### Groups

- **g1** — free_design
  - span_sec: [37.5, 39.375]
  - free_design: { dominant_system: "question slam into negative space", primitives: ["braam-punch", "negative-space-hold"], density_topology: "accumulate" }
  - anchors: [37.5, 37.96875, 38.90625]
  - copy: ["E quanto custa", "tudo isso?", "(spoiler: cabe no bolso)"]
- **g2** — free_design
  - span_sec: [39.375, 41.25]
  - free_design: { dominant_system: "claim stack + strobe build", primitives: ["braam-punch", "flash-cut", "crash-zoom-in"], density_topology: "accumulate" }
  - anchors: [39.375, 39.84375, 40.3125, 40.78125]
  - copy: ["Mensalidade fixa.", "Sem comissão", "por pedido."]

## Frame 8 — planos

- src: compositions/frames/08-planos.html
- duration: 11.25s
- span_sec: [41.25, 52.5]
- pacing: beat_cut
- mood: [peak, confident]
- feel: DROP 2 — full energy, plan reveals on the bar lines
- notes: >
    41.25 DROP 2 on a lime frame (0 ms) + shake, then 0 ms to night at 41.484 with the first card
    already slamming.
    PLAN CARD design (both cards share it): 900 px wide, radius 44, padding 64; plan name Figtree
    700 56 px; price in Space Grotesk 700 200 px with "/mês" Figtree 600 56 px beside it; perks as
    a list (Figtree 600 44 px) each with a small check mark (the brand path) in front.
    S1 Mirim 41.25–45.0: card = surface `#fffdf8` with forest type. Header "Venduá Mirim"
    (41.484). Price rolls (slot-machine digits) from "R$ 00,00" and locks on "R$ 69,90" at
    42.1875 with a punch. Perks land on beats: "Sua loja online" (42.65625), "Cardápio, pedidos e
    Pix" (43.125), "Cupons" (43.59375). Above the card, headline "Pra começar:" (41.484, cream,
    120 px). At 44.53 the card whips left/out.
    S2 Bandeira 45.0–48.75: card = forest `#123c32` with cream type and a lime 4 px border, a lime
    pill "Recomendado" on its top edge (pops at 45.0). Header "Venduá Bandeira" (45.0). Headline
    above: "O completo:" (45.0). Price rolls and locks on "R$ 169" + "/mês" at 45.9375 (punch,
    shake). Perks land on beats, each with a small lime "+": "Tudo do Mirim" (46.40625), "o Duá,
    vendedor com IA · 250 conversas/mês" (46.875), "Tela da cozinha" (47.34375), "Impressão
    automática" (47.8125), "Cartão fidelidade" (48.28125). Duá (assets/dua/avatar-feliz.webp,
    260 px, on a lime disc) pops onto the card's top-right corner at 46.875.
    S3 48.75–50.625: the Bandeira card holds and breathes (slow 3 % push, a lime light sweep
    across it at 48.75 — chrome-sweep), and the headline swaps to "Venda mais." (48.75) /
    "Sem trabalhar mais." (49.6875).
    S4 50.625–52.5: 0 ms flip to a full LIME stage: "14 dias" (50.625) / "grátis." (51.09375),
    forest, 260 px, then "Sem cartão." (51.5625) Figtree 800 90 px; a small forest pill under it
    "no Venduá Bandeira" (52.03125). Exit whip from 52.35.

### Groups

- **g1** — free_design
  - span_sec: [41.25, 45.0]
  - free_design: { dominant_system: "plan card slam + price slot roll + perk stack", primitives: ["system-replace", "slot-machine-reveal", "staggered-reveal", "screen-shake"], density_topology: "accumulate" }
  - anchors: [41.25, 41.484375, 42.1875, 42.65625, 43.125, 43.59375, 44.53125]
  - copy: ["Pra começar:", "Venduá Mirim", "R$ 69,90", "/mês", "Sua loja online", "Cardápio, pedidos e Pix", "Cupons"]
- **g2** — free_design
  - span_sec: [45.0, 48.75]
  - free_design: { dominant_system: "recommended plan card + price lock + perk stack", primitives: ["slot-machine-reveal", "staggered-reveal", "overlay-pop"], density_topology: "accumulate" }
  - anchors: [45.0, 45.9375, 46.40625, 46.875, 47.34375, 47.8125, 48.28125]
  - copy: ["O completo:", "Venduá Bandeira", "Recomendado", "R$ 169", "/mês", "Tudo do Mirim", "o Duá, vendedor com IA · 250 conversas/mês", "Tela da cozinha", "Impressão automática", "Cartão fidelidade"]
- **g3** — free_design
  - span_sec: [48.75, 50.625]
  - free_design: { dominant_system: "hold + light sweep + headline swap", primitives: ["chrome-sweep", "content-swap"], density_topology: "replace" }
  - anchors: [48.75, 49.6875]
  - copy: ["Venda mais.", "Sem trabalhar mais."]
- **g4** — free_design
  - span_sec: [50.625, 52.5]
  - free_design: { dominant_system: "lime trial slam", primitives: ["palette-flip", "braam-punch"], density_topology: "accumulate" }
  - anchors: [50.625, 51.09375, 51.5625, 52.03125]
  - copy: ["14 dias", "grátis.", "Sem cartão.", "no Venduá Bandeira"]

## Frame 9 — cta

- src: compositions/frames/09-cta.html
- duration: 7.5s
- span_sec: [52.5, 60.0]
- pacing: beat_cut
- mood: [triumphant, resolve]
- feel: last two groove bars, impact on 52.5, final stab at 58.125 ringing out to 60.0
- notes: >
    52.5: night + shake; headline slams "Crie sua loja" (52.5) / "hoje." (52.96875, lime marker).
    53.4375: a big pill button slides up (forest-on-lime: lime `#d9f875` fill, forest Figtree 800
    64 px "Criar minha loja", with an arrow →, 820×150, radius 999, at y≈1150). The drawn fingertip
    taps it at 54.375: button squashes 0.94 and flashes, then morphs (0.25 s) into a forest disc
    with a lime check mark.
    END CARD from 55.3125 (cut at 56.25 must already be clean): night stage, the brand lock-up
    centred at y≈760: check mark (lime) + "venduá." (cream, lime ".") ~180 px, Duá
    (avatar-feliz.webp, 300 px, on a lime disc) above-right; under the logo, Figtree 700 64 px
    cream "vendua.com.br" (56.25) and Figtree 600 48 px muted "14 dias grátis no Bandeira"
    (56.71875). At 58.125 (final stab) a single lime ring pulses out from the logo (one ring, 0.6 s)
    and the logo punches 1.04→1. Then hold, everything breathing very slowly (1 %) to 60.0.
    The last ~1.8 s must be a clean, readable end card.

### Groups

- **g1** — free_design
  - span_sec: [52.5, 55.3125]
  - free_design: { dominant_system: "CTA headline + button tap", primitives: ["braam-punch", "screen-shake", "overlay-pop"], density_topology: "accumulate" }
  - anchors: [52.5, 52.96875, 53.4375, 54.375]
  - copy: ["Crie sua loja", "hoje.", "Criar minha loja"]
- **g2** — free_design
  - span_sec: [55.3125, 60.0]
  - free_design: { dominant_system: "logo end card + final stab ring", primitives: ["negative-space-hold", "overlay-pop"], density_topology: "accumulate" }
  - anchors: [55.3125, 56.25, 56.71875, 58.125]
  - copy: ["venduá.", "vendua.com.br", "14 dias grátis no Bandeira"]
