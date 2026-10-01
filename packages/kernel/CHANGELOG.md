# @vendua/kernel changelog

Semver, per docs/architecture/11-backward-compatibility.md: minors and patches
never need a storefront edit; a major only ships with a Contract major.

## 1.11.0

Native-app feel on phones — the store stays a plain web app (no manifest, no service worker).
Additive; no storefront edit, no new runtime export.

- Page changes are View Transitions where the browser has them: deeper pages slide in
  (`push`), shallower ones slide back (`pop`), siblings crossfade; ≥ 768 px and anything else
  crossfade; reduced motion is a 120 ms fade. Kernel navigation, store `<Link>`s and
  `useNavigate()` all go through it, and back/forward too — except when the browser animated
  the swipe itself (`hasUAVisualTransition`). `html[data-vt]` names the running type.
- Shared photo: a tapped element with `data-vt-src="product:<slug>"` morphs into the
  `data-vt-dst` with the same key on the next page (and back). The default product card and
  `sdk:purchase-panel` media carry them; stores may put them on their own markup.
- The sacola opens as a sheet over the page it was opened from (`CartTrigger`, the bag bar):
  `/sacola` is pushed with `state.vBackground` and the cart renders in a `<dialog>`
  (`cart.Drawer`, `presentation="drawer"`). Phones: a bottom sheet you drag down to close;
  ≥ 768 px: a side panel. Drag, ×, Esc, a tap outside and the back button all animate it away
  before the route pops. A direct visit to `/sacola`, a trigger on checkout and
  `afterAdd: 'cart'` still go to the full page.
- `catalog.Gallery` (default): a swipe gallery with page dots on phones; `data-part="main"` is
  now the swiping strip (a list of `data-part="slide"`), thumbnails stay from 860 px.
- Checkout steps are history entries (`state.vStep`): back returns to the previous step; a
  new step starts at the top with focus on its heading.
- `<meta name="theme-color">` follows the live `bg` token (created when the page has none)
  and dims while the sheet is open.
- Toasts sit in the top layer (above the header, the bag bar and the sheet), enter and leave
  with motion, and swipe away sideways or down.
- Android haptics (`navigator.vibrate`): a tick on add-to-bag and steppers, a firmer one when a
  drag dismisses the sheet.
- `@vendua/kernel/styles.css` also pulls `@vendua/ui-defaults/native.css` (transitions, sheet,
  toasts — `@layer vendua`).

## 1.10.0

The store's live design at first paint (Phase 4 edge) — additive; no storefront edit, no new
runtime export.

- `SurfacesEnvelope` gains optional `templates` and `tokens`, present only in the
  edge-injected `window.__VENDUA_STATE__` (Core `GET /storefront/v1/surfaces?design=1`).
- Tokens in force: the injected ones (validated) over the build's snapshot over
  `config.tokens` — a merchant's token edit shows at the next page load without a rebuild, so a
  store served from the shared `_template` build gets its own look.
- Templates: the injected ones sit between the build's snapshot and the live
  `/state?templates=1` answer, so the first render is already the store's current page.

## 1.9.0

Stock the cart already holds — additive; no storefront edit needed.

- `AddToCart` counts what the cart already draws from the product and from each kit pick
  (direct lines, other modifier sets and kits, as Core's stock check does). When `qty` doesn't
  fit it is disabled with `data-state="limit"` instead of getting `OUT_OF_STOCK` from Core. The
  prop type accepts `stockQuantity` and `comboSlots`, so passing the catalog product or the
  product detail is enough.
- Product page: the quantity stops at what fits (a kit's picks included) and says when the
  sacola already has every unit; `catalog.ComboPicker` items get `stockLeft` (what one kit can
  still take at the chosen qty) and the default picker says "sem mais unidades".
- Cart: `QuantityStepper` and the `/sacola` lines cap a line at the stock the other lines leave;
  `cart.LineItem` gets that as the new optional `max` prop.
- `catalog.ProductCard` gets the new optional `stockLeft` (stock minus the cart;
  `product.stockQuantity` stays Core's number) and the `sdk:stock-counter` block shows it; the
  default card says "Tudo na sacola" when none is left.
- New `useStockLeft(product)`: a product's stock minus what the cart holds (`null` = not
  tracked), for store cards that show stock.
- `CartItem.combo[].stockQuantity`: each kit pick's stock (Core serves it with this release).

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
