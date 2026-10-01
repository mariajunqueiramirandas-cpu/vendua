# @vendua/kernel — v1 API (frozen)

Kernel 1.x serves **Contract 2** (ADR 0018). Everything a storefront may touch is
listed here; the package `exports` map (`.`, `./config`, `./rules`, `./styles.css`, `./vite`,
`./sdk-catalog`) hides everything else, and `test/api-surface.test.ts`
fails on any unlisted runtime export. `./rules` (Kernel 1.14) is the pure half of the Kernel —
presentation rules over Core's fields, no React, no DOM — for `@vendua/ui-defaults` and the
merchant admin; a store imports the same names from `@vendua/kernel`. Within Contract 2, changes are additive:
new exports, optional props, new slots/sections/blocks — never removals, renames or
retypes (those need a Contract major, a codemod and an alias window).

## Config and required mounts

| Export             | What it is                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `defineStorefront` | Types `vendua.config.ts` (`contract: 2`, tokens, overrides, paths, redirects, consent, images) |
| `VenduaProvider`   | Tenant context, API client, cache, tokens → `--v-*`, beacon. Props: `config`, `storefront`     |
| `SystemSurfaces`   | Server-driven surfaces: banner stack, blocking overlay, consent. Mount before the router       |
| `StorefrontRoutes` | The route table: template pages + the Kernel's `(vendua)` pages, inside the layout template    |
| `KERNEL_ROUTES`    | The reserved `(vendua)` group: `/sacola`, `/checkout`, `/pedido/:id`, `/pedidos`               |
| `KERNEL_PATHS`     | Same paths by name                                                                             |
| `SurfaceRegion`    | Inline notices targeted at a region name                                                       |
| `ErrorBoundary`    | Fallback-on-throw wrapper for storefront code                                                  |
| `SLOT_KEYS`        | The slot registry (32 slots, each with a default in `@vendua/ui-defaults`)                     |
| `SLOT_ALIASES`     | Deprecated slot keys → their replacement and the codemod that rewrites them                    |

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { StorefrontRoutes, SystemSurfaces, VenduaProvider } from '@vendua/kernel';
import storefront from 'virtual:vendua/storefront';
import '@vendua/kernel/styles.css';
import config from './vendua.config.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VenduaProvider config={config} storefront={storefront}>
      <SystemSurfaces />
      <BrowserRouter>
        <StorefrontRoutes />
      </BrowserRouter>
    </VenduaProvider>
  </StrictMode>,
);
```

`vite.config.ts` adds `vendua({ config })` from `@vendua/kernel/vite`. `vendua.config.ts`
imports `defineStorefront` from `@vendua/kernel/config` (Vite loads it in plain Node).
The `virtual:vendua/storefront` module is typed by the Kernel entry itself.

## Hooks

`useStore`, `useCatalog`, `useProduct`, `useNotices`, `useCart` (with `mutations`),
`useCheckout`, `useDeliveryZones`, `useDeliveryQuote`, `useOrder`, `useOrderHistory`,
`useCustomer` (guest profile remembered on opt-in; OTP accounts land behind the same
hook), `useAnalytics` (`track('custom.<name>')`, consent-gated), `useConsent`,
`useErrorSurface` (route a caught error to the default notice), `usePageContext`
(page id + route params for sections/blocks), and since Kernel 1.2 `useOrders`,
`useLoyalty`, `useCep`, `useWaitlist`, and since 1.9 `useStockLeft` (`useStockLeft(product)`: the product's
stock minus what the cart holds, kit picks included; `null` when stock isn't tracked — show it
instead of `stockQuantity` in store cards). `@vendua/ui-defaults` also exports `Calendar`
(the month grid behind `checkout.SchedulePicker`) for store sections that need one.

Since 1.14, hooks that bind the rules (below) to the store's live data: `useCardState`,
`useMenu`, `useStoreStatus`, `useStoreHours`, `useDeliverySummary`, `useMoney`, `useLinks`,
`useCopy`, `useCartCount`, `useCoupon`, `useCouponCheck`, `useLineQuote`, `usePixTimer`,
`useReducedMotion` and `useScrollSpy`; `useNotices` returns only notices inside their
`startsAt`/`endsAt` window and `blocking` follows `isBlocking`.

Hooks never compute prices or eligibility; every read exposes `refetch`. Since 1.6 the
reads behind `useCatalog`, `useProduct`, `useStore`, `useDeliveryZones` and `useNotices` also refresh by
themselves when Core's live stream says they changed (no API change).

**Kernel 1.2 (commerce completeness, roadmap Phase 2)** — all additive:

| Hook / change                | What it does                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useOrder(id, { live? })`    | Live by default: a Kernel-owned **SSE** stream (1.3; `GET /orders/:id/events` over a header-authed fetch), with the long poll (`GET /orders/:id?since&wait`) as fallback. Pauses while the tab is hidden, stops at a terminal state, backs off on errors. Returns `live` and `transport`. `{ live: false }` = the plain read |
| `useOrders(phone?)`          | "Sem senha, sem cadastro": the phone's orders across devices (summaries, no address). `needsVerification` + `verify(orderNumber)`; the device that checked out with the phone is already trusted                                                                                                                             |
| `useLoyalty(phone?)`         | The stamp card (`stamps`, `stampsRequired`, minted `rewards` coupon codes) for a verified phone                                                                                                                                                                                                                              |
| `useCep()`                   | `lookup(cep)` → street/bairro/cidade + the delivery-zone answer, via Core                                                                                                                                                                                                                                                    |
| `useWaitlist(productId)`     | Join a sold-out product's restock waitlist; answers how many wait                                                                                                                                                                                                                                                            |
| `useCart().mutations`        | `add(…, comboSelections?)`, structured `setDelivery` (street/number/cep/lat/lng…), `applyCoupon`, `removeCoupon`, `importItems`, `share` (a `?cart=CODE` link), `reorder(orderId)`                                                                                                                                           |
| `useDeliveryQuote().quote`   | Also takes `{ lat, lng }` (distance-priced zones)                                                                                                                                                                                                                                                                            |
| `useCheckout().submit`       | `CheckoutInput` gains `notes`, `scheduledFor` and structured address fields                                                                                                                                                                                                                                                  |
| `?cart=CODE` / `?cupom=CODE` | Handled by `VenduaProvider`: the shared sacola is imported / the coupon applied, the param stripped                                                                                                                                                                                                                          |

