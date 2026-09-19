# Phase 0 findings — observed central-behavior touchpoints

> Status: Working draft · collected while building the Core skeleton, the rough
> Kernel, and the first spike storefronts. Every entry is a place a store
> needed to touch behavior that should have been central — these become slots,
> primitives, or API fields in Contract v1 (docs/roadmap.md Phase 0 exit).

Sources: `storefronts/<slug>/OBSERVATIONS.md` from each spike + platform work
in `packages/core` and `packages/kernel`.

## From platform bring-up (core + kernel)

1. **Tenant vocabulary is Core data, not storefront constants.** The Quero
   Pudim port needs item noun "doce" and bag "sacola" — the reference repo
   proved per-tenant vocabulary is real (`copy.vocabulary`). Shipped:
   `store_settings.vocabulary` jsonb → `store.vocabulary` on
   `GET /storefront/v1/store` (migration 0002).
2. **Products need a figure/asset field.** `GET /catalog` returns no imagery;
   every storefront will need `product.figure` (asset ref or built-in SVG
   motif id) + an `Img`-style primitive with a graceful fallback.
3. **Money formatting must be a Kernel util.** Every storefront formats
   centavos → BRL. Shipped: `formatCents(cents, currency, locale)` +
   `formatBRL` alias exported from `@vendua/kernel`.
4. **Delivery zones need a public read surface.** Storefronts can't render an
   address/neighborhood picker without knowing serviced neighborhoods.
   Shipped: `GET /storefront/v1/zones` + `useDeliveryZones` +
   `api.quote(neighborhood)`.
5. **`store.opensAt` (next opening) is missing.** `deriveStatus` computes it
   internally for notices but `/store` didn't expose it. Shipped: `closed`
   status sets `resumesAt` to the next window boundary (exact minute —
   `nextOpen` was rewritten from 30-min probes), so `resumesAt` covers both
   paused-resume and next-open.
6. **Order confirmation needs a WhatsApp deep link.** Reference storefront
   confirmed orders via WhatsApp. v1: `order.trackingUrl` + canonical
   `https://wa.me/<store.whatsapp>?text=…pedido #n` helper, or a
   `notify.whatsapp` notice action emitted by Core at order create.
7. **Font loading is unowned.** Tokens name font families, nothing loads the
   files. v1: contract rule — storefronts self-host fonts under `assets/fonts`
   and declare `font.srcs`; Kernel emits `@font-face` for declared sources.
8. **No default cart drawer.** `cart.Drawer` is in the slot registry but has
   no Kernel default — every spike rebuilt one. v1: ship `cart.Drawer` +
   `cart.LineItem` defaults in ui-defaults so a no-override store still has a
   cart.
9. **Modifier selection needs a primitive.** `AddToCart` accepts
   `modifierIds` but nothing enforces required groups client-side;
   `catalog.ModifierPicker` is registry-only. v1: Kernel `ModifierPicker`
   primitive that knows `minSelect/maxSelect/required` and produces
   `modifierIds`, driving `AddToCart`'s disabled state.
10. **Checkout needs a step surface.** `useCheckout().submit` works but there
    is no `checkout.Layout` default; stores rebuilt address→delivery→payment.
    v1: Kernel-owned checkout surface mounted at `/(vendua)/checkout`.
11. **`useOrder` polling hook missing.** Shipped: `useOrder(id)` with manual
    `refetch` (polling + a `poll` option is Phase 1+; realtime is a feature
    gap below).
12. **postgres.js jsonb footgun** (platform-internal, recorded so it isn't
    re-learned): `JSON.stringify(x)` into a jsonb param double-encodes to a
    JSON _string_; always `sql.json(x)`.

## From storefront spikes (OBSERVATIONS.md)

All three spikes reported: `quero-pudim` (full port of the reference
storefront, zero feature loss — the canonical example, now also at
`storefronts/_examples/quero-pudim`), `brasa`, and `forn`. Their combined
lists:

### Fixed in the platform already (spike found → base patched same week)

