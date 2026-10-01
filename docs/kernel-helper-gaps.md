# Kernel helper gaps — display rules stores re-derive

> Status: open, for investigation · Written 2026-10-01 during menu import phase 3
> ([PR #271](https://github.com/mariajunqueiramirandas-cpu/vendua/pull/271)) · Owner: undecided

A store that draws its own components gets Core's **data** from the Kernel but none of the
**display rules** the Kernel's defaults apply to it. Each such store re-derives those rules by
hand, so a new rule ships to the default storefront and silently misses every store that drew
its own card. This note records the case that exposed the gap, what is duplicated today, and
the questions a deeper investigation should answer before anything is built.

## The case that exposed it: "a partir de"

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
PR labelled for that store), so a platform PR needed the `platform` label to carry them.

The rule itself is small — show `fromPriceCents` when it is above `basePriceCents`, and then
hide the base-only "de" price beside it — but it now lives in four copies (`fromPrice` in
`sections.tsx:633`, `fromPrice` in `commerce.tsx:413`, `fromOf` in `Dish.tsx:167`, inline in
Quero Pudim's `ProductCard.tsx:52`), and the copies already differ (the QR menu checks only
`!= null`).

## How display reaches a store today

- **Data**: Core serves numbers and labels (`basePriceCents`, `compareAtPriceCents`,
  `fromPriceCents`, `promoLabel`, `availabilityLabel`, `lowStock`, `needsChoices`, …). Money is
  computed only in Core; clients never recompute totals.
- **Defaults**: the Kernel's sections and `@vendua/ui-defaults` slots turn that data into
  markup and apply the display rules (when to strike a price, when to say "a partir de", which
  badge wins, when the card can add to the bag directly).
- **Helpers exported to stores**: `formatCents` (cents → "R$ 12,34") and hooks such as
  `useStockLeft`, `AddToCart`, `ProductLink`. There is no helper that answers "what price, in
  which form, does this product show" or "can this card add directly".
- **A store's own section** reads the data and owns everything else. The Kernel can't reach into
  it, so every display rule is the store's to re-implement and to keep in step.

## What stores re-derive today

Found by reading `storefronts/quero-pudim` and `storefronts/_template` on 2026-10-01; line
numbers are from that day.

| Rule (who owns it in the defaults)                                                                 | Core field(s)                                                    | Re-derived in                                                                                                    | Divergence today                                                                                                |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "a partir de": show `fromPriceCents` only above the base                                           | `fromPriceCents`, `basePriceCents`                               | quero-pudim `ProductCard.tsx:52`, `qr-menu.tsx:164`; template `Dish.tsx:167`                                     | QR menu omits the "above base" check (harmless while Core guarantees it)                                        |
| Promo "de/por": strike `compareAtPriceCents` when above the price shown, never beside a from-price | `compareAtPriceCents`                                            | not re-derived — neither store shows it                                                                          | a timed promotion (or a static "de" price) shows on store cards only as the lower price, with no strike-through |
| Timed promotion's days and hours                                                                   | `promoLabel`                                                     | not shown by either store                                                                                        | shoppers on store sections never see when a promotion runs                                                      |
| Sold out by schedule: "Só sábados, 9h–13h"                                                         | `availabilityLabel`                                              | template `Dish.tsx:112`; not shown by Quero Pudim                                                                | Quero Pudim's card says only "Esgotado hoje"                                                                    |
| Low stock                                                                                          | `lowStock` (Core's call against the product's threshold)         | quero-pudim `ProductCard.tsx:36` recomputes from `useStockLeft` and its own `lowStockThreshold` prop (default 5) | the store's threshold can disagree with the product's `low_stock_threshold` that Core uses                      |
| Card can add to the bag directly                                                                   | `status`, `needsChoices`, `kind`, `requiresPreorder` + bag state | quero-pudim `ProductCard.tsx:48`; template `Dish.tsx:52` (same expression, copied)                               | none yet; a new reason a product needs its page (e.g. a required note) would have to be added in every copy     |
| Badge priority (preorder, all in bag, sold out…)                                                   | `requiresPreorder`, `status`, bag state                          | quero-pudim `ProductCard.tsx:49`; template `Dish.tsx:121`                                                        | wording and priority differ per store (by design or not — undecided)                                            |
| Money formatting                                                                                   | cents + store currency                                           | quero-pudim `_shared/format.ts:3` (`formatBRL`, BRL only); template uses `formatCents`                           | Quero Pudim ignores the store's `currency`                                                                      |
| Delivery fee "a partir de" from the zones                                                          | zones' `feeCents`                                                | template `menu-hero.tsx:49` (`lowestFee`); Kernel `sdk/blocks.tsx:153–165`; `pages/checkout.tsx:295`             | three copies of "lowest fee, or 'grátis'" inside and outside the Kernel                                         |

The defaults themselves carry two copies of some rules: `fromPrice` exists in both the Kernel
(`sections.tsx`) and ui-defaults (`commerce.tsx`), because neither exports it.

### Related: price arithmetic outside Core

Not a store problem, but the same family, and it should be in scope:

- `packages/kernel/src/sdk/sections.tsx:581` — the purchase panel's add button shows
  `basePriceCents × qty` computed in the browser (pre-existing; phase 3 only narrowed when it
  shows). Core could serve the line's unit and total price for the current picks.
- `apps/admin/src/features/menu/ProductPage.tsx:161–164` — the admin's preview card re-derives
  which price is shown and which is struck during a timed promotion (`promoNow ? promo : price`).
  It matches Core's `priceNow` (`packages/core/src/modules/catalog.ts`) today; Core could serve
  the shown and struck prices on the admin product instead.

## A direction to test (not decided)

One Kernel helper per rule family, returning **what to show**, never a new number:

- **Price**: given a `CatalogProduct` (and the store's currency), return the price to show, its
  form (`plain` / `from` / `promo`), the struck price if any, the promotion line if any, and the
  accessible label ("de R$ 24,00 por R$ 18,00", "a partir de R$ 22,90"). Every input is a Core
  number; the helper only chooses among them. A component (`<ProductPrice>`) on top for stores
  that want the default markup with their own styling hooks.
- **Card state**: "can this card add directly", "which badge", "low stock" — from Core's fields
  and the Kernel's bag state, so a new reason lands once.
- **Delivery summary**: the lowest fee / free / minimum line from the zones.

Each is a new runtime export, so it follows the Kernel contract: additive within Contract 2,
`API.md` + `test/api-surface.test.ts`, a version bump and a `CHANGELOG.md` line. The defaults
(Kernel sections and ui-defaults) would use the same helpers, removing their duplicate copies.
Stores adopt them in their own `storefront:<slug>` PRs.

## Questions for the investigation

1. **Inventory**: which other rules do store sections re-derive beyond the catalog card — the
   product page, cart, checkout summary, order tracking, store hours/open state, notices? Read
   every section in every store and list each rule with its Core field and its copies.
2. **What should stay the store's**: some differences are design (Quero Pudim's badge wording).
   Which parts are rules (must match Core and the defaults) and which are voice (the store's to
   choose)? A helper should return the decision and let the store word and style it.
3. **Core vs Kernel**: for each rule, should Core serve the decision (e.g. `priceDisplay` on the
   product, a line total for the current picks) or should the Kernel derive it from Core's
   fields? Money arithmetic belongs in Core; pure presentation choices may sit in the Kernel.
4. **Guard rails**: could `vendua check` (K-rules) flag a store section that reads
   `basePriceCents` directly, or formats money itself, so new stores start on the helpers?
5. **Migration cost**: how many store sections change per helper, and can the defaults adopt
   them first with no store edit?
6. **Admin**: the admin's previews of the storefront (product page preview card, appearance)
   duplicate storefront rules too — same helpers, or Core-served values?

## References

- `docs/menu-import.md` §6 (model gaps 1 and 8) and §9 (phase 3) — where
  `fromPriceCents` and timed promotions were introduced.
- `packages/kernel/API.md` — "Timed promotions and 'a partir de' (Kernel 1.13)".
- `packages/kernel/CHANGELOG.md` 1.13.0.
- `tools/check-storefront-paths.mjs` — the storefront write-scope boundary and the `platform`
  label.
