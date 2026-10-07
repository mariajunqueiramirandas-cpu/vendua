# Competitor parity — what every competitor has and we don't

> Status: Living tracker · Started 2026-10-01 · Owner: product

Features that merchants can reasonably expect because competing platforms ship
them, and that Venduá does not have yet. This is a **gap ledger**, not a
roadmap: an entry here means "we are missing it", and a decision to build it
moves it to [`roadmap.md`](roadmap.md) or an ADR.

## How to use this file

- One row per feature, one stable ID (`P-001`, never reused or renumbered).
- **Evidence** is a link or a dated note (competitor docs, pricing page, a
  merchant asking for it). A row with no evidence is a hypothesis: keep it in
  _Unverified_ until someone checks.
- Only list a feature when **most** relevant competitors have it. A feature one
  competitor has is a differentiator to consider, not parity.
- Before adding a row, grep Core and the admin to confirm we really lack it.
- Copy that states a price, plan or date needs the owner's decision (see
  `CLAUDE.md`); keep those out of this file.

Status: `gap` (confirmed missing) · `partial` (exists, weaker than the
market) · `planned` (has a roadmap/ADR link) · `shipped` (move to the log below)
· `declined` (we chose not to, with the reason).

Priority: `P0` merchants churn or don't convert without it · `P1` frequent ask
· `P2` nice to have.

## Competitor set