- **Session death after checkout** — `vst.<cartId>.<hmac>` pinned to a
  `completed` cart stranded every subsequent `addItem` (CART_NOT_FOUND).
  Core: `POST /session` now re-attaches open carts and rotates spent tokens;
  Kernel: `clearSession()` + `ensureSession` self-heals, `useCheckout`
  invalidates the cart query.
- **`api.order()` always 401** — no auth header; fixed, and `useOrder(id)`
  hook added (order tracking + manual refetch).
- **No zone read surface** — `GET /storefront/v1/zones` shipped +
  `useDeliveryZones`; `api.quote(neighborhood)` exposes the non-mutating
  quote (`POST /checkout/v1/quote` existed but was unwired).
- **Sold-out modifiers accepted** — `validateItemModifiers` now rejects
  `status:'sold_out'` with `MODIFIER_SOLD_OUT` (409).
- **asChild clobbered child props** — `withChild` now composes: onClick
  chains, className merges, `disabled` ORs.
- **`useCart().loading` stuck true without a session** — `useQuery` tracks a
  `resolved` flag; `useCart` returns `Cart | null`.
- **`CartTrigger` counted completed carts** — now open-status only.
- **No `refetch` on read hooks** — exposed on all of them.
- **`useCheckout` returned only `submit`** — now `pending`/`error`/`reset`
  with structured `QueryError` (code + `details.field`).
- **`resumesAt` 30-min probe rounding** — `nextOpen` computes the exact
  window boundary.
- **No field-level error contract** — validation errors carry
  `details.field` (`customer.phone`, `delivery.address`, …).
- **Kernel types lagged the wire** — `figureVariant`/`tags`/category `slug`
  declared; `ERROR_CODES` exported from `@vendua/kernel`.
- **`@vendua/kernel/styles.css` unresolvable** — added to the exports map.
- **Malformed JSON body → 500** — `bodyJson()` 400s instead.
- **Closed notice hid `resumesAt` in prose** — now also in `payload.resumesAt`.
- **Duplicate order on re-submit of a completed cart** (forn proved it live)
  — `POST /checkout` now 409s `CART_NOT_OPEN` when the cart isn't `open`.
- **`invalidateQuery` not exported** — storefronts couldn't clear cache after
  custom flows; now exported.
- **`useQuery` in-flight race** — a component mounting mid-fetch could miss
  the resolution and stay `loading`; late subscribers now tick on
  `entry.inflight`.
- **Notice override props untyped** — `NoticeOverrideProps`
  (`{ notice, onDismiss? }`) exported; overrides type as
  `ComponentType<NoticeOverrideProps>`.
- **Primitive a11y props clobbered the child** — `withChild` now lets child
  `aria-*`/`data-*` win (a `CartTrigger` can restate its count in brand
  voice); `data-vendua` stays primitive-managed.
- **`StoreStatusBadge` leaked raw ISO** — its `title` now renders a localized
  `retorna <weekday HH:mm>` in the store timezone.
- **No currency/vocabulary on `StoreProfile`** — `store_settings.currency`
  (default `BRL`) + `store_settings.vocabulary` (default `{}`) added in
  migration 0002 and surfaced on `/store`; quero-pudim seeds
  `doce/sacola/"Escolher meu doce"`.

### Review hardening (PR #10 review findings — all landed in base)

- **Order numbers had a read-then-insert race** — concurrent checkouts could
  share `max(number)+1`; the checkout tx now takes
  `pg_advisory_xact_lock(hashtext(tenant_id))` before computing the number.
- **`GET /orders/:id` answered any authenticated session** — now scoped to
  the session's cart (`and cart_id = ${cartId}`); foreign-cart reads → 404
  `ORDER_NOT_FOUND`.
- **Idempotency claim wasn't atomic** — placeholder-insert-then-catch let two
  same-key requests both execute. Rewritten as a single-owner atomic claim
  (`INSERT ... ON CONFLICT ... WHERE response IS NULL AND stale`); losers
  poll for the stored response and replay it, else 409
  `IDEMPOTENCY_IN_PROGRESS`.
