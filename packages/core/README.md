# @vendua/core — Venduá Core (Phase 0 skeleton)

The shared multi-tenant backend. Modular monolith: Bun + Hono + Postgres, one
process, one schema, row-level security on every tenant table. Normative
reference: `docs/architecture/01-core.md`.

## What exists in Phase 0

| Surface          | Scope                                                                  | Endpoints                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/storefront/v1` | public, tenant resolved from `Host`                                    | `GET /store` · `GET /catalog` · `GET /products/:slug` · `GET /surfaces` · `GET /state` · `GET /events` (SSE hints)                                                 |
| `/checkout/v1`   | anonymous session token (`vst.*`), `Idempotency-Key` on every mutation | `POST /session` · `GET /cart` · `POST /cart/items` · `PATCH/DELETE /cart/items/:id` · `POST /cart/delivery` · `POST /quote` · `POST /checkout` · `GET /orders/:id` |
| `/control/v1`    | staff (`CONTROL_SECRET` / CRM session)                                 | `GET /state?tenant=<slug>` — a store's status + blocking notices                                                                                                   |
| `/v1/v.js`       | the loader                                                             | proxied by the edge, which keeps the last good copy while Core is down                                                                                             |

Modules under `src/modules/`: `store` (hours → open/closed/paused derivation),
`catalog`, `cart` (server-side totals — the Kernel holds no pricing),
`checkout` (stub: full validation + order creation; Mercado Pago is Phase 2),
`orders` (state machine + events + outbox), `notices` (`composeNotices` → SDUI
envelope per `05-system-surfaces.md`).

## Commerce (roadmap Phase 2, migration 0051)

| Surface          | Endpoints                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/storefront/v1` | `GET /cep/:cep` (address + zone) · `POST /waitlist`; products carry `imageUrl`/`gallery`, stock/`lowStock`, `kind: 'combo'` + `comboSlots`, encomenda fields; `/store` carries `pix`/`loyalty`                                                                                             |
| `/checkout/v1`   | `POST /coupons/validate` · `POST/DELETE /cart/coupon` · `POST /cart/import` · `POST /cart/share` · `POST /cart/reorder` · `POST /customer/session` · `GET /customer/orders` · `GET /customer/loyalty` · `GET /orders/:id/events` (SSE) · `GET /orders/:id?since&wait` (long-poll fallback) |
| `/control/v1`    | `…/storefronts/:slug/commerce/` — `PATCH products/:p` (stock, status, encomenda) · `PUT products/:p/media` · `PUT products/:p/combo` · coupons · `PATCH settings` (pix, loyalty, location, preorder) · zones · orders + `transition` · waitlist                                            |

Modules: `place-order` (the one place an order is born — fee, coupon, stock and
schedule recomputed under locks), `coupons`, `combos`, `stock`, `preorder`,
`customer` (tokens, orders-by-phone, loyalty — ADR 0019), `cart-share`, `geo`
(bairro + radius zones, ViaCEP with an LRU), `pix` (BR Code), `order-live`
(LISTEN `vendua_order` → SSE pushes and long-poll wake-ups).

## Control Plane (roadmap Phase 4, migration 0064, ADR 0022)

`src/modules/fleet`: releases, pointer-flip deployments verified by synthetic probes, fleet
incidents and the provisioner (docs/architecture/08-control-plane.md). A 15 s loop
(`startFleetJobs`) reconciles drift, advances provisionings and probes live hosts.

| Surface             | Endpoints                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/control/v1/fleet` | `GET status` · `GET storefronts[/:slug]` · `PATCH storefronts/:slug` · `POST storefronts/:slug/{promote,rollback,probe}` · `GET/POST releases` · `GET/POST provisionings` · `POST provisionings/:id/retry` · `GET slug` · `GET incidents` · `PATCH incidents/:id` |
| `/edge/v1/resolve`  | the edge only (`x-vendua-edge: VENDUA_EDGE_SECRET`): Host → tenant + live release                                                                                                                                                                                 |
| `/storefront/v1`    | `GET /surfaces?design=1` — the edge's injected state: surfaces + the live templates and tokens (Kernel 1.10)                                                                                                                                                      |

Env: `VENDUA_EDGE_SECRET`; `VENDUA_PROBES` (`1`/`0`; default on in production, off in dev);
`VENDUA_PROBE_ORIGIN` (probe through `http://edge:8080` instead of `https://<host>`).

## Dev loop

```sh
bun run db:up      # postgres:16 in docker, port 5433
bun run migrate    # schema (also runs automatically on `bun run dev`)
bun run seed       # dev tenant: quero-pudim, blank (onboarding fills it)
bun run seed:fixtures  # CI/fleet: menu, zones, Pix + the canary tenants (what `vendua train` needs)
bun run dev        # http://localhost:8787
bun run test       # unit tests (no DB needed)
bun run check      # tsc
```

Tenant resolution is host-based, exactly like production: a storefront dev
server proxies `/storefront`+`/checkout` to Core with its own `Host`
(`quero-pudim.localhost`, or `localhost:<port>` — both are seeded in
`domains`). Try it:

```sh
curl -H 'Host: quero-pudim.localhost' localhost:8787/storefront/v1/surfaces
```

## Notes / skeleton limits

- Checkout doesn't capture payment: orders are created `placed` with
  `payment.provider = 'sandbox'` (Pix orders carry a copia e cola for the exact
  amount). MP OAuth/PIX capture/webhooks land in Phase 3.
- Admin APIs (`/admin/v1`), payments, notifications, identity, analytics are
  Phase 2+; only the tables needed for Phase 0 exist.
- Order transitions exist (`modules/orders.ts`) but no admin surface consumes
  them yet — exercising them is a merchant-admin concern.
- `SESSION_SECRET`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `PORT` are env
  vars; dev defaults are in `src/index.ts`. `DB_POOL_MAX` sizes the Postgres pool
  requests use, per process (default 10); `DB_JOBS_POOL_MAX` the separate one for background
  jobs, the scheduler and agents (default 10).
