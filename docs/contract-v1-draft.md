# Contract v1 — draft (from Phase 0 observations)

> Status: **Superseded — frozen into [03](architecture/03-storefront-contract.md)
> as Contract v1** (2026-09-19). Kept as Phase-0 provenance; where this draft
> and 03 disagree, 03 wins. This is the Phase 0 exit artifact:
> Contract v1 written from _observed_ needs (docs/roadmap.md). It refines
> [03 — The Storefront Contract](architecture/03-storefront-contract.md); where
> they disagree, this draft records what the spikes proved we need.
>
> Sources: `storefronts/quero-pudim/OBSERVATIONS.md`,
> `storefronts/brasa/OBSERVATIONS.md`, `storefronts/forn/OBSERVATIONS.md` —
> three feature-complete storefronts driven entirely through this contract.

Everything in 03 remains normative. This draft adds what building the spike
storefronts on the skeleton showed was missing. Items marked **(landed)** were
already implemented in `packages/core`/`packages/kernel` during Phase 0 — the
contract caught up to them; the rest are candidates for the v1 freeze.

## API surface — observed

| Endpoint                             | Change                                                                                                                                                                       | Status / why (observed)                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /store`                         | `vocabulary` + `currency` **(landed)**; `resumesAt` on `closed` covers next-open **(landed)**; v1: `pixKey`/`pixBeneficiary`                                                 | Per-tenant copy is real ("doce"/"sacola"); pix details needed for confirmation UX |
| `GET /catalog`                       | `figureVariant`, `tags[]`, `imageUrl?`, `stockQuantity?`, `lowStockThreshold?`                                                                                               | Imagery + stock badges; first two landed, rest are v1 candidates                  |
| `GET /storefront/v1/zones`           | `name, neighborhoods, feeCents, etaMin/Max, minOrderCents`                                                                                                                   | **(landed)** — zone UX without it was guesswork                                   |
| `POST /checkout/v1/quote`            | `api.quote(neighborhood)` client                                                                                                                                             | **(landed)** — non-mutating fee preview                                           |
| `POST /session`                      | Re-attaches open carts, rotates spent tokens                                                                                                                                 | **(landed)** — one-order-then-stuck was the worst spike bug                       |
| `GET /orders/:id`                    | session-auth'd + scoped to the session's cart (landed); v1: + `items[]`, `trackingUrl`, `whatsappLink`, `notes`                                                              | My-orders + confirmation pages need items/share without sessionStorage snapshots  |
| `GET /customer/orders`               | NEW — `?phone=` order history                                                                                                                                                | "Sem senha" my-orders across devices                                              |
| `POST /storefront/v1/waitlist`       | NEW — `{ productId, phone }`                                                                                                                                                 | Sold-out waitlist is a real conversion flow                                       |
| `POST /checkout/v1/coupons/validate` | NEW — `discountCents` on cart totals                                                                                                                                         | Coupon field exists in reference checkout                                         |
| `CheckoutInput`                      | + `notes`, + structured `delivery.address` (street/number/complement/cep), + `scheduledFor`                                                                                  | Order notes and real addresses observed; preorder for encomendas                  |
| `POST /checkout`                     | 409 `CART_NOT_OPEN` on a non-open cart **(landed)**; advisory-locked tenant order numbering; availability re-validated at pay **(landed)**                                   | forn produced a real duplicate order before the guard                             |
| `POST /checkout` response            | `payment.pixQrcodePayload?`, `expiresAt?`                                                                                                                                    | Pix copy/QR on confirmation                                                       |
| `POST /checkout/v1/price-preview`    | NEW — Core-priced cart preview for a product + modifier selection                                                                                                            | Lets product-page CTAs show an authoritative total without client-side money math |
| Combos                               | NEW `combos` entity (slots with per-slot min/max, qtyPerItem)                                                                                                                | Kits/encomendas UX can't be expressed by flat modifier groups                     |
| Notices                              | `payload.resumesAt` (landed); `payload.region` for `SurfaceRegion` targeting                                                                                                 | Countdown styling; mid-catalog promo placement                                    |
| Security posture                     | session Bearer on checkout routes; order read cart-scoped; `Idempotency-Key` claims atomic; `X-Vendua-Control` gate on `/control`; fixed-window rate limit on `/checkout/v1` | All landed in the PR-review pass — becomes Contract invariant                     |

## Kernel additions observed

| Piece                                 | Kind       | Status / note                                                                               |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `useOrder(id)`                        | hook       | **(landed)** with `refetch`; poll interval option is the v1 question                        |
| `useDeliveryZones()`                  | hook       | **(landed)**                                                                                |
| `useCheckout` `{pending,error,reset}` | hook state | **(landed)** — `error.details.field` for inline form errors                                 |
| `refetch` on all read hooks           | hook       | **(landed)**                                                                                |
| `ERROR_CODES` + `details` schema      | export     | **(landed)** — synced to Core's emitted set incl. `RATE_LIMITED`, `IDEMPOTENCY_IN_PROGRESS` |
| `formatCents`                         | util       | **(landed)** — currency-aware, `pt-BR` default; `formatBRL` alias dropped                   |
| `useQuery` cache/refetch              | hook       | **(landed)** — per-provider cache; `refetch` routes through `invalidate`                    |
| `invalidateQuery`                     | export     | **(landed)** — storefronts can clear cache after custom flows                               |
| `NoticeOverrideProps`                 | type       | **(landed)** — `{ notice, onDismiss? }` for `system.*` overrides                            |
| `cart.Drawer` + `cart.LineItem`       | defaults   | No-override store currently has no cart UI                                                  |
| `ModifierPicker`                      | primitive  | Enforces required/min/max client-side, produces `modifierIds`                               |
| `checkout.Layout`                     | slot       | Kernel-owned checkout; storefronts keep rebuilding the 3-step flow                          |
| `system.PromoNotice`                  | slot key   | Kind-camelization already produces it; add to `SLOT_KEYS`                                   |
| Realtime order updates                | hook       | `useOrder(id, {poll})` covers Phase 0; SSE wrapper is Phase 1+                              |
| Font loading rule                     | contract   | `font.srcs` in config → Kernel `@font-face`; files in `assets/fonts/`                       |
| `importCart(items)` / `?cart=`        | primitive  | Cross-device cart share links                                                               |

## Contract rules — corrections from the spikes

- **Reserved route prefixes must be listed**: `/checkout/v1`, `/storefront/v1`,
  `/v1` are API mounts — page routes can't use them (brasa's checkout lives at
  `/fechar`). The bare `/checkout` vite proxy key swallows SPA routes on
  refresh; the contract should mandate `'/checkout/v1'` (narrow form).
- **Vite proxy must be object-form** — string shorthand normalizes to
  `changeOrigin:true` and rewrites `Host` → `TENANT_NOT_FOUND`.
- **`useCart` semantics**: `cart: Cart | null`, `loading` resolves without a
  session, `CartTrigger` counts only `status:'open'`.
- **asChild composition contract**: primitives chain `onClick`, merge
  `className`, OR `disabled`, and child `aria-*`/`data-*` win over
  primitive defaults — child props are never silently discarded.
  `data-vendua` is always the primitive's marker.
- **Closed vs paused** is a product decision, not an accident: `closed` allows
  checkout (pre-order for next open), `paused` blocks. Document it.

## What Phase 0 did NOT need (recorded so nobody adds it speculatively)

- Multi-language notice copy — pt-BR only; `Notice.body` stays server copy.
- Storefront-defined pages outside `routes/` — the file layout held.
- Client-computed prices — never needed; Core's priced cart was sufficient.
- Loyalty points mechanics beyond display — display came up; the mechanics
  defer with the program itself.

## Open questions for Phase 1 freeze

1. ~~`opensAt` on `/store` vs only in `store_closed` payload~~ — resolved
   Phase 0: `closed` sets `resumesAt` to the next window boundary; both the
   field and the notice payload carry it.
2. ~~Vocabulary scope~~ — resolved at freeze: free-form
   `Record<string, string>`; no inflected-forms registry in v1.
3. ~~`figure`/`imageUrl` format~~ — resolved at freeze: `figureVariant` motif
   enum is landed; `imageUrl`/`stockQuantity` land as additive Core fields.
4. ~~Orders-by-phone~~ — resolved at freeze: deferred; ships only behind
   phone verification (OTP or tight rate limit). Not in v1's required surface.
5. ~~`useOrder` poll interval~~ — resolved at freeze: v1 polling is
   storefront-driven `refetch`; SSE arrives as an additive hook option later.
