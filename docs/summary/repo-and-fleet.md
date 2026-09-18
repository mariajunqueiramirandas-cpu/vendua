# Repo & Fleet — Monorepo, Artifacts, Edge, Control Plane, Trains, QA, Compat

Condenses `architecture/06–11`. Full docs are normative.

## Monorepo (`06`)

One repo: `packages/` (core, kernel, ui-defaults, cli, conformance, codemods,
loader, control-plane, admin, edge) + `storefronts/` (`_template`, `_examples`,
`<slug>…`). Storefronts consume Kernel via workspace deps — no publishing.

- **Isolation (enforced)**: `storefront:<slug>` PRs may only touch
  `storefronts/<slug>/**` (changed-path CI check); CODEOWNERS splits
  `packages/**` (platform) vs `storefronts/**` (fleet automation); `exports`
  maps + `vendua check` lint block cross-boundary imports.
- **Builds**: affected-graph only — Kernel change → rebuild all (fleet train);
  storefront change → that store; Core change → conformance per supported
  Kernel line. Remote cache. ~5000 CI-min per train at N=1000.
- **Assets**: binaries never in git — `assets/manifest.json` → content-hash
  keys in the assets bucket; build uploads + rewrites to CDN URLs.
- **Agents**: sparse, read-scoped checkout
  (`--filter=blob:none --sparse`; Kernel + `docs` + `_template` + `_examples` +
  the slug); write scope = the slug only. `_examples/` = curated golden stores,
  the only sibling read set. Codemods are full-clone CI batch jobs.
- **Sharding trigger**: clone >10 min shallow, `git status` >30 s, or GitHub UI
  degradation → split into 2–4 `fleet-*` repos on published Kernel versions;
  Control Plane already tracks `storefront → repo/path`.

## Deployment & hosting (`07`)

Storefronts are **artifacts, not services** — nothing per-tenant ever runs.

- **Artifact**: `s3://vendua-artifacts/storefronts/<slug>/<release-id>/` —
  prerendered HTML (brand + `(vendua)` system routes), hashed assets,
  `storefront.manifest.json` (release, tenant, contract, kernelVersion,
  commit, routes, sduiMaxVersion, budgets, qaRef). Immutable,
  content-addressed; promote/rollback = pointer flip.
- **Static-first (default)**: brand pages prerendered with catalog snapshot;
  Kernel hydrates + revalidates live; Core is truth at checkout → stale
  snapshots can't sell wrong. Catalog edits → webhook → targeted rebuild
  (~1 min). Cost ≈ storage + CDN ≈ zero marginal.
- **Edge** (one shared tier): TLS (Caddy on-demand + `ask` gate; wildcard for
  `*.vendua.com.br`) → `Host → tenant + release` (30 s cache) → serve artifact
  → inject `__VENDUA_STATE__` (status + blocking notices → correct first
  paint) → `v.js` from CDN.
- **Failure modes**: Core down → static shell + last-known state + loader
  overlay; artifact store down → edge LKG cache; bad deploy → re-promote; bad
  train → ring halt + rollback.
- **Option B (deferred)**: multi-tenant SSR host / Workers for Platforms —
  only if static-first measurably fails SEO/personalization. Artifact format
  already emits a server entry.
- **Infra**: Dokploy VPS for Core/CP/edge/Postgres; S3-compatible (R2/MinIO)
  for artifacts/media; edge wants ≥2 nodes at scale.

## Control Plane (`08`)

Desired vs actual state for every tenant; reconciles the gap. CLI-first
(`vendua-fleet …`), UI is a thin client. **Not in the request path** — a CP
outage pauses operations, never serving.

- **Schema**: tenants, storefronts(repo_path, contract_major, kernel_version,
  ring), releases(artifact_uri, manifest, qa_report), deployments, domains,
  health_checks, incidents, agent_tasks, kernel_versions, compat_matrix.
- **Reconciler**: drift → deploy; ring advance → promotions (halt on gate
  fail); domain re-verify; 60 s synthetic probes per hostname (catalog 200,
  `vendua-state`, loader ping, checkout smoke); agent-task aging/escalation.
- **Dashboards**: fleet-by-Kernel skew, train view, QA pass rate per release,
  build-failure classification, domain health, agent spend.
- **Agent queue**: failure bundles (context, diff.patch, logs, failing-tests,
  screenshots, trace) → `agent_tasks`; anything that opens a conforming PR
  satisfies the interface.
- **Provisioner**: approved storefront → live site (tenant row, DNS, promote,
  analytics, merchant invite); idempotent state machine.

## Migrations & fleet trains (`09`)

- **Change classes**: backend/SDUI → deploy Core, done; new Kernel default →
  minor + train; additive hook → minor + train (opt-in); breaking → Contract
  major + codemod + train; new brand page → storefront PR.
- **Train**: build all affected once → canary (Venduá stores, 24 h) → early
  (~10%, 48 h) → stable (batched, halt-on-anomaly). Rollback = re-promote.
  Biweekly; hot-trains skip soaks, keep ring order.
- **Contract majors**: ≤1/year; no merge without codemod + conformance test +
  dual-support plan. Codemods idempotent/scoped/dry-runnable. Flow: codemod
  branch → per-store typecheck+conformance → auto-commit green → failures to
  agent queue → train. Expect 5–15% failure tail; >20% means fix the codemod.
- **Skew policy**: Core supports N/N−1 API majors ≥12 months; >2 Kernel minors
  behind → `kernel_skew` alert; >4 → feature entitlements blocked.
- **Forbidden**: agents as routine migration mechanism; per-store Kernel
  flags; Core changes only new Kernels can render; "redeploy" as migration.

## QA pipeline (`10`)

- **Conformance** (deterministic, every build, no AI): C-series commerce flow
  (catalog → cart → checkout → order, out-of-zone, idempotent retry), S-series
  system states (paused/closed/unknown-kind/override-crash/`v.js`/system
  routes), Q-series quality (viewports, axe, reduced-motion, no-JS, budgets,
  links, contrast, hostile CSS, focus, zoom), K-series contract lint
  (config typecheck, mounts, no direct fetch, primitives-only, path scope).
- **Generation QA** (agent PRs): screenshot matrix, LLM visual triage vs
  DesignSpec (triage signal only — never approves), human gate at launch +
  majors, ≤4 fix iterations then escalate.
- **Mechanics**: seeded test tenant fixtures; Playwright against the built
  artifact; QA report id → release manifest.
- **Flake policy**: deterministic or quarantined/deleted; visual-triage flakes
  harmless.

## Backward compatibility (`11`)

Invariant: **a storefront untouched for a year keeps working, keeps receiving
backend features, keeps passing conformance.**

- Three axes: Core API (integer major, additive-only, N/N−1 ≥12 mo), Kernel
  (semver, non-breaking within a Contract major), Contract (integer, ≤1 major
  /year + codemod + window). Compat matrix in Control Plane gates builds.
- Sunset by **fleet census**, not date — an API major dies only when zero live
  artifacts depend on it.
- CI runs each supported Kernel line's conformance against Core `main` — this
  catches "backend change breaks stores nobody rebuilt".
- **Staleness guarantee is tested**: a permanent CI job keeps a reference
  storefront on the oldest supported Kernel + Contract and re-runs S-series on
  every merge; breakage reverts the merge.
