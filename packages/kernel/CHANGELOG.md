# @vendua/kernel changelog

Semver, per docs/architecture/11-backward-compatibility.md: minors and patches
never need a storefront edit; a major only ships with a Contract major.

## 1.3.0

- Live orders over **SSE**: `useOrder` reads Core's `GET /checkout/v1/orders/:id/events`
  through a header-authed `fetch` (EventSource can't send the session token). One
  stream carries every change; it drops while the tab is hidden, reconnects with
  backoff and `Last-Event-ID`, and falls back to the 1.2 long poll when no event
  stream gets through (an older Core, a buffering proxy). `useOrder` also returns
  `transport: 'stream' | 'poll' | null`.
- `checkout.SchedulePicker`'s default is a month **calendar** (`Calendar` from
  `@vendua/ui-defaults`): only Core's bookable days select, bounded month
  navigation, roving-tabindex keyboard grid (arrows, Home/End, PageUp/PageDown).

## 1.2.0

Commerce completeness (roadmap Phase 2) — additive; no storefront edit needed.

- Hooks: `useOrders(phone?)` (cross-device history, verified by an order number),
  `useLoyalty`, `useCep`, `useWaitlist`. `useOrder` is live by default (a Kernel-owned
  long poll woken by Core's `pg_notify`; pauses on hidden tabs); `{ live: false }` opts out.
- Cart mutations: kit `comboSelections`, structured delivery address + coordinates,
  `applyCoupon`/`removeCoupon`, `importItems`, `share` (`?cart=CODE`), `reorder`.
  `VenduaProvider` handles `?cart=` and `?cupom=` links.
- Kernel pages: checkout gains CEP autofill, "usar minha localização" (distance-priced
  zones), reference point, notes, coupon field, encomenda date picker with Pix-only
  enforcement, free-delivery progress; `/pedido/:id` shows items, notes, the Pix copia e
  cola + QR and "pedir de novo"; `/pedidos` merges this device's orders with the phone's
  and shows the loyalty card; `/sacola` gets the coupon field and "mandar sacola por link".
- SDK: `sdk:pix-info`, `sdk:loyalty-teaser` (placed on existing stores by the template
  migration `2026-09-loyalty-teaser-on-product`); purchase panel gallery, kit picker,
  stock-capped quantity, encomenda note; waitlist count on `sdk:notify-me`.
- 9 new slots (see API.md); new Core error codes in `ERROR_CODES`.

## 1.1.1

- Build plugin: the manifest's section catalog carries each section's area
  declaration order (`order`). Core stores manifests as jsonb, which reorders
  object keys, so template migrations picked areas in the wrong order — found
  in the canary review of `2026-09-delivery-eta-on-product` (the block landed
  in `after-cta`), rolled back, fixed here, re-applied.

## 1.1.0

- New SDK block `sdk:delivery-eta` (category `info`): delivery window and fee
  from Core's zones, pickup time from the store's prep time. Placed on existing
  stores by the template migration `2026-09-delivery-eta-on-product`
  (requires Kernel ≥ 1.1.0).

## 1.0.0

- Contract 2 (ADR 0018): page templates, SDK and store sections, blocks in
  category-typed areas, Kernel pages, styling API. Every slot has a default
  (`@vendua/ui-defaults`). Public surface frozen (API.md).
