# @vendua/kernel changelog

Semver, per docs/architecture/11-backward-compatibility.md: minors and patches
never need a storefront edit; a major only ships with a Contract major.

## 1.14.0

The Kernel owns its presentation rules — additive; no storefront edit. One implementation of
every rule over Core's fields, which the Kernel's defaults, `@vendua/ui-defaults`, stores and the
merchant admin share; Core still decides anything that needs the clock, the zones, the stock
ledger or money (API.md, "Rules and display helpers").

- New pure subpath `@vendua/kernel/rules` (no React, no DOM), every name also exported from
  `@vendua/kernel`: format (`LOCALE`, `formatCents` — moved, `formatCentsParts`,
  `formatDateTime`, `formatTime`, `formatDay`, `formatWhen`, `localNow`, `plural`, `foldText`,
  `interpolate`, `countdown`, `MEDIA_WIDTHS`, `mediaSrcSet`); price and card (`priceDisplay`,
  `priceWords`, `MAX_LINE_QTY`, `cardState`); menu (`arrangeMenu`, `matchProduct`); hours
  (`hoursRows`, `todayHours`, `statusHint`, `statusWords`); delivery (`zoneFeeFloor` — a per-km
  zone is never "grátis", `deliverySummary`, `deliveryWords`); links (`KERNEL_PATHS`,
  `DEFAULT_PATHS`, `resolvePaths`, `productHref`, `catalogHref`, `productAnchor`, `absoluteUrl`,
  `whatsappDigits`, `whatsappUrl`, `instagramHandle`, `instagramUrl`, `phoneDisplay`,
  `contactLinks`); phone (`digitsOf`, `isValidPhone`, `phoneKey`, `maskPhone`, `maskCep`,
  `isValidCep`); notices (`noticeSeverity`, `noticeLinks`, `isBlocking`, `visibleNotices`);
  orders (`ORDER_STATE_LABEL`, `TERMINAL_ORDER_STATES`, `orderPath`, `orderProgress`,
  `orderStepLabel`, `PAYMENT_METHOD_LABEL` + alias `PAYMENT_LABEL`, `PAYMENT_METHOD_ORDER`,
  `PAYMENT_METHOD_DETAIL`, `PAYMENT_STATUS_LABEL`, `PIX_KEY_LABEL`, `adjustmentKind`,
  `adjustmentShort`, `adjustmentText`, `lineSummary`); errors (`ERROR_COPY`, `errorCopy`,
  `couponMessage`, `COUPON_REASON`, `isCouponError`); QR (`qrMatrix`, `qrSvgPath`, `qrSvg`);
  copy (`DEFAULT_VOCABULARY`, `vocabularyOf`). `@vendua/ui-defaults`' `money`, `dateTime`,
  `time`, `dayLabel`, `ORDER_STATE_LABEL`, `PAYMENT_LABEL`, `COUPON_REASON`, `MEDIA_WIDTHS`,
  `mediaSrcSet`, `countdown`, `qrMatrix`, `qrSvgPath`, `noticeSeverity` and `noticeLinks` are now
  these (same names; it peer-depends on the Kernel). Its coupon reasons read the one table
  ("Esse cupom expirou").
