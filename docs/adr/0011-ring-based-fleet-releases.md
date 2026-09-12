# ADR 0011: Ring-based fleet releases with artifact promotion

- Status: Proposed
- Date: 2026-09-11

## Context

A Kernel release means "rebuild all storefront artifacts and get them live".
Doing this as N independent deploys is unmanageable; doing it as one big-bang
is reckless. We need the rollout itself to be a first-class, gated, reversible
operation.

## Decision

Fleet releases run as **trains**: build all affected artifacts once (immutable,
content-addressed), then promote through rings — `canary` (Venduá-owned
stores) → `early` (~10%) → `stable` — with health gates between rings
(conformance green, soak time, checkout-rate baseline). Rollback is always
re-promoting the previous artifact — seconds, scoped per store or per ring.

Cadence: biweekly trains; hot-trains for emergencies (skip soaks, keep ring
order).

## Consequences

### Positive

- Blast radius of a bad Kernel release is bounded by ring size, not by hope.
- Rollback is trivially safe because artifacts are immutable — no "roll forward
  or rebuild" panic.
- Gates are health metrics, not approvals — the train advances itself or halts
  itself; humans intervene on anomaly.
- Predictable cadence makes "when does my store get feature X" answerable.

### Negative / costs

- A fleet train at N=1000 is ~5000 CI minutes — a scheduling problem, solved by
  self-hosted runners + remote cache.
- Ring membership is a real product decision (early-ring merchants get features
  first and bugs first — consider a discount for volunteers).
- Soak times add latency between "Kernel shipped" and "fleet has it" (~3 days
  to stable) — accepted; SDUI covers the must-arrive-now cases.

## Alternatives considered

- **Per-store deployment pipelines**: N pipelines to babysit; no shared gates;
  rejected.
- **Big-bang promotion of all artifacts**: one bad release = fleet-wide
  incident at dinner rush; rejected.

## Links

- [architecture/09-migrations-and-fleet-trains](../architecture/09-migrations-and-fleet-trains.md)
- [architecture/07-deployment-and-hosting](../architecture/07-deployment-and-hosting.md)