## Primitives

| Primitive          | Stamps                          | Behaviour owned by the Kernel                                                                                                                                                                                     |
| ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProductLink`      | `data-vendua="product-link"`    | route resolution (`paths.product`), prefetch                                                                                                                                                                      |
| `AddToCart`        | `data-vendua="add-to-cart"`     | disabled on paused/sold-out, mutation, `add_to_cart` event; `comboSelections` (1.2); disabled with `data-state="limit"` when `qty` doesn't fit the stock the cart leaves (the product's and its kit picks') (1.9) |
| `QuantityStepper`  | `data-vendua="qty-stepper"`     | min/max (capped at the stock the cart leaves, 1.9), mutation                                                                                                                                                      |
| `CartTrigger`      | `data-vendua="cart-trigger"`    | badge count, opens `/sacola`, `cart_open` event                                                                                                                                                                   |
| `CheckoutButton`   | `data-vendua="checkout-button"` | starts the session, disabled states, `checkout_start`                                                                                                                                                             |
| `StoreStatusBadge` | `data-vendua="store-status"`    | live open/closed/paused; 1.14: optional `labels` (the store's word per status), part `label`, `data-hint` (`statusHint`'s kind), `title` = Core's moment ("Aberto até 18:00")                                     |
| `NotifyMeButton`   | `data-vendua="notify-me"`       | "avise-me" subscription, `notify_me` event                                                                                                                                                                        |
| `Img`              | —                               | CDN srcset (`images.cdn`; Core media `?w=` since 1.7), lazy/priority, blur-up                                                                                                                                     |

Every primitive accepts `asChild`. A primitive with no `onError` hands typed errors to
the default error surface.

The commerce funnel (`add_to_cart`, `cart_open`, `checkout_start`, `notify_me`, …) is emitted
only by these primitives (and the Kernel's pages): a store UI that adds to the bag, opens it or
starts checkout must do it through `AddToCart`, `CartTrigger` and `CheckoutButton` (with
`asChild` for its own look), or the merchant's funnel loses those steps. `useAnalytics` only
takes `custom.*` events.

Since 1.14 the main entry also exports `Slot` (mount a slot — e.g. `store.HoursTable` — with
its override and default, as the Kernel does) and `haptic` (`haptic.tick()` / `haptic.commit()`:
Android vibration, a no-op elsewhere; `AddToCart` already ticks — don't buzz twice).

## Page composition

`defineSection`, `defineBlock` and the settings builders `text`, `richText`, `number`,
`boolean`, `select`, `image`, `url`, `product`, `category`, `list`. `BlockArea` renders
a section's area. Types: `SectionProps`, `BlockProps`, `SectionSchema`, `BlockSchema`,
`SettingsValues`, `AreaSpec`, the field types (`Field`, `TextField`, … `ListField`), `StorefrontBundle`, `StorefrontSnapshot`,
`PageContextValue`.

Store modules live in `sections/*.tsx`, export `schema` + a default component, and
may only use `store:` types.

### SDK sections and blocks (Kernel 1.0; additions marked)

| Type                   | Kind    | Variants / settings                                                   | Areas (accepts)                                                                                                                |
| ---------------------- | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `sdk:page-content`     | section | layout marker — where pages render                                    | —                                                                                                                              |
| `sdk:header`           | section | brand, logo, links, showStatus, cartLabel                             | `actions` (badge, info)                                                                                                        |
| `sdk:footer`           | section | note, showHours, showContacts, links                                  | `extra` (info, social-proof, promo)                                                                                            |
| `sdk:announcement-bar` | section | text, href, linkLabel, tone `accent\|surface`                         | —                                                                                                                              |
| `sdk:header-cart`      | section | label, variant `pill\|text`                                           | —                                                                                                                              |
| `sdk:bag-bar`          | section | label — phones: sticky sacola bar (count + subtotal) — **Kernel 1.5** | —                                                                                                                              |
| `sdk:purchase-panel`   | section | variant `split\|compact\|editorial`, product, labels, afterAdd        | `media` (media, badge), `after-price` (purchase-extras, badge, promo, info), `after-cta` (purchase-extras, info, social-proof) |
| `sdk:catalog-grid`     | section | variant `grid\|list`, search, category tabs, copy                     | `before-grid` (promo, info)                                                                                                    |
| `sdk:product-list`     | section | category, limit, variant, cta                                         | —                                                                                                                              |
| `sdk:store-status`     | section | status + hours, variant `card\|inline`                                | —                                                                                                                              |
| `sdk:rich-text`        | section | eyebrow, title, body (plain paragraphs)                               | —                                                                                                                              |
| `sdk:stock-counter`    | block   | category `purchase-extras`; showWhenPlenty (threshold: ignored, 1.14) | —                                                                                                                              |
| `sdk:notify-me`        | block   | category `purchase-extras`; title, successText                        | —                                                                                                                              |
| `sdk:promo-badge`      | block   | category `badge`; text, tone                                          | —                                                                                                                              |
| `sdk:delivery-eta`     | block   | category `info`; showFee, showPickup — **Kernel 1.1**                 | —                                                                                                                              |
| `sdk:pix-info`         | block   | category `info`; title, showQr — **Kernel 1.2**                       | —                                                                                                                              |
| `sdk:loyalty-teaser`   | block   | category `promo`; text — **Kernel 1.2**                               | —                                                                                                                              |

Kernel 1.5: `catalog.ProductCard` receives an optional `quickAdd(children)` render prop — the
Kernel's add-to-cart button, offered only for products that can be added as-is (active, not a
combo, no modifier groups, not an encomenda); `CatalogProduct.needsChoices` says so. Banner
notices render in the page flow above the header; transient errors and confirmations float in
`[data-vendua="toast-region"]` inside the banner stack.

Kernel 1.2 also teaches existing SDK pieces: `sdk:purchase-panel` renders the product
gallery (`catalog.Gallery`), the kit picker (`catalog.ComboPicker`) for `kind: 'combo'`
products, a "sob encomenda" note and caps quantity at tracked stock; `sdk:notify-me`
joins the restock waitlist and shows how many wait.

### Slots added in Kernel 1.2

`catalog.ComboPicker`, `catalog.Gallery`, `checkout.CouponField`, `checkout.SchedulePicker`,
`checkout.Notes`, `checkout.PixPayment`, `order.Items`, `customer.LoyaltyCard`,
`customer.PhoneVerify` — each with a default and a fixture in `@vendua/ui-defaults`.
`checkout.AddressForm` gains optional `onCep`/`cepStatus`, `onLocate`/`locateStatus` and
`zoneHint`; `CustomerDraft` gains optional `cep` and `reference`.

### Online payments (Kernel 1.7)

Checkout and `/pedido/:id` take payments through the store's Mercado Pago (Contract 2,
additive — no storefront edit). Card data only ever touches Mercado Pago's hosted page.

- `StoreProfile` gains `onlinePayments { pix, card }` and `pickup { address, instructions }`;
  `paymentMethods` / `PaymentMethod.id` / `CheckoutInput.payment.method` may be
  `'card_online'` ("Cartão de crédito", offered only when the store lists it).
- `Order.payment` gains optional `online`, `paidAt`, `refundedCents`, `redirectUrl` and
  `pix.expiresAt`; `status` may be `pending | paid | failed | expired | refunded |
partially_refunded | charged_back | in_mediation`. New type `PaymentNext` (what
  `POST /checkout/v1/orders/:id/pay` asks for next: `pix`, `redirect` or `none`).
- New slot `checkout.PaymentStatus` (`PaymentStatusKind`: redirecting, confirming, due, paid,
  processing, failed, expired, refunded, unavailable) — the Kernel picks the state and the
  next step (`action`), the slot only renders it. `checkout.PixPayment` gains optional
  `online` and `expiresAt` (countdown); `order.StatusPage` gains optional `pickup`;
  `DeliveryOption` gains optional `note`.
- `CatalogProduct.availabilityLabel`: a `sold_out` product outside its schedule says when it's
  back ("Só sábados, 9h–13h"); the product card and `sdk:purchase-panel` show it, and
  `sdk:notify-me` / `sdk:stock-counter` stay out of the way.
- `Img` with no `images.cdn`: a `/v1/media/…` src gets a srcset from Core's own resized
  copies (`?w=`).
- `ERROR_CODES` adds `PAYMENT_NOT_REQUIRED`, `PAYMENT_UNAVAILABLE`, `PAYMENT_ONLINE`.

### Security hardening (Kernel 1.8)

Additive — no storefront edit, no new runtime export.

- `StateEnvelope` gains optional `adminOrigin` (sent with `templates`): the merchant admin's
  origin, the only parent the editor preview listens to.
- Customer tokens are anchored to an order: until that order is delivered, `customer.orders()`
  holds only it and the loyalty card carries no reward codes. `checkout()` sends the phone's
  customer token, which phone-bound coupons (loyalty rewards) require.
- `ERROR_CODES` adds `PRICES_CHANGED` (checkout moved cart lines to the live price; the cart
  refetches) and `IDEMPOTENCY_KEY_REUSED`.

### Live design at first paint (Kernel 1.10)

Additive — no storefront edit, no new runtime export.

- `SurfacesEnvelope` gains optional `templates` and `tokens`. The edge inlines Core's
  `GET /storefront/v1/surfaces?design=1` as `window.__VENDUA_STATE__` before `</head>`
  (docs/architecture/07-deployment-and-hosting.md); the Kernel's own `api.surfaces()` never
  asks for them.
- Tokens in force are the injected ones (validated like Core does) over the build's snapshot
  over `config.tokens`: a merchant's token edit is live at the next page load, with no rebuild.
  Templates: live `/state?templates=1` over the injected ones over the build's snapshot.

### Native feel (Kernel 1.11)

Additive — no storefront edit, no new runtime export. Stores stay a plain web app.

- **Page transitions.** Navigations inside `<StorefrontRoutes />` (Kernel links, store
  `<Link>`/`useNavigate()`, back/forward) run as View Transitions where supported:
  `html[data-vt]` is `push` (deeper: product, sacola, checkout), `pop`, `tab` (same depth) or
  `fade` (always on ≥ 768 px); reduced motion gets a 120 ms crossfade. A replace animates only
  when its `state.vt` names a type. The `.v-header` and bag bar are pinned by their own
  transition names. Never on top of the browser's own swipe animation.
- **Shared photo.** Put `data-vt-src="product:<slug>"` on the tappable photo and
  `data-vt-dst="product:<slug>"` on the next page's photo: the photo morphs across (and back on
  pop). The source is the tapped element's `[data-vt-src]`, or the one inside the tapped
  link/button; the destination is the innermost visible match. The default product card and
  `sdk:purchase-panel` media already carry them.
- **The sacola as a sheet.** `CartTrigger` (and the bag bar) pushes `/sacola` with
  `state.vBackground` (the current location): the page stays rendered and the cart opens over
  it in a `<dialog data-vendua="cart-sheet">` through `cart.Drawer` with
  `presentation="drawer"`. A direct visit, a trigger on `/checkout` and `afterAdd: 'cart'` get
  the full page, as before. Store CSS styles it only through `--v-*` tokens and `[data-part]`
  hooks.
- **Checkout steps** are history entries (`state.vStep`); back returns to the previous step.
- `<meta name="theme-color">` follows the `bg` token; toasts live in the top layer.

### Timed promotions and "a partir de" (Kernel 1.13)

Additive — no storefront edit, no new runtime export. Money stays Core's.

- `CatalogProduct.fromPriceCents` (display-only): the cheapest configured unit, set only when
  above `basePriceCents`. Show "a partir de" it instead of the base price; never compute it.
- `CatalogProduct.promoLabel`: the product has a timed promotion, e.g. "Seg a sex, 18h–20h".
  Inside a window `basePriceCents` is already the promotion's price and `compareAtPriceCents`
  the regular one; outside, the regular price and no "de" price.
- The catalog response's optional `nextChangeAt` (ISO instant): when a promotion or a
  product's hours next start or end. `useCatalog` re-reads the catalog and open product pages
  then; a custom catalog reader should do the same.

### Catalog model gaps (Kernel 1.12)

Additive — no storefront edit, no new runtime export. Money stays Core's: the Kernel shows
Core's numbers and labels Core's rules, it never prices options or payment methods itself.

- Promo price: `CatalogProduct.compareAtPriceCents` (display-only; `basePriceCents` is what the
  shopper pays). The default `catalog.ProductCard` and `sdk:purchase-panel` strike it through
  (`<s>` with visually hidden "de"/"por") only when it is above the price; the card link's
  label reads "de … por …".
- Option quantity: modifiers carry `maxQty` (1 = a toggle), `description` and `imageUrl`;
  groups carry `pricingRule` (`ModifierPricingRule`: `sum`, `average`, `most_expensive`).
  `catalog.ModifierPicker` gains optional `quantities` (units per picked option) and
  `onQtyChange(groupId, modifierId, qty)`; old overrides keep `value`/`onChange` and still
  work. A group's min/max count units. `sdk:purchase-panel` clamps each option to its `maxQty`
  and to what the group's `maxSelect` leaves, and sends the units with the add:
  `api.addItem(…, comboSelections?, modifierQty?)`, `useCart().mutations.add(…,
comboSelections?, modifierQty?)` and `AddToCart`'s `modifierQty` prop (only units above 1 go to
  Core, as `modifiers: [{ id, qty }]`). The add button shows its `base × qty` price only while no
  picked option changes the price — Core prices the line (rule × units) and the sacola shows it.
  `CartItem.modifiers[].qty`, `CartItem.modifierQty`, `OrderItem.modifiers[].qty` and
  `ImportLine.modifiers` carry the units; cart and order lines read "2× Calda".
- `CatalogCategory.description`: `sdk:catalog-grid` shows it under the category heading.
- Payment methods: `'meal_voucher'` ("Vale-refeição", paid on delivery) joins
  `PaymentMethod.id` / `CheckoutInput.payment.method`. `StoreProfile.paymentAdjustments`
  (`PaymentAdjustment`: signed `percentBps` / `fixedCents`) labels each method in
  `checkout.PaymentMethods` through the new optional `PaymentMethod.adjustment` (`label` like
  "−5%" or "+R$ 1,50", `kind` discount | surcharge | mixed). On the payment step the checkout
  asks Core for the cart priced with the chosen method (`api.cart(paymentMethod?)` →
  `GET /checkout/v1/cart?paymentMethod=`); `CartTotals.paymentAdjustmentCents` is its own
  summary line (hidden at 0) and the confirm button carries Core's total (none while a method
  with a rule is being priced). `checkout.Summary` gains optional `paymentLabel`;
  `order.Items` gains optional `paymentAdjustmentCents` and `paymentLabel`
  (`Order.paymentAdjustmentCents`). `api.quote` / `useDeliveryQuote().quote` accept
  `paymentMethod` (then `QuoteResult.totals`) and answer `zoneKind`.
- Delivery zones: `DeliveryZone.kind` may be `'polygon'` with `polygon: [lat, lng][]`; the
  checkout offers "Usar minha localização" when any radius or polygon zone exists.

## Rules and display helpers (Kernel 1.14)

One implementation of every presentation rule over Core's fields, in `@vendua/kernel/rules`
(pure) and re-exported from `@vendua/kernel`. Core still decides anything that needs the clock,
the zones, the stock ledger or money; a rule returns the _decision_, and the pt-BR words are a
separate function a store may skip for its own voice. Additive — no storefront edit.

**Format** (`rules/format.ts`)

- `LOCALE` — `'pt-BR'`, the default locale of every formatter.
- `formatCents` `(cents, currency?, locale?)` — money (moved here; same function as before).
- `formatCentsParts` `(cents, currency?)` — `{ symbol, amount, symbolFirst }` for a split price.
- `formatDateTime` `(iso, timeZone?)` — `sáb., 26 set., 18:00` (ui-defaults' `dateTime`).
- `formatTime` `(iso, timeZone?)` — `18:00` (ui-defaults' `time`).
- `formatDay` `(date)` — `sáb., 26 set.` for a store-local `YYYY-MM-DD` (ui-defaults' `dayLabel`).
- `formatWhen` `(iso, timeZone, now?)` — the next-instant phrase: `hoje às 18:00`, `amanhã às 09:00`, `sáb às 09:00`, `12/10 às 09:00`.
- `localNow` `(timeZone, now?)` — the store's wall clock: `{ date, weekday, minutes }`.
- `plural` `(n, one, many)` — the word for `n` (only 1 is singular).
- `foldText` `(s)` — accent- and case-blind text for matching.
- `interpolate` `(text, vars)` — `{key}` placeholders filled; a missing value reads as nothing.
- `countdown` `(to, now)` — `29:41` until a deadline.
- `MEDIA_WIDTHS` / `mediaSrcSet` `(src, widths?)` — Core's resized copies of an upload, as a srcset.

**Price and card** (`rules/price.ts`, `rules/card.ts`)

- `priceDisplay` `(product)` — `{ form: 'plain' | 'from' | 'promo', cents, struckCents, promoLabel }`: from-price above the base wins and is never struck; else a "de" price above the base.
- `priceWords` `(display, currency?)` — `a partir de R$ 22,90` / `de R$ 24,00 por R$ 18,00` / `R$ 18,00`.
- `MAX_LINE_QTY` — 99, the most units one line takes.
- `cardState` `(product, stockLeft)` — `{ soldOut, scheduleLabel, stockLeft, allInBag, lowStock, canQuickAdd, maxQty, badge }`; low stock is Core's (`lowStock`, or `lowStockThreshold` on the stock the bag leaves); badge priority sold-out > all-in-bag > low-stock > preorder.

**Menu** (`rules/menu.ts`)

- `arrangeMenu` `(categories, { query? })` — search, empty categories dropped, sold out last within a category.
- `matchProduct` `(product, categoryName, query)` — the search rule: name, description or category name, accents ignored.

**Hours and status** (`rules/hours.ts`)

- `hoursRows` `(hours, now?)` — the weekly table, Monday first, same-hours days folded (`Seg – Sex`, `Todos os dias`), closed days included, `today` in the store's zone.
- `todayHours` `(hours, now?)` — today's windows, a special day (`hours.specialDays`) first.
- `statusHint` `({ status, closesAt?, resumesAt? })` — `open-until` / `opens` / `paused-until` / `open` / `closed` / `paused`; a time only when Core served one.
- `statusWords` `(hint, timeZone, now?)` — `Aberto até 18:00`, `Abre amanhã às 09:00`, `Pausado até 14:30`, `Fechado`.

**Delivery** (`rules/delivery.ts`)

- `zoneFeeFloor` `(zone)` — the least a zone charges: Core's `minFeeCents` (a per-km zone costs at least one km), else the zone's flat fee.
- `deliverySummary` `(store, zones)` — `{ delivery: { etaMin, etaMax, fee: { form, cents }, freeOverCents, minOrderCents, minOrderVaries } | null, pickup: { prepMinutes } | null }`.
- `deliveryWords` `(summary, currency?)` — `{ fee, eta, minOrder, freeOver }`: `entrega a partir de R$ 5,00`, `30–50 min`.

**Links** (`rules/links.ts`)

- `KERNEL_PATHS` — also here (pure), unchanged.
- `DEFAULT_PATHS` — every route with no `paths` in the config (`/cardapio`, `/produto/:slug`, the Kernel's pages).
- `resolvePaths` `(config)` / `productHref` `(config, slug)` / `catalogHref` `(config)` — the store's routes.
- `productAnchor` `(slug)` — `produto-<slug>`, the catalog's deep-link id (the Kernel scrolls to `#produto-<slug>`).
- `absoluteUrl` `(base, path)` — an absolute link (share, QR, JSON-LD) from `StoreProfile.publicUrl`.
- `whatsappDigits` `(raw)` / `whatsappUrl` `(raw, text?)` — Core's normalisation (country code 55) and the `wa.me` link.
- `instagramHandle` `(raw)` / `instagramUrl` `(raw)` — the bare handle from any form, and the profile link.
- `phoneDisplay` `(digits)` — `(22) 98179-5040` (no-break space after the area code).
- `contactLinks` `(store, text?)` — `{ whatsapp: { href, display } | null, instagram: { href, handle } | null }`; open them in a new tab.

**Phone and CEP** (`rules/phone.ts`)

- `digitsOf` `(s)` / `phoneKey` `(s)` — digits; national digits (Core's phone key).
- `isValidPhone` `(s)` — 10–11 digits, or 12–13 starting with 55.
- `maskPhone` `(s)` / `maskCep` `(s)` — progressive input masks `(22) 98179-5040`, `00000-000`.
- `isValidCep` `(s)` — 8 digits.

**Notices** (`rules/notices.ts`)

- `noticeSeverity` `(notice)` / `noticeLinks` `(notice)` — the forward-compatible severity and links (moved from ui-defaults).
- `isBlocking` `(notice)` — blocks the page (blocking severity or an emergency).
- `visibleNotices` `(notices, now?)` — the ones inside their window.

**Orders and payment** (`rules/orders.ts`)

- `ORDER_STATE_LABEL` / `TERMINAL_ORDER_STATES` — order states in words; the ones that end it.
- `orderPath` `(mode)` — `placed → confirmed → preparing → ready → [out_for_delivery →] delivered`.
- `orderProgress` `(order)` — `{ steps, current, terminal, outcome }` along the order's path.
- `orderStepLabel` `(state, mode)` — a step's short name (`Preparo`, `A caminho`, `Retirado`).
- `PAYMENT_METHOD_LABEL` (alias `PAYMENT_LABEL`), `PAYMENT_METHOD_ORDER`, `PAYMENT_METHOD_DETAIL` — methods in the shopper's words, in checkout order.
- `PAYMENT_STATUS_LABEL` — an online payment's status in words.
- `REFUNDED_PAYMENT_STATUSES` — the payment statuses where money went back (`refunded`, `partially_refunded`).
- `PIX_KEY_LABEL` — a Pix key's type in words (`chave aleatória`).
- `adjustmentKind` `(a)` / `adjustmentShort` `(a, currency?)` / `adjustmentText` `(a, currency?)` — a method's discount/surcharge: `discount`, `−5%`, `5% de desconto`.
- `lineSummary` `(item, currency?)` — a line's options and kit picks: `2× Calda (+R$ 2,00), Granulado`.

**Errors and coupons** (`rules/errors.ts`)

- `ERROR_COPY` / `errorCopy` `(code)` — default pt-BR `{ title, body? }` per Core error code.
- `couponMessage` `(code, details?, currency?)` — a coupon's refusal in words (`Faltam R$ 12,00 para usar este cupom.`).
- `COUPON_REASON` — coupon code → message (ui-defaults' name); `isCouponError` `(code)` — the code is about the coupon.

**Options and kits** (`rules/modifiers.ts`) — Core counts a group's min/max in units and
refuses an add that breaks them; these say the same before the add.

- `modifierUnits` `(group, picks)` — units picked in an option group (`picks`: units per picked option id; a toggle is 1).
- `groupMissing` `(group, units)` — a required group short of `max(1, minSelect)`.
- `groupFull` `(group, units)` — the group takes no more (`maxSelect` reached).
- `modifierMax` `(group, modifierId, picks)` — the most units of one option now: its `maxQty` and what `maxSelect` leaves.
- `groupHint` `(group)` — `obrigatório`, `escolha 1–3`, `opcional`, `até 3`.
- `slotUnits` `(slot, selections)` / `slotMissing` `(slot, units)` / `slotFull` `(slot, units)` — a kit slot's picked units, units still needed (0 = complete), and whether it takes more.
- `slotHint` `(slot)` — `escolha 2`, `escolha de 1 a 3`.

**QR and copy** (`rules/qr.ts`, `rules/copy.ts`)

- `qrMatrix` `(text)` / `qrSvgPath` `(matrix, quiet?)` / `qrSvg` `(text, opts?)` — the dependency-free QR encoder; `qrSvg` is a standalone SVG document.
- `DEFAULT_VOCABULARY` / `vocabularyOf` `(store)` — `itemSingular`, `itemPlural`, `bag`, `cta`: the store's words over the defaults.

**Hooks** (main entry only)

- `useCardState` `(product)` — `cardState` with the stock the bag leaves.
- `useMenu` `({ query? })` — `arrangeMenu` over `useCatalog` `()`, plus `count`.
- `useStoreStatus` `()` — `{ status, closesAt, resumesAt, hint, label, timeZone, loading }`; reads the store again when Core's moment passes.
- `useStoreHours` `()` — `{ rows, today, timeZone }`.
- `useDeliverySummary` `()` — `deliverySummary` over the store and its zones, plus `loading`.
- `useMoney` `()` — `(cents) => string` in the store's currency.
- `useLinks` `()` — `{ product(slug), catalog, anchor(slug), absolute(path), contacts }` (`absolute` uses `publicUrl`, else this page's origin).
- `useCopy` `()` — `{ vocabulary, interpolate(text) }` with `{store}` and `{city}`.
- `useCartCount` `()` — units in the open bag.
- `useCoupon` `()` — `{ coupon, discountCents, apply, remove, pending, message, error, reason }`; never throws.
- `useCouponCheck` `()` — `{ check(code), result, pending, message, error }` (Core validates without applying).
- `useLineQuote` `(product, picks, qty)` — Core's price for a configured line, debounced: `{ quote, pending, error }` (`error` is the code, never thrown).
- `usePixTimer` `(expiresAt)` — `{ expired, msLeft, label }` on the shopper's clock.
- `useReducedMotion` `()` — the system's reduced-motion setting, live.
- `useScrollSpy` `(ids, { offset?, rootMargin? })` — which id is being read (IntersectionObserver).

**Components** (main entry only; parts are Contract surface)

- `ProductPrice` — `{ product, className? }`: Core's price as decided by `priceDisplay`; `[data-vendua="product-price"]` with `data-form`, parts `price`, `struck`, `amount`, `from`, `promo`.
- `ProductImage` — `{ product, sizes?, priority?, fallback?, width?, height?, alt?, className? }`: `Img` with Core's srcset, `data-vt-src="product:<slug>"`, `fallback` with no photo or on error.
- `QrCode` — `{ value, size?, dark?, light?, title? }`: an inline SVG (`[data-vendua="qr-code"]`).

**Core fields and client** — `StoreProfile` gains optional `closesAt`, `publicUrl` and
`hours.specialDays` (`SpecialDay`); `SurfacesEnvelope`/`StateEnvelope` `store` gain `closesAt`
and the edge's `SurfacesEnvelope` gains `meta` (`StoreMeta`). `DeliveryZone` gains optional
`minFeeCents` — the least any address in the zone pays before free-delivery thresholds, from
Core's fee formula (a per-km zone: its fee plus the first km); clients read it, never recompute
it. `useCart().mutations.addLine` (and `api.addLine`) answer Core's `added` (`AddedLine`: the
units added and their price) — what analytics should count; `CartMutations.addLine` is optional
in the exported type, so a store's own `CartMutations` needn't implement it;
`api.quoteLine(slug, { qty, modifiers?, comboSelections? })` (`LinePicks`
→ `LineQuote`) is `useLineQuote`'s read.

**Slot props** — `StoreTime` (`timeZone?`) on `system.PauseNotice`, `system.StoreClosedNotice`,
`order.StatusPage`, `order.Timeline`, `checkout.SuccessPage`, `checkout.PixPayment`,
`customer.LoyaltyCard`; `StoreMoney` (`currency?`) on `checkout.DeliveryOptions`,
`checkout.PaymentMethods`; `StoreWords` (`vocabulary?`) on `cart.Drawer`, `cart.LineItem`,
`checkout.Summary`, `checkout.EmptyCart`, `catalog.ProductCard`, `order.Items`. Optional: a
default formats with them when given. The Kernel passes them: the store's zone, its currency and
`vocabularyOf(store)`.

**Vocabulary phrases** — `Vocabulary` (from `vocabularyOf` / `useCopy`) also carries the bag
word with its article, since pt-BR nouns have a gender: `inBag` (`na sacola` / `no carrinho`),
`toBag` (`à sacola` / `ao carrinho`), `ofBag` (`da sacola` / `do carrinho`), `yourBag`
(`Sua sacola` / `Seu carrinho`). They follow the store's `bag` (feminine when it ends in "a")
unless `store.vocabulary` sets them; the default `cta` follows too (`Adicionar ao carrinho`).

**The Kernel's own defaults decide through these rules** (behaviour changes, no API change):

- `sdk:purchase-panel`'s add button shows Core's price for the configured line
  (`useLineQuote` → `lineTotalCents`, `[data-part="add-price"][data-state="quote"]`) — for
  options, kits and quantities alike — and only once Core priced exactly the current picks and
  quantity: while the quote is on its way the part is empty with `data-state="pending"`, and
  with choices missing or the line refused it is empty with `data-state="none"`. It never shows
  one unit's price for the line nor multiplies `basePriceCents`. A combo says "a partir de"
  only from Core's `fromPriceCents`.
- `AddToCart`'s `add_to_cart` event carries `value` = Core's `added.lineTotalCents` (absent when
  Core doesn't send `added`) — no longer `basePriceCents × qty`.
- `sdk:stock-counter` reads low stock as Core does (`cardState`: `lowStock`, or
  `lowStockThreshold` on what the bag leaves); its `threshold` setting is kept for saved
  templates and ignored. `sdk:delivery-eta` words `deliverySummary` ("Entrega a partir de
  R$ 1,50 · 30–50 min"): a per-km zone is never "grátis". The checkout's delivery option uses
  the same summary.
- Catalog cards: `quickAdd` follows `cardState.canQuickAdd` — absent when every unit is already
  in the bag (it was a locked button); search, empty categories and sold-out ordering are
  `arrangeMenu`.
- Document title and meta per page: template pages `name — tagline` (or the name), the product
  page `<product> · <store>` with the product's description, the Kernel's pages `Sacola · <store>`
  (the store's bag word), `Finalizar pedido · <store>`, `Pedido #<n> · <store>`,
  `Meus pedidos · <store>`. `<meta name="description">`, `og:title` and `og:description` are
  updated when the page has them (never added). A page whose title isn't known yet keeps the
  current one.
- Notices: `SystemSurfaces` and `SurfaceRegion` show only notices inside their
  `startsAt`/`endsAt` window (`SurfaceRegion` showed expired ones), blocking by `isBlocking`.
- A `#hash` (e.g. `#produto-<slug>`) scrolls smoothly unless the shopper asked for reduced
  motion, and its element carries `data-target` for ~2 s (style the highlight with
  `[data-target]`).
- Copy that named the bag or items (`CartTrigger`'s label, toasts, the share sheet, reorder
  notes) uses the store's vocabulary.

**`@vendua/kernel/sdk-catalog`** (pure data, no React) serves the SDK sections and blocks
above as schemas: `SDK_SCHEMAS` (all of them, in the table's order) and each by name —
`pageContent`, `header`, `footer`, `announcementBar`, `headerCart`, `bagBar`, `purchasePanel`,
`catalogGrid`, `productList`, `storeStatus`, `richTextSection`, `stockCounter`, `notifyMe`,
`promoBadge`, `deliveryEta`, `pixInfo`, `loyaltyTeaser` — and `catalogOf` `(schemas)` (the
catalog the artifact manifest publishes). Since 1.14 it also exports `DEFAULT_TEMPLATES` (what a
page renders with no template), `resolveSettings` `(schema, raw)` (the settings coercion the
Kernel renders with), `PREVIEW_QUERY_PARAM` and `PREVIEW_MESSAGE` (the editor-preview protocol
below), and SDK section schemas carry `title` (the merchant's name for it) and `addable`. Its
runtime exports are frozen like the main entry's.

### Editor preview (Kernel 1.4)

Not an export: a storefront loaded inside a frame with `?vendua-preview=1` listens for
`{ type: 'vendua:preview', templates?, tokens?, selected? }` from its parent — since Kernel 1.8
only when the parent's origin is `StateEnvelope.adminOrigin`, and it stays inert until Core
reports one — renders those
draft templates and tokens over the live ones (each validated like Core does), outlines
`selected`'s section and posts `{ type: 'vendua:preview-select', id }` when a section is
tapped. It announces itself with `{ type: 'vendua:preview-ready', tokens, paths }` (the tokens in
force and the store's routes, posted only to that origin) and sends no analytics. The merchant admin's
Aparência editor is the only caller.

## Styling API (Contract surface)

Three layers, in order of preference (17 — styling API):

1. **Tokens** — `--v-color-*`, `--v-font-*`, `--v-radius-*`, `--v-space-*`,
   `--v-motion-*` from `tokens` (store data in Core; since 1.10 live at the next page load
   through the edge-injected state, with no rebuild).
2. **Variants** — the `variant` setting on each SDK section.
3. **Parts** — `[data-part="…"]` inside `[data-section="sdk:…"]`, `[data-block="sdk:…"]`
   or a `[data-vendua="…"]` root, plus these custom properties:
   `--v-notice-radius`, `--v-btn-radius`, `--v-btn-padding`, `--v-card-radius`,
   `--v-card-media-ratio`, `--v-card-gap`, `--v-grid-min`, `--v-grid-gap`,
   `--v-section-pad`, `--v-page-max`, `--v-purchase-panel-gap`,
   `--v-purchase-panel-media-ratio`, `--v-announcement-bg`, `--v-announcement-fg`,
   `--v-header-height`, `--v-focus`.

Parts added in Kernel 1.12: `compare-at` (the struck "de" price, in the product card's and
`sdk:purchase-panel`'s `price`), `category-description` (`sdk:catalog-grid`), and inside
`[data-vendua="modifier-picker"]` `pricing-rule`, `option-image`, `option-description` and
`option-qty` (a `modifier` with units is `data-kind="qty"`); in the checkout
`[data-part="adjustment"]` (a payment option's rule, `data-kind` discount | surcharge | mixed)
and `payment-adjustment` (the summary line; also in `[data-vendua="order-items"]`), and `pricing-note` (the "calculando o total" line under the confirm button while Core prices a method with a rule; confirm stays disabled until it answers).

`vendua check` (`no-v-namespace`) allows exactly those; any other `.v-*` or
`[data-vendua]` selector in store CSS fails. Slot overrides stay available but are
the last resort — each one is counted in the artifact manifest.

An override module loads with `vendua.config.ts` (in Node, at build time), before the Kernel's
React runtime exists: import helpers from `@vendua/kernel/rules` and only types from
`@vendua/kernel` (`import type`). `vendua check` (K08) fails a runtime `@vendua/kernel` import in
an override, and K07 allows `@vendua/kernel/rules` in store code.

## Core types and helpers

`ApiError`, `ERROR_CODES` (the exhaustive set storefronts may switch on),
`formatCents`, and the Core DTO types (`StoreProfile`, `CatalogProduct`, `Cart`,
`Order`, `Notice`, `StateEnvelope`, …). Kernel 1.2 types: `ComboSlot`, `ComboSelection`,
`CartCoupon`, `CartSchedule`, `CouponCheck`, `DeliveryAddress`, `CepResult`, `ImportLine`,
`ImportReport`, `OrderItem`, `OrderSummary`, `LoyaltyCard`, `PixInfo` (Kernel 1.7: `PaymentNext`;
Kernel 1.12: `PaymentAdjustment`, `ModifierPricingRule`); every new DTO field
is optional so a Kernel 1.2 storefront still runs against an older Core. Slot prop types: `SlotProps`, `CheckoutStep`,
`CustomerDraft`, `DeliveryOption`, `PaymentMethod`, `ModifierGroup`, `PaymentStatusKind` (1.7).

## Build (`@vendua/kernel/vite`)

`vendua({ config })` pulls the store's templates + tokens from Core when
`VENDUA_CORE_ORIGIN` is set (repo `templates/` otherwise), blocks tokens that fail WCAG
AA on default surfaces, and writes `dist/vendua-manifest.json` (Kernel × Contract ×
Core API majors, template/token source + hash, section catalog, override list, and since 1.14
`paths` — the store's resolved routes, which the edge matches product pages by).
