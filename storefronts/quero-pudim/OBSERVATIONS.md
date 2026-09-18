# OBSERVATIONS — `quero-pudim` spike

Port of `mariajunqueiramirandas-cpu/queropudim` onto the Venduá Kernel
(`packages/kernel` @ branch `devin/phase-0`). Every note below is a concrete
place where the Contract needed to stretch to express a feature the reference
storefront already ships. FEATURE-GAP items are features the reference has
that have no platform support at all; each was implemented honestly on the
storefront side where feasible.

## Platform bugs (recorded, NOT patched — per mission)

- **FEATURE-GAP — `api.order(id)` ships without auth.** Kernel
  `VenduaApi.order()` does `apiFetch(co('/orders/:id'))` with no `sessionCartId`
  Bearer, while Core's `GET /checkout/v1/orders/:id` requires it → every
  refetch 401s. `/pedido/:id` attempts the live call (forward-compat) then
  falls back to a sessionStorage snapshot taken at checkout. What Core/Kernel
  must add: send the session token on order reads (or accept the order id as
  a capability token).
- **`POST /checkout/v1/orders` does not clear the cart.** After a successful
  order the same `cart_items` rows stay server-side, so the sacola badge keeps
  its pre-checkout count and re-entering checkout re-validates the same items.
  `useCheckout().submit` also doesn't invalidate the `cart` query. Storefront
  workaround: `Promise.all(items.map(i => mutations.remove(i.id)))` then
  `invalidate('cart')` after a successful submit. What Core/Kernel must add:
  clear (or rotate) the cart on order placement, and invalidate the cart
  query in `useCheckout`.