Primary: the platforms our merchants already use, as named in
[`menu-import.md` §3](menu-import.md#3-platforms). Their public stores are the
evidence base, and each one is also an import adapter.

| Platform        | Role                        | Import status (menu-import §3)  |
| --------------- | --------------------------- | ------------------------------- |
| anota.ai        | Primary (cardápio digital)  | Blocked from our test network   |
| Goomer          | Primary                     | Doable                          |
| Instadelivery   | Primary                     | Easy                            |
| Cardápio Web    | Primary                     | Easy                            |
| OlaClick        | Primary                     | Easy                            |
| Delivery Direto | Primary                     | Easy                            |
| Takeat          | Primary                     | Easy                            |
| Saipos          | Primary                     | Easy                            |
| iFood           | Marketplace we sell against | Blocked; later via official API |

Secondary, for reference only (generalist storefronts, weaker signal for a
food merchant): Nuvemshop, Tray, Loja Integrada, Yampi, Shopify. Menudino was in
the first proposal but is in no existing doc; keep it out unless a merchant
names it.

## Confirmed gaps

Code status verified 2026-10-01 against Core, admin, kernel, ui-defaults and
`storefronts/`. Competitor counts are out of the 9 food-segment platforms
(8 primary + iFood) unless noted; "generalists" are Nuvemshop, Tray, Loja
Integrada, Yampi and Shopify. Counts only include what a source states, so
they are floors. Priorities are **proposed** and need the owner's call.
Profiles: [`competitors/`](competitors/README.md).

### Food segment (our core market)

| ID    | Feature                                                                      | Who has it                                                                | Our status                                                                                    | Pri (proposed)                           |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| P-015 | Dine-in: QR table ordering, comanda                                          | 7 of 8 primary (all but Saipos explicit)                                  | partial: staff-taken comandas on tables ([ADR 0035](adr/0035-pdv.md)); no shopper QR ordering | P0 if we serve restaurants, else decline |
| P-013 | [iFood / marketplace order and menu sync](features/ifood-integration.md)     | 5 of 8 primary (Instadelivery, Cardápio Web, OlaClick, Takeat, Saipos)    | gap: iFood import only planned, via the Merchant API                                          | P0                                       |
| P-017 | [Shopper-facing WhatsApp ordering bot / attendant](features/whatsapp-bot.md) | 6 of 8 primary (AI at anota.ai, Cardápio Web, OlaClick, Takeat)           | gap: click-out link only (`OrderDetail.tsx:197`)                                              | P1                                       |
| P-016 | Kitchen printing (thermal, auto) and KDS screen                              | KDS: anota.ai, Goomer, Cardápio Web, Takeat, Saipos; print: Instadelivery | have: KDS ([ADR 0029](adr/0029-kitchen-display.md)), auto print (ADR 0027)                    | P1                                       |
| P-004 | Fiscal documents (NF-e / NFC-e)                                              | 5 of 8 primary; Nuvemshop, Tray, Loja Integrada                           | gap                                                                                           | P1                                       |
| P-019 | Courier management and tracking                                              | anota.ai, Instadelivery, Cardápio Web, OlaClick, Saipos                   | gap, deferred after Phase 8 (`roadmap.md:618`)                                                | P1                                       |
| P-018 | WhatsApp campaigns / broadcasts to customers                                 | anota.ai, Instadelivery, Cardápio Web, OlaClick                           | gap                                                                                           | P1                                       |
| P-010 | Cashback / referral on top of loyalty                                        | cashback: anota.ai, Instadelivery, Cardápio Web, Takeat; Yampi            | partial: stamps and rewards only                                                              | P2                                       |
| P-001 | Abandoned-cart recovery                                                      | anota.ai, Cardápio Web, Delivery Direto; every generalist                 | partial: `'abandoned'` is a type nothing sets                                                 | P1 (cheap, WhatsApp-native)              |
| P-022 | Delivery / pickup time slots                                                 | Instadelivery, Cardápio Web                                               | partial: date-based encomendas only (`preorder.ts`)                                           | P2                                       |
| P-021 | Custom domain, fully automated                                               | OlaClick, Delivery Direto                                                 | partial: planned, ADR 0010 Proposed, staff-activated                                          | planned                                  |
| P-020 | AI-generated product descriptions                                            | Instadelivery; AI features at 5 of 6 cardápio platforms                   | gap                                                                                           | P2                                       |
| P-002 | Store and product reviews                                                    | Instadelivery, Cardápio Web, Takeat (feedback); Tray, Yampi               | gap                                                                                           | P2                                       |
| P-005 | Ad pixels and conversions API                                                | anota.ai, Cardápio Web; every generalist (Meta CAPI at three)             | gap                                                                                           | P1 for paid-traffic merchants            |

### Generalist storefront features (weaker signal for food)

| ID    | Feature                                            | Who has it                                     | Our status                                   | Pri (proposed)    |
| ----- | -------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- | ----------------- |
| P-012 | Per-page SEO, redirects, sitemap                   | Nuvemshop, Tray, Yampi; Shopify partial        | gap (SSR host conditional, `roadmap.md:613`) | P1                |
| P-006 | Google Merchant / Meta product feeds               | Tray, Loja Integrada, Nuvemshop; Shopify       | gap                                          | P2                |
| P-007 | Instagram / WhatsApp catalog sync                  | Nuvemshop; partial elsewhere; 0 food platforms | gap                                          | P2                |
| P-003 | Carrier quotes and labels (Correios, Melhor Envio) | all four BR generalists; no food platform      | gap: zones and fees only                     | P2                |
| P-014 | Subscriptions / recurring orders                   | Nuvemshop, Yampi, Shopify; no food platform    | gap (adjacent: encomendas)                   | P2                |
| P-009 | Gift cards / store credit                          | Shopify; Yampi partial                         | gap                                          | P2                |
| P-008 | Customer accounts                                  | Yampi, Shopify                                 | declined by ADR 0019 (OTP "later")           | declined          |
| P-011 | Multi-language / currency                          | Nuvemshop, Shopify; no food platform           | gap, no ADR (pt-BR and BRL hardcoded)        | decline candidate |

## Open decisions

- **Do we serve dine-in?** Yes, for orders the staff take (owner, 2026-10-06,
  [ADR 0035](adr/0035-pdv.md)). Still open: shopper-side QR table ordering (the rest of
  P-015) and whether the WhatsApp bot (P-017) takes dine-in orders.
- **Is P-011 declined?** There is no ADR; `docs/adr/` would record it.
- **Priorities** above are proposals, not decisions.

## Shipped / declined log

| ID    | Feature                                                   | Outcome | Date       | Link                                           |
| ----- | --------------------------------------------------------- | ------- | ---------- | ---------------------------------------------- |
| P-023 | PDV / counter sales, caixa, mesas with comandas           | shipped | 2026-10-06 | [ADR 0035](adr/0035-pdv.md)                    |
| P-024 | Order-status messages to shoppers from the store's number | shipped | 2026-10-02 | [ADR 0026](adr/0026-store-whatsapp-gateway.md) |
