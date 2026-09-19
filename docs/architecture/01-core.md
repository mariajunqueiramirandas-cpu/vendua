# 01 — Venduá Core

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0009](../adr/0009-mercado-pago-marketplace.md), [ADR 0013](../adr/0013-modular-monolith-core.md)

The Core is the single shared backend for all tenants. It owns **all** business
logic. The Kernel is a thin client of it; storefronts never talk to it directly
except through the Kernel (public reads) — see
[03-storefront-contract](03-storefront-contract.md#rules-of-engagement).

## Shape

A **modular monolith** in TypeScript (Bun or Node), Hono or Fastify HTTP layer,
Postgres as the system of record. No microservices until a module demonstrates
an independent scaling or isolation requirement — see
[ADR 0013](../adr/0013-modular-monolith-core.md).

```
core/
  modules/
    tenancy/        tenants, users, memberships, merchant auth
    catalog/        products, variants, modifier groups, categories, media
    store/          profile, hours, status, delivery zones, prep times
    cart/           server-side carts, sessions, totals
    checkout/       checkout sessions, address, delivery method, place-order
    delivery/       zone matching, fee calculation, ETAs
    payments/       provider adapters (mercadopago first), connections, webhooks
    orders/         order state machine, order events, merchant actions
    notifications/  WhatsApp templates, merchant alerts, transactional email
    identity/       customer auth (phone OTP), sessions
    analytics/      event ingestion, rollups, funnel queries
    notices/        server-driven notice composition → system surfaces
  platform/
    db/             Postgres, migrations, RLS policies
    outbox/         transactional outbox → webhooks/events
    http/           routing, authn middleware, error model, OpenAPI gen
    observability/  logs, metrics, tracing
```

Module rule: modules communicate through explicit service interfaces and the
outbox, never by reaching into each other's tables. If a module is ever
extracted to a service, its interface and events must not change.

## Multi-tenancy

- Every tenant-owned row carries `tenant_id`. Postgres **row-level security**
  enforces it as a second line of defense; application code still scopes every
  query explicitly.
- Tenant resolution: the edge forwards the original `Host`; Core resolves
  `Host → domain → tenant` against a read-through cache fed by the Control
  Plane's `domains` table. The public API never accepts a tenant id from the
  client.
- Isolation levels per surface:
  - `/storefront/v1/*` — public, tenant-scoped by host, read-heavy, CDN-cacheable
    with short TTLs. Store status and notices are _not_ CDN-cached (or cached
    ≤30 s) since they drive blocking UI.
  - `/checkout/v1/*` — session-token scoped (anonymous cart/checkout session,
    signed, rotatable). All mutations are idempotent via `Idempotency-Key`.
  - `/admin/v1/*` — merchant-authenticated (JWT, role-scoped: owner/staff).
  - `/control/v1/*` — internal only, mTLS or private network, used by Control
    Plane/edge/QA harness.

## API versioning

- One integer major per surface: `/storefront/v1`, `/checkout/v1`, `/admin/v1`.
- **Additive-only within a major**: new fields, new enum values, new endpoints
  are fine; removing or changing semantics requires a new major.
- Core supports **N and N−1** majors for ≥12 months. The compat matrix lives in
  the Control Plane ([11](11-backward-compatibility.md)).
- Enums are always open-ended on the wire: clients must tolerate unknown values
  (Kernel renders generically; storefronts never see raw values that change
  meaning — see SDUI rules in [05](05-system-surfaces.md)).
- Errors are typed: `{ error: { code: 'STORE_PAUSED', message, details } }` —
  `code` is the contract, `message` is human-readable and may change.
- OpenAPI-generated TS client shared by Kernel, admin app and QA harness.

## Server-side cart — non-negotiable

Cart lives in Core (`carts`, `cart_items`), addressed by a signed session token
minted by the Kernel at first interaction. Pricing, modifier math, promotions,
delivery fees and availability are **always computed by Core**. The Kernel holds
no totals logic; it renders what Core returns. Rationale: pricing rules in the
Kernel would exist in N versions simultaneously, unretractably.

## Key domain behaviors

- **Store status** (`store.status`): `open | closed | paused`, plus `resumesAt`,
  derived automatically from `hours` when not manually overridden. Status is
  part of the `vendua-state` edge injection and the notices pipeline — status
  changes must take effect without any storefront rebuild.
- **Orders**: strict state machine
  (`placed → confirmed → preparing → ready → out_for_delivery → delivered`,
  with `cancelled`, `refunded` branches). Transitions emit outbox events →
  notifications + `order.timeline` surface payloads.
- **Delivery**: zones as polygons or radii per tenant; `quote(address)` returns
  fee + ETA + eligibility; checkout hard-fails outside zones with typed error.
- **Payments**: see [13-payments](13-payments.md). Mercado Pago first behind a
  `PaymentProvider` interface; webhooks are the authoritative payment state
  (never client redirects), processed idempotently via outbox.
- **Notices**: a first-class Core capability. `composeNotices(tenant, surface,
context)` returns the `notices[]` SDUI payload — store status, delivery-zone
  warnings, promotional banners, system-wide emergencies. The schema is defined
  in [05](05-system-surfaces.md).
- **Notifications**: WhatsApp Cloud API templates for order status to customers
  and new-order alerts to merchants; email optional. All sends are outbox-driven
  and idempotent.

## Data model sketch

```
tenants(id, slug, name, plan, status, created_at)
users(id, tenant_id, role, name, phone, email, auth…)
payment_connections(tenant_id, provider, mp_user_id, access/refresh_vault_ref,
                    status, expires_at)
products(id, tenant_id, name, desc, base_price, status, …)
variants / modifier_groups / modifiers / categories / media_assets
store_settings(tenant_id, hours jsonb, status_override, prep_time, …)
delivery_zones(id, tenant_id, kind, geojson, fee, min_order, eta_min/max)
carts(id, tenant_id, session_token_hash, status, totals jsonb, …)
cart_items(cart_id, product_id, variant_id, modifiers jsonb, qty, unit_price)
orders(id, tenant_id, cart_id, customer_id?, state, totals, delivery jsonb, …)
order_events(order_id, at, from, to, actor, meta)
payments(id, order_id, provider, provider_payment_id, method, status,
         application_fee, raw jsonb)
customers(id, tenant_id, phone, name, addresses jsonb, consent jsonb)
analytics_events(id, tenant_id, name, at, session_id, props jsonb)
outbox(id, tenant_id, topic, payload, published_at)
```

(Domains, releases, deployments and health live in the **Control Plane** schema —
[08](08-control-plane.md) — not in Core.)

## Observability & safety

- Structured logs with `tenant_id`, `release`, `trace_id` on every request.
- Metrics per endpoint + per-tenant cardinality-guarded counters.
- Outbox-backed webhooks with at-least-once delivery + consumer idempotency.
- Rate limits per IP on public surfaces; per-session on checkout.
- Secrets (MP tokens, signing keys) in a vault/KMS, never in DB plaintext —
  `payment_connections` stores vault references.
- Every mutation endpoint: `Idempotency-Key` required, safe retries everywhere.
