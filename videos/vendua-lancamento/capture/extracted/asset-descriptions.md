# Asset inventory — Venduá (no crawl)

Not a site capture: every file below is copied from the Venduá repo. The admin screens are the real
merchant admin of the fictional store **Bolos da Nena** (owner Nena), captured by
`site/scripts/assets.ts screens` (registry `site/src/lib/screens.ts`). Phone screens are 375×812 CSS
px at 2× (750×1624 px), Creme theme unless the name says `noite`. The product appears only through
these; no AI images, photos, people or drawn app UI.

## Admin screens (`capture/assets/`)

- `cardapio-creme-750.webp` — Cardápio: "14 produtos em 4 categorias", category pills (Bolos inteiros
  6, Fatias do dia 3, Encomendas), product cards with prices: "Bolo de cenoura com brigadeiro
  R$ 45,00", "Bolo de chocolate molhadinho R$ 48,00". Answers "cardápio" and "preço".
- `cardapio-noite-750.webp` — the same Cardápio in the dark Noite theme.
- `loja-creme-750.webp` — Loja: the store's own link "bolosdanena.vendua.com.br" under the title, then
  Horários (Seg fechado, Ter–Sáb 7h–21h). The "one link" moment; also answers "horário".
- `inicio-creme-750.webp` — Início: "Bom dia, Nena" with Duá, "Vendas de hoje R$ 718,00", 6 pedidos,
  ticket médio R$ 120; "Precisa de você": "2 pedidos esperando você" and "1 Pix para conferir —
  Confira no seu banco e marque como pago". The Pix touchpoint on the merchant side.
- `pedidos-creme-750.webp` — Pedidos: tabs Novos 2 / Preparo 2 / Prontos 1 / Concluídos 1; order #28
  Mariana, 2× Bolo de milho cremoso, R$ 85,00, Centro, "Fica pronto em 15/30/45", button "aceitar ·
  30 min"; order #29 Luiz below.
- `pedido-creme-750.webp` — Pedido #29 "hoje às 18h52", Novo: 1× Bolo de laranja com calda R$ 38,00,
  2× Bolo de milho cremoso R$ 80,00, 2× Bolo de chocolate molhadinho R$ 96,00, entrega R$ 5,00,
  Total R$ 219,00; customer Luiz Fernando, "primeiro pedido", WhatsApp button; "aceitar · 30 min".
  The payoff: an order that arrived by itself.
- `pedido-noite-750.webp` — the same order in Noite.
- `pausar-creme-750.webp` — pausing the store: 15 min, 1 hora, resto do dia, with a note for the
  customer.
- `seuDia-creme-750.webp` — Seu dia: the day's recap when the store closes (best seller "Fatia de
  cenoura com brigadeiro", 5; busiest hour 18h; avg ticket R$ 120).
- `boasVindas-creme-750.webp` — Duá starting to set up the store with Nena.

## System UI (draw in code, Core's real text only)

- Push notification from the admin PWA: app "Minha loja", title "Pedido #29 chegou", body "Luiz ·
  R$ 219,00 · entrega", one action "aceitar" (`packages/core/src/admin/workers.ts`, mirrored in
  `site/src/lib/content.ts`).

## Brand (`capture/assets/svgs/`)

- `mark-green.svg`, `mark-lime.svg` — the Venduá check mark (one stroked path, `M32 48 L61 88 L98 34`,
  round caps, stroke 17 on a 128 box), deep green / lime.
- `mark-avatar.svg` — the mark in its avatar tile.
- The logo is the mark + the word "venduá." set live in Space Grotesk 700, letter-spacing −0.035em;
  on dark the mark and the final dot turn lime `#d9f875` (`site/src/lib/components/Logo.svelte`).
  The repo's `wordmark-*.svg` files depend on a font that isn't shipped, so they are not used.

## Character (`capture/assets/`)

- `avatar-feliz.webp`, `avatar-ola.webp` — Duá, Venduá's anteater mascot (480×480, transparent),
  happy / waving. Never mirrored or recolored.

## Fonts (`assets/fonts/`)

- Space Grotesk Variable (display), Figtree Variable (body), Instrument Serif 400 (moments such as
  "Bom dia, Nena"), latin subsets from the site's @fontsource packages.

## Customer storefront (`capture/assets/`)

Captured by `scripts/storefront-shots.mjs` from the real standard storefront (`storefronts/_template`,
the Venduá Basic look) running Bolos da Nena on the dev database, 375×812 CSS px at 2× (750×1624).

- `vitrine-cardapio-750.webp` — Cardápio: search, category pills (Bolos inteiros, Fatias do dia,
  Encomendas), "Bolos inteiros 6": Bolo de banana com canela R$ 40,00, Bolo de cenoura com
  brigadeiro R$ 45,00, Bolo de chocolate molhadinho R$ 48,00, each with a "+" button.
