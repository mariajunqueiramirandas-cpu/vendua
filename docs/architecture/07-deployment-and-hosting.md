# 07 — Deployment and Hosting

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0003](../adr/0003-storefronts-as-artifacts.md), [ADR 0010](../adr/0010-automated-domains-tls.md), [ADR 0011](../adr/0011-ring-based-fleet-releases.md)

Storefronts are **artifacts, not services**. No storefront ever runs as its own
process or container — that model is what makes 1000 tenants marginally cheap.
Deployment means pointing a hostname at an immutable artifact.

## The artifact

`vendua build storefronts/<slug>` produces:

```
s3://vendua-artifacts/storefronts/<slug>/<release-id>/
  index.html                 # prerendered shell: brand pages w/ catalog snapshot
  routes/**/*.html           # other prerendered brand routes
  (vendua)/**/*.html         # system route shells (checkout, order, legal…)
  assets/**                  # hashed JS/CSS/media
  storefront.manifest.json   # normative — below
```

```ts
interface StorefrontManifest {
  release: string; // content-addressed id
  tenant: string; // tenant slug
  contract: 1; // contract major
  kernelVersion: string; // semver actually built against
  builtAt: string; // ISO
  commit: string; // monorepo sha
  routes: string[]; // prerendered paths incl. system routes
  sduiMaxVersion: number; // newest envelope version understood
  budgets: BudgetReport; // measured sizes per route
  qaRef: string; // conformance report id in Control Plane
}
```

Artifacts are immutable and content-addressed. **A release is promoted, never
rebuilt in place** — rollback = promote the previous artifact (seconds, not a
rebuild).

## Hosting model A — static-first (the default)

Each artifact is fundamentally static: brand pages are prerendered with a
catalog snapshot for SEO/LCP; the Kernel hydrates and revalidates everything
live (status, prices, availability) against `/storefront/v1` + `/checkout/v1`.
Core is always the source of truth at checkout, so a stale snapshot can never
sell the wrong price.

Catalog changes trigger a **targeted rebuild** via outbox webhook →
`vendua build <slug>` → promote (~1 min). Stores with high-churn catalogs can
flag routes `client-only` in the manifest and skip snapshotting.

Cost profile: object storage + CDN + shared edge ≈ near-zero marginal cost per
storefront. This is the model that makes the SaaS economics work.

## The edge

One shared edge tier in front of all storefront hostnames:

1. **Terminate TLS** — Caddy with on-demand TLS; `ask` endpoint checks the
   Control Plane that the hostname is registered and verified. `*.vendua.com.br`
   uses a wildcard cert (DNS-01). See [12](12-domains-and-tls.md).
2. **Resolve tenant**: `Host → domains table → tenant + current release`
   (read-through cache, ~30 s TTL, fed by Control Plane).
3. **Serve artifact**: HTML from object storage (short cache), `assets/*`
   long-cached by content hash.
4. **State injection**: fetch `GET /control/v1/state?tenant=` (≤30 s cache) and
   inline it as `<script id="vendua-state">window.__VENDUA_STATE__=…</script>`
   before `</head>`. Contains store status + blocking notices → first paint is
   already correct (open/closed/paused), no flicker, no post-load layout jump.
5. **Loader**: storefront HTML references `v.js` from the CDN; the edge can pin
   the loader version per fleet config.

Failure modes by design:

| Failure               | Behavior                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core down             | Static shell still serves; state injection serves last-known snapshot; `v.js` renders emergency/maintenance overlay from edge-cached `loader_state` |
| Artifact store down   | Edge serves last-known-good HTML from its cache                                                                                                     |
| Bad storefront deploy | Control Plane re-promotes previous artifact                                                                                                         |
| Bad Kernel train      | Ring gate halts; affected rings roll back by re-promotion                                                                                           |

## Option B — multi-tenant SSR host (deferred)

If product-page SEO or personalization proves insufficient under static-first,
the alternative is a shared SSR host: one service resolves tenant, loads that
tenant's server bundle into a worker pool (timeouts, LRU eviction), renders.
Cloudflare Workers for Platforms + Cloudflare for SaaS is the buy-not-build
version.

The artifact interface is designed so A can evolve into B: the build already
produces a server entry; only the edge's fetch step changes. **Do not build B
until model A demonstrably fails a requirement** — per-tenant SSR processes are
exactly the marginal-cost trap the artifact model avoids.

## Release pipeline

```
PR merged (storefronts/<slug> only)
  → affected build → artifact → object storage
  → conformance suite against the artifact (preview URL)
  → Control Plane records Release {artifact, qa report, screenshots}
  → auto-promote if ring policy says so, else await approval
```

## DNS layout

| Hostname             | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `slug.vendua.com.br` | default tenant hostname, provisioned at signup                      |
| `edge.vendua.com.br` | CNAME target for custom domains                                     |
| `cdn.vendua.com.br`  | `v.js`, shared assets, artifact CDN                                 |
| `api.vendua.com.br`  | Core APIs                                                           |
| Custom domain        | CNAME/ALIAS → `edge.vendua.com.br`; see [12](12-domains-and-tls.md) |

## Where this runs

Core, Control Plane, edge, and Postgres deploy as a small set of services on
the existing self-hosted platform (Dokploy-managed VPS); artifacts and media on
S3-compatible object storage (R2 — zero egress — or self-hosted MinIO). At
fleet scale the edge wants ≥2 nodes behind a floating IP / anycast; until then
it is the single most important process to monitor (see
[16](16-operations-and-incidents.md)).