- Hooks: `useCardState`, `useMenu`, `useStoreStatus`, `useStoreHours`, `useDeliverySummary`,
  `useMoney`, `useLinks`, `useCopy`, `useCartCount`, `useCoupon`, `useCouponCheck`,
  `useLineQuote` (Core's price for a configured line, debounced), `usePixTimer`,
  `useReducedMotion`, `useScrollSpy`. Components: `ProductPrice`, `ProductImage`, `QrCode`.
  Also exported: `haptic`, `Slot`.
- Fix: `useNotices` returns only notices inside their `startsAt`/`endsAt` window (re-reading at
  the next boundary), and `blocking` uses `isBlocking` (unknown severities read as info).
- Core fields (all optional for an older Core): `StoreProfile.closesAt`, `publicUrl`,
  `hours.specialDays` (`SpecialDay`); `closesAt` on the surfaces/state `store`;
  `SurfacesEnvelope.meta` (`StoreMeta`, the edge's head meta). Client: `api.quoteLine` (`GET
/storefront/v1/products/:slug/quote`, `LinePicks` → `LineQuote`); `api.addLine` and
  `useCart().mutations.addLine` answer Core's `added` (`AddedLine`).
- Slot props (types now; the Kernel passes them next): optional `timeZone` (`StoreTime`),
  `currency` (`StoreMoney`) and `vocabulary` (`StoreWords`) on the slots whose defaults format
  times, money or the store's words.
- `@vendua/kernel/sdk-catalog` adds `DEFAULT_TEMPLATES`, `resolveSettings`,
  `PREVIEW_QUERY_PARAM`, `PREVIEW_MESSAGE`; section schemas take optional `title` and `addable`
  (filled for the SDK sections).
- API.md: commerce funnel events come only from the primitives — a store UI must add, open the
  bag and start checkout through them.
- Rules for options and kits (`rules/modifiers.ts`): `modifierUnits`, `groupMissing`,
  `groupFull`, `modifierMax`, `groupHint`, `slotUnits`, `slotMissing`, `slotFull`, `slotHint`;
  and `REFUNDED_PAYMENT_STATUSES`. `Vocabulary` gains `inBag`, `toBag`, `ofBag`, `yourBag` (the
  bag word with its gendered article, `no carrinho` / `na sacola`; the default `cta` follows the
  bag word). `StoreStatusBadge` takes optional `labels` (`StoreStatusBadgeProps`).
- The Kernel's own defaults stop re-deriving: sections, blocks, pages and primitives decide
  through the rules or Core. Behaviour changes (API.md, "The Kernel's own defaults…"):
  - Fix: the purchase panel's add button shows Core's quote for the line (`useLineQuote`), for
    options and kits too, and the product's own price while choices are missing — never
    `basePriceCents × qty`. A combo says "a partir de" only from Core's `fromPriceCents` (the
    invented "a paid slot item" rule is gone).
  - Fix: `add_to_cart` analytics `value` is Core's `added.lineTotalCents` (none from an older
    Core), no longer `basePriceCents × qty`.
  - Fix: `sdk:stock-counter` follows Core's low stock; its `threshold` setting is ignored.
  - Fix: `sdk:delivery-eta` and the checkout's delivery option never say "grátis" for a per-km
    zone (`deliverySummary`); the block reads "Entrega a partir de R$ 1,50 · 30–50 min".
  - Fix: the Kernel no longer overwrites a page's title with the bare store name: template
    pages `name — tagline`, product `<product> · <store>`, and `Sacola`, `Finalizar pedido`,
    `Pedido #<n>`, `Meus pedidos` `· <store>`; description and `og:*` follow when present.
  - Fix: `SurfaceRegion` keeps notices to their window; `SystemSurfaces` uses `visibleNotices`/
    `isBlocking`.
  - `StoreStatusBadge`: part `label`, `data-hint`, title = Core's moment ("Aberto até 18:00",
    "Abre amanhã às 09:00") instead of "retorna sáb., 09:00".
  - A catalog card whose every unit is in the bag offers no quick add (`cardState.canQuickAdd`).
  - A `#hash` scrolls smoothly (instantly with reduced motion) and marks its element with
    `data-target` for ~2 s.
  - The Kernel passes `timeZone`, `currency` and `vocabulary` to the slots that declare them;
    bag/item copy follows the store's vocabulary. Pix key types read from `PIX_KEY_LABEL`
    ("Chave aleatória:"), WhatsApp/Instagram links from `contactLinks` (country code 55 added),
    phones validate with `isValidPhone`.
- `dist/vendua-manifest.json` carries `paths` (the store's resolved routes) for the edge.

## 1.13.0

Timed promotions and "a partir de" — additive; no storefront edit, no new runtime export. Every
price shown is still Core's.

- `CatalogProduct.fromPriceCents`: the cheapest configured unit, set only when above
  `basePriceCents` (a product priced by a required list). The default `catalog.ProductCard` and
  the grid's link label read "a partir de R$ X" in its place (`data-part="from"`), with no "de"
  price beside it (that one is the base's, without the options). `sdk:purchase-panel` reads "a partir de" it
  too (combos keep theirs), and its add button leaves out base × qty while a required list
  sets the price.
- `CatalogProduct.promoLabel`: the product has a timed promotion (Core's copy of its days and
  hours). Inside a window Core already serves the promotion as `basePriceCents` and the regular
  price as `compareAtPriceCents`, so the "de/por" strike-through shows it; `sdk:purchase-panel`
  prints "Promoção: …" under the price (`data-part="promo"`).
- The catalog response may carry `nextChangeAt`: `useCatalog` reads the catalog (and evicts open
  product pages) again at that moment, armed again on every read, so a page left open sees a
  promotion or a product's hours start and end.
- `catalog.ModifierPicker`'s default gives a group with more than 12 options a filter ("Buscar
  sabor"/"Buscar opção", `data-part="option-search"`) — accents and case ignored, names and
  descriptions matched, picks kept while filtered out. A group now holds up to 100 options.

## 1.12.0

The catalog model gaps — additive; no storefront edit, no new runtime export. Every price
shown is still Core's.

- Promo price: `CatalogProduct.compareAtPriceCents`; the default product card and
  `sdk:purchase-panel` strike the "de" price through (with "de"/"por" for screen readers) only
  when it is above the price.
- Option quantity: modifiers get `maxQty`, `description`, `imageUrl`; groups get `pricingRule`
  (new type `ModifierPricingRule`). `catalog.ModifierPicker` gains optional `quantities` and
  `onQtyChange` (steppers in the default, clamped to `maxQty` and the group's `maxSelect`; old
  overrides keep `value`/`onChange`), plus the option's photo, description and a "vale o preço
  da opção mais cara" / "média" hint. Units ride the add as an optional 5th argument of
  `api.addItem` / `mutations.add` and `AddToCart`'s `modifierQty`; `CartItem`, `OrderItem` and
  `ImportLine` carry them. The add button drops its `base × qty` price once a picked option
  changes the price (Core prices the line).
- `CatalogCategory.description` under the category heading in `sdk:catalog-grid`.
- Payment: `meal_voucher` ("Vale-refeição"); `StoreProfile.paymentAdjustments` (new type
  `PaymentAdjustment`) labels each method ("−5%", "+R$ 1,50") via the new optional
  `PaymentMethod.adjustment`. The payment step reads the cart priced for the chosen method
  (`api.cart(paymentMethod)`), shows `CartTotals.paymentAdjustmentCents` as its own line
  (hidden at 0) and Core's total; `checkout.Summary` gains `paymentLabel`, `order.Items`
  gains `paymentAdjustmentCents` + `paymentLabel` (`Order.paymentAdjustmentCents`).
  `quote` takes `paymentMethod` (→ `totals`) and returns `zoneKind`.
- Delivery: `DeliveryZone.kind` `'polygon'` + `polygon`; the checkout asks for the shopper's
  location when any radius or polygon zone exists.
- New parts: `compare-at`, `category-description`, `pricing-rule`, `option-image`,
  `option-description`, `option-qty`, `adjustment`, `payment-adjustment`, `pricing-note`.
- Checkout: confirming is disabled while Core prices a payment method that has a discount or
  surcharge, so the total shown always matches what Core charges.

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
  `afterAdd: 'cart'` still go to the full page. A blocking notice closes the sheet; the empty
  bag's "Ver cardápio" goes to the menu.
- `catalog.Gallery` (default): a swipe gallery with page dots on phones; `data-part="main"` is
  now the swiping strip (a list of `data-part="slide"`), thumbnails stay from 860 px.
- Checkout steps are history entries (`state.vStep`): back returns to the previous step; a
  new step slides in from its side, starts at the top with focus on its heading. Step entries
  that can't be shown (after a reload, or once the order is placed) are skipped back over,
  and a hash-only entry (the skip link) keeps its step. Changes inside one page (steps,
  filters) are never page transitions, which would swallow the next tap while they run.
- `<meta name="theme-color">` follows the live `bg` token (created when the page has none)
  and takes the scrim's tint while the sheet is open.
- Toasts sit in the top layer (above the header and the bag bar; inside the sheet while it is
  open, so they stay tappable and announced), enter and leave with motion, and swipe away
  sideways or down.
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
