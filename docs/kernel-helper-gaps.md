# Kernel helper gaps — what the Kernel should own and doesn't

> Status: investigated, nothing decided · Opened 2026-10-01 during menu import phase 3
> ([PR #271](https://github.com/mariajunqueiramirandas-cpu/vendua/pull/271)), full sweep the same
> day · Owner: undecided

A store that draws its own components gets Core's **data** from the Kernel but none of the
**display rules** the Kernel's defaults apply to it. Each such store re-derives those rules by
hand, so a new rule ships to the default storefront and silently misses every store that drew
its own card. The first version of this note covered the catalog card. The sweep below covers
every store section, the template every new store is copied from, the Kernel and ui-defaults
themselves, the admin, the CRM, the loader, the site, and `vendua check`.

**In short.** About 60 rules, helpers and primitives live outside the Kernel (or outside Core)
today. They fall into 15 families (§3). Ten of them are bugs today, whatever we decide about design (§4).
The pattern is the same everywhere:

- Core already computes a decision and doesn't serve it (`closesAt`, holidays, `liveStatus` and the
  display prices on the admin product).
- Or the Kernel computes it inside a default and doesn't export it (`productHref`, `Slot`,
  `unitsLeft`, `errorCopy`, `haptic`, `reducedMotion`, `noticeSeverity`).
- So every consumer writes its own copy, and the copies drift. Some drift happened before anyone
  noticed: `_examples/quero-pudim`, the golden read set, still renders `basePriceCents` for
  "a partir de" products.

## 1. The case that exposed it: "a partir de"

Phase 3 added `fromPriceCents`: Core computes the cheapest configured unit of a product priced
by a required list (base R$ 0, at least one of R$ 22,90–25,90), and the storefront should read
"a partir de R$ 22,90" instead of "R$ 0,00". Core and the Kernel type
(`CatalogProduct.fromPriceCents`, Kernel 1.13) made the number available everywhere at once,
but showing it took edits in five places:

| Where                                                      | What draws the price                        | Edit needed |
| ---------------------------------------------------------- | ------------------------------------------- | ----------- |
| `packages/kernel/src/sdk/sections.tsx`                     | `sdk:purchase-panel`, the grid's link label | yes         |
| `packages/ui-defaults/src/commerce.tsx`                    | the default `catalog.ProductCard`           | yes         |
| `storefronts/_template/sections/_shared/Dish.tsx`          | the template's own card                     | yes         |
| `storefronts/quero-pudim/sections/_shared/ProductCard.tsx` | Quero Pudim's own card                      | yes         |
| `storefronts/quero-pudim/sections/qr-menu.tsx`             | Quero Pudim's QR menu                       | yes         |

The two Quero Pudim edits also tripped `storefront-isolation` (a store's files change only in a
PR labelled for that store), so a platform PR needed the `platform` label to carry them. A sixth
place was missed: `storefronts/_examples/quero-pudim` still shows `formatBRL(basePriceCents)`
(`ProductCard.tsx:95`, `qr-menu.tsx:164`). A seventh was never in scope: the admin's product
preview (`apps/admin/src/features/menu/ProductPage.tsx:163`) still reads "R$ 0,00".

## 2. How display reaches a store today

- **Data**: Core serves numbers and labels (`basePriceCents`, `compareAtPriceCents`,
  `fromPriceCents`, `promoLabel`, `availabilityLabel`, `lowStock`, `needsChoices`, …). Money is
  computed only in Core; clients never recompute totals.
- **Defaults**: the Kernel's sections and pages and `@vendua/ui-defaults` slots turn that data into
  markup and apply the display rules.
- **Helpers exported to stores**: `formatCents`, hooks such as `useStockLeft`, and the primitives
  `AddToCart`, `ProductLink`, `Img`, `StoreStatusBadge` and a few others. There is no helper that
  answers "what price, in which form", "can this card add directly", "what are today's hours" or
  "what is this product's URL".
- **What stores can't reach**:
  - `@vendua/ui-defaults` is not a store dependency, so its pure helpers are out of reach:
    `money`, `dateTime`, `dayLabel`, `ORDER_STATE_LABEL`, `PAYMENT_LABEL`, `COUPON_REASON`,
    `countdown`, `mediaSrcSet`, `noticeSeverity`, `noticeLinks`, `qrMatrix`.
  - `Slot` isn't exported (`packages/kernel/src/index.ts` exports only the `SlotKey` and `SlotProps`
    types). So a store section can't render a default such as `store.HoursTable` or
    `catalog.ProductCard` inside its own markup. It redraws it, or overrides the whole slot.
- **A store's own section** reads the data and owns everything else.
- **Apps can't import the Kernel cheaply.** `@vendua/kernel` `.` pulls the React runtime. The only
  pure subpath is `./sdk-catalog`, which the admin already uses, in `appearance/fields.ts:1`. So the
  admin keeps its own copies of the same rules.

## 3. Inventory

Line numbers are from 2026-10-01. Short paths:

- **K** = `packages/kernel/src`
- **UD** = `packages/ui-defaults/src`
- **QP** = `storefronts/quero-pudim`
- **T** = `storefronts/_template`
- **AD** = `apps/admin/src`
- **C** = `packages/core/src`

The R/V column is **R** when the copies must match Core and the defaults (a rule), and **V** when
the wording or look is the store's to choose (voice). Most rows are both. The helper should return
the decision and leave the words to the store.

`_template` matters most. `vendua scaffold` copies the whole folder into every new store
(`packages/cli/src/scaffold.ts:84-91`), and the folder is also the bundle that serves every store
without one of its own. Every rule it re-derives is copied into every future store, and a fix made
in the template never reaches stores that were already scaffolded.

