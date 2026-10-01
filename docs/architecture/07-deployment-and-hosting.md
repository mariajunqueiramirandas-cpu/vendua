# 07 — Deployment and Hosting

> Status: Implemented (v0, Phase 4) · Last reviewed: 2026-09-30
> Decisions: [ADR 0003](../adr/0003-storefronts-as-artifacts.md), [ADR 0010](../adr/0010-automated-domains-tls.md), [ADR 0011](../adr/0011-ring-based-fleet-releases.md), [ADR 0022](../adr/0022-control-plane-v0-and-edge.md)

Storefronts are **artifacts, not services**. No storefront ever runs as its own
process or container — that model is what makes 1000 tenants marginally cheap.
Deployment means pointing a hostname at an immutable artifact.

## The artifact

A **bundle** is a storefront folder under `storefronts/` (`_template`, `quero-pudim`);
`_template` serves every store that has no bundle of its own (every self-serve signup). A **release** is one immutable build of one bundle.
`vendua release publish` (packages/cli) writes it to the artifact store:

```
<VENDUA_ARTIFACTS>/storefronts/<bundle>/<release>/
  index.html                 # the SPA shell (Kernel routes render client-side)
  assets/**                  # hashed JS/CSS/media
  vendua-manifest.json       # the Kernel's build manifest (sections, compat)
  storefront.manifest.json   # normative — below; written last (its presence = complete)
```

`StorefrontManifest` (`@vendua/edge/manifest`):

```ts
interface StorefrontManifest {
  manifestVersion: 1;
  release: string; // 20 hex: sha256 of bundle + every file's sha256 + the Kernel manifest sans builtAt
  bundle: string; // '_template' | '<slug>'
  tenant: string; // the tenant the bundle is built for (package.json vendua.tenant)
  contract: number; // contract major
  kernelVersion: string; // semver actually built against
  builtAt: string; // ISO
  commit: string; // monorepo sha (GIT_COMMIT, else git, else 'unknown')
  entry: 'index.html';
  spaFallback: true; // extension-less misses serve the entry
  files: Record<string, { size: number; sha256: string; type: string }>;
  budgets: { files; totalBytes; htmlBytes; jsBytes; cssBytes; entryGzipBytes };
  qa: { status: 'passed' | 'failed'; checks: { id; ok; detail? }[] }; // compat, manifest, entry, budget
  build: ArtifactManifest; // vendua-manifest.json verbatim
}
```

Artifacts are immutable and content-addressed: the same source always hashes to the same
release, so publishing is idempotent. **A release is promoted, never rebuilt in place** —
rollback = promote the previous release (seconds, not a rebuild).

The artifact store is a directory (the compose `artifacts` volume, `file:///…`) or an
S3-compatible bucket (`s3://bucket/prefix` — R2, MinIO — through `Bun.S3Client`).

## Hosting model A — static-first (the default)

Each artifact is static: the SPA shell plus hashed assets. The Kernel renders and revalidates
everything live (status, prices, availability, templates) against `/storefront/v1` +
`/checkout/v1`; Core is always the source of truth at checkout, so nothing static can ever sell
the wrong price. First paint is correct without a fetch because the edge injects the store's
state and live design (below).

Prerendering brand pages with a catalog snapshot (and the targeted rebuild on catalog change it
would need) is deferred until SEO/LCP measurements ask for it; the manifest keeps room for
`routes`.

Cost profile: object storage + shared edge ≈ near-zero marginal cost per storefront. This is
the model that makes the SaaS economics work.

## The edge (`packages/edge`)

One shared Bun process in front of all storefront hostnames, behind Dokploy's Traefik:

1. **TLS** — Traefik terminates it: a wildcard certificate for `*.vendua.com.br` (DNS-01) and
   per-host certificates for the PRO+ domains staff attach. On-demand TLS for custom domains
   (Caddy + the `ask` gate) comes with Phase 7's domain automation — see [12](12-domains-and-tls.md).
2. **Resolve**: `Host → GET /edge/v1/resolve?host=` (Core; `x-vendua-edge: VENDUA_EDGE_SECRET`)
   → tenant + live release. Cached 30 s, stale-while-revalidate, served stale for as long as Core
   is down; unknown hosts negative-cached 10 s and answered with the "loja não encontrada" 404.
   A store not promoted yet gets its bundle's newest passed release (`fallback`).
