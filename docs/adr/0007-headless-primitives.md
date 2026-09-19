# ADR 0007: Headless primitives are the commerce API

- Status: Proposed
- Date: 2026-09-11

## Context

Three hard requirements collide in storefront code: (1) commerce behavior must
be correct everywhere (no sold-out orders, no ordering while paused); (2) QA
must drive arbitrary designs deterministically; (3) analytics must produce a
uniform funnel across all stores. The naive approach — "agents, please remember
to add `data-vendua` attributes and call the hooks correctly" — fails
statistically: across 1000 generated storefronts, some percentage forget.

## Decision

Commerce behavior is expressed only through **headless primitives** —
`AddToCart`, `QuantityStepper`, `CartTrigger`, `CheckoutButton`,
`ProductLink`, `StoreStatusBadge`, `NotifyMeButton`, `Img` — which own the
behavior (mutations, disabled states, events, test hooks, ARIA) and delegate
100% of visuals via `asChild`/render props. The Contract requires primitives
for commerce triggers; lint + conformance enforce it.

## Consequences

### Positive

- Correctness is inherited: paused/sold-out/zone states are handled once, in
  the primitive — storefronts literally cannot forget them.
- `data-vendua` hooks are stamped by the primitive: the Conformance Suite works
  on any design without per-store selectors.
- Uniform funnel analytics is automatic — instrumentation is behavior.
- Agents get a _small, legible_ API surface: use the primitive, style it
  however you want. Fewer ways to be wrong.

### Negative / costs

- Primitive API design is load-bearing for years — `asChild` ergonomics and
  slot composition must be right; budget real design time here.
- Some exotic interactions won't fit a primitive cleanly; the answer is a new
  primitive or a composition pattern, never a bypass (the Contract forbids
  parallel implementations).

## Alternatives considered

- **Convention (`data-vendua` attributes)**: unenforceable statistically;
  QA and analytics degrade per-store.
- **Styled component library**: binds behavior to looks — kills the design
  freedom that is the product.

## Links

- [architecture/02-kernel — primitives](../architecture/02-kernel.md#primitives)
- [architecture/10-qa-pipeline](../architecture/10-qa-pipeline.md)
- [architecture/15-analytics](../architecture/15-analytics.md)