- **Kernel types lag Core's payload.** Core returns `figureVariant` and `tags`
  on products, and `slug` on categories; `CatalogProduct`/`CatalogCategory`
  in `packages/kernel/src/api.ts` don't declare them. Storefront must cast
  `(p as { figureVariant?: 'default'|'alt' })`, `(c as { slug?: string })`.
  What Kernel must add: surface the fields in the public types (catalog cards
  can't pick the pudim/sacolé SVG figure without `figureVariant`).

## Feature gaps (features the reference ships that the platform cannot express)

Each is implemented storefront-side; every item says what Core/Kernel must
add for the real version.

- **FEATURE-GAP — Combos / kits.** Reference has a `combos` table + ComboModal
  with per-slot min/max and qty-per-item. Core has no combos entity, so the
  seeded `Kits` products + a multi-select `Sabores` modifier group carry the
  UX (`kit-festa` asks for 2–4 sabores). What Core must add: a `combos`
  entity (name, basePriceCents, slots[] { name, minSelect, maxSelect,
  qtyPerItem }, items[] per slot) and checkout validation for it. Kernel:
  nothing new — a `catalog.ComboPicker` slot would do.
- **FEATURE-GAP — Stock quantity + low-stock threshold.** Reference shows
  "Restam N" / "Em estoque (N)" and caps qty at stock. Kernel exposes only
  `status: 'active'|'sold_out'`. Storefront renders the stock line defensively
  via `(p as { stockQuantity?: number })` and skips it when absent. Core:
  `stockQuantity` + `lowStockThreshold` on products; Kernel: pass through.
- **FEATURE-GAP — Preorder / encomendas.** Reference has `requiresPreorder`
  products + a `scheduledFor` picker with per-client lead days, and forces
  Pix-only payment for encomendas. Core has neither. Storefront defensively
  renders a "Sob encomenda" badge/CTA via `(p as { requiresPreorder?: boolean })`
  and falls back to the reference's WhatsApp deep link for scheduling. Core:
  `requiresPreorder`, `preorderLeadDays`, and `scheduledFor` on CheckoutInput
  + payment-method constraints.
- **FEATURE-GAP — `imageUrl` on products.** Reference hydrates photos; Core
  ships none. Cards render the ProductFigure SVG fallback (`figureVariant`)
  and upgrade to `<img>` if `imageUrl` ever arrives. Core: media table or a
  `imageUrl`/`gallery[]` field.
- **FEATURE-GAP — Waitlist ("Quero ser avisado").** Reference posts
  `{productId, phone}` to `/waitlist`. No Core route → storefront keeps the
  form but deep-links the phone into `wa.me/<store.whatsapp>` as the honest
  version. Core: `POST /storefront/v1/waitlist` (productId, phone).
- **FEATURE-GAP — Order items on the order view.** Reference order page +
  my-orders render the purchased items; Core's `OrderView` has no `items`.
  Checkout snapshots `cart.items` into sessionStorage at submit and both pages
  render from it. Core: include `items[]` (name, qty, unitPriceCents, modifiers)
  on `GET /orders/:id`.
- **FEATURE-GAP — Orders-by-phone ("Sem senha, sem cadastro").** Reference
  serves `GET /customer/orders?phone=`; my-orders must therefore filter the
  local order log instead of querying the API, and can't see orders made on
  other devices. Core: orders-by-phone endpoint + Kernel `useOrders(phone)`
  hook.
- **FEATURE-GAP — Pix on the store profile.** Reference shows a pix key +
  copy button + QR. `StoreProfile` has no `pixKey`/`beneficiary`; only
  `payment.instructions` text arrives after checkout. Storefront renders the
  instructions block + copy button. Core: `pixKey`, `pixBeneficiary`, maybe
  `pixQrcodePayload`/`expiresAt` on store (or on the order's payment block).
- **FEATURE-GAP — Coupons.** Reference validates `couponCode` → discount at
  checkout. No endpoint → field intentionally absent rather than fake-validated.
  Core: `POST /checkout/v1/coupons/validate` + `discountCents` on cart totals.
- **FEATURE-GAP — Order notes.** Reference collects "Alguma observação?" and
  stores it on the order. `CheckoutInput` has no `notes` → notes ride in
  sessionStorage and get appended to the WhatsApp order message. Core:
  `notes` field on CheckoutInput → OrderView.
- **FEATURE-GAP — Delivery zones readable before checkout.** Reference lists
  neighborhoods + fees + ETA before the user commits. `api.setDelivery` is the
  only way to learn a fee, and it mutates the cart. Storefront offers a
  datalist of the seeded bairros + calls `setDelivery` on change to read
  `deliveryFeeCents`/`belowMinOrder` back; unmatched bairros resolve via
  OUT_OF_ZONE at submit. Core: `GET /storefront/v1/zones` (name, feeCents,
  minOrderCents, eta) + a non-mutating quote route; Kernel `useZones()`.
- **FEATURE-GAP — CEP lookup + geolocation distance pricing.** Reference does
  ViaCEP autocomplete + distance-based fees. Storefront can't fetch external
  APIs (contract) and Core has no geo pricing → bairro-based zones only.
  Core: `cep` field + address autocomplete or zone auto-detection endpoint.
- **FEATURE-GAP — Structured address.** Reference stores street/number/
  complement/cep separately; `CheckoutInput.delivery.address` is one string.
  Storefront composes `street, number — complement — bairro (CEP)` and keeps
  the parts in the local profile. Core: structured address fields.
- **FEATURE-GAP — Loyalty card ("cartão fidelidade").** Reference shows a
  points/stamps card on my-orders. No platform concept → omitted from the
  port. Core: loyalty program + `GET /customer/loyalty?phone=`.
- **FEATURE-GAP — Cross-device cart recovery (`?cart=` share links).**
  Reference rebuilds a cart from a URL param. Kernel session is
  sessionStorage-bound and `addItem` can't seed from a param without N
  sequential calls → omitted; would need a cart-import primitive. Kernel:
  `importCart(items)` or Core: `POST /cart` accepting items.
- **FEATURE-GAP — Realtime order updates.** Reference uses SSE +
  fallback polling. Contract forbids fetch/EventSource in storefront code →
  manual "Atualizar" button only. Kernel: `useOrder(id)` hook with a poll
  interval, or a surfaces-style SSE wrapper it owns.

## Kernel ergonomics (not gaps — friction)

- **No `refetch` on queries.** `useStore`/`useCatalog`/`useProduct` return
  `{data, loading, error}` with no way to re-run. `useKernel().invalidate(key)`
  is internal-ish (used for cart). A public `refetch` or a `useOrder(id)`
  hook with refresh would cover order tracking without manual api calls.
- **Primitives don't expose their internals.** `CartTrigger` stamps
  `data-count` on the child instead of passing a `count` prop — the badge
  re-reads `useCart()` itself. `QuantityStepper` has no `asChild`, so its
  chrome can't be restyled; it renders Kernel's own buttons inside a slot
  (`stepper-slot` wrapper). `AddToCart` has no pending-label slot → the button
  can't swap "Adicionando…" without forgoing the primitive.
- **`system.PromoNotice` isn't a slot key.** Kind→slot camelization produces
  `system.PromoNotice`, which isn't in `SLOT_KEYS`, so promo notices land in
  the `system.Notice` override — correct fallback, but the named slot
  `system.PromoNotice` should exist for promo-specific styling.
- **Money formatting / locale copy isn't platform-owned.** `formatBRL`
  (`Intl.NumberFormat pt-BR`) had to be storefront-side; every storefront
  will rewrite it. Kernel: `useFormat()`/`formatCents` utility.
- **`vocabulary` isn't server-driven.** Reference gets item nouns ("doce"),
  bag name ("sacola"), CTAs and placeholders from a shared copy deck; here
  they're literals in the storefront. Core could ship `store.vocabulary`/
  `store.copy` so three storefronts don't triple-maintain pt-BR copy.
- **`@vendua/kernel/src/styles.css` isn't in the package exports map** —
  main.tsx imports it via relative path `../../packages/kernel/src/styles.css`.
- **`setDelivery` can't carry an address.** `delivery.address` only exists on
  `CheckoutInput`, so the fee preview can't include the street — fine for
  zone-priced delivery, but worth noting if fees ever depend on distance.
- **`/checkout` proxy collides with the SPA route.** The prescribed
  `'/checkout'` vite proxy swallows the client-side `/checkout` page on direct
  load/refresh (Core 404s it). Narrowed to `'/checkout/v1'` — every Kernel
  checkout call lives under that prefix, so nothing else needs the bare key.
  Worth documenting in the contract docs so every storefront doesn't
  rediscover it.
- **No scaffold/CLI.** `vendua.config.ts`, vite proxy wiring, `tsconfig`
  extends chain — all hand-rolled. A `bunx create-vendua-storefront` would
  pin the boilerplate.

## Surfaces used as intended

- `StoreStatusBadge` (open/closed/paused pill), `AddToCart asChild`,
  `QuantityStepper`, `CartTrigger asChild`, `SystemSurfaces` + slot override
  `system.Notice` (brand-styled margin-note), `useCheckout` error codes
  mapped to copy (`OUT_OF_ZONE` → "fora da área", `ORDER_MIN_NOT_MET` →
  min order via `details.minOrderCents`), `cart.totals.belowMinOrder`/
  `minOrderCents`/`deliveryFeeCents` driving the checkout summary.
