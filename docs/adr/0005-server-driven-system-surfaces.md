# ADR 0005: System surfaces are server-driven

- Status: Proposed — brand-page boundary amended by [ADR 0018](0018-page-composition.md)
- Date: 2026-09-11

## Context

The central operational requirement: a feature like "store paused, orders
return at 18:00" must reach storefronts that were built months ago and never
updated — without rebuilding them. If system surfaces exist only as compiled
Kernel components, then (a) they only exist in Kernel versions that contain
them, and (b) delivering them requires N rebuilds. Old storefronts simply never
get the feature — the exact failure mode the architecture exists to prevent.

## Decision

System surfaces (notices, blocking states, checkout structure, order timeline,
consent, legal) are **server-driven**: Core emits typed payloads (the SDUI
envelope), the Kernel renders them through a generic renderer with optional
specialized slots, and the edge injects the blocking subset into HTML so first
paint is already correct. Unknown kinds/severities/action types degrade to
generic renderings per fixed rules.

This is deliberately bounded: SDUI applies **only** to system surfaces. Brand
pages are real code and never go through a JSON schema.

> **Amended by [ADR 0018](0018-page-composition.md):** brand pages become
> templates, meaning data listing sections and blocks. The design inside a store
> section stays real code. Only the page's composition is data; visuals are
> never rendered from a schema.

## Consequences

### Positive

- Feature _existence_ reaches every storefront ever shipped, immediately,
  independent of Kernel version.
- Core owns "when and whether" — the layer we control continuously.
- The generic-render path converts version skew from a breaking problem into a
  cosmetic gradient (generic now, polished after the next train).
- Same pipeline doubles as incident comms and kill-switch messaging.

### Negative / costs

- Discipline cost: every new `kind` must be authored so generic rendering is
  acceptable — copy, actions, severity — which constrains design ambition for
  day-0 behavior.
- Two render paths per feature (generic + specialized) means two things to
  test; conformance fixtures carry this.
- Temptation to creep SDUI into brand surfaces — must be resisted; the moment
  it does, storefronts stop being bespoke.

## Alternatives considered

- **Compile-time only** (Kernel components, no SDUI): simpler, but a feature
  then requires N rebuilds and never reaches stale stores — fails the core
  requirement.
- **SDUI for everything** (full page builder): kills the differentiator.

## Links

- [architecture/05-system-surfaces](../architecture/05-system-surfaces.md)
- [architecture/00-overview — feature ladder](../architecture/00-overview.md#how-a-global-feature-ships-the-ladder)
