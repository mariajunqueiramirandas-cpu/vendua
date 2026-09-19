# Brasa — Phase-0 spike observations

Everything below is a place where the Contract (Core API, Kernel hooks/primitives,
or the platform docs) had to grow to let a real storefront work. Each item says
what I needed, what exists today, and what I did instead. Ordered by how much it
hurt.

## Contract gaps that block real flows

1. **Session dies after one order — no reset exists.**
   `vst.<cartId>.<hmac>` pins the session to a cart. After checkout the cart is
   `completed`, `ensureSession()` returns early because a token exists, and every
   `addItem` 404s with `CART_NOT_FOUND`. There is no `api.clearSession()` — the
   token lives in a closure, so even `sessionStorage.removeItem('vendua.session')`
   can't help. Verified live: a second add renders `CART_NOT_FOUND`. Need either
   `clearSession()` on `VenduaApi` or a Core rule that an open-cart POST auto-mints
   a new cart for a completed-cart token.
   _Workaround: none. ErrorPlate surfaces the 404 honestly; reload fixes it._

2. **`api.order(id)` can never succeed.** `GET /checkout/v1/orders/:id` requires
   `Bearer` auth; `api.order` omits `auth()` → always 401 `SESSION_REQUIRED`. Docs
   mention a `useOrder` hook — it doesn't exist. Direct-nav/reload of the order
   page can't hydrate.
   _Workaround: order data passes via `location.state`; reload falls back to a
   "saiu do gancho" dead state._

3. **No zone catalog.** No endpoint exposes zones/neighborhoods, so checkout can't
   list covered areas — `BAIRROS` is hardcoded from the seed. `useNotices` accepts
   `zoneMatched` but the storefront can't know it without a quote.
   _Need: `GET /storefront/v1/zones` (names, fees, per-zone min, eta) or a
   `useDeliveryZones` hook._

4. **No fee quote without a write.** `POST /checkout/v1/quote` exists in Core but
   no hook exposes it. The only way to learn a fee is `setDelivery`, which mutates
   server state (fine for this flow, wrong for a zone-picker UI). And
   `deliveryFeeCents === 0` is ambiguous — out-of-zone and free-zone are
   indistinguishable; my "bairro ainda não confirmou frete" hint fakes that
   distinction.
   _Need: `useDeliveryQuote(neighborhood)` returning `{matched, feeCents, eta}`._

5. **Sold-out modifiers are accepted.** `status:'sold_out'` renders fine, but
   `addItem` doesn't reject sold-out modifier ids (no `MODIFIER_SOLD_OUT` error —
   `validateItemModifiers` only checks membership). Brasa disables them in the UI,
   but the contract promises Core owns behavior.
   _Need: server reject with an error code; primitive-level disable._

## Kernel/primitive frictions

