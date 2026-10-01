# @vendua/kernel — v1 API (frozen)

Kernel 1.x serves **Contract 2** (ADR 0018). Everything a storefront may touch is
listed here; the package `exports` map (`.`, `./config`, `./styles.css`, `./vite`,
`./sdk-catalog`) hides everything else, and `test/api-surface.test.ts`
fails on any unlisted runtime export. Within Contract 2, changes are additive:
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
| `StoreStatusBadge` | `data-vendua="store-status"`    | live open/closed/paused                                                                                                                                                                                           |
| `NotifyMeButton`   | `data-vendua="notify-me"`       | "avise-me" subscription, `notify_me` event                                                                                                                                                                        |
| `Img`              | —                               | CDN srcset (`images.cdn`; Core media `?w=` since 1.7), lazy/priority, blur-up                                                                                                                                     |

Every primitive accepts `asChild`. A primitive with no `onError` hands typed errors to
the default error surface.

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
| `sdk:stock-counter`    | block   | category `purchase-extras`; threshold, showWhenPlenty                 | —                                                                                                                              |
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
Core API majors, template/token source + hash, section catalog, override list).
