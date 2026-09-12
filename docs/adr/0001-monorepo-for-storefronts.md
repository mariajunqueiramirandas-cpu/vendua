# ADR 0001: One monorepo for all storefronts

- Status: Proposed
- Date: 2026-09-11

## Context

Venduá will operate 100–1000+ storefronts that all consume the same Kernel and
Contract. We will regularly need fleet-wide operations: Contract codemods,
Kernel upgrades, conformance reruns, and agent-generated changes. With
repo-per-storefront, every one of those operations multiplies by N — a codemod
becomes N pull requests, N CI configurations must be kept alive, and the
Control Plane degenerates into a GitHub-API glue project.

## Decision

All storefronts live in a single monorepo at `storefronts/<slug>/`, alongside
`packages/` containing Core, Kernel, Control Plane, CLI, conformance and
codemods. Builds are affected-graph driven (only changed storefronts rebuild;
a Kernel change rebuilds all). Isolation is enforced mechanically: CODEOWNERS
plus a CI check that a `storefront:<slug>` PR touches only its own directory.
Agents get a scoped working directory but can read the Kernel and sibling
stores as references.

## Consequences

### Positive

- Fleet codemod = one PR. Contract majors become tractable.
- One toolchain, one lockfile per build graph, one CI definition.
- Agents benefit: Kernel source and reference storefronts are readable in-repo.
- Atomic platform+storefront changes are possible when needed (e.g. Contract v2
  lands together with the codemod that updates every store).

### Negative / costs

- Repo size requires discipline: binary assets must live in object storage,
  not git ([06](../architecture/06-monorepo.md#assets)).
- A shared CI outage pauses all storefront work (mitigate: runners are boring,
  and trains are scheduled not continuous).
- Git performance will eventually degrade (~1000+ dirs) — sharding path is
  documented and does not change the Contract.

## Alternatives considered

- **Repo-per-storefront + batch-changes tooling** (Sourcegraph/Renovate-style):
  maximally "decoupled" but N× CI/config/bot overhead and no atomicity; the
  decoupling buys nothing since all stores share the Contract anyway.
- **One repo for platform, repo-per-store for storefronts**: worst of both —
  agents can't see the Kernel source, codemods still need cross-repo tooling.

## Links

- [architecture/06-monorepo](../architecture/06-monorepo.md)
- [architecture/09-migrations-and-fleet-trains](../architecture/09-migrations-and-fleet-trains.md)