6. **`asChild` primitives override the child's own props.** `AddToCart` clones with
   `disabled`/`onClick`, silently discarding the child's `disabled` — a storefront
   cannot gate the add button on unmet required modifiers (my `!ready` gate is
   stripped; only Core's `MODIFIER_REQUIRED` 422 remains). Same on `CartTrigger`
   (child `onClick` replaced by `onOpen` behavior).
   _Need: `disabled` prop union, or a render-state `{disabled, reason}` passed down._

7. **`useCart().loading` never resolves before a session.** Without a token the
   fetcher resolves `undefined` → `loading` stays `true` forever → "loading" vs
   "empty" are indistinguishable, and `cart === undefined` also means both.
   _Need: resolve `null` for no-session; or an explicit `status` on the hook._

8. **`CartTrigger` count reads completed carts.** After checkout the kernel's
   internal count still sums the completed cart (`aria-label` says "1 itens" on an
   empty comanda). Storefront can't override the stamped label/count.
   _Need: count only `status:'open'`, or expose `itemCount` slot._

9. **Data hooks expose no `refetch`.** Retry = page reload. Error states on the
   board ("reler o quadro") reload because there's no other lever.
   _Need: `refetch` on every read hook._

10. **`useCheckout` returns only `submit`** — no `pending`/`error`/`reset`, so each
    storefront re-implements submission state.

11. **`@vendua/kernel/src/styles.css` isn't resolvable.** The exports map only
    defines `.` and `./config`; the documented CSS path 404s.
    _Workaround: relative import `../../../packages/kernel/src/styles.css`._
    _Fix: add `"./src/styles.css"` (or `./styles.css`) to exports._

12. **Kernel types hide live fields.** `ProductDetail` omits `figureVariant` and
    `tags` — both returned by Core. `CartItem` has no `slug`-level `status`
    snapshot. Untyped-but-present fields are a trap.
    _Need: types that match the wire, or `extra` passthrough._

13. **No media surface.** Products have no image/asset field at all; merchandising
    is text-only. `figureVariant` hints at intent but isn't consumable.

## Notices / surfaces

14. `store_closed` warning renders correctly (title/body/dismiss) and `store_paused`
    blocking overlay works. Two wishes:
    - `payload.region` never set by Core — `SurfaceRegion` zones (`catalog.notices`)
      get nothing; only kind-matching works. A `region` field on notices would let
      `promo`/upsell notices land mid-board instead of top-banner only.
    - No `resumesAt` payload on the closed notice — it's embedded in `body` copy,
      so a storefront can't restyle the countdown (e.g. "abre em 12min").

15. **Missing `useCheckout` states for closed/paused**: `closed` still allows
    checkout (pre-order?) while `paused` blocks it — the difference is a product
    decision Core should document; `AddToCart` disables on paused but not closed.

## Docs / setup accuracy

16. **Reserved route prefixes collide with page routes.** `/checkout` and
    `/storefront` are proxied API prefixes — a checkout page can't live at
    `/checkout`. Brasa's checkout is `/fechar`. Contract should list reserved
    prefixes (or mount API on a subdomain).

17. **Vite proxy docs are subtly wrong.** "changeOrigin:false (default preserves
    Host)" is true only for object-form proxy config; the string shorthand
    `proxy:{'/storefront':'http://localhost:8787'}` _forces_ `changeOrigin:true`
    (vite dist normalizes it), rewriting Host to `localhost:8787` →
    `TENANT_NOT_FOUND`. Spell out the object form in the contract.

18. **`resumesAt` granularity is a 30-min probe.** Closed-store `resumesAt` said
    "20:36" while real open is 20:30 (probe rounds to half-hour boundaries). If
    it's meant as "next open," Core should compute from the hours table, not the
    probe grid — customers read it as a promise.

19. **No error contract for checkout field failures.** `INVALID_CUSTOMER`/
    `INVALID_DELIVERY`/`INVALID_PAYMENT` arrive as generic `message` strings —
    no `details.field`, so inline field-level errors can't be placed next to the
    offending input. _Need: `details: {field: 'customer.phone'}`._

20. **Copy that should come from Core:** error messages are English machine copy
    ("cart not found or already completed"); every storefront rewrites them into
    brand voice — fine — but the _semantic_ mapping table (code → what happened)
    lives only in `modules/`. A `ERROR_CODES` enum + details schema exported from
    `@vendua/kernel` would stop each storefront from reverse-engineering it.

## Things that worked exactly as promised

- Required `Ponto` group: `MODIFIER_REQUIRED` fires honestly, `minSelect/maxSelect`
  drive the radiogroup-vs-checklist choice cleanly.
- `setDelivery` repricing: typing "Gamboa" → `deliveryFeeCents:600` and
  `totalCents` update in the same cart payload — no client math needed.
- `belowMinOrder` + `minOrderCents` in totals — the "faltam R$18" meter is pure
  Core data.
- `status_override` on `store_settings` cleanly flips open→closed→paused for
  verification.
- Order `timeline` + `delivery.etaMin/etaMax` + `payment.instructions` all arrive
  on the order object — the receipt page needed zero Core assumptions.
