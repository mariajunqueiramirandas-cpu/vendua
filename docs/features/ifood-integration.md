# iFood integration (P-013)

> Status: Tracked, not planned · Started 2026-10-01 · Gap: [P-013](../competitor-parity.md) · Related: [menu-import §3](../menu-import.md#3-platforms) (iFood is "Blocked; later via the official API")

Connect a merchant's iFood store to Venduá so orders, menu and store status
flow without retyping. Different from the one-time **menu import**: that reads
a public page once; this is a continuous, authorized integration.

## What competitors ship

Marketing claims from each vendor's own pages; "?" means not stated.

| Capability                    | Saipos | Anota AI        | Cardápio Web                | OlaClick                                                           | Takeat                 | Instadelivery |
| ----------------------------- | ------ | --------------- | --------------------------- | ------------------------------------------------------------------ | ---------------------- | ------------- |
| iFood orders into the system  | Y      | Y               | Y                           | Y                                                                  | Y (tagged by channel)  | Y             |
| Auto-accept / auto-print      | ?      | ?               | Y (iFood's own must be off) | ?                                                                  | Y (non-fiscal printer) | ?             |
| Status updates back to iFood  | ?      | ?               | ?                           | Y                                                                  | ?                      | ?             |
| Cancellation from the tool    | ?      | ?               | Y                           | ?                                                                  | ?                      | ?             |
| Menu, price, availability out | Y      | one-time import | manual product linking      | Y (claimed real time)                                              | pause items            | ?             |
| Stock decrement from orders   | Y      | ?               | ?                           | ?                                                                  | ?                      | ?             |
| Store open/closed from tool   | Y      | ?               | ?                           | N (controlled in iFood)                                            | widget only            | ?             |
| Known limits                  |        |                 |                             | iFood orders not editable; courier tips not synced; 72 h to enable |                        |               |

Table stakes: orders in, kitchen workflow, availability pause. The harder
half, a continuous menu and status sync, is claimed by only two.

## How the iFood Merchant API works

From developer.ifood.com.br and partner pages. Several official pages returned
404 to our fetcher, so items marked (summary) come from search summaries and
need a read of the official page before design.

**Becoming an integrator**

- Register on the developer portal, build against test credentials, then
  request homologation. The portal says about one week; one developer reports
  2-3 rejections with generic errors before a manual review.
- Needs a **CNPJ** (not CPF) and a technology CNAE. A production app exists only
  after the test app is certified, via a validation meeting on a test store.
- Customer-initiated cancellation and dispute flows (handshake) cannot be
  simulated in the portal, so they need assisted homologation.

**App type decides the architecture**

- **Centralized (SaaS):** one app serves all authorized stores. Auth is
  `client_credentials`, no refresh token, access token about 3 h (one source
  says 6 h: verify). The merchant is selected per request through the
  `x-polling-merchants` header. This matches our multi-tenant model.
- **Distributed (on-premise):** per-merchant OAuth (`userCode`, merchant
  authorizes in the Partner Portal, then `authorization_code`), refresh token
  valid 7 days.
- Merchant authorization in practice: the merchant authorizes the app in the
  Portal do Parceiro ("Conectar iFood"). OlaClick reports up to 72 h after the
  merchant submits their Store ID.

**Orders**

- Polling is the documented core: `GET /events:polling` every **30 s** (it also
  keeps the store "online"), then `POST /events/acknowledgment` (up to 2,000
  ids) only after the events are durably stored. Unacknowledged events are
  redelivered; events are kept up to 8 h. A webhook option exists but its
  details are unknown.
- Up to 500 stores per polling request; the `x-polling-merchants` header is
  mandatory above 500 merchants and recommended from 100.
- Order actions (`confirm`, `readyToPickup`, `dispatch`, `requestCancellation`)
  return HTTP 202 and are asynchronous: do not change local state until the
  confirming event arrives. For merchant-delivered orders `readyToPickup` must
  precede `dispatch`. Unaccepted orders auto-cancel after about 5 min (summary).
- Event codes have a short `code` (PLC) and a canonical `fullCode` (PLACED);
  matching the wrong one is a known bug source.
- Takeout and dine-in orders arriving at a marketplace integration are to be
  refused via cancellation (summary).

**Other modules:** catalog v1 and v2, merchant status (opening hours,
interruptions: use interruptions, not hours edits, for pauses), shipping
(iFood couriers for own-fleet merchants, courier tracking after `ASSIGN_DRIVER`),
financial and reconciliation (gzipped CSV), reviews, and promotions (marketplace
partners only).

**Rate limits** are per module, 20 to 6,000 requests/min (orders 3,000-6,000,
catalog v2 3,000-5,000, authentication 100). Excess returns 429.

**Improper-use policy** has three blocking levels, from losing marketplace
listing to blocking API consumption. Triggers: polling faster than 30 s,
missing acknowledgments, querying one order more than 10 times, a 4xx rate
above about 2% on monitored endpoints, credentials in URLs, 90+ days inactive.
Two pollers on the same credentials (dev and prod) steal each other's events.

**Unknown, read the terms before design:** who owns order and customer data,
retention obligations, exact cancellation-reason lists and dispute deadlines.

## Feature checklist for Venduá

Proposed, not decided, in suggested order.

- [ ] Venduá registered as an iFood centralized app (CNPJ, homologation)
- [ ] "Conectar iFood" in the admin; authorization status and health
- [ ] Per-tenant poller with acknowledgment after durable store
- [ ] Order ingestion into the orders model with `source = ifood` and an
      `external_id`, deduplicated on that id
- [ ] Order lifecycle both ways: accept, ready, dispatch, cancel with reason
- [ ] New-order alert and printing for iFood orders in the existing admin flow
- [ ] Availability pause by item, and whole-store open/close, from Venduá
- [ ] Menu and price sync out (catalog v2) with item linking
- [ ] Stock decrement from iFood orders
- [ ] Handshake: customer cancellation and dispute events
- [ ] Reconciliation and fee statement for iFood orders (financial module)

## What we already have

| Piece             | State                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu import       | Adapter pipeline for 7 platforms; iFood blocked by Cloudflare, "later via official API" (`menu-import.md` §3 step 4: register Venduá as an iFood app, "Conectar iFood", catalog v2). Its own design doc is still to write. |
| Polling pattern   | Per-tenant `setInterval` jobs in `payments/jobs.ts` with a connection table and secret handling (`payments/connections.ts`, `control_integrations`). Agent scheduler is CRM-scoped, not a fit.                             |
| Order model       | `placeOrderTx` is the single order-birth point and reprices; iFood orders arrive priced, so ingestion needs a separate insert path, not the checkout. No `source` or `external_id` column.                                 |
| Order transitions | `transitionOrder` with `order_events` and an outbox (`order.<state>`); the natural place to call iFood actions on state change.                                                                                            |
| Merchant alerts   | Push plus WhatsApp fallback in `admin/workers.ts` would cover iFood orders once they exist as orders.                                                                                                                      |
| Tenant isolation  | Every job must iterate tenants under `withTenant` (`platform/db.ts`), RLS per table.                                                                                                                                       |
| ADR               | none for iFood                                                                                                                                                                                                             |

## Open decisions

1. **Own the money invariant?** Core computes money and clients never
   recompute. iFood orders come with iFood's totals, fees and coupons. They
   must be stored as given and flagged external, not repriced.
2. **Registration:** who holds the CNPJ and CNAE for the app, and who runs
   homologation (about one week, opaque rejections).
3. **Scope of v1:** orders in plus accept/cancel (smallest useful) versus full
   menu and status sync (what two competitors claim).
4. **Strategic:** iFood is the marketplace we sell against, and Anota AI is
   reportedly owned by iFood (search summary, verify). Becoming an integrator
   ties part of the product to iFood's terms and its blocking policy.
5. **Dependency:** the `source` column is shared with the
   [WhatsApp bot](whatsapp-bot.md).

## Sources

Official: developer.ifood.com.br (portal home; `docs/getting-started/documentation/rate-limit/`,
`.../best-practices/`, `.../improper-use/`; guides for events polling, merchant
workflow, order workflow, shipping, financial reconciliation, promotion).
Competitors: ajuda.cardapioweb.com/automacao/integracoes/integracao-com-o-ifood,
help.olaclick.com (como integrar ao iFood), olaclick.com/ifood,
saipos.com/ifood/iconnect-ifood, anota.ai/home/funcionalidade/integracao-com-ifood/,
takeat.app, blog.instadelivery.com.br/integracao-ifood-instadelivery/.
Third party: dev.to homologation write-up, alloy.al cancellation post, a
GitHub implementation PR.

## Change log

- 2026-10-01: first pass.
