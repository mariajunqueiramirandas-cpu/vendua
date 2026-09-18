# Contract v1 — draft (from Phase 0 observations)

> Status: Draft · supersedes nothing yet. This is the Phase 0 exit artifact:
> Contract v1 written from _observed_ needs (docs/roadmap.md). It refines
> [03 — The Storefront Contract](architecture/03-storefront-contract.md); where
> they disagree, this draft records what the spikes proved we need.

Everything in 03 remains normative. This draft adds what building three
storefronts on the skeleton showed was missing.

## API surface — fields observed missing

| Endpoint                   | Addition                                                                            | Why (observed)                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /store`               | `vocabulary: { itemSingular, itemPlural, bag }`, `opensAt`, `figure` for brand mark | Per-tenant copy is real (quero-pudim "doce"/"sacola"); closed badge needs next-open |
| `GET /catalog`             | `product.figure`, `product.tags[]` (e.g. `sold_out`, `popular`)                     | Imagery/merchandising — every store needed it                                       |
| `GET /storefront/v1/zones` | NEW — `name, neighborhoods, feeCents, etaMin/Max, minOrderCents`                    | Address/delivery UX without zone data is guesswork                                  |
| `POST /checkout` response  | `order.trackingUrl`, `order.whatsappLink`                                           | Order-confirmation page needs both without computing them                           |
| `GET /orders/:id`          | public by order id + signed access (already: `/checkout/v1/orders/:id`)             | My-orders page needs a stable URL                                                   |

## Kernel additions observed

| Piece                                    | Slot/primitive                       | Note                                                                             |
| ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `formatBRL` / `useMoney()`               | util                                 | Every store formats centavos                                                     |
| `cart.Drawer` + `cart.LineItem` defaults | slots (need defaults in ui-defaults) | No-override store currently has no cart UI                                       |
| `ModifierPicker`                         | primitive                            | Enforces required/min/max client-side, produces `modifierIds` for `AddToCart`    |
| `checkout.Layout` default                | slot                                 | Kernel-owned checkout mount at `/(vendua)/checkout`                              |
| `useOrder(id)`                           | hook                                 | Poll order status page                                                           |
| Font loading rule                        | contract                             | `font.srcs` in config → Kernel `@font-face`; storefront fonts in `assets/fonts/` |

## Config surface — additions to `vendua.config.ts`

```ts
defineStorefront({
  contract: 1,
  ring: 'stable',
  tokens: {
    color: { /* as 03 */ },
    font:  { display, body, mono?, srcs?: { family, file, weight, style }[] },
    radius: { sm, md, lg },
    space: { scale },
    motion:{ duration, easing },
  },
  routes: './routes',
  budgets: 'default',
  overrides: { /* registry keys only */ },
});
```

## What Phase 0 did NOT need (recorded so nobody adds it speculatively)

- Coupons, loyalty, scheduled orders — no storefront touched them; defer.
- Multi-language notice copy — pt-BR only today; `Notice.body` stays server
  copy. Locale is a tenant field when a second language appears.
- Storefront-defined pages outside `routes/` — the file layout held.
- Client-computed prices — never needed; Core's priced cart was sufficient.

## Open questions for Phase 1 freeze

1. Does `opensAt` live on `/store` or only inside the `store_closed` notice
   payload? (Leaning: both — field for code, payload for copy.)
2. Vocabulary scope: are `vocabulary` strings free-form pt-BR or a registry of
   inflected forms? Free-form for v1; grammar handled by copy.
3. `figure` format: asset-bucket URL vs built-in motif enum vs both.
4. Checkout as `/(vendua)/checkout` Kernel route vs `checkout.Layout` slot
   mounted by the storefront — the reserved-route answer in 03 held up; keep
   it Kernel-mounted.
