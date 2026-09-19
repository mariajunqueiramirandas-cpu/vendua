# 04 — Extensions and Overrides

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0004](../adr/0004-kernel-owned-checkout.md), [ADR 0008](../adr/0008-contract-versioning.md)

The extension system is how a storefront makes _platform-owned_ surfaces look
like _its own_ design — without ever owning their behavior.

## The slot model

A **slot** is a named, typed extension point with a Kernel default
implementation. Slots exist for system surfaces and for a small set of
commerce-structural components where layout genuinely varies by brand.

- Slot names are namespaced: `<domain>.<Component>` —
  `system.*` (notices, blocking, consent, errors), `checkout.*`, `cart.*`,
  `order.*`, `store.*`, `catalog.*`.
- Each slot has a **typed props contract**: data in, callbacks out. Props are
  additive-only within a Contract major — Kernel may add optional props, never
  remove or retype.
- Every slot renders inside a Kernel **error boundary**. If an override throws,
  renders invalid output, or violates its contract, the Kernel default renders
  and the failure is reported to the Control Plane. **An outdated override
  degrades to generic, never to broken.**

## Override rules

Overrides MUST be presentational:

- Receive all data via props; receive intent callbacks (`onAction`, `onDismiss`,
  `onSelect`). They MUST NOT fetch, MUST NOT import the API client, MUST NOT
  call mutations outside the provided callbacks. (Lint-enforced.)
- MUST render within their props' semantics — e.g. a `checkout.Summary`
  override cannot hide the total or the delivery fee; conformance checks the
  required `data-vendua` sub-hooks it must forward.
- MUST be reachable: declared in `vendua.config.ts → overrides` with lazy
  imports so unviewed surfaces cost no JS.
- SHOULD consume design tokens (`var(--v-*)`) rather than hardcode brand values,
  so token changes propagate.

## Slot registry — v1 (design sketch)

The initial registry. Each entry: props summary + what the default does.
Additions are additive (new slots appear with defaults — old stores unaffected).
Renames require a Contract major + codemod + alias window.

| Slot                       | Props (sketch)                        | Default behavior                                                                                       |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `system.Notice`            | `notice: Notice; onDismiss; onAction` | Generic notice card (info/warning/blocking) — **the guaranteed fallback for every future notice kind** |
| `system.StorePausedNotice` | `notice; resumesAt; onNotifyMe`       | Blocking banner + countdown + notify-me                                                                |
| `system.StoreClosedNotice` | `notice; opensAt`                     | Non-blocking closed banner with next-opening time                                                      |
| `system.ConsentBanner`     | `purposes[]; onAccept; onReject`      | LGPD consent bar, token-styled                                                                         |
| `system.ErrorFallback`     | `error; retry`                        | Generic recoverable error panel                                                                        |
| `system.NotFound`          | `path`                                | 404 page within the storefront shell                                                                   |
| `system.EmergencyOverlay`  | `notice`                              | Loader-rendered last-resort overlay (see `v.js`)                                                       |
| `checkout.Layout`          | `steps; current; children`            | Step shell (address → delivery → payment → review)                                                     |
| `checkout.Summary`         | `cart; deliveryFee; total`            | Order summary block                                                                                    |
| `checkout.AddressForm`     | `value; onChange; errors`             | Address form (validation stays in Kernel)                                                              |
| `checkout.DeliveryOptions` | `options[]; selected; onSelect`       | Delivery/pickup picker                                                                                 |
| `checkout.PaymentMethods`  | `methods[]; selected; onSelect`       | PIX/card method picker (Bricks mount inside)                                                           |
| `checkout.SuccessPage`     | `order`                               | Order confirmation page                                                                                |
| `checkout.EmptyCart`       | `onBrowse`                            | Empty-cart state                                                                                       |
| `cart.Drawer`              | `cart; onClose; onCheckout`           | Cart drawer shell                                                                                      |
| `cart.LineItem`            | `item; onQty; onRemove`               | Cart line layout                                                                                       |
| `order.StatusPage`         | `order; timeline`                     | Order tracking page shell                                                                              |
| `order.Timeline`           | `events[]`                            | Timeline component                                                                                     |
| `store.HoursTable`         | `hours`                               | Opening-hours display                                                                                  |
| `catalog.ProductCard`      | `product; onOpen`                     | Default product card for listing regions                                                               |
| `catalog.ModifierPicker`   | `groups; value; onChange; errors`     | Variant/modifier selection UI                                                                          |

Registry maintenance rules:

- **New slot** = minor Kernel release; storefronts adopt optionally.
- **New required props on an existing slot** = forbidden; use optional props or
  a new slot.
- **Rename/remove** = Contract major; Kernel keeps the old name aliased to the
  new implementation for one major and the codemod rewrites registrations.
- Every slot ships with a conformance fixture that renders it with canonical
  props — so a codemod can verify overrides still typecheck and render.

## Design tokens

Tokens are the _cheap_ override: they make Kernel defaults look on-brand with
zero component code. They are also what the generation agent fills in first
from the DesignSpec.

```ts
tokens: {
  color:  { bg, surface, text, muted, accent, onAccent, danger, success },
  font:   { display, body, mono },
  radius: { sm, md, lg },
  space:  { scale },            // rem scale or explicit steps
  motion: { duration, easing }, // used by defaults' transitions
}
```

Emitted as `:root` variables (`--v-color-accent`, `--v-font-display`, …).
Kernel defaults reference **only** these variables — they carry no hardcoded
brand values of their own beyond neutral fallbacks. Contrast between
`text`/`bg` and `accent`/`onAccent` is validated at build (WCAG AA on default
surfaces; a failing token pair blocks release — accessibility is not optional).

Two levels of token adoption by storefronts:

- **Required**: tokens are fully populated (scaffold derives a sane set; the
  generation agent refines from the DesignSpec).
- **Recommended**: storefront CSS reuses `var(--v-*)` so surfaces and custom
  code share one visual language.

## Deprecation lifecycle

`available → deprecated → removed (next major)`

- Deprecation is announced in Kernel release notes + a lint warning naming the
  replacement and the codemod id.
- Aliased slots keep working for exactly one major; the codemod deletes the
  alias usage.

## Lint rules (enforced by `vendua check`)

- `vendua/no-direct-fetch` — no `fetch`/axios/Core imports outside `@vendua/*`.
- `vendua/no-deep-kernel-imports`.
- `vendua/override-purity` — overrides can't import mutation hooks/API client.
- `vendua/require-primitives` — commerce triggers must be primitives (heuristic:
  buttons whose handler matches cart/checkout patterns; plus explicit JSX
  checks).
- `vendua/no-v-namespace` — storefront CSS must not target `v-*`/`[data-vendua]`.
- `vendua/valid-slots` — override keys must exist in the registry for the
  declared Contract major.
