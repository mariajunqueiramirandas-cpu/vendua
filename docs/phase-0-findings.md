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
   proved per-tenant vocabulary is real (`copy.vocabulary`). v1: `store.vocabulary`
   (itemSingular/itemPlural/bag) on `GET /storefront/v1/store`.
2. **Products need a figure/asset field.** `GET /catalog` returns no imagery;
   every storefront will need `product.figure` (asset ref or built-in SVG
   motif id) + an `Img`-style primitive with a graceful fallback.
3. **Money formatting must be a Kernel util.** Every storefront formats
   centavos → BRL. Provide `formatBRL(cents)` / `useMoney()` so no store
   re-implements locale formatting.
4. **Delivery zones need a public read surface.** Storefronts can't render an
   address/neighborhood picker without knowing serviced neighborhoods. v1:
   `GET /storefront/v1/zones` (or embed in `/store`): name, neighborhoods,
   fee, ETA bounds, per-zone min order.
5. **`store.opensAt` (next opening) is missing.** `deriveStatus` computes it
   internally for notices but `/store` doesn't expose it; `StoreStatusBadge`
   and `system.StoreClosedNotice` both want it. v1: expose `opensAt` next to
   `resumesAt`.
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
11. **`useOrder` polling hook missing** (client has `api.order`; no hook).
12. **postgres.js jsonb footgun** (platform-internal, recorded so it isn't
    re-learned): `JSON.stringify(x)` into a jsonb param double-encodes to a
    JSON _string_; always `sql.json(x)`.

## From storefront spikes (OBSERVATIONS.md)

Two spikes have reported so far: `quero-pudim` (full port of the reference
storefront, zero feature loss) and `brasa`. Their combined lists:

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