- **`x-forwarded-host` trusted unconditionally** — tenant resolution could be
  hijacked off-CDN. `tenantMiddleware` gates XFH behind
  `VENDUA_TRUST_PROXY=1` (default off; sets the same env on the rate
  limiter's `x-forwarded-for` read).
- **CORS allowed `*`** — now reflects only origins equal to the request Host
  or resolving to a seeded domain.
- **Cart mutations on completed carts** — every cart write now runs
  `assertCartOpen` (409 `CART_NOT_OPEN` + `details.cartStatus`).
- **Checkout re-validates availability** — items priced earlier could turn
  `sold_out` before pay; `validateCheckout` re-checks product + modifier
  status (409 `SOLD_OUT` / `MODIFIER_SOLD_OUT`).
- **`nextOpen` never returned future days** — `delta <= 0` skipped every
  candidate once today's open passed, so daily stores got no `resumesAt`.
  Rewritten to wall-clock-exact candidates; drift correction absorbs tz
  offset shifts.
- **`/control/v1/state` was open** — now requires `x-vendua-control` matching
  the session-signing secret, else 404.
- **No rate limiting** — fixed-window limiter on `/checkout/v1/*`
  (240/min per tenant+ip, 429 `RATE_LIMITED`).
- **Kernel `useQuery` cache was module-global** — leaked across providers;
  now keyed per `VenduaApi` instance.
- **`refetch` didn't refetch** — it deleted cache without notifying; now
  routes through `invalidate(key)`. `useDeliveryZones` exposes `refetch`.
- **`formatBRL` alias removed** — `formatCents` only (clean cutover).
- **`ERROR_CODES` drifted from the wire** — synced to Core's emitted set
  (added `IDEMPOTENCY_IN_PROGRESS`, `RATE_LIMITED`, `TENANT_SUSPENDED`,
  `MODIFIER_LIMIT`, `DELIVERY_UNAVAILABLE`, `ORDER_MIN_NOT_MET`,
  `INVALID_ORDER_TRANSITION`, `NOT_FOUND`; dropped never-emitted codes).
- **Kernel `CartItem` type lagged the wire** — `productStatus` + modifier
  `status` fields declared.

Round 2 (second review pass — all landed):

- **Concurrent checkouts minted duplicate orders** — cart row is locked
  `FOR UPDATE` before validation and `orders(cart_id)` is unique; verified
  two simultaneous checkouts → one 201, one 409.
- **`addItem` bypassed the 99-per-line cap** — on-conflict incremented past
  it; now `CHECK (qty <= 99)` on `cart_items` maps to `INVALID_QTY`.
- **Duplicate modifier ids double-charged** — `modifierIds` deduped and
  sorted; reordered selections now merge into one line.
- **Fulfillment checked the wrong axis** — closed stores rejected orders
  when `pickup_enabled` was false regardless of requested mode; now pickup
  needs `pickup_enabled`, delivery needs `delivery_enabled`, and `closed`
  always allows preorder (`PICKUP_UNAVAILABLE` added to `ERROR_CODES`).
- **Blank `delivery.address` accepted** — now requires non-whitespace.
- **Exact vs bare host match was nondeterministic** — resolver orders
  exact-host first.
- **`vendua_app` role shipped a predictable password** — `migrate-cli`
  rotates it from `VENDUA_APP_DB_PASSWORD` at deploy time.
- **CORS allowed every registered tenant origin** — tightened to same-host
  only (storefronts call Core same-origin via the dev proxy anyway).
- **`SystemSurfaces` reused notices across `zoneMatched` changes** — query
  key carries the flag; injected first paint only applies unscoped.
- **`refetch` could be overwritten by the superseded in-flight fetch** —
  `runToken` guard; invalidate no longer double-fetches across subscribers.

Round 3 (third review pass — all landed):

- **Idempotent claims could rerun a committed mutation** — handler work and
  its recorded response now commit in one transaction (`run(c, tx)`); a
  crash leaves a pending claim that safely reruns rolled-back work.
- **Idempotency keys were unbounded** — length capped at 200; the claim tx
  sweeps rows older than 7 days.
- **Cart mutations raced checkout** — `assertCartOpen` takes the cart row
  `FOR UPDATE`, so a mutation serializes against a completing checkout
  instead of observing a stale `open` status.
- **`migrate()` raced itself** — `pg_advisory_lock` on a reserved
  connection serializes concurrent starters; each file's DDL +
  `schema_migrations` row commit atomically.
- **`SESSION_SECRET` had a checked-in default** — unset now means a random
  per-boot secret (tokens unforgeable; dev re-mints via `POST /session`).
- **Concurrent first mutations minted competing carts** — kernel
  `ensureSession` is single-flight; callers share one session creation.
- **quero-pudim kept dead cleanup + a stale zones comment** — removed the
  item-by-item cart-empty loop (Core completes the cart server-side) and
  the datalist now reads neighborhoods from `/zones`.

Round 4 (fourth review pass — all landed):

- **A stale idempotent claim could be stolen while work was in flight** —
  claims now carry an `owner` uuid; the work transaction holds a per-key
  `pg_advisory_xact_lock`, re-reads the claim, and only the owning
  transaction may write the response (`409 IDEMPOTENCY_IN_PROGRESS` on
  mismatch). Concurrent same-key requests serialize on the lock — a second
  owner replays the stored response instead of double-committing.
- **Session tokens weren't bound to a tenant** — the HMAC input is now
  `tenant.id|cartId`, so a token minted on one storefront host can't replay
  on another (`SESSION_REQUIRED` cross-host).
- **`migrate()` could strand its session-level advisory lock** — the whole
  run is now a single transaction using `pg_advisory_xact_lock`, which
  auto-releases at commit/rollback — no unlock to forget, no pooled
  connection left holding a lock.
- **Catalog edits could strand stored cart modifiers** — `cart_items` keeps
  the raw `modifier_ids`, and `checkout` re-validates them against the
  current product definition via `validateItemModifiers` (a modifier
  deleted or sold out mid-flight → `MODIFIER_SOLD_OUT`/`INVALID_MODIFIER`,
  priced the order can't silently carry phantom add-ons).
- **Kernel query caches pinned unmounted providers** — `caches` is a
  `WeakMap`; module-level `invalidateQuery` fans out via a `liveCaches`
  registry the provider registers on mount so unmounted caches GC.
- **Kernel transport failures threw a raw TypeError** — fetch errors now
  surface as `ApiError(0, 'NETWORK_ERROR')` so storefronts can classify
  unreachable-backend like any other failure.
- **Unset `SESSION_SECRET` rotated silently** — boot now logs a loud
  warning when the random-per-boot secret is in use.

Round 5 (fifth review pass — all landed):

- **A failed mutation poisoned same-key retries for 30s** — when `run`
  throws, its committed claim is now released (`delete ... where owner`)
  before the error propagates, so an immediate retry re-executes instead
  of hitting `IDEMPOTENCY_IN_PROGRESS`. Failed responses are deliberately
  not persisted — retries rerun deterministically.
- **Reseed died on cart activity** — `cart_items.product_id` is `NO
ACTION`, so the catalog wipe failed once dev carts existed; the seed now
  drops tenant `cart_items` first (carts themselves are preserved, emptied).
- **Rate-limit buckets leaked per client IP** — a window-scoped lazy sweep
  deletes expired buckets, bounding the map to live traffic.
- **Scheduled notices never flipped on time** — `SystemSurfaces` now arms a
  timer for the nearest future `startsAt`/`endsAt` boundary instead of
  computing visibility only on unrelated renders.
- **brasa/forn proxied bare `/checkout`** — narrowed to `/checkout/v1` per
  the reserved-prefix contract (a bare prefix would swallow a same-named
  storefront route).
- **Kernel doc demanded `AddToCart` disabled when `closed`** — reconciled
  the table with Core's shipped semantics: `paused` blocks, `closed`
  accepts pre-orders; the behavior text is normative now.

Round 6 (sixth review pass — all landed):

- **Order tracking died on session rotation** — `api.order(id)` sent only
  the current cart token, and `loadOrderView` scopes reads to the token's
  cart, so a new cart's token got `ORDER_NOT_FOUND` for previous orders.
  The Kernel now stores the checkout-time token per order id
  (`vendua.orderTokens`, bounded) and `order(id)` prefers it. Verified live:
  rotated token → 404; stored token → reads the order.
- **Failed `setDelivery` left stale-priced totals** — quero-pudim (both
  copies) and brasa track the sync (`syncing`/`ok`/`error` + sequence guard
  for superseded responses), block placing while a sync is pending or
  failed, and surface a retry prompt in the UI.
- **Stale comments in pedido/fechar** — corrected: `api.order` does send
  Bearer (per-order token now), brasa's post-checkout `CART_NOT_FOUND`
  caveat is obsolete (`ensureSession` rotates), and its redundant
  `invalidate('cart')` is removed.
- **`_examples/quero-pudim` couldn't typecheck** — it wasn't a workspace
  member (name collided with the live storefront); renamed to
  `@vendua/example-quero-pudim`, added `storefronts/_examples/*` to
  workspaces, and fixed its `tsconfig` extends depth.

### Feature gaps the reference ships that the platform can't express yet

(From `quero-pudim` — each had an honest storefront fallback; details in its
OBSERVATIONS.md `## Feature gaps`. Candidates for Contract v1 or Phase 1+.)

- **Combos / kits** — per-slot min/max + qty-per-item picker. Needs a Core
  `combos` entity; carried by `Kits` products + a `Sabores` modifier group.
- **Stock quantity + low-stock** — "Restam N" badges and qty caps. Needs
  `stockQuantity`/`lowStockThreshold` on products.
- **Preorder / encomendas** — `requiresPreorder`, `scheduledFor`, lead-days,
  Pix-only constraint.
- **Product media** — no `imageUrl`/`gallery`; `figureVariant` is the only
  bridge today (SVG figures).
- **Waitlist** ("avisar quando voltar") — needs `POST /storefront/v1/waitlist`.
- **Order items on the order view** — `GET /orders/:id` lacks `items[]`;
  storefronts snapshot cart items at submit.
- **Orders-by-phone** — "sem senha, sem cadastro" order history. Needs
  `GET /customer/orders?phone=` + a `useOrders(phone)` hook.
- **Pix details on the store/order** — `pixKey`/beneficiary/QR payload on
  `StoreProfile` or the order's `payment` block.
- **Coupons** — `POST /checkout/v1/coupons/validate` + `discountCents` in
  cart totals.
- **Order notes** — `notes` on `CheckoutInput` → `OrderView`.
- **Structured address + CEP lookup** — `delivery.address` is one string;
  reference had street/number/complement/cep + ViaCEP autocomplete and
  distance-priced fees.
- **Loyalty card** — points/stamps on my-orders.
- **Cross-device cart recovery** (`?cart=` links) — needs a cart-import
  primitive (`POST /cart` accepting items) or `importCart()`.
- **Realtime order updates** — reference used SSE; contract forbids
  fetch/EventSource in storefront code. Needs a Kernel-owned wrapper
  (`useOrder(id, { poll })` shipped now; SSE variant is Phase 1+).

### Doc/setup corrections (recorded so the next spike doesn't rediscover)

- **Reserved route prefixes**: `/checkout` and `/storefront` are API mounts —
  a checkout page can't live at `/checkout` (brasa used `/fechar`;
  quero-pudim narrowed its proxy to `/checkout/v1`). Contract must list
  reserved prefixes and require the object-form vite proxy
  (`changeOrigin:false`) — string shorthand rewrites `Host` → TENANT_NOT_FOUND.
- **`system.PromoNotice` should be a named slot key** — kind-camelization
  produces it but `SLOT_KEYS` doesn't include it, so promo notices land on the
  generic `system.Notice` override.
- **`notices[].payload.region`** — `SurfaceRegion` zones get nothing today;
  a `region` field would let promo/upsell notices land mid-catalog instead
  of banner-only.
- **Closed-vs-paused checkout semantics** are undocumented: closed allows
  checkout (pre-order), paused blocks. A product decision Core should state.
- **No scaffold** — `vendua.config.ts`, vite proxy, tsconfig chain are all
  hand-rolled per store. Phase 1's `vendua scaffold` is already planned.

## Review hardening — round 6

- **Bounded public input** — `bodyJson` reads raw text and 413s over 32KB;
  checkout/delivery/quote fields length-capped (name 200, phone 40,
  neighborhood 200, address 500); `modifierIds` capped at 32 entries.
- **Malformed identifiers → stable 4xx** — `uuidParam()` guards
  `:itemId`/`:id` params and `productId` before uuid comparisons; Postgres
  `22P02` no longer surfaces as `INTERNAL`.
- **Manual `closed` no longer promises reopening** — the override persists
  until cleared, so `resumesAt` is now only the configured `resumes_at`,
  never the next scheduled window.
- **v.js ↔ Kernel handoff** — `VenduaProvider` sets
  `__VENDUA_KERNEL_MOUNTED__` and removes `#vendua-loader-overlay`; the
  loader's tick yields once the flag is set, so blocking surfaces render
  once (Kernel's) instead of under a max-z-index loader card.
- **Kernel baseUrl changes** — a changed `baseUrl` mints a fresh client
  (per-api cache, session cleared) instead of silently keeping the old
  backend.
- **Order tracking survives storage failures** — per-order checkout tokens
  live in an in-memory map first; sessionStorage is the refresh layer.

## Review round 10 — price snapshots + cache/render honesty

- **Cart lines freeze accepted prices** — `cart_items` now stores
  `unit_price_cents` + `modifier_snapshot` at add time (migration 0005);
  `loadPricedItems` prices from the snapshot and joins catalog rows only for
  live availability (`productStatus`/modifier status). A merchant price edit
  no longer alters an open cart or its checkout total — verified live
  (add at 1990 → raise to 2490 → cart still reads 1990; order placed after
  the raise commits the snapshotted total, not the live price).
- **Oversized modifier arrays reject** — >32 `modifierIds` returns
  422 BAD_REQUEST instead of silently truncating the accepted line.
- **`useQuery` re-runs on api change** — a `baseUrl` swap remints the client
  and its cache; `api` is now an effect dep so queries refetch instead of
  hanging loading.
- **`PAYLOAD_TOO_LARGE` joins `ERROR_CODES`** — the contract list covers the
  413 the body cap emits.
- **Checkout pages render Core's totals** — quero-pudim (and the `_examples`
  mirror) no longer recomputes `subtotal + fee` locally; the display follows
  the synced server cart's mode and `totals.totalCents`.

## Review round 11 — commit-time eligibility locking + input caps

- **Checkout eligibility reads are locked** — the checkout tx takes
  `pg_advisory_xact_lock(hashtext(tenant_id))` up front (the documented
  serialization point for all future availability writers) and reads
  store_settings / delivery_zones / products + modifier graph `FOR UPDATE`.
  Under READ COMMITTED a merchant write could previously slip between the
  validation read and the order insert — verified live: a concurrent
  `status='sold_out'` write blocks checkout until commit, then SOLD_OUT
  instead of placing the order.
- **`delivery_enabled` defaults true when settings are absent** — the checkout
  check now matches what `/store` advertises (`?? true`).
- **Public input caps closed** — `/products/:slug` and `/control/v1/state`'s
  `tenant` param go through `str(..., 200)`; oversized values 422 instead of
  reaching the resolver/catalog query.
