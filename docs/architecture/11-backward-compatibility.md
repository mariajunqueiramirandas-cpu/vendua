# 11 — Backward Compatibility

> Status: Proposed · Last reviewed: 2026-09-11
> Decision: [ADR 0008](../adr/0008-contract-versioning.md)

At any moment the fleet is a matrix of Core API versions × Kernel versions ×
Contract majors. Compatibility is an engineered property with explicit rules
and CI enforcement — not a hope. The invariant to protect:

> **A storefront that no one has touched in a year must keep working, keep
> receiving backend features, and keep passing conformance.**

## The three version axes

| Axis | Versioned as | Who declares it | Compatibility rule |
| --- | --- | --- | --- |
| **Core API** | integer major per surface (`/storefront/v1`) | Core | N and N−1 supported ≥12 months; additive-only within a major |
| **Kernel** | semver (`@vendua/kernel@2.4.1`) | storefront artifact manifest | minors/patches are non-breaking by definition; majors only via Contract major |
| **Contract** | integer (`contract: 1`) | `vendua.config.ts` | majors ≤1/year, always with codemod + dual-support window |

Why three axes: they evolve at different speeds. API fields change weekly;
Kernel internals monthly; the Contract almost never. Collapsing them into one
number forces either frozen APIs or constant "breaking" releases — both fatal
at fleet scale.

## Compat matrix

The Control Plane holds the authoritative matrix:

```
contract_major | kernel range   | core api majors
1              | >=1.0 <4.0     | [1]
2              | >=3.0 <5.0     | [1, 2]   ← transition windows overlap
```

CI consults it: a storefront may only build/deploy artifacts whose declared
Contract major × resolved Kernel version × Core API majors form a valid row.

## Rules — Core

1. Additive-only within a major: new fields, enum values, endpoints, notice
   kinds, action types.
2. Enum fields are open on the wire — consumers MUST tolerate unknowns
   (SDUI generic-render rules, [05](05-system-surfaces.md)).
3. Removing/renaming/retyping = new major; old major lives ≥12 months after
   the last storefront artifact using it is gone from the fleet (Control Plane
   tracks this number to zero — **you sunset by fleet census, not by date**).
4. Error `code`s are contract; adding codes is additive.
5. CI runs the conformance suite of **each supported Kernel line** against
   Core `main` — this is the mechanism that catches "backend change breaks
   stores nobody rebuilt".

## Rules — Kernel

1. Within a Contract major: slot props additive-only, hooks additive-only,
   primitives' `data-vendua` hooks and ARIA semantics never change.
2. Slot renames keep the old name aliased for one major.
3. Overrides always render inside error boundaries — Kernel protects the store
   *from* the storefront's own old code.
4. Kernel internals are private by `exports`; "internal" is enforced so
   "private" can evolve freely.

## Rules — SDUI / surfaces

1. Unknown `kind`/`severity`/action `type` degrade per the envelope spec —
   new server capabilities never require a minimum Kernel version to be *safe*.
2. A new `kind` ships with generic-render copy reviewed — the fallback is the
   primary experience on stale stores, not a degraded edge case.
3. `version` field bumps only for incompatible envelope changes; `v.js` and old
   Kernels must keep handling v1 for the platform's life.

## Deprecation lifecycle

`available → deprecated → sunset`, measured by **fleet census**:

- `deprecated`: warning in `vendua check`, docs point to replacement, codemod
  exists if mechanical.
- `sunset`: allowed only when Control Plane reports zero live artifacts
  depending on it (or the remaining ones are pinned on N−1 API majors still in
  their window).

## The staleness guarantee — tested, not asserted

A dedicated CI job keeps a **reference stale storefront**: an artifact built on
the oldest supported Kernel line + Contract major, never updated. On every Core
and Kernel merge it re-runs the S-series conformance tests against it. If
"store built 14 months ago" breaks, the merge that broke it reverts. This test
*is* the backward-compatibility strategy; everything else is bookkeeping.
