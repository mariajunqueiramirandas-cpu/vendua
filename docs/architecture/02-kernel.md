# 02 — The Kernel

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0004](../adr/0004-kernel-owned-checkout.md), [ADR 0007](../adr/0007-headless-primitives.md)

The Kernel is the shared frontend runtime every storefront builds on. It is the
**only** supported way for a storefront to interact with commerce behavior. It
contains **no business rules** — every rule lives in Core; the Kernel fetches,
caches, renders and delegates.

## Packages

| Package               | Contents                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@vendua/kernel`      | `VenduaProvider`, API client, query/cache layer, hooks, primitives, `<SystemSurfaces />`, overrides registry, analytics beacon, error boundaries |
| `@vendua/ui-defaults` | Token-driven default implementations of every system surface and slot                                                                            |
| `@vendua/cli`         | `scaffold`, `dev`, `check`, `build`, `qa`, `preview` — the only supported build path                                                             |
| `@vendua/conformance` | The shared Playwright suite + lint rules + type tests                                                                                            |
| `@vendua/codemods`    | Contract migration transforms                                                                                                                    |
| `@vendua/loader`      | Source of `v.js`, built and versioned separately from the Kernel                                                                                 |

Packages are private workspace dependencies — storefronts live in the same
monorepo, nothing is published to a registry. Kernel internals are hidden behind
the package `exports` map; deep imports are impossible by construction and also
lint-checked.

## Provider tree (what every storefront root mounts)

```tsx
<VenduaProvider config={config}>   // tenant context, api client, query cache
  <SystemSurfaces />               // server-driven surfaces: notices, blocking,
                                   // consent, emergency overlay mount point
  <App />                          // storefront's own routes — arbitrary code
</VenduaProvider>
```

`VenduaProvider` resolves tenant context at boot from the injected
`window.__VENDUA_STATE__` (edge-injected; see
[07](07-deployment-and-hosting.md#the-edge)) and hydrates the query cache
with it — so `useStoreStatus()` is correct on first paint with zero flicker.

## Hooks (v1 surface)

Data hooks are thin typed wrappers over Core reads (TanStack Query underneath).
Mutation hooks hit `/checkout/v1` and return typed errors.

| Hook                              | Returns                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `useStore()`                      | store profile, hours, status (`open/closed/paused`, `resumesAt`) |
| `useCatalog()` / `useProduct(id)` | catalog tree / single product incl. variants & modifiers         |
| `useCart()`                       | server cart: items, totals, session state                        |
| `useCartMutations()`              | `add`, `updateQty`, `remove`, `applyCoupon`, `clear`             |
| `useDeliveryQuote()`              | zone check, fee, ETA for an address                              |
| `useCheckout()`                   | checkout session state machine + `submit()`                      |
| `useOrder(id)`                    | order status + timeline (poll/stream)                            |
| `useNotices()`                    | resolved notices for the current surface context                 |
| `useCustomer()`                   | customer session (phone OTP), addresses                          |
| `useAnalytics()`                  | `track(name, props)` for allow-listed custom events              |

Rules: hooks never compute prices or eligibility locally; they surface Core's
answer. Typed error codes (`STORE_PAUSED`, `OUT_OF_ZONE`, `SOLD_OUT`…) map to
default surfaces automatically when the storefront doesn't handle them.

## Primitives

Headless, Radix-style components that own **behavior** and delegate all visuals
to the storefront via `asChild` or render props. This is how "arbitrary design"
coexists with uniform behavior, testability and analytics — the storefront never
re-implements commerce logic and can never forget a test hook.

Each primitive MUST stamp its `data-vendua` hook and ARIA semantics regardless
of the delegated child.

| Primitive          | Behavior owned by Kernel                                                              | Stamps                          |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------- |
| `ProductLink`      | product route resolution, prefetch, `product_view` event                              | `data-vendua="product-link"`    |
| `AddToCart`        | disabled when paused/sold-out, mutation, optimistic state, `add_to_cart` event        | `data-vendua="add-to-cart"`     |
| `QuantityStepper`  | min/max, stock cap, debounced mutation                                                | `data-vendua="qty-stepper"`     |
| `CartTrigger`      | opens cart drawer/page, badge count                                                   | `data-vendua="cart-trigger"`    |
| `CheckoutButton`   | starts checkout session, disabled states                                              | `data-vendua="checkout-button"` |
| `StoreStatusBadge` | live open/closed/paused + countdown                                                   | `data-vendua="store-status"`    |
| `NotifyMeButton`   | "avise-me" subscription for paused/sold-out                                           | `data-vendua="notify-me"`       |
| `Img`              | CDN-backed responsive images, blur-up, budgets                                        | —                               |

Closed vs paused is asymmetric: `paused` blocks ordering (manual hold), while
`closed` still accepts orders as pre-orders for the next window — Core rejects
`STORE_PAUSED` but lets `closed` through. Primitives disable on `paused`, not
`closed`; the closed state is surfaced via `StoreStatusBadge`/notices instead.

```tsx
// Storefront code — full visual freedom, zero behavioral freedom:
<AddToCart product={p} asChild>
  <motion.button whileTap={{ scale: 0.94 }} className="my-wild-cta">
    Quero esse ✦
  </motion.button>
