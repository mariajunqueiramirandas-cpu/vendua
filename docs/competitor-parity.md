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

Not yet agreed. Proposed starting point, to confirm:

| Segment                    | Candidates                             |
| -------------------------- | -------------------------------------- |
| BR generalist storefronts  | Nuvemshop, Tray, Loja Integrada, Yampi |
| Global generalist          | Shopify                                |
| Food / delivery (our core) | iFood, Anota AI, Goomer, Menudino      |

## Confirmed gaps

| ID  | Feature | Competitors | Status | Pri | Evidence | Notes |
| --- | ------- | ----------- | ------ | --- | -------- | ----- |
|     |         |             |        |     |          |       |

## Unverified candidates

Seeded from general market knowledge, **not yet checked** against the
competitors or the codebase. Verify, then promote to _Confirmed gaps_ or drop.

| ID    | Feature                                                     | Area       | Check first                        |
| ----- | ----------------------------------------------------------- | ---------- | ---------------------------------- |
| P-001 | Abandoned-cart recovery (WhatsApp / email)                  | Marketing  | `abandoned` exists in Core: scope  |
| P-002 | Product reviews and ratings                                 | Storefront | no hits in Core or admin           |
| P-003 | Carrier shipping quotes and labels (Correios, Melhor Envio) | Loja       | zones/flat fees only today         |
| P-004 | Fiscal documents (NF-e / NFC-e) issuance                    | Pagamentos | no hits in Core or admin           |
| P-005 | Ad pixels and conversions API (Meta, Google, TikTok)        | Marketing  | one `pixel` hit: scope             |
| P-006 | Product feeds for Google Merchant / Meta catalog            | Marketing  | no hits                            |
| P-007 | Instagram / WhatsApp catalog sync                           | Marketing  | Instagram hits are likely import   |
| P-008 | Customer accounts (order history, saved addresses)          | Storefront | see ADR 0019 (deliberately none)   |
| P-009 | Gift cards / store credit                                   | Marketing  | two `gift` hits: scope             |
| P-010 | Referral and cashback programs                              | Marketing  | loyalty stamps only                |
| P-011 | Multi-language / multi-currency storefront                  | Storefront | no i18n; likely `declined` (pt-BR) |
| P-012 | Per-page SEO controls (titles, meta, redirects, sitemap)    | Storefront | three `seo` hits: scope            |
| P-013 | Marketplace and POS integrations (iFood, Rappi, PDV)        | Pedidos    | none today                         |
| P-014 | Scheduled / recurring orders (subscriptions)                | Pedidos    | encomendas only                    |

## Shipped / declined log

| ID  | Feature | Outcome | Date | Link |
| --- | ------- | ------- | ---- | ---- |
|     |         |         |      |      |
