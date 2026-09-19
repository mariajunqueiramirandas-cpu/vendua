# 09 — Migrations and Fleet Trains

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0008](../adr/0008-contract-versioning.md), [ADR 0011](../adr/0011-ring-based-fleet-releases.md)

How change reaches the fleet. Two mechanisms cover everything: **fleet trains**
(rebuild + promote, no code change) and **Contract majors** (codemod + train).
The design goal: a train is a boring, scheduled non-event.

## Change classes → process map

| Change                                        | Mechanism                                                 | Storefront code touched?        |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| Backend rule/content                          | Deploy Core. Done.                                        | Never                           |
| New notice kind / SDUI field                  | Deploy Core; generic render covers old Kernels            | Never                           |
| New Kernel default / new slot                 | Kernel minor → fleet train (rebuild all, promote by ring) | Never                           |
| Additive hook/prop                            | Kernel minor → train; adoption optional                   | Never (opt-in)                  |
| Slot rename, config shape change, removed API | Contract major → codemod → train                          | Codemod; failures → agent queue |
| New brand page / redesign                     | Storefront PR (agent or human)                            | That storefront only            |

## Fleet trains

A **train** = "rebuild all affected artifacts on Kernel X and promote through
rings with gates."

1. **Build once**: affected-graph rebuild produces all storefront artifacts in
   one CI run. Artifacts are immutable.
2. **Canary**: Venduá-owned demo/pilot stores promote first. Gate: conformance
   green + 24 h healthy probes + zero new incidents.
3. **Early**: ~10% of stores (volunteer merchants get a small discount for ring
   membership — worth it). Gate: conformance + 48 h probes + checkout success
   rate within baseline.
4. **Stable**: everyone else, promoted in batches with automatic
   halt-on-anomaly (probe failures, checkout-error spike, loader ping drop).
5. **Rollback** is always "promote previous artifact" — seconds, per store or
   per ring, no rebuilds.

Cadence: biweekly. Emergency Kernel fixes get a hot-train that skips soak times
but keeps ring order.

## Contract majors

Rules (normative):

- **At most one major per year.** A major that can't carry a codemod doesn't
  ship.
- **No breaking change merges without**: a codemod in `@vendua/codemods`, a
  conformance test covering the new behavior, and a dual-support plan (Core and
  Kernel support old and new for the window).
- Codemods are **idempotent, scoped, and dry-runnable**: `vendua codemod run
<id> --dry` prints the per-storefront change report; the run is what the
  fleet train executes.
- A major runs as: codemod branch over all `storefronts/*` → typecheck +
  conformance per store → auto-commit green cases → failures go to the agent
  queue with failure bundles → train promotes.
- Expect a **5–15% failure tail** on arbitrary code: agents handle it. Budget
  it; measure it; if a major's tail exceeds ~20%, the codemod wasn't good
  enough — fix the codemod, don't feed the queue.

### Worked example: renaming a slot in Contract v2

- Change: `system.StorePausedNotice` → `system.PauseNotice`, props gain
  `actions[]` (previously hardcoded notify-me).
- Codemod: rewrites `vendua.config.ts` override keys, renames imported file
  references where statically resolvable, inserts `actions` prop forwarding in
  override bodies, renames `data-vendua` slot attributes if hand-styled.
- Kernel 3.x: accepts both slot names for the window (old name aliases new
  implementation); Core keeps serving both payload shapes for N−1.
- Result bands: ~90% rewritten and green automatically; ~10% need an agent
  (dynamic imports, prop spreading the codemod can't prove); <1% need a human.

## Kernel version skew

Reality: at any moment the fleet runs a spread of Kernel versions. Policy:

- Core supports the union of API majors the fleet still runs (N and N−1, ≥12
  months each) — enforced by CI running each supported Kernel line's
  conformance suite against Core `main`.
- Storefronts >2 Kernel minors behind the current train get flagged
  (`kernel_skew` alert); >4 behind block new feature entitlements until rebuilt.
- The Control Plane's `compat_matrix` is the single source of truth for
  "is this storefront allowed to deploy this artifact?" — CI consults it.

## Migration anti-patterns (explicitly forbidden)

- "Just have the agent update all stores" for a routine change — agent time is
  for the failure tail and genuinely new surfaces, not plumbing.
- Per-store feature flags in Kernel — flags live in Core and arrive via SDUI.
- Shipping a Core change that only _new_ Kernels can render — every feature
  needs a generic-render story or it waits for the window.
- Rolling restarts/redeploys as a "migration" — nothing in the fleet is
  restarted by a storefront change; artifacts are promoted.
