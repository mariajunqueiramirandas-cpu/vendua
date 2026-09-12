# ADR 0004: Checkout and system surfaces are Kernel-owned

- Status: Proposed
- Date: 2026-09-11

## Context

The platform promise is "arbitrary frontend code" — but some surfaces carry
disproportionate risk if re-implemented per storefront: checkout (payment
handling, PIX, Bricks PCI scope, address validation, delivery quoting,
idempotent order submission), order tracking, consent, and system notices.
A buggy custom checkout is the highest-variance, highest-blast-radius output a
generation agent can produce — and the merchant experience of a broken payment
flow is indistinguishable from "Venduá is broken".

## Decision

Checkout and all system surfaces are **owned by the Kernel**: flow, state,
validation and payment SDK mounting are platform code. Storefronts customize
through design tokens (always) and a bounded set of typed slots (optional) —
`checkout.Summary`, `checkout.Layout`, `checkout.SuccessPage`, etc. — whose
overrides are presentational-only and error-boundaried back to defaults.

## Consequences

### Positive

- Payment correctness, PCI scope and idempotency are engineered once, audited
  once, and inherited by every storefront.
- Checkout improvements (new payment method, new step) ship via SDUI/Kernel to
  the whole fleet — including stores never touched since launch.
- Agents can't hallucinate a payment flow: there is no sanctioned place to
  write one.
- Uniform funnel analytics at the highest-value step of the funnel.

### Negative / costs

- "100% custom" is not literally true — checkout structure is shared. The
  honest product framing: the parts that are identical in every restaurant are
  the parts no brand wants custom anyway; and every pixel of checkout is still
  themeable + slot-overridable.
- Slot design becomes critical platform work: a too-small slot set frustrates
  premium stores; too-large invites behavior smuggling. Registry governance is
  in [04](../architecture/04-extensions-and-overrides.md).

## Alternatives considered

- **Fully custom checkout per storefront**: maximum freedom, unbounded risk;
  also breaks every fleet-shipping guarantee for payment features.
- **Hosted checkout redirect (MP-style)**: breaks the premium illusion — the
  whole point is that the experience stays in-brand.

## Links

- [architecture/04-extensions-and-overrides](../architecture/04-extensions-and-overrides.md)
- [architecture/05-system-surfaces](../architecture/05-system-surfaces.md)
