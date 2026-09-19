# Review Guidelines — Venduá

Venduá is a multi-tenant commerce platform: one shared backend (`packages/core`,
Hono + Postgres with row-level security) serves many storefronts through a shared
client runtime (`packages/kernel`) and per-tenant storefronts (`storefronts/*`).
A bug here can leak one merchant's data to another, corrupt money math, or
duplicate orders — prioritize those above style and refactoring concerns.

Flag as **bug** anything that violates an invariant below, even without a failing
test. Flag as **security** anything that crosses tenants or weakens auth.

## Business-critical invariants

### Tenant isolation (highest severity)

- Every table must carry `tenant_id` and an RLS policy; every new migration must
  add both. A table without a policy, or a policy that can match another tenant's
  rows, is a blocker.
- Every request-scoped query must run under `SET LOCAL app.tenant_id` (see
  `platform/db.ts`). A query path that skips tenant context — raw `sql` without
  the tenant set, a transaction that forgets `SET LOCAL`, a JOIN that unions
  across tenants — is a blocker.
- Session tokens are bound to a tenant (`vst.<cartId>.<hmac>` over
  `tenantId|cartId`). Token verification must compare the tenant — accepting a
  token minted under tenant A on tenant B's host is a blocker.
- Tenant resolution is Host-header based via the `domains` table.
  `X-Forwarded-Host` may only be trusted when `VENDUA_TRUST_PROXY` is set; a
  code path that trusts it unconditionally is a bug.

### Money and order integrity

- All prices are integer cents; totals are computed server-side in Core only.
  Any client/kernel code that computes or adjusts a price, fee, or total is a
  bug — the kernel surfaces Core's answer, never recomputes it.
- Line totals must equal `(unit + modifiers) × qty` with modifiers snapshotted
  at add time; a code path that re-derives prices at read time can show wrong
  totals after a price change.
- Exactly one order may exist per cart (`orders.cart_id` unique + checkout
  locking). A checkout path that can create a second order for the same cart —
  including a retry, a double-submit, or a concurrent request — is a blocker.
- Order numbers are per-tenant monotonic, assigned under the tenant advisory
  lock. A gap-free guarantee is not required, but two orders sharing a number
  within a tenant is a bug.

### Cart lifecycle and checkout validation

- Mutations may only touch `open` carts — `assertCartOpen` under `FOR UPDATE`.
  Any path that can mutate a `completed`/`abandoned` cart, or read it as still
  editable, is a bug.
- Checkout must re-validate at commit time: store not `paused` (`paused` blocks
  checkout; `closed` accepts pre-orders — do not flag this), fulfillment mode
  enabled, delivery zone match + fee, min-order, every item still active and
  every modifier still active (sold-out check happens AGAIN at checkout, not
  only at add-time).
- Fulfillment modes are `pickup`/`delivery` only; `delivery` requires a
  neighborhood that resolves to a zone; a blank or whitespace address is
  invalid.

### Idempotency and concurrency

- Every mutating endpoint requires `Idempotency-Key` and goes through the
  claim/owner/advisory-lock pattern in `platform/http.ts` — a new mutation that
  skips it can double-apply.
- Claims are owner-bound and a failed handler must release its claim so a retry
  can re-execute; a claim that survives a thrown handler permanently poisons the
  key.
- Watch for check-then-act races: availability checks, stock checks, and cart
  status checks must happen under row locks or be re-validated in the same
  transaction that writes.
- Kernel-side: `ensureSession` is single-flight (concurrent first mutations must
  share one session), delivery writes are serialized per call-time token, and
  checkout rotates the session only AFTER the order is stored — reordering these
  is a bug.

### API contract

- Error responses use stable codes from `ERROR_CODES` (`kernel/src/api.ts`).
  New codes must be added there; storefronts may switch on them.
- Malformed ids/inputs must produce stable 4xx (`uuidParam`, `str`, `bounded`,
  32KB body cap) — never a Postgres error (22P02) surfacing as 500.
- Unbounded input is a bug: any request field written to the DB or echoed needs
  a length cap; arrays need a size cap.

### Storefront contract (storefronts/*, packages/kernel)

- Storefront code must never call `fetch`/`axios`/XHR directly — only the kernel
  api client. Reserved proxy prefixes are `/checkout/v1`, `/storefront/v1`,
  `/v1` — never bare `/checkout`, `/cart`, etc.
- Storefronts never persist cart/session state themselves — the kernel owns the
  session token and per-order tracking tokens.
- `storefronts/_examples/` is a frozen mirror — when a finding names a file
  there, check whether the same bug exists in its `storefronts/` source and flag
  the source; do not request fixes only in the mirror.

### postgres.js specifics (packages/core)

- `ReservedSql` has no `.begin()` — transactions on a reserved connection must
  use `sql.begin`/`sql.unsafe` patterns already in the codebase; flag
  `reserved.begin(...)`.
- `jsonb` parameters require `tx.json(value)`; multi-statement DDL requires
  `sql.unsafe` — these are established conventions, not style.
- `migrate()` must run as the owner role (`MIGRATION_DATABASE_URL`) under the
  advisory lock inside one transaction; the `vendua_app` role must never gain
  DDL or `BYPASSRLS`.

## Non-goals — do not flag

- `closed` status accepting pre-orders (by design; only `paused` blocks checkout).
- `SESSION_SECRET` defaulting to a per-boot `randomUUID()` in dev (deliberate —
  unset means unforgeable).
- Style/formatting — prettier config owns it (`bun run format`).
- Missing test coverage on spike storefronts — Phase 0 code is intentionally
  thin; flag behavioral bugs, not coverage.

## Ignore

- `docs/**`, `*.md` (unless a doc change contradicts code behavior), `bun.lock`,
  `**/dist/**`, `**/node_modules/**`, `docker-compose.yml` port/env wiring.
- `storefronts/_examples/**` — mirror of `storefronts/quero-pudim` (see above).
