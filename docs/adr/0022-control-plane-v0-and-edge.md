# ADR 0022: Control Plane v0 in Core, a Bun edge, releases as pointer flips

- Status: Accepted (implemented 2026-09-30, Core migration 0064, Kernel 1.10, Phase 4)
- Date: 2026-09-30

## Context

Phase 4's promise is that the first merchant is live **through the fleet machinery**: their
storefront was provisioned, promoted, is being probed and could be rolled back without a manual
step ([roadmap](../roadmap.md#phase-4--one-tenant-operated-for-real-weeks-1420-overlaps)).
Until now one nginx container (`stores`) served every store: nginx asked Core which store a
Host was (`/storefront/v1/_bundle`) and served the bundle baked into its image, or the
`_template` bundle. Nothing recorded what a store ran, a deploy replaced every store at once,
rollback meant redeploying the platform, nobody watched a store after it went up, and a store
was born only from self-serve signup — the CRM's leads never became stores.

[07](../architecture/07-deployment-and-hosting.md), [08](../architecture/08-control-plane.md),
[12](../architecture/12-domains-and-tls.md) and [ADR 0003](0003-storefronts-as-artifacts.md) /
[0010](0010-automated-domains-tls.md) / [0011](0011-ring-based-fleet-releases.md) describe the
target. This ADR records how v0 builds it on the self-hosted Dokploy platform.

## Decision

**The Control Plane is a Core module** (`packages/core/src/modules/fleet`), not a service.
Per [ADR 0013](0013-modular-monolith-core.md) it shares Core's Postgres, RLS and staff auth, and
exposes its own API (`/control/v1/fleet/*`) that the CRM and `vendua fleet` both call. It stays
out of the request path: the edge caches what it reads and keeps serving when Core is down.
Extraction later keeps the API. Its tables (migration 0064): `releases` (platform),
`storefront_ops.{bundle, release_policy, live_release_id, live_kernel_version}`,
`deployments`, `fleet_probes`, `health_checks`, `fleet_incidents` (operations; merchants keep
reading `platform_incidents`), `provisionings`, `leads.tenant_id`.

**A release is one immutable build of one bundle.** A bundle is a storefront folder
(`_template`, `quero-pudim`, `_examples/quero-pudim`); `_template` serves every store without its
own. `vendua release publish` hashes `dist/` (the file hashes plus the Kernel manifest without
`builtAt`) into a 20-hex release id, writes `storefront.manifest.json` (files with sha256, budgets,
QA checks — compat, manifest, entry, a 350 KB gzip entry budget), uploads to the artifact store
(a Docker volume, or S3/R2/MinIO through `Bun.S3Client`) and registers it. The same source hashes
to the same id, so publishing on every deploy is idempotent; each publish bumps
`published_at`, so a revert deploys again.

**Deployment is a pointer flip, verified by a probe.** Promote = one transaction: a
`deployments` row `pending` + `storefront_ops.live_release_id`. The edge follows within its
30 s route TTL. The page carries `x-vendua-release`; the probe that sees the new id with every
check passing marks the deployment `live`. Three failing probes or five minutes without
verification fail it and — when there is a previous release — promote that one back
(`rollback`) and **pin** the store, so the reconciler doesn't re-promote the bad build.
A store is `auto` (follows its bundle's newest passed release) or `pinned`; staff rollback and
promoting a non-newest release pin it. Ring membership is stored but promotion isn't
ring-gated yet: trains are Phase 5.

**Probes run in Core** every 60 s per live host (15 s while a deployment waits): the page with
`vendua-state` and the release header, `v.js` answering `__VENDUA_LOADER__`, `/storefront/v1/state`,
and a checkout session that re-attaches the probe's one cart instead of creating one per minute.
Three failures open a `probe_failing` incident (critical after 10 min); a pass resolves it. Half
the fleet failing at once is the edge or Core: one `fleet_degraded` incident, and per-store
alerts and automatic rollbacks hold off. History keeps failures and recoveries only.
`VENDUA_PROBE_ORIGIN` unset probes `https://<host>` end to end (DNS, TLS, edge); set, it goes
through the edge with the Host header. Without probes (dev) a flip is live at once.

**The edge is a Bun service with no dependencies** (`packages/edge`), behind Traefik. Host →
Core `GET /edge/v1/resolve` (its own secret, `VENDUA_EDGE_SECRET`; not under `/control`) → the
store's release; files from the artifact store, checked against the manifest's sha256 and
cached on disk; `/assets/*` immutable, HTML `no-cache` with
`<script id="vendua-state">window.__VENDUA_STATE__=…</script>` before `</head>`; the API prefixes
proxied to Core as nginx did (same `X-Forwarded-For` append, so `VENDUA_PROXY_HOPS` stays 1).
Routes, states and the last good `/v1/v.js`, `/storefront/v1/state` and `/surfaces` are served
stale while Core is down and survive a restart through a snapshot on disk. A store not promoted
yet gets its bundle's newest passed release (`fallback`), as nginx's `_default` did.

**The injected state carries the store's live design** (`/storefront/v1/surfaces?design=1`:
templates and tokens). Kernel 1.10 paints with them: a token edit is live at the next page load
with no rebuild — the only way one shared `_template` build can wear each store's look. A store
whose live build predates 1.10 still queues a rebuild on a token edit.

**The provisioner is a state machine** (`release → verify → invite → live`), one row per store,
advanced under a lease so replicas never double-step, retried with backoff, and a
`provisioning_stuck` incident after 30 min. `provision_store()` opens it for both sources: a
self-serve signup (ADR 0021) and a **staff invite from a CRM lead** (`POST
/control/v1/fleet/provisionings`, the lead's "criar loja"). The invite goes to the owner by
WhatsApp and email; the lead moves to `invited` and then `live`, and a signup whose phone or
email is already a lead graduates that lead. The store is born paused behind its plan, as
signup's are; the owner activates the plan in the admin.

**DNS and TLS for `<slug>.vendua.com.br` need no per-store step:** one wildcard record points at
the VPS and Traefik holds the wildcard certificate (DNS-01, [dokploy.md](../deploy/dokploy.md)),
so "create the DNS record" in 08's provisioner is the domains row, and the `verify` step's probe
(`https://<host>` by default) is the proof. PRO+ custom domains keep their one staff step (TLS in
Dokploy) until Phase 7.

**Every deploy publishes.** The compose `publish` service (the `storefronts/Dockerfile` build
stage) runs `vendua release publish --all` once per deploy; unchanged bundles are no-ops.

## Consequences

### Positive

- Promote and rollback of one store take seconds and touch nothing else; a bad build rolls
  itself back and says so.
- The first-store gate's mechanics are exercised by CI (`edge-smoke`): invite → publish →
  edge serves with state → probe verifies → new release → rollback.
- Leads and signups share one pipeline, visible in the CRM (Lojas → frota) and the terminal.
- Merchants' colors reach their store without anyone building anything.

### Negative / costs

- One edge node (Phase 7 adds a second). While it is down every store is down; the snapshot and
  disk cache make a restart safe, not an outage.
- Probes are synthetic HTTP checks from Core, not a browser: `__VENDUA_LOADER__` is checked in
  `v.js`'s source, not executed. The conformance suite remains the rendering gate.
- Artifacts are not garbage-collected yet (a release is ~1 MB; the volume grows with deploys).
- Custom domains, Caddy on-demand TLS and the `ask` endpoint stay Phase 7; `agent_tasks` and
  failure bundles stay Phase 6; ring-gated trains stay Phase 5.

## Alternatives considered

- **A separate `control-plane` package/service**: a second deployable and a second auth story for
  tables Core already owns; deferred until the fleet needs independent scaling.
- **Keep nginx and bake bundles into its image**: no per-store release, rollback or verification.
- **Caddy in front with on-demand TLS now**: Dokploy's Traefik owns :443; Caddy only pays off
  with custom-domain automation (Phase 7).
- **Per-store builds for design tokens**: N builds of the same template, and a build farm Core
  doesn't have; tokens are data, like templates.

## Links

- [architecture/07-deployment-and-hosting](../architecture/07-deployment-and-hosting.md),
  [08-control-plane](../architecture/08-control-plane.md),
  [12-domains-and-tls](../architecture/12-domains-and-tls.md),
  [16-operations-and-incidents](../architecture/16-operations-and-incidents.md)
- [deploy/dokploy.md](../deploy/dokploy.md)
