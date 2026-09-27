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
| `SLOT_KEYS`        | The slot registry (31 slots, each with a default in `@vendua/ui-defaults`)                     |
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
`useLoyalty`, `useCep`, `useWaitlist`. `@vendua/ui-defaults` also exports `Calendar`
(the month grid behind `checkout.SchedulePicker`) for store sections that need one.

Hooks never compute prices or eligibility; every read exposes `refetch`.

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

| Primitive          | Stamps                          | Behaviour owned by the Kernel                                                       |
| ------------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| `ProductLink`      | `data-vendua="product-link"`    | route resolution (`paths.product`), prefetch                                        |
| `AddToCart`        | `data-vendua="add-to-cart"`     | disabled on paused/sold-out, mutation, `add_to_cart` event; `comboSelections` (1.2) |
| `QuantityStepper`  | `data-vendua="qty-stepper"`     | min/max, mutation                                                                   |
| `CartTrigger`      | `data-vendua="cart-trigger"`    | badge count, opens `/sacola`, `cart_open` event                                     |
| `CheckoutButton`   | `data-vendua="checkout-button"` | starts the session, disabled states, `checkout_start`                               |
| `StoreStatusBadge` | `data-vendua="store-status"`    | live open/closed/paused                                                             |
| `NotifyMeButton`   | `data-vendua="notify-me"`       | "avise-me" subscription, `notify_me` event                                          |
| `Img`              | —                               | CDN srcset (`images.cdn`), lazy/priority, blur-up                                   |

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

| Type                   | Kind    | Variants / settings                                            | Areas (accepts)                                                                                                                |
| ---------------------- | ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `sdk:page-content`     | section | layout marker — where pages render                             | —                                                                                                                              |
| `sdk:header`           | section | brand, logo, links, showStatus, cartLabel                      | `actions` (badge, info)                                                                                                        |
| `sdk:footer`           | section | note, showHours, showContacts, links                           | `extra` (info, social-proof, promo)                                                                                            |
| `sdk:announcement-bar` | section | text, href, linkLabel, tone `accent\|surface`                  | —                                                                                                                              |
| `sdk:header-cart`      | section | label, variant `pill\|text`                                    | —                                                                                                                              |
| `sdk:purchase-panel`   | section | variant `split\|compact\|editorial`, product, labels, afterAdd | `media` (media, badge), `after-price` (purchase-extras, badge, promo, info), `after-cta` (purchase-extras, info, social-proof) |
| `sdk:catalog-grid`     | section | variant `grid\|list`, search, category tabs, copy              | `before-grid` (promo, info)                                                                                                    |
| `sdk:product-list`     | section | category, limit, variant, cta                                  | —                                                                                                                              |
| `sdk:store-status`     | section | status + hours, variant `card\|inline`                         | —                                                                                                                              |
| `sdk:rich-text`        | section | eyebrow, title, body (plain paragraphs)                        | —                                                                                                                              |
| `sdk:stock-counter`    | block   | category `purchase-extras`; threshold, showWhenPlenty          | —                                                                                                                              |
| `sdk:notify-me`        | block   | category `purchase-extras`; title, successText                 | —                                                                                                                              |
| `sdk:promo-badge`      | block   | category `badge`; text, tone                                   | —                                                                                                                              |
| `sdk:delivery-eta`     | block   | category `info`; showFee, showPickup — **Kernel 1.1**          | —                                                                                                                              |
| `sdk:pix-info`         | block   | category `info`; title, showQr — **Kernel 1.2**                | —                                                                                                                              |
| `sdk:loyalty-teaser`   | block   | category `promo`; text — **Kernel 1.2**                        | —                                                                                                                              |

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

### Editor preview (Kernel 1.4)

Not an export: a storefront loaded inside a frame with `?vendua-preview=1` listens for
`{ type: 'vendua:preview', templates?, selected? }` from its parent, renders those draft
templates over Core's (each validated like Core does), outlines `selected`'s section and
posts `{ type: 'vendua:preview-select', id }` when a section is tapped. It announces itself
with `{ type: 'vendua:preview-ready' }` and sends no analytics. The merchant admin's
Aparência editor is the only caller.

## Styling API (Contract surface)

Three layers, in order of preference (17 — styling API):

1. **Tokens** — `--v-color-*`, `--v-font-*`, `--v-radius-*`, `--v-space-*`,
   `--v-motion-*` from `tokens` (store data in Core; an edit triggers a rebuild).
2. **Variants** — the `variant` setting on each SDK section.
3. **Parts** — `[data-part="…"]` inside `[data-section="sdk:…"]`, `[data-block="sdk:…"]`
   or a `[data-vendua="…"]` root, plus these custom properties:
   `--v-notice-radius`, `--v-btn-radius`, `--v-btn-padding`, `--v-card-radius`,
   `--v-card-media-ratio`, `--v-card-gap`, `--v-grid-min`, `--v-grid-gap`,
   `--v-section-pad`, `--v-page-max`, `--v-purchase-panel-gap`,
   `--v-purchase-panel-media-ratio`, `--v-announcement-bg`, `--v-announcement-fg`,
   `--v-header-height`, `--v-focus`.

`vendua check` (`no-v-namespace`) allows exactly those; any other `.v-*` or
`[data-vendua]` selector in store CSS fails. Slot overrides stay available but are
the last resort — each one is counted in the artifact manifest.

## Core types and helpers

`ApiError`, `ERROR_CODES` (the exhaustive set storefronts may switch on),
`formatCents`, and the Core DTO types (`StoreProfile`, `CatalogProduct`, `Cart`,
`Order`, `Notice`, `StateEnvelope`, …). Kernel 1.2 types: `ComboSlot`, `ComboSelection`,
`CartCoupon`, `CartSchedule`, `CouponCheck`, `DeliveryAddress`, `CepResult`, `ImportLine`,
`ImportReport`, `OrderItem`, `OrderSummary`, `LoyaltyCard`, `PixInfo`; every new DTO field
is optional so a Kernel 1.2 storefront still runs against an older Core. Slot prop types: `SlotProps`, `CheckoutStep`,
`CustomerDraft`, `DeliveryOption`, `PaymentMethod`, `ModifierGroup`.

## Build (`@vendua/kernel/vite`)

`vendua({ config })` pulls the store's templates + tokens from Core when
`VENDUA_CORE_ORIGIN` is set (repo `templates/` otherwise), blocks tokens that fail WCAG
AA on default surfaces, and writes `dist/vendua-manifest.json` (Kernel × Contract ×
Core API majors, template/token source + hash, section catalog, override list).