</AddToCart>
```

Primitives are the reason the Conformance Suite works on arbitrary designs: the
suite drives `data-vendua` selectors that primitives guarantee, not selectors
each storefront remembers to add.

## `<SystemSurfaces />` and the overrides registry

`SystemSurfaces` renders all server-driven surfaces (see
[05](05-system-surfaces.md)) at fixed mount points: global banner stack,
blocking overlay, consent, and inline surface regions that brand pages may place
explicitly (e.g. `<SurfaceRegion name="product.notices" />`).

For each surface it consults the overrides registry: if the storefront declared
an override for the resolved slot, the override renders **inside an error
boundary**; on any thrown error or contract violation the Kernel default
renders instead. An outdated or buggy override therefore degrades to generic —
never to broken.

## Design tokens

`vendua.config.ts → tokens` is compiled to CSS variables on `:root`
(`--v-color-*`, `--v-font-*`, `--v-radius-*`, `--v-space-*`, `--v-motion-*`).
All Kernel defaults consume these variables, so a storefront that overrides
_nothing_ still gets surfaces in its own colors, type and radii. Token coverage
is what protects the "premium software house" illusion on never-touched stores.
See [04](04-extensions-and-overrides.md#design-tokens).

## CSS isolation

Storefronts run arbitrary CSS, including aggressive resets. Kernel UI is
therefore isolated:

- All Kernel default styles live in `@layer vendua` with `v-`-prefixed classes
  and declare their own resets locally — they must not depend on, or leak into,
  storefront styles.
- The `v.js` loader renders in Shadow DOM — fully insulated even from a broken
  page.
- Conformance includes a "hostile CSS" fixture: a reset-and-everything page
  must not break Kernel defaults.

## Analytics instrumentation

Primitives and surfaces emit the standard event taxonomy automatically
([15](15-analytics.md)). Storefronts get fleet-comparable funnels for free;
custom events go through `useAnalytics().track()` against an allow-listed
namespace. No third-party trackers in Kernel; consent gating is a system
surface (`system.ConsentBanner`).

## What the Kernel MUST NOT contain

- Pricing, discount, delivery-fee or tax math (Core computes; Kernel renders).
- Business rules (minimum order, availability windows, zone logic).
- Direct payment-provider SDK usage outside the Kernel-owned checkout flow.
- Fetching from storefront code paths — all network access goes through the
  Kernel client so auth, retries, caching and error mapping are uniform
  (enforced by lint: no `fetch`/`axios`/API imports outside `@vendua/*`).
- Per-tenant conditionals (`if (tenant === 'x')`). Customization is tokens,
  overrides, or storefront code — never Kernel branches.