### 3.1 Price display

| Rule                                                               | Copies                                                                                                                                         | Divergence today                                                                                                                                                                                                                                                                             | R/V | Suggested owner                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------ |
| "a partir de": show `fromPriceCents` only above the base           | K `sdk/sections.tsx:633`, UD `commerce.tsx:413`, T `Dish.tsx:165-179`, QP `ProductCard.tsx:52`, QP `qr-menu.tsx:164`, AD `ProductPage.tsx:163` | QR menu skips the above-base check. Admin preview never shows it. `_examples` never got it. The purchase panel also says "a partir de" for combos with a paid slot item (K `sections.tsx:431`), and Core never serves that (`fromPriceCents` is null for combos, C `modules/catalog.ts:345`) | R   | Kernel `priceDisplay(product)` + `<ProductPrice>`      |
| Promo "de/por": strike `compareAtPriceCents` above the shown price | K `sections.tsx:301-307,421-437`, UD `commerce.tsx:427-433,486-518`, AD `ProductPage.tsx:163-164`                                              | Neither store shows a struck price, so a timed promotion looks like a plain lower price                                                                                                                                                                                                      | R   | same helper; Core serves shown/struck on admin product |
| Promotion's days and hours                                         | `promoLabel` read only by the defaults                                                                                                         | not shown by either store                                                                                                                                                                                                                                                                    | R   | same helper                                            |
| Accessible price words ("de R$ 24,00 por R$ 18,00")                | K `sections.tsx:637-644` (`priceWords`)                                                                                                        | QP card's `aria-label` (`ProductCard.tsx:67`) says only "esgotado"; no store says "de … por"                                                                                                                                                                                                 | R   | same helper                                            |
| Add button price `basePriceCents × qty`                            | K `sections.tsx:581`                                                                                                                           | browser arithmetic; hidden only while a priced option is picked                                                                                                                                                                                                                              | R   | Core quote for a configuration (unit + line total)     |
| `add_to_cart` analytics `value`                                    | K `primitives.tsx:173`                                                                                                                         | `basePriceCents × qty`: wrong for options, combos and from-price products; skews the funnel                                                                                                                                                                                                  | R   | Core quote, or drop `value`                            |

### 3.2 Card state: stock, sold out, quick add, badge

| Rule                                    | Copies                                                                                                                                                                                                                                                                                                          | Divergence today                                                                                                                                                                                  | R/V | Suggested owner                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------- |
| Low stock                               | UD `commerce.tsx:440` (Core `lowStock` and `left > 0`), K `sdk/blocks.tsx:18-40` (`StockCounter`, own `threshold` setting, default 5, `sdk/schemas.ts:144`), T `Dish.tsx:53-57` (`lowStock` OR `stock <= lowStockThreshold`), QP `ProductCard.tsx:36` (own prop, default 5), AD `ui/ProductTile.tsx:32-36`      | Four rules. The same product reads low on one surface and not on another. Core decides on gross stock, the clients on stock left after the cart. The Kernel's own block ignores Core's `lowStock` | R   | one decision: Core `lowStock` + Kernel `cardState`       |
| Sold out                                | `status !== 'active'` in about 8 places in K and UD (`commerce.tsx:424,487`, `blocks.tsx:23`, `sections.tsx:511,675`, `primitives.tsx:158,194`, `growth.tsx:74`); QP `ProductCard.tsx:34` uses `=== 'sold_out'`; AD `ProductTile.tsx:7-11` + 3 more (`ImportFlow.tsx:692`, `Marketing.tsx:541`, `Menu.tsx:126`) | QP and K disagree on `paused`. Wording differs: "Esgotado", "Esgotado hoje", "Indisponível agora". The admin recomputes Core's `liveStatus` (C `catalog.ts:274`)                                  | R+V | Kernel `cardState`; Core `liveStatus` on admin product   |
| Sold out by schedule                    | `availabilityLabel`: UD, T `Dish.tsx:112`                                                                                                                                                                                                                                                                       | QP's card says only "Esgotado hoje". The default card shows "Esgotado" with no label                                                                                                              | R   | Kernel `cardState`                                       |
| Card can add to the bag directly        | K `sections.tsx:684-688`, T `Dish.tsx:51-52`, QP `ProductCard.tsx:48`, plus K `AddToCart` limits (`primitives.tsx:158-161`)                                                                                                                                                                                     | Same expression copied. A new reason a product needs its page lands in every copy. Core's `needs_choices` (C `catalog.ts:382`) leaves out preorder, so every copy adds it back                    | R   | Core `canQuickAdd`, or Kernel `cardState`                |
| "All of it is in the bag"               | T `Dish.tsx:49` + `useInBag.ts:4-8`, UD `commerce.tsx:434-442`                                                                                                                                                                                                                                                  | T re-sums the cart for non-combo products only                                                                                                                                                    | R   | Kernel `cardState`                                       |
| Stock left after the cart, max quantity | K `hooks.ts:228-303` (internal `cartDemand`, `unitsLeft`, `productDraw`, `lineDraw`; only `useStockLeft` exported), copied inline at K `sections.tsx:323,666-667`; cap 99 at K `sections.tsx:277`, `pages/cart.tsx:18`, `primitives.tsx:205-212`, UD `commerce.tsx:20,182`                                      | Port of Core's `stockDemand` (C `modules/stock.ts:15`) that can drift. The UD fallback `min(99, stockQuantity)` ignores other lines and kits                                                      | R   | export `unitsLeft`/`useLineMax`; Core serves max-addable |
| Badge priority                          | UD `commerce.tsx:434-442` (preorder > all in bag > low), T `Dish.tsx:110-123` (sold out > all in bag > low > preorder), QP `ProductCard.tsx:49`                                                                                                                                                                 | Three orders. "Encomenda" vs "Sob encomenda"; "Últimas N" vs "Restam N"                                                                                                                           | R+V | Kernel `cardState` returns a badge key; store words it   |

