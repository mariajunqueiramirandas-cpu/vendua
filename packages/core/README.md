# @vendua/core — Venduá Core (Phase 0 skeleton)

The shared multi-tenant backend. Modular monolith: Bun + Hono + Postgres, one
process, one schema, row-level security on every tenant table. Normative
reference: `docs/architecture/01-core.md`.

## What exists in Phase 0

| Surface          | Scope                                                                  | Endpoints                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/storefront/v1` | public, tenant resolved from `Host`                                    | `GET /store` · `GET /catalog` · `GET /products/:slug` · `GET /surfaces` · `GET /state`                                                                             |
| `/checkout/v1`   | anonymous session token (`vst.*`), `Idempotency-Key` on every mutation | `POST /session` · `GET /cart` · `POST /cart/items` · `PATCH/DELETE /cart/items/:id` · `POST /cart/delivery` · `POST /quote` · `POST /checkout` · `GET /orders/:id` |
| `/control/v1`    | internal (dev-open)                                                    | `GET /state?tenant=<slug>` — the edge-injection payload                                                                                                            |
| `/v1/v.js`       | the loader stub                                                        | in prod served from CDN; dev-only here                                                                                                                             |

Modules under `src/modules/`: `store` (hours → open/closed/paused derivation),
`catalog`, `cart` (server-side totals — the Kernel holds no pricing),
`checkout` (stub: full validation + order creation; Mercado Pago is Phase 2),
`orders` (state machine + events + outbox), `notices` (`composeNotices` → SDUI
envelope per `05-system-surfaces.md`).

## Dev loop

```sh
bun run db:up      # postgres:16 in docker, port 5433
bun run migrate    # schema (also runs automatically on `bun run dev`)
bun run seed       # dev tenants: quero-pudim, brasa, forn
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

- Checkout is a **stub**: orders are created `placed` with
  `payment.provider = 'sandbox'`. MP OAuth/PIX/webhooks land in Phase 2.
- Admin APIs (`/admin/v1`), payments, notifications, identity, analytics are
  Phase 2+; only the tables needed for Phase 0 exist.
- Order transitions exist (`modules/orders.ts`) but no admin surface consumes
  them yet — exercising them is a merchant-admin concern.
- `SESSION_SECRET`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `PORT` are env
  vars; dev defaults are in `src/index.ts`.
