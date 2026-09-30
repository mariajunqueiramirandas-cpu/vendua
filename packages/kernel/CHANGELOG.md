# @vendua/kernel changelog

Semver, per docs/architecture/11-backward-compatibility.md: minors and patches
never need a storefront edit; a major only ships with a Contract major.

## 1.9.0

Stock the cart already holds — additive; no storefront edit, no new runtime export.

- `AddToCart` counts the product's units already in the cart (direct lines and kit picks, as
  Core's stock check does) against its `stockQuantity`: when `qty` is more than what's left it
  is disabled with `data-state="limit"` instead of getting `OUT_OF_STOCK` from Core. The prop
  type now accepts `stockQuantity`, so passing a catalog product is enough.
- The product page's quantity stepper stops at what's left and says when the cart already has
  every unit; the cart page clamps a line's quantity to the stock its other lines leave.

## 1.8.0

Security hardening — additive; no storefront edit, no new runtime export.

- Customer tokens are anchored to an order (`vcu2.`): a token from a checkout or an order number
  reads only that order and no loyalty reward codes until the order is delivered. Older tokens
  get `CUSTOMER_REQUIRED` once and re-verify through the usual flow.
- `checkout()` sends the phone's customer token, so loyalty rewards redeem only for a proven phone.
- The editor preview listens only to the merchant admin's origin, which Core now reports as
  `StateEnvelope.adminOrigin` (with `templates`); it stays inert until then and posts only there.
- New `ERROR_CODES`: `PRICES_CHANGED` (checkout moved cart lines to the live price; the cart
  refetches and the error copy asks to confirm again) and `IDEMPOTENCY_KEY_REUSED`.

## 1.7.0

Online payments — additive; no storefront edit, no new runtime export.