### 3.3 Catalog listing

| Rule                                  | Copies                                                                                                                         | Divergence today                                                                                                                       | R/V | Suggested owner                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------ |
| Hide archived                         | K `sections.tsx:716,728`, T `menu.tsx:73`, QP `catalog.tsx:49`                                                                 | Dead code: Core never serves archived (C `catalog.ts:442`); `CatalogProduct.status` still lists it (K `api.ts:74`)                     | R   | drop; tighten the type                     |
| Hide empty categories, sold out last  | K `sections.tsx:716,734`, T `menu.tsx:66-96`                                                                                   | QP renders a tab for every category, empty ones included, and doesn't sink sold-out. `showcase.tsx:44` keeps only active products      | R   | Core orders them, or Kernel `useMenu()`    |
| Search: accent fold + what matches    | `normalize` ×5: K `sections.tsx:646`, UD `commerce.tsx:535` (`fold`), T `menu.tsx:40`, T `DishArt.tsx:18`, QP `catalog.tsx:37` | K matches a category name and shows all its products (`sections.tsx:722`). T matches per product. QP matches name and description only | R   | Kernel `matchProduct`/`useMenu({ query })` |
| Category description                  | K `sections.tsx:855`                                                                                                           | T's menu never renders `CatalogCategory.description`, so new stores start without it                                                   | R   | template fix; `useMenu` carries it         |
| Unavailable products in the QR picker | QP `qr-menu.tsx:48`                                                                                                            | sold-out products are selectable                                                                                                       | R   | `useMenu`                                  |

### 3.4 Store status and hours

| Rule                                | Copies                                                                                                                                                                                                                                                                                               | Divergence today                                                                                                                                                                                                                                                                                                               | R/V | Suggested owner                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | -------------------------------------------------------------------------- |
| "Open until X" / "opens tomorrow X" | T `_shared/hours.ts:14-65` (`hoursHint`, device clock), used at `menu-hero.tsx:43`                                                                                                                                                                                                                   | Core already computes `closesAt` and holiday-aware `resumesAt` (C `modules/store.ts:162-210`) but `/store` sends only `resumesAt` (C `app.ts:506`). The template ignores both. It says "abre amanhã" on a holiday, and for a manual close where Core deliberately gives no time (`store.ts:174-177`). An empty timezone throws | R   | Core serves `closesAt` + `specialDays`; Kernel `useStoreHours()`           |
| Weekly hours rows                   | UD `commerce.tsx:343-410` (`HoursTable`, Monday-first, folded, "hoje"), T `hours.ts:67-84` (Sunday-first, open days only), QP `footer.tsx:28-47` (`hoursSummary`)                                                                                                                                    | Three formats. QP ignores `hours.timezone`. None knows holidays, because `StoreProfile.hours` (K `api.ts:32`) has no special days, so `HoursTable`'s "hoje" is wrong on a holiday                                                                                                                                              | R+V | Kernel `hoursRows(hours)`; export `Slot` so stores can mount `HoursTable`  |
| Format Core's next-open instant     | C `modules/notices.ts:37-45`, K `primitives.tsx:379-385`, UD `system.tsx:102,133`, T `hours.ts:60`, AD `StatusPill.tsx:14-39`, AD `StatusSheet.tsx:184-195`                                                                                                                                          | Six phrasings ("retorna sáb 09:00", "Volta …", "abre amanhã")                                                                                                                                                                                                                                                                  | R+V | Kernel `formatWhen(iso, tz)` (pure)                                        |
| Status pill                         | K `StoreStatusBadge` (`primitives.tsx:376-396`, fixed labels, no parts), QP `_shared/StatusPill.tsx` + CSS `global.css:341-380`, T `menu-hero.tsx:52-53,88-94` + CSS `global.css:352-374`                                                                                                            | Both stores redraw it because the badge takes no label and has no documented parts. Both drop the resume time                                                                                                                                                                                                                  | R+V | `useStoreStatus()` → `{ status, closesAt, resumesAt }`; parts on the badge |
| Store time zone                     | UD `format.ts:5-22` accepts `timeZone`, but no caller passes one (`commerce.tsx:219,266`, `system.tsx:102,133`, K `pages/order.tsx:385`, UD `growth.tsx:659`); `SchedulePicker` is given `timezone` (K `pages/checkout.tsx:599`) and ignores it; AD `MiniStore.tsx:30` uses the browser's `getDay()` | A shopper outside the store's zone sees wrong promise and pause times                                                                                                                                                                                                                                                          | R   | Kernel `useStoreTime()` / `formatStoreDateTime`                            |

### 3.5 Delivery summary

| Rule                                | Copies                                                                                                                                | Divergence today                                                                                                                                                                                                                                                                                                                         | R/V | Suggested owner                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------ |
| Lowest fee / "grátis", ETA, minimum | K `sdk/blocks.tsx:155-169` (`DeliveryEta`), K `pages/checkout.tsx:289,361,386`, UD `checkout.tsx:76`, T `menu-hero.tsx:45-50,100-136` | `Math.min(feeCents)` ignores `feePerKmCents`, and Core charges `fee_cents + ceil(km) × perKm` (C `modules/geo.ts:87-92`), so a radius zone with base 0 reads "entrega grátis". With fees `[0, 500]` T prints "Entrega a partir de R$ 0,00" and K prints "grátis". All copies ignore `freeDeliveryOverCents` and per-zone `minOrderCents` | R   | Core `deliverySummary` on the store; Kernel `useDeliverySummary()` |
| Min-order / free-delivery remaining | Core serves `remainingMinOrderCents`, `freeDeliveryRemainingCents`; only UD `checkout.tsx:107-132` words them                         | A store with its own bag bar must rebuild the message                                                                                                                                                                                                                                                                                    | R+V | Kernel helper over the Core fields                                 |

