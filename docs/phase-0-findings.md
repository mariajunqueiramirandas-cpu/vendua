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

<!-- filled in from each storefront's OBSERVATIONS.md when the spikes land -->
