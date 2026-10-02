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
- `vitrine-pagamento-750.webp` — Finalizar pedido, step Pagamento: Pix selected (radio), Cartão na
  entrega, Dinheiro; "Confirmar pedido · R$ 48,00". The "Pix" beat.
- `vitrine-pix-750.webp` — the order page after confirming: "Pedido #1 recebido! R$ 48,00 · Pix",
  "Pague com Pix R$ 48,00", "Copiar código Pix", Pix copia e cola. Not used: its "#1" would contradict
  order #29 in Frame 5.