### 3.6 Money, currency and locale

| Rule             | Copies                                                                                                                                                                                                                                                                                                                                                           | Divergence today                                                                                                       | R/V | Suggested owner                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------ |
| Format cents     | K `api.ts:1126` (`formatCents`, exported, unused inside the Kernel); UD `format.ts:1` (`money`, what the Kernel's own pages use); QP `_shared/format.ts:1-5` (BRL only); T `_shared/Price.tsx:5-13` (regex re-split of the formatted string); AD `lib/format.ts:10`; control `lib/format.ts:1`; site `scripts/assets.ts:234`; conformance `suite/helpers.ts:116` | Two formatters inside the platform. QP and the admin ignore `store.currency`. T's regex assumes the symbol comes first | R   | one pure `formatCents` (+ parts or `<Money>`), apps included |
| Currency, locale | `store?.currency ?? 'BRL'` ×11 (K `sections.tsx:250,272,715,892`, `pages/*`, T ×3); `'pt-BR'` hard-coded in K `pages/checkout.tsx:67,385`, `pages/order.tsx:385`, UD `calendar.tsx:35,44`, `format.ts`, `growth.tsx:659`                                                                                                                                         | Core serves `currency` but no `locale`                                                                                 | R   | Kernel `useMoney()`/`useFormat()`; Core `locale` field       |

### 3.7 URLs and links

| Rule                        | Copies                                                                                                                                                                                                                                  | Divergence today                                                                                                                                                                                                                                    | R/V | Suggested owner                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------- |
| Product and catalog URL     | K `config.ts:94,103` (`resolvePaths`, `productHref`; not exported, and `KERNEL_PATHS` has no catalog or product path); QP `qr-menu.tsx:31-34` (`${base}/produto/${slug}`); QP `header.tsx` hard-codes `/catalog`, `/pedidos`, `/qrcode` | The QR menu ignores `paths.product`. `ProductLink` is the only link and exposes no `href` for share, QR or JSON-LD                                                                                                                                  | R   | export `productHref`/`catalogHref` (or `useHref`)                                              |
| Store's public URL          | QP `qr-menu.tsx:42` (`window.location.origin`, editable); control `stores/bits.tsx:88-94` (hard-coded `slug.vendua.com.br`)                                                                                                             | `StoreProfile` has no canonical URL, so a QR printed from a preview prints the wrong host                                                                                                                                                           | R   | Core `publicUrl` on the store; Kernel `absoluteUrl(path)`                                      |
| `#produto-<slug>` deep link | QP `catalog.tsx:57,64-80`, `ProductCard.tsx:57`, `story.tsx:24-29`; T `menu.tsx:127-141`, `Dish.tsx:187`                                                                                                                                | A store-invented convention. K `scroll.tsx:94-103` already scrolls to any hash, so on a `#produto-` link the Kernel's instant jump and the store's smooth scroll both fire. `story.tsx`'s "BrowserRouter doesn't scroll to hashes" comment is stale | R+V | Kernel scroll-to-product-and-highlight helper                                                  |
| WhatsApp / Instagram links  | K `sections.tsx:137,154,160`, K `pages/order.tsx:59-64`, T `menu-hero.tsx:60,166-173`, QP `footer.tsx:51-54,69,79,116,123`, `closing.tsx:21,37-39`, `qr-menu.tsx:78-80`, AD `lib/format.ts:28-41`                                       | The admin adds the country code 55 to 10–11 digit numbers. The storefront doesn't, so a number saved without 55 (import, CRM) gives a broken `wa.me` on the store and a working one in the admin. Instagram URL shape differs (`www.…/x/` vs `…/x`) | R   | Core normalises on write and serves `whatsappUrl`/`instagramUrl`; Kernel `contactLinks(store)` |
| Address line                | K `sections.tsx:145-148,916-919`, QP `footer.tsx`, `qr-menu.tsx`                                                                                                                                                                        | separators differ (", " vs " · ")                                                                                                                                                                                                                   | V   | Core `addressLine`                                                                             |

### 3.8 Orders, payment and coupons

| Rule                         | Copies                                                                                                                                                                                                                                                              | Divergence today                                                                                                                                                           | R/V | Suggested owner                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------- |
| Order progress, terminal set | UD `format.ts:24` (`ORDER_STATE_LABEL`), UD `commerce.tsx:13,318-342` (private path), K `hooks.ts:305` (`TERMINAL_ORDER`), K `pages/order.tsx:57` (`REFUNDED`); AD `ui/StateChip.tsx:15-58`, `orders/Orders.tsx:57` vs C `modules/orders.ts:20` (`TRANSITIONS`)     | No test ties the admin's state machine to Core's                                                                                                                           | R+V | Kernel `orderProgress(order)`; Core `allowedNext` on admin orders |
| Payment method labels        | K `pages/checkout.tsx:36-44`, UD `format.ts:35`, UD `payment.tsx:104`, K `pages/order.tsx:300`, AD `ui/PaymentChip.tsx:26`, `orders/PaymentSection.tsx:33-37`, `orders/actions.ts:244`                                                                              | `card_online` reads "Cartão pelo Mercado Pago" (admin) vs "Cartão de crédito" (store); the printed ticket says "Cartão" for any card                                       | R+V | one pure table + audience wording                                 |
| Payment adjustment label     | K `pages/checkout.tsx:60-73` (bps → "−5%", discount/surcharge/mixed), UD `checkout.tsx:88-99`, UD `growth.tsx:593-603`, AD `payments/Adjustments.tsx:22-39` (also mirrors Core's bounds)                                                                            | three wordings; bounds copied from C `payment-adjustments.ts:17-18`                                                                                                        | R   | Core serves `label`/`kind` on `PaymentAdjustment`                 |
| Coupon messages              | K `errors.ts:50-58`, UD `format.ts:54-63`, K `pages/checkout.tsx:47-57` (three code tables); apply/remove handler at K `pages/cart.tsx:81-108` and `pages/checkout.tsx:414-434`; AD `Marketing.tsx:187-195,406-424` vs C `modules/coupons.ts:46-51` (`couponLabel`) | The admin ignores Core's `label`, so "entrega grátis" vs "Entrega grátis", and "R$ 12,00 de desconto" vs "R$ 12,00 off". `api.validateCoupon` (K `api.ts:755`) has no hook | R+V | Kernel `useCoupon()`; admin uses Core's `label`                   |
| Pix countdown, key labels    | UD `growth.tsx:420-490`, K `pages/order.tsx:91-93,133-139` (two client-clock timers); key types at K `sdk/blocks.tsx:212-218` vs K `pages/order.tsx:20-26`                                                                                                          | "aleatória" vs "chave aleatória"                                                                                                                                           | R   | `usePixTimer()`; one table                                        |
| Line option summary          | UD `commerce.tsx:154-166`, UD `growth.tsx:572-580`, K `pages/checkout.tsx:57`                                                                                                                                                                                       | only the cart line shows the price delta                                                                                                                                   | R   | Kernel `lineSummary(item)`                                        |
| Encomenda line, lead days    | UD `commerce.tsx:260`, UD `growth.tsx:345,361,608`, K `sections.tsx:446-450`                                                                                                                                                                                        | none yet                                                                                                                                                                   | R   | Kernel helper                                                     |

### 3.9 Shopper input: phone and CEP

| Rule                    | Copies                                                                                                                                                                                                     | Divergence today                                      | R/V | Suggested owner                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --- | --------------------------------------- |
| Phone valid, normalised | K `pages/checkout.tsx:84-85` (10–13 digits), `primitives.tsx:346-348` (10–13), `sdk/blocks.tsx:71,98` (≥ 10), `hooks.ts:582` (slice 13), `hooks.ts:668` (`endsWith`), `api.ts:579` (`phoneKey`, strips 55) | Five rules. No mask, though the placeholder shows one | R   | Kernel `normalizePhone`/`isValidPhone`  |
| CEP mask and trigger    | UD `checkout.tsx:260-264`, K `hooks.ts:588,737`, `api.ts:747`, `pages/checkout.tsx:408-409`                                                                                                                | none yet                                              | R   | Kernel `maskCep`; normalise in `useCep` |

### 3.10 Notices

| Rule                         | Copies                                                                                                                                                                                                  | Divergence today                                                                                                                                                                                                                                                                                                  | R/V | Suggested owner                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------- |
| Which notices show, blocking | K `SystemSurfaces.tsx:143-149` (time window + `noticeSeverity`), K `hooks.ts:115-128` (`useNotices`: neither), K `SystemSurfaces.tsx:327-341` (`SurfaceRegion`), UD `system.tsx:9`, loader `v.js:77-79` | The exported `useNotices` returns expired and future notices, and its blocking test (`severity === 'blocking' \|\| kind === 'emergency'`) skips the unknown-severity coercion. Four filters                                                                                                                       | R   | `useNotices` returns the filtered set; Core serves `blocking` |
| Notice look via override     | QP `overrides/Notice.tsx:6-27` copies `noticeSeverity` and `noticeLinks` (UD `system.tsx:9,16-23`)                                                                                                      | The override never calls `onAction`, so `notice_action` telemetry is lost. It has no `data-kind` or `data-severity`, and it can dismiss blocking notices. `_examples` reuses it for `system.PauseNotice`, which drops the "Volta …" line. QP's `OBSERVATIONS.md:128-131` is stale on which slot promo notices use | R+V | export the helpers; give `NoticeCard` documented parts        |

### 3.11 Images and media

| Rule                        | Copies                                                                                                                                                                                                                                   | Divergence today                                                                    | R/V | Suggested owner                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------- |
| Responsive product image    | K `Img` (`primitives.tsx:413-467`), UD `format.ts:69` (`mediaSrcSet`); raw `<img>` at QP `ProductCard.tsx:70-77`, `product-figure.tsx:17-24`, `hero.tsx:87`, `story.tsx:37`; T `Dish.tsx:90`, `dish-media.tsx:67`, `menu-hero.tsx:66,80` | Stores ship full-size uploads to 56–96 px thumbnails and hand-write `fetchpriority` | R   | `Img` (exists) or a `<ProductImage>` with `onError` → placeholder |
| Image failure → placeholder | UD `commerce.tsx:425,458-476`, T `Dish.tsx:38,89-99`                                                                                                                                                                                     | `T dish-media.tsx` shows a broken image                                             | R   | same                                                              |
| Gallery on the product page | K `sections.tsx:274,391` hides `catalog.Gallery` when any block sits in the `media` area; QP `product-figure.tsx`, T `dish-media.tsx` (re-implements the gallery, "Foto i de n")                                                         | Multi-photo products lose their gallery in QP                                       | R   | the `media` area wraps the gallery                                |
| Card → page photo morph     | UD `commerce.tsx:450` sets `data-vt-src`                                                                                                                                                                                                 | Store cards don't, so there is no shared-element transition                         | R   | `ProductLink`/`Img` set it                                        |
| QR code                     | UD `qr.ts` (dependency-free); QP `qr-menu.tsx:4,58-61` and AD `ui/PixCode.tsx:13`, `Marketing.tsx:70-80` use the `qrcode` package                                                                                                        | Three QR stacks                                                                     | R   | Kernel `<QrCode>`/`qrSvg()` (pure)                                |
| Placeholder art             | T `DishArt.tsx:8-23` (pt-BR keyword regex), QP `ProductFigure.tsx`; both hard-code `kind === 'combo' ? 'box'`                                                                                                                            | Ignores Core's `figureVariant`                                                      | V   | store's; consider a Core art key                                  |

### 3.12 Motion, scroll, haptics

| Rule                     | Copies                                                                                                                                                | Divergence today                                                                      | R/V | Suggested owner                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --- | --------------------------------------- |
| Reduced motion           | K `spring.ts:69-70` (internal); QP `catalog.tsx:74`, `story.tsx:27`, `Reveal.tsx:20`; T `menu.tsx:42`, `dish-media.tsx:54`                            | none yet                                                                              | R   | export `useReducedMotion()`             |
| Haptic tick              | K `haptics.ts:16` (internal), called by `AddToCart` (`primitives.tsx:168`); T `Dish.tsx:47` calls `navigator.vibrate(8)` in `onAdded`                 | The template buzzes twice per add                                                     | R   | export `haptic`; drop the template call |
| Scroll reveal            | QP `_shared/Reveal.tsx:5-43` + CSS `global.css:764-772,1729-1739`; T `menu.tsx:105`                                                                   | no Kernel primitive                                                                   | V   | Kernel `<Reveal>` or `data-reveal`      |
| Scroll-spy, sticky strip | T `menu.tsx:98-159` (magic `rootMargin`, 1200 ms timeout), CSS `global.css:670-674,735-736` (76 px tab bar hard-coded); QP `header.tsx:66-86,120-151` | `--v-header-height` is a fixed 64 px token, so an announcement bar breaks the offsets | V   | `useScrollSpy(ids)`; real header height |
| Print                    | QP `qr.css:145-163` hides `.site-header`/`.site-footer`; UD `styles.css:3331-3338` hides the Kernel's own                                             | none yet                                                                              | V   | a `data-print` page marker              |

### 3.13 Head, meta and store boilerplate

| Rule                         | Copies                                                                                                                        | Divergence today                                                                                                                            | R/V | Suggested owner                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------- |
| Document title               | K `router.tsx:96` (`store.name` on every non-product page), K `sections.tsx:284` (`product · store`)                          | The Kernel overwrites QP's hand-written SEO title after mount                                                                               | R+V | Kernel `useDocumentMeta`; title template from config/Core |
| Meta, OG, canonical, JSON-LD | none in the Kernel or edge (`edge/src/inject.ts` injects state only); per store in `index.html`                               | No description, Open Graph, canonical, manifest or apple-touch-icon from Core's `/store` data (`name`, `tagline`, `description`, `logoUrl`) | R   | vite plugin `transformIndexHtml` or the edge injector     |
| `index.html` shell           | T `index.html:4-10,24`, QP `index.html:4-12,26`                                                                               | QP's viewport lacks `viewport-fit=cover` and `interactive-widget=resizes-content`. A static `theme-color` copies the `bg` token by hand     | R   | plugin injects viewport, `v.js`, noscript shell           |
| `vite.config.ts`, `main.tsx` | identical in both stores except the port and fonts (K06, K02 enforce the shape)                                               | the plugin (K `vite.ts:116-258`) has no `config()` hook; scaffold regex-replaces the port                                                   | R   | plugin owns proxy, `publicDir`, port from `package.json`  |
| Fonts                        | `@fontsource-variable/*` in `main.tsx`, QP `styles/fonts.css`; the provider can inject `font.srcs` (K `provider.tsx:276-292`) | none yet                                                                                                                                    | V   | provider self-hosts from tokens                           |

### 3.14 Copy, vocabulary, errors

| Rule                  | Copies                                                                                                                 | Divergence today                                                                                                               | R/V | Suggested owner                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------ |
| Store vocabulary      | Core serves `store.vocabulary` (K `api.ts:40`); nothing reads it                                                       | "sacola", "item/itens", "cardápio" are hard-coded in K and UD; QP sets `itemSingular`/`itemPlural` in section settings instead | V   | Kernel applies it; `useCopy()`                   |
| Placeholders `{city}` | QP `hero.tsx:40`, `faq.tsx:25`, `steps.tsx:49`, `product-perks.tsx:31`                                                 | none yet                                                                                                                       | R   | Kernel `interpolate(text)` (`{city}`, `{store}`) |
| Plural                | `n === 1 ? a : b` at about 8 sites in K and UD                                                                         | none yet                                                                                                                       | R   | Kernel `plural()`                                |
| Error copy per code   | K `errors.ts:69,73,90,113` (`errorCopy`, `errorCode`, `showError`, `showInfo`; only `useErrorSurface().show` exported) | A store showing its own error text re-writes pt-BR copy per code                                                               | R+V | export `errorCopy`                               |
| Cart count            | K `sections.tsx:87,210,239`, `primitives.tsx:260-266`, UD `commerce.tsx:82`, QP `header.tsx:34`                        | none yet; `CartTrigger` only stamps `data-count`                                                                               | R   | `useCartCount()`                                 |
| Funnel events         | K `telemetry.ts:8,153` (`PLATFORM_EVENTS`, `emit`; only `track('custom.*')` exported)                                  | A store add that bypasses `AddToCart` loses the funnel                                                                         | R   | keep commerce on primitives; document it         |

### 3.15 Admin, CRM, loader and templates

The admin can't import the Kernel's React entry. Each row below needs either a Core-served value or
a pure Kernel subpath (`./sdk-catalog` is the precedent).

| Rule                                  | Where                                                                                                                                          | Divergence today                                                                                                                                                                                 | Suggested owner                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Product preview price                 | AD `menu/ProductPage.tsx:159-164,300-345`; Core's admin route serves `promoNow` only (C `admin/routes-catalog.ts:109`)                         | No "a partir de", promo line, availability label or low stock in the preview                                                                                                                     | Core serves the storefront's display fields on the admin product                 |
| Schedule wording, window validation   | AD `menu/schedule.ts:30,36,59,68`, `lib/format.ts:109`                                                                                         | "Seg a sex, das 11h às 15h" vs the storefront's "Seg a sex, 11h–15h"                                                                                                                             | Core serves the label; `windowProblem` mirrors Core's `goodWindow`               |
| Default templates and tokens          | AD `appearance/Appearance.tsx:51-97` (`FALLBACK`, `BASE_TOKENS`)                                                                               | Copies of K `sdk/defaults.ts:5` and `templates/src/palette.ts:62`                                                                                                                                | export via `./sdk-catalog` / `@vendua/templates`                                 |
| Contrast pairs                        | AD `appearance/Colors.tsx:34-39` (7 pairs), conformance Q07 (`conformance.e2e.ts:949-956`, 6 pairs)                                            | Q07 lacks `danger`/`surface`; `templates/src/tokens.ts:143` has the list                                                                                                                         | use `CONTRAST_PAIRS`/`contrastProblems` everywhere                               |
| Section names, addable list, settings | AD `appearance/fields.ts:19-52`, `SettingsEditor.tsx:73`                                                                                       | A new SDK section shows "Seção x". The helper text says `/catalog`, but the Kernel default is `/cardapio` (K `config.ts:97`). URL fields skip `SAFE_URL`, so the Kernel drops the value silently | schema metadata `title`/`addable`; export `resolveSettings` from `./sdk-catalog` |
| Settings validated only at render     | `templates/src/model.ts` checks shape only; K `composition/schema.ts:169` drops bad settings                                                   | No layer warns the merchant                                                                                                                                                                      | Core validates against the Kernel schemas on save                                |
| Preview protocol                      | AD `Appearance.tsx:187-232` string literals; K `preview.ts` documents them in a comment                                                        | none yet                                                                                                                                                                                         | export the message constants                                                     |
| Template/token types                  | AD `lib/api.ts:848-871`                                                                                                                        | redeclared                                                                                                                                                                                       | `import type` from `@vendua/templates`                                           |
| Slug                                  | AD `signup/progress.ts:132`, control `fleet/CreateStoreSheet.tsx:17`, C `billing/signup.ts:72`, C `admin/context.ts:116`                       | Only the admin maps `&` → " e "                                                                                                                                                                  | Core's slug check returns the normalised slug                                    |
| Client sums                           | AD `orders/Scheduled.tsx:109`, `home/Home.tsx:160`, `reports/Reports.tsx:272,324,331`, `orders/PaymentSection.tsx:28-31` (refundable fallback) | merchant analytics, not charged money; the refundable fallback covers an older Core                                                                                                              | Core serves day totals and deltas; drop the fallback                             |

## 4. Bugs found along the way

These are wrong today, whatever we decide about helpers, and each is small:

1. **Radius-zone fee reads "grátis".** K `sdk/blocks.tsx:162` and `pages/checkout.tsx:289` take the
   lowest `feeCents`, and that ignores `feePerKmCents`.
2. **`useNotices` returns expired and future notices.** K `hooks.ts:115-128` doesn't apply the
   time-window filter that `SystemSurfaces` applies.
3. **`StockCounter` ignores Core's `lowStock`.** It uses its own threshold (K `sdk/blocks.tsx:33`).
4. **`add_to_cart` analytics value uses `basePriceCents`.** See K `primitives.tsx:173`.
5. **The template vibrates twice per add.** See T `Dish.tsx:47`.
6. **The Kernel overwrites a store's document title** on every non-product page (K `router.tsx:96`).
7. **`SchedulePicker` ignores the store's `timezone`.** UD's date formatters are never given it.
8. **The template's delivery line shows "a partir de R$ 0,00"** when one zone is free
   (T `menu-hero.tsx:117-119`).
9. **The template's hours hint invents a reopening time.** It does so on holidays and on a manual
   close (T `hours.ts:31-65`).
10. **`_examples/quero-pudim` still shows `basePriceCents` for "a partir de" products.** The golden
    read set teaches the pre-1.13 behaviour. Its `OBSERVATIONS.md` also claims a `lowStock` change
    that neither copy has.

## 5. Answers to the investigation questions

1. **Inventory.** See §3. Beyond the catalog card, store sections re-derive:
   - store hours and open state
   - the delivery summary
   - contact links
   - product URLs
   - catalog filtering, sorting and search
   - image handling
   - notice rules (through the override)
   - motion and scroll primitives
   - head and meta tags

   No store re-derives the cart, the checkout or order tracking. Those are Kernel pages, and K09
   keeps stores off them. The duplication there sits inside the platform, between K `pages/*` and UD
   (§3.8).

2. **Rule vs voice.** The R/V column in §3. The line holds everywhere: the decision (which price,
   which badge, open or not, which notices) is a rule. The wording, the order of labels and the look
   are voice. Badge wording, status labels, scroll-reveal style, placeholder art and fonts are the
   store's.
3. **Core vs Kernel.**
   - **Core should serve:** anything that needs a clock, the zones or the stock ledger, and anything
     an app needs too:
     - `closesAt` and `specialDays` on the store
     - a `deliverySummary`
     - `canQuickAdd` (or preorder folded into `needsChoices`)
     - a configuration quote (unit and line price for the current picks)
     - `publicUrl`, `whatsappUrl` and `instagramUrl`, normalised on write
     - `locale`
     - `label` and `kind` on payment adjustments
     - the storefront display fields on the admin product
     - `allowedNext` on admin orders
   - **The Kernel should export:** pure choices over Core fields and the platform's own internals:
     - `priceDisplay` and `<ProductPrice>`
     - `cardState`
     - `useMenu` / `matchProduct`
     - `useStoreHours` / `hoursRows` / `formatWhen`
     - `useDeliverySummary`
     - `useMoney`
     - `productHref`, `catalogHref` and `absoluteUrl`
     - `contactLinks`
     - `orderProgress`
     - `useCoupon`
     - `normalizePhone` and `maskCep`
     - `useReducedMotion` and `haptic`
     - `errorCopy`, `plural` and `interpolate`
     - `useCartCount`
     - `Slot`, so a store section can mount a default
   - **Pure subpath.** The pure members should also ship as a React-free subpath (`./format` or a
     wider `./sdk-catalog`), so the admin uses the same table.
4. **Guard rails.** See §6. Today `vendua check` catches raw fetch, literal Core paths, cart
   mutations and one shape of hand-built product URL, and nothing else on this list.
5. **Migration cost.**
   - **Defaults first.** Adopting the helpers in K and UD needs no store edit. It removes the
     platform's own duplicate copies: two `fromPrice`, two money formatters, five copies of the fee
     floor, three coupon tables, five phone rules.
   - **Stores then follow** in their own `storefront:<slug>` PRs:
     - QP touches about 8 sections and `_shared` files.
     - `_template` touches about 6. It is the copy that matters most, since it is copied into
       every new store.
   - **Stores already scaffolded** keep their copies until they adopt the helpers themselves.
6. **Admin.** It duplicates the rules too: price preview, low stock, sold out, schedule wording,
   hours, WhatsApp, payment labels, coupon labels and default templates (§3.15). Most of these
   should be Core-served values on the admin's own endpoints. Shared formatting should come from
   the pure subpath. A React import won't work there.

## 6. Enforcement today and what a check could add

K01–K16 live in `packages/conformance/src/static.ts` and `lint.ts`. The next free id is K17.

| Family                                                         | Caught today?                                                       | A rule that would catch it                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Raw fetch / axios / XHR                                        | K03                                                                 | also `EventSource`, `sendBeacon`, `WebSocket`                                      |
| Cart mutations, `useCheckout`                                  | K09                                                                 | —                                                                                  |
| Hand-built product URL                                         | K09, only `to=`/`href=` + literal `/produto/` (`lint.ts:148`)       | any string containing `/produto/` or a configured `paths.*` value, `navigate(...)` |
| Money formatting (`Intl.NumberFormat`, `toLocale*`, `toFixed`) | no                                                                  | flag in `sections/**`                                                              |
| `'BRL'` / `'pt-BR'` literals                                   | no                                                                  | flag in `sections/**`                                                              |
| Reading `basePriceCents` / `fromPriceCents` / `compareAt…`     | no                                                                  | warn once `priceDisplay` exists                                                    |
| Stock recompute (`stockQuantity`, `lowStockThreshold`)         | no                                                                  | flag comparisons                                                                   |
| `wa.me`, `instagram.com`, `tel:` built in code                 | no                                                                  | flag in `sections/**`                                                              |
| Hours/date math (`Intl.DateTimeFormat`, `.hours.windows`)      | no                                                                  | flag in `sections/**`                                                              |
| Raw `<img src={…imageUrl}>`                                    | no                                                                  | flag                                                                               |
| `navigator.vibrate`, `prefers-reduced-motion` matchMedia       | no                                                                  | flag once the Kernel exports them                                                  |
| Declared block area never rendered                             | no (QP `header.tsx:28` declares `actions` and never renders it)     | K11 extension                                                                      |
| Short hard-coded copy                                          | K12 sees JSX text over the word limit only                          | string literals in props                                                           |
| Kernel's internal copies agree                                 | no                                                                  | collapse to one module, or a parity test                                           |
| Display rules end to end                                       | no conformance check for "a partir de", strike, low stock, currency | C-suite fixtures with a from-price product, a timed promo and a radius zone        |

## 7. Still open

- Which helpers come first? The candidate is `priceDisplay` + `cardState` + `useDeliverySummary` +
  `useStoreHours`. They cover most of the drift and three of the bugs.
- Should Core serve the card decisions (`canQuickAdd`, a badge key) or should the Kernel derive them?
  The admin's needs push toward Core.
- Should the stores' copies (`_examples/quero-pudim`, `OBSERVATIONS.md`) be corrected now or retired
  as rule guides? The investigation found both stale.
- How do the new K-rules land: warnings first, then errors once the helpers exist?

## References

- `docs/menu-import.md` §6 (model gaps 1 and 8) and §9 (phase 3) — where `fromPriceCents` and timed
  promotions were introduced.
- `packages/kernel/API.md` — "Timed promotions and 'a partir de' (Kernel 1.13)".
- `packages/kernel/CHANGELOG.md` 1.13.0.
- `packages/conformance/src/lint.ts`, `static.ts` — K01–K16.
- `tools/check-storefront-paths.mjs` — the storefront write-scope boundary and the `platform` label.
- `packages/cli/src/scaffold.ts` — what `_template` copies into a new store.