- `vitrine-produto-750.webp` — the product page of Bolo de chocolate molhadinho, R$ 48,00, quantity
  1 and "Adicionar à sacola R$ 48,00". The "preço" beat.
- `vitrine-pagamento-750.webp` — Finalizar pedido, step Pagamento, carrying order #29's cart (2× Bolo
  de chocolate molhadinho, 1× Bolo de laranja com calda, 2× Bolo de milho cremoso, delivery to
  Centro): Pix selected (radio), Cartão na entrega, Dinheiro; Sacola 5; "Confirmar pedido · R$
  219,00", the total Frame 5's order #29 arrives with. The "Pix" beat. No order is placed: its
  number would not be #29.

## Added for the launch video (`capture/assets/`, copied from `site/static/screens/`)

- `boasVindas-noite-750.webp` — Duá starting to set up the store, Noite theme.
- `boasVindasDesktop-creme-1600.webp` — desktop: the Duá chat setting up the store with the store
  appearing beside it. The "você conversa com o Duá, e ele monta tudo" beat.
- `quadro-creme-1600.webp` — desktop order board (novos, preparo, prontos, concluídos).

## The launch story: Caio's order #30 (`capture/assets/`)

Captured by `scripts/capture-shots.mjs` from the real merchant admin and storefront on the dev
database (Bolos da Nena, owner Nena). One customer, one order everywhere: **Caio**, (22) 9••••-0130,
a WhatsApp voice note, **order #30**: 1× Bolo de cenoura com brigadeiro R$ 45,00 + 1× Fatia de
chocolate R$ 9,50 (Fatias do dia), entrega R$ 8,00 to Rua das Acácias, 120 · Parque Califórnia
(zone Bairros próximos), **total R$ 62,50**, Pix (the store's key, marked paid by Nena). Times read
~18h on Saturday 03/10 (browser clock pinned; Core's timestamps moved to the same evening). Phone
shots 375×812 CSS at 2× (750×1624), tablet shots 1280×800 at 2× (2560×1600), Creme theme. The
store pill reads "Aberta" and the tab bar shows Pedidos and Duá badges in every phone admin shot.

- `duá-conversa-1-audio.webp` — Duá › Conversas › Caio, "(22) 9••••-0130 · primeira conversa",
  chip "Duá atendendo"; "hoje"; Caio's voice note 0:04 with its transcript "“Oi, tudo bem? Tem bolo
  de cenoura com brigadeiro pra hoje?”" 17:58; floor "O Duá está atendendo" + "assumir". The
  opening beat.
- `duá-conversa-2-preco.webp` — + Duá · IA: "Oi! Sou o Duá, assistente virtual da Bolos da Nena."
  and "Tem sim! O bolo de cenoura com brigadeiro inteiro sai R$ 45,00." (17:58, "por quê"). The
  price beat.
- `duá-conversa-3-adicional.webp` — pinned "Sacola · 2 itens R$ 54,50" at step montar; Duá: "Quer
  levar também uma fatia de chocolate para comer hoje? Sai R$ 9,50."; Caio: "Quero a fatia
  também" 17:59; Duá: "Anotei a fatia também. É para entregar ou você vem buscar?". The add-on
  beat.
- `duá-conversa-4-resumo.webp` — "Sacola · 2 itens R$ 62,50" at step confirmar; Duá: "A entrega aí
  fica R$ 8,00. Confere o resumo:"; receipt "gerou o resumo do pedido"; Core's card SEU PEDIDO ·
  calculado pela loja: 1× Bolo de cenoura com brigadeiro R$ 45,00, 1× Fatia de chocolate R$ 9,50,
  Entrega · Rua das Acácias, 120 · Parque Califórnia R$ 8,00, Total R$ 62,50, "chega em 30–60 min ·
  pagamento: Pix". A sliver of Caio's address bubble shows under the pinned bar. The "calculado
  pela loja" beat.
- `duá-conversa-5-pix.webp` — pinned "Pedido #30 · feito R$ 62,50" (all five steps); "mandou o Pix"
  + Core's card "💠 Pix do pedido #30 · R$ 62,50 / Copie o código abaixo e cole no app do seu banco,
  em Pix copia e cola."; second Pix card with the copia-e-cola code; chip "Pedido #30 feito ·
  aguardando pagamento". (Before it, off screen: Duá "O pagamento é por Pix. Posso fechar?", Caio
  "Pode fechar", Duá "Pedido feito! Aqui está o Pix:".) The Pix beat.
- `duá-conversa-5b-pago.webp` — + Caio "Já paguei" 18:03, Duá "Pagamento confirmado! Seu pedido já
  foi para a loja.", chip "Pedido #30 feito · pago". The paid beat.
- `duá-conversa-6-assumir.webp` — the same thread from the top: Caio "1 pedido · cliente desde out
  2026", chip "Duá atendendo", the order bar, the voice note and Duá's first bubbles; floor "O Duá
  está atendendo" with the "assumir" button (the last bubble runs under the floor). The "you can
  take over" beat.
- `duá-conversa-7-assumido.webp` — after Nena taps assumir: floor "Você está atendendo", "devolver
  ao Duá", composer "Escreva sua resposta…", "O Duá volta se você ficar 30 min sem responder."; above
  it "Já paguei", "Pagamento confirmado!…", "Pedido #30 feito · pago". The takeover beat.
- `duá-conversas-lista.webp` — Conversas inbox: filters todas / precisa de você · 1 / com pedido /
  Duá atendendo / outros; Caio 18:03 "Duá: Pagamento confirmado! Seu p…" pedido #30; Marcos 18:03
  "tem bolo de milho ainda?" Duá atendendo; Júlia 17:52 "loja: Vou chamar alguém da loja par…"
  alergia · esperando há 11 min; Fernanda 17:32 (pedido #26), cut by the tab bar.
- `pedidos-novo-30.webp` — Pedidos, tabs Novos 2 / Preparo 2 / Prontos 1 / Concluídos 1; card #30
  Caio "Novo · 3 min", 1× Bolo de cenoura com brigadeiro, 1× Fatia de chocolate, R$ 62,50, "Pago",
  Parque Califórnia, "Fica pronto em (minutos)" 15 / **30** / 45, "aceitar · 30 min"; #29 Luiz below.
  The order-arrives beat.
- `pedido-30.webp` — order detail: "hoje às 18h01", #30, Novo, Pago; items R$ 45,00 / R$ 9,50,
  Subtotal R$ 54,50, Entrega R$ 8,00, Total R$ 62,50; Caio "(22) 90000-0130 · primeiro pedido",
  WhatsApp button; sticky "aceitar · 30 min". The admin shows no source label for Vendedor orders.
- `pedido-30-entrega.webp` — the same page scrolled: Entrega Rua das Acácias, 120 — Parque
  Califórnia · Bairros próximos, "Prometido: 18h31–19h01"; "Pix na chave da loja — Pago, confirmado
  por Nena"; Linha do tempo "Novo · hoje às 18h01 · cliente"; "imprimir comanda".
- `pedido-30-aceitar.webp` — right after tapping "aceitar · 30 min" on the board: toast "Pedido #30
  aceito", Novos 1 (#29 Luiz, R$ 219,00, "Pix a conferir"), Preparo 3. There is no prep-time sheet:
  the 15/30/45 choice is inline on the card (see `pedidos-novo-30`).
- `impressoras.webp` — Impressoras: "O pedido sai impresso na cozinha, sem ninguém precisar apertar
  nada."; device "Balcão" **conectado**, "Computador Windows · versão 0.1.0"; printer "EPSON
  TM-T20X", "Instalada no Windows", "imprimiu há 1 min", **automática**; "Quando imprimir": **Ao
  aceitar o pedido** / Assim que chega. The printing beat.
- `cozinha.webp` (tablet) — Cozinha 18:19 "ao vivo", chips "1 atrasado", "3 na fila", "1 em
  preparo"; tickets: #27 Retirada · Rafael **39:37 atrasado 10 min** (red stripes), #28 Entrega ·
  Mariana **21:37 faltam 8 min** (amber), #30 Entrega · Caio **14:37 faltam 15 min** (green, "na
  fila", 1× Bolo de cenoura com brigadeiro, 1× Fatia de chocolate, "começar"), #29 Entrega · Luiz
  13:37; rail "Prontos no balcão": #26 Fernanda. The kitchen beat.
- `cozinha-itens.webp` (tablet) — the cake ticked (struck through, check) on #30, "1/2", button
  "pronto"; "2 em preparo".
- `cozinha-pronto.webp` (tablet) — 18:21, the #30 ticket turned lime: "#30 pronto", "desfazer 5"
  (the undo window before the customer is told).
- `cozinha-phone.webp` — the kitchen on a phone, tab Prontos 2: #26 Fernanda "esperando o cliente ·
  há 23 min" (retirado); #30 Caio "esperando o entregador · há 1 min", button "saiu para entrega".
- `painel-chamada.webp` (tablet) — the customers' board calling the number: full lime screen
  "Pronto para retirada" / **30** (the board's own words; deliveries shown by its setting).
- `painel.webp` (tablet) — Bolos da Nena "Acompanhe seu pedido" 18:22; Preparando 27, 28 (moto), 29
  (moto); "Pronto · pode retirar" **30** (moto, highlighted), 26.
- `vitrine-pedido-pronto.webp` — the storefront's order page: PEDIDO #30, **Pronto**, "Chega entre
  19:05 e 19:35", progress bar; timeline Pedido recebido 18:01, Pedido confirmado 18:05, Em preparo
  18:11, Pronto 18:21 (sáb., 03 de out.); ENTREGA Rua das Acácias, 120 — Parque Califórnia,
  PAGAMENTO Pix, TOTAL R$ 62,50; Itens begins at the bottom. The customer-side payoff.