- Checkout offers "Cartão de crédito" (`card_online`, paid on Mercado Pago's hosted checkout)
  when the store lists it; placing the order calls `POST /checkout/v1/orders/:id/pay` and hands
  off to Mercado Pago behind a "Levando você ao Mercado Pago…" state. With online Pix the Pix
  option says the QR comes on the next screen and confirms na hora.
- `/pedido/:id`: an online Pix is generated when the order has none, shows its countdown and
  turns into "Pagamento confirmado" when the live stream says so; an expired one offers "Gerar
  novo Pix". A card return (`?pagamento=retorno`) syncs with Core and shows approved / em
  análise / não aprovado ("Tentar de novo"). Refunds show the amount returned; a provider
  outage offers a retry and the store's WhatsApp. Offline orders are unchanged.
- The Mercado Pago hand-off only follows an `https:` URL (plain `http:` on `*.localhost` in
  dev); anything else from Core is treated as `PAYMENT_UNAVAILABLE`.
- New slot `checkout.PaymentStatus` (default in `@vendua/ui-defaults`); optional props
  `checkout.PixPayment.online/expiresAt`, `order.StatusPage.pickup`, `DeliveryOption.note`.
- Pickup: checkout and the order page show the store's pickup address and instructions.
- Scheduled products: `availabilityLabel` replaces "Esgotado" on cards and the product page.
- `Img` (and the default card/product images) get a `?w=` srcset for Core media when no CDN
  is configured.
- Types: `StoreProfile.pickup/onlinePayments`, `Order.payment.online/paidAt/refundedCents/
redirectUrl/pix.expiresAt`, `CatalogProduct.availabilityLabel` (and on kit picks), `PaymentNext`,
  `PaymentStatusKind`; `ERROR_CODES` adds `PAYMENT_NOT_REQUIRED`, `PAYMENT_UNAVAILABLE`,
  `PAYMENT_ONLINE`.

## 1.6.1

Navigation scroll — patch; no storefront edit, no new export.

- `StorefrontRoutes` now manages scroll: a new page opens at the top, a `#hash` link scrolls to its
  element (waiting for async content), back/forward restores the previous position. Same-path
  changes (`?query`, filters) leave the page where it is.

## 1.6.0

Live storefront — additive; no storefront edit, no new export.

- `VenduaProvider` holds one Core change stream (`GET /storefront/v1/events`, payload-free
  `catalog` / `store` / `surfaces` hints). `useCatalog`, `useProduct`, `useStore`,
  `useDeliveryZones` and `useNotices` revalidate in place when the merchant changes stock, prices,
  hours, pause state or a banner, with no loading flash. Paused while the tab is hidden; a
  reconnect resyncs; without a stream (proxy, capacity) reads behave exactly as before.
- Relays `vendua:change` on `document` so `v.js` (which polls at 60 s) reacts instantly.

## 1.5.0

Storefront experience — additive; existing stores need no edit.

- `sdk:bag-bar`: a sticky "ver sacola" bar on phones (count + Core's subtotal), hidden on the
  product, sacola, checkout and order pages. Placed by the `2026-09-bag-bar-on-layout` template
  migration.
- Product cards get a one-tap add: `catalog.ProductCard` receives `quickAdd` for products that
  need no choices (`CatalogProduct.needsChoices`, served by Core), with a "na sacola" toast.
- Banner notices sit in the page flow above the header instead of floating over it; transient
  errors and confirmations move to a bottom toast region (`data-vendua="toast-region"`).

## 1.4.1

- The not-found route marks itself `noindex` while mounted, so typo URLs stay out of
  search results (the SPA answers 200 for every path). No storefront edit.

## 1.4.0

Merchant admin support — additive, no storefront edit.

- Checkout offers only the payment methods the store accepts (`StoreProfile.paymentMethods`,
  set from the merchant admin); Core answers `PAYMENT_METHOD_UNAVAILABLE` for any other.
- `StoreProfile.logoUrl`: the logo the merchant uploaded.
- Editor preview: a storefront framed by the admin with `?vendua-preview=1` renders the
  editor's draft templates (postMessage), outlines the selected section and reports taps
  on sections back to the editor. Preview sessions send no analytics.

## 1.3.1

Default UI refresh — visual and behavioural polish in the SDK sections and
`@vendua/ui-defaults`; no API change, no storefront edit.

- Header: one row on phones (nav becomes a scrollable strip), translucent sticky bar,
  current-page nav link (`aria-current`), bag glyph and a count that bumps on change.
- Catalog: search matches category names too, shows a result count, clears with × or
  Esc and spans every category; sold-out items sort last; category titles carry counts;
  tabs scroll in one row on phones; skeleton cards while loading.
- Product cards: monogram placeholder, hover lift, "Encomenda" / "Últimas N" badges.
  Product page: sticky buy bar on phones, sticky media on desktop, pill qty stepper,
  radio/checkbox indicators on modifiers. "Você também pode gostar" never lists the
  product being viewed.
- `store.HoursTable` folds days with the same hours ("Todos os dias", "Seg – Sex")
  and marks today in the store's timezone.
- Cart lines get a thumbnail and cap qty at stock; the cart page's summary no longer
  repeats the lines. Checkout steps are a segmented track; the order page shows a
  progress track and a dotted timeline. Buttons show a spinner while `aria-busy`.
- Typography: one scale (12 · 14 · 15 · 16 · 18 · 20 + fluid display sizes) applied by
  role, weights 400 text / 500 UI / 600 emphasis, tightened display tracking, balanced
  headings and orphan-free paragraphs, tabular lining numerals for money; monograms and
  count badges trimmed to cap height so they sit on the optical centre. Order history
  rows read title / meta / total + status instead of one mixed line.
- `checkout.PixPayment` is phone-first: amount up top, a full-width copy button, the code
  on one line, three steps for the bank app, and the QR as the "another device" path
  (QR leads from 720px). The success card stops repeating the Pix how-to and "recebido".
- Animations respect `prefers-reduced-motion`.

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
