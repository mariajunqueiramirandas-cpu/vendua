# ADR 0003: Storefronts are deployable artifacts, not services

- Status: Proposed
- Date: 2026-09-11

## Context

Per-storefront running services (a container/SSR server per tenant) destroy the
SaaS cost model: 1000 mostly-idle Node processes ≈ 150 GB of RAM doing nothing
at 3 AM on a Tuesday, plus 1000 deployable units for the Control Plane to
babysit. The whole point of the platform is that marginal cost per storefront
approaches zero.

## Decision

A storefront compiles to an **immutable static artifact** (prerendered
HTML/JS/CSS + `storefront.manifest.json`) in object storage. A shared edge
layer resolves `Host → tenant → release`, serves the artifact, and injects
`vendua-state` (store status, blocking notices) into the HTML. Live data —
prices, availability, cart, checkout — is fetched client-side by the Kernel and
always revalidated by Core at mutation time, so static snapshots can never
sell wrong.

Deployment = promoting an artifact pointer. Rollback = re-promoting the
previous artifact. Nothing per-tenant is ever "restarted".

## Consequences

### Positive

- Marginal hosting cost per storefront ≈ object storage + CDN bytes.
- Static artifacts are the most resilient serving mode: edge cache keeps
  last-known-good alive through Core and artifact-store outages.
- Instant, trivially-safe rollback (pointer flip) enables ring-based trains.
- Per-tenant "runtime bugs" (memory leaks, event-loop stalls) cannot exist —
  there is no per-tenant runtime.

### Negative / costs

- Catalog changes need a targeted rebuild for fresh snapshots (~1 min per
  store, webhook-triggered); high-churn catalogs may mark routes client-only.
- No per-storefront server logic, ever — this is enforced by the Contract, and
  it's the intended boundary, but it must be explained in the product: "custom
  backend" is not on the menu.
- Product-page SEO relies on snapshot freshness + hydration correctness;
  if that proves insufficient, the deferred Option B (shared SSR host /
  Workers for Platforms) is the documented upgrade path — the artifact
  interface already produces a server entry.

## Alternatives considered

- **Container per storefront (Dokploy app per tenant)**: operationally familiar
  but economically fatal at N=300+.
- **Shared multi-tenant SSR host now**: real capability, real complexity
  (tenant isolation, worker pools, noisy neighbors). Deferred until a measured
  requirement forces it — see
  [07](../architecture/07-deployment-and-hosting.md#option-b--multi-tenant-ssr-host-deferred).

## Links

- [architecture/07-deployment-and-hosting](../architecture/07-deployment-and-hosting.md)