3. **Serve**: files from the artifact store, verified against the manifest's sha256 and cached
   on disk; `assets/*` `immutable`, everything else `no-cache`; ETag/304 and gzip; every
   response carries `x-vendua-release`.
4. **State injection**: `GET /storefront/v1/surfaces?design=1` for that host (≤30 s cache,
   stale on errors), inlined as `<script id="vendua-state">window.__VENDUA_STATE__=…</script>`
   before `</head>`: store status + notices → first paint is already correct (open/closed/
   paused), and since Kernel 1.10 the store's live templates and tokens — a merchant's design
   edit shows at the next load without a rebuild, which is how one shared `_template` build
   wears each store's look.
5. **API**: `/storefront/v1`, `/checkout/v1`, `/v1` proxy to Core with the Host kept and
   `X-Forwarded-For` appended (streams such as SSE pass through unbuffered). The last good
   `/v1/v.js`, `/storefront/v1/state` and `/storefront/v1/surfaces` answers are served stale
   (`x-vendua-edge-stale: 1`) while Core fails, so the loader's kill switch still reaches shoppers.

Routes, states and those API answers are snapshotted to disk, so an edge restart during a Core
outage keeps serving.

Failure modes by design:

| Failure               | Behavior                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Core down             | Stale routes serve the shell; injected state and `v.js`/`state` are last-known-good; the loader shows overlays |
| Artifact store down   | Files already on the edge's disk keep serving; a file never fetched answers 502                                |
| Artifact corrupted    | sha256 mismatch → 502, never cached, never served                                                              |
| Bad storefront deploy | The probe never verifies it (or fails it) → the Control Plane promotes the previous release and pins the store |
| Bad Kernel train      | Ring gate halts; affected rings roll back by re-promotion (trains: Phase 5)                                    |

## Option B — multi-tenant SSR host (deferred)

If product-page SEO or personalization proves insufficient under static-first,
the alternative is a shared SSR host: one service resolves tenant, loads that
tenant's server bundle into a worker pool (timeouts, LRU eviction), renders.
Cloudflare Workers for Platforms + Cloudflare for SaaS is the buy-not-build
version.

The artifact interface is designed so A can evolve into B: only the edge's fetch step changes.
**Do not build B until model A demonstrably fails a requirement** — per-tenant SSR processes are
exactly the marginal-cost trap the artifact model avoids.

## Release pipeline

```
deploy (Dokploy compose) or CI
  → storefronts built (the shared Docker build stage)
  → `publish` service: vendua release publish --all
      → release id, QA checks, storefront.manifest.json → artifact store (skipped if present)
      → POST /control/v1/fleet/releases
  → Control Plane: every `auto` store on that bundle gets a `pending` deployment (pointer flip)
  → the edge picks it up (≤30 s); a probe sees x-vendua-release → deployment `live`
  → not verified in 5 min / 3 failing probes → previous release promoted back, store pinned
```

CI's `edge-smoke` job runs this loop for real (invite → publish → edge → probe → new release →
rollback). The Kernel's conformance suite stays the rendering gate on every storefront PR.

## DNS layout

| Hostname             | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `slug.vendua.com.br` | default tenant hostname — the wildcard record, no per-store step    |
| `edge.vendua.com.br` | CNAME target for custom domains                                     |
| `cdn.vendua.com.br`  | `v.js`, shared assets, artifact CDN (not yet: the edge serves both) |
| `api.vendua.com.br`  | Core APIs                                                           |
| Custom domain        | CNAME/ALIAS → `edge.vendua.com.br`; see [12](12-domains-and-tls.md) |

## Where this runs

`docker-compose.yml` on the Dokploy-managed VPS: `db`, `core` (with the Control Plane),
`edge`, the one-shot `publish`, `crm`, `admin`, `site` ([deploy/dokploy.md](../deploy/dokploy.md)).
Artifacts live in the `artifacts` volume or an S3-compatible bucket. At fleet scale the edge
wants ≥2 nodes behind a floating IP / anycast (Phase 7); until then it is the single most
important process to monitor (see [16](16-operations-and-incidents.md)).
