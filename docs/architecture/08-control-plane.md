# 08 — The Control Plane

> Status: Implemented (v0, Phase 4) · Last reviewed: 2026-09-30
> Decisions: [ADR 0011](../adr/0011-ring-based-fleet-releases.md), [ADR 0022](../adr/0022-control-plane-v0-and-edge.md)

The Control Plane is what makes 300 storefronts a _managed fleet_ instead of
300 freelance projects. It holds the desired and actual state of every tenant
and reconciles the difference. It is CLI-first; the UI is a thin client over
the same API.

v0 is a module of Core (`packages/core/src/modules/fleet`, ADR 0022): same Postgres, RLS and
staff auth, its own API under `/control/v1/fleet`. The CRM's Lojas → frota and `vendua fleet`
are its two clients.

## Schema (v0, Core migration 0064)

```sql
tenants(id, slug, name, plan, status, created_at)               -- Core's own
storefront_ops(tenant_id, ring, bundle, bundle_locked,          -- one per store (was 0050's
               release_policy,  -- auto | pinned                    ring + v.js kill switch)
               pinned_reason, live_release_id, live_since, live_kernel_version,
               loader_state, loader_title, loader_message, loader_href)
releases(id, bundle, tenant_slug, kernel_version, contract, commit,
         artifact_uri, manifest jsonb, qa_status, qa_report jsonb,
         built_at, created_at, published_at)                     -- platform table
deployments(id, tenant_id, release_id, previous_release_id,
            kind,     -- promote | rollback | auto | provision
            status,   -- pending | live | failed | rolled_back | superseded
            actor, reason, detail, started_at, finished_at)
domains(host, tenant_id, is_primary)                             -- Core's resolver table
custom_domains(…, status)   -- pending_dns | dns_ok | active | failed (ADR 0021)
fleet_probes(host, tenant_id, status, failures, failing_since, last_checked_at,
             last_ok_at, last_error, last_release_id, latency_ms, checkout_token,
             next_check_at, lease_until)
health_checks(id, tenant_id, host, at, ok, latency_ms, release_id, checks jsonb)
fleet_incidents(id, tenant_id?, kind, severity, subject, summary, detail,
                opened_at, acked_at, resolved_at)
provisionings(id, tenant_id, source, lead_id, state, attempts, last_error,
              next_attempt_at, lease_until, log jsonb, created_by, live_at)
```

Still to come: `agent_tasks` (Phase 6), `kernel_versions` / trains (Phase 5; the compat matrix
lives in `@vendua/templates`).

Desired state is declarative: an `auto` store should run its bundle's newest passed release
(by `published_at`); a `pinned` store stays where staff (or an automatic rollback) put it.
`live_release_id` is what the edge serves. The reconciler closes the gap.

## Reconciler (`fleet/jobs.ts`, a 15 s loop in Core)

Replica-safe: provisionings and probes are claimed under leases, deployments move only from
`pending`, and a promotion locks the store's ops row.

- **Drift**: every 5 min, and on every release registration, each `auto` store whose live
  release isn't its bundle's newest passed one gets a deployment.
- **Deployments**: promote = `pending` deployment + pointer flip in one transaction. A probe
  that sees `x-vendua-release` = the new id with all checks passing marks it `live`. Three
  failing probes or 5 min unverified → `failed`, the previous release is promoted back and the
  store pinned, and a `deployment_failed` incident opens.
- **Probes**: per live hostname every 60 s (15 s while a deployment waits): page 200 with
  `vendua-state` and `x-vendua-release`; `v.js` exposing `__VENDUA_LOADER__`; `/storefront/v1/state`
  200; a checkout session re-attaching the probe's one cart. Three failures open
  `probe_failing` (critical after 10 min); a pass resolves it. Half the fleet failing =
  `fleet_degraded`, and per-store alerts and rollbacks wait.
- **Provisioner** (below).
- **History**: health checks (failures and recoveries only) kept 30 days; resolved incidents 90.
- Later: ring-gated trains (Phase 5), domain re-verification and cert state (Phase 7 — the
  15-min custom-domain DNS check is ADR 0021's), agent task ageing (Phase 6).

Incidents alert staff (email + WhatsApp, the `fleet` staff event) once when they open and once
when they resolve.

## Fleet operations API

HTTP (`/control/v1/fleet`, staff auth, `Idempotency-Key` on every mutation):

```
GET   status | storefronts | storefronts/:slug | releases[?bundle=] | provisionings[?leadId=]
      | incidents[?all=1] | slug?slug=
POST  releases                                 # vendua release publish
PATCH storefronts/:slug  { policy?, bundle?, ring? }
POST  storefronts/:slug/promote  { release, reason?, force? }
POST  storefronts/:slug/rollback { reason? }
POST  storefronts/:slug/probe
POST  provisionings  { leadId?, slug, storeName, planId, ownerName, ownerPhone, ownerEmail }
POST  provisionings/:id/retry
PATCH incidents/:id  { ack | resolved }
GET   /edge/v1/resolve?host=                   # the edge only (x-vendua-edge)
```

CLI (`vendua`, packages/cli):

```
vendua release build|publish [slug…|--all]      # artifact + register
vendua fleet status | stores | store <t> | releases [bundle]
vendua fleet promote <t> <release> | rollback <t> | pin <t> | unpin <t> | bundle <t> <bundle>
vendua fleet probe <t>
vendua fleet provision --slug … | provisions | retry <id>
vendua fleet incidents [--all] | incidents ack|resolve <id>
vendua ops <t> --maintenance "…" | --normal     # the v.js kill switch (Phase 1b)
```

Still to come: `trains start|advance|halt` (Phase 5), `qa rerun`, `agents enqueue` (Phase 6),
`domains verify|repair` (Phase 7).

## Dashboards that matter

v0 (CRM → Lojas → frota): stores with their bundle, live release and Kernel, policy, probe and
last deployment; open incidents; provisionings in flight; per store the release history,
deployment timeline, probe results and a "verificar agora". `vendua fleet status` prints the
same fleet summary (stores behind their bundle, Kernel spread, failing hosts).

Later:

- **Fleet by Kernel version** — skew is the enemy; stores >2 minors behind are
  flagged.
- **Train view** — per-ring pass/fail, soak timers, gate status.
- **QA health** — conformance pass rate per Kernel release; a release that
  drops pass rate is a suspect, not a success.
- **Build-failure classification** — codemod-fail vs conformance-fail vs
  infra-fail; only the first two go to the agent queue.
- **Domain health** — verification age, cert expiry, broken custom domains.
- **Agent spend** — minutes/cost per storefront, iterations-to-green.

## The agent queue interface (Phase 6)

When automated processes (codemod, conformance, generation QA) can't complete,
the Control Plane emits a **failure bundle** to object storage:

```
failure-bundles/<task-id>/
  context.json        # tenant, contract, kernel, target versions, task kind
  diff.patch          # the breaking change (for migrations)
  logs.txt            # build/test output, trimmed
  failing-tests.json  # conformance ids + messages
  screenshots/        # relevant captures
  trace/              # playwright trace where available
```

An agent task = `{ kind, storefront, bundle, done-when: "conformance green" }`.
The agent is _replaceable_ — anything that can open a PR in the monorepo
satisfies the interface. See [14](14-agent-pipeline.md).

## Provisioner (`fleet/provision.ts`)

A state machine, not a script — one `provisionings` row per store, every step idempotent and
resumable, advanced under a lease with backoff:

```
provision_store()          tenant, <slug>.<store domain> (covered by the wildcard DNS record
                           and certificate), settings, owner, storefront_ops, this row
  → release                the bundle's newest passed release (a `provision` deployment)
  → verify                 a probe sees the edge serve it (deployment live)
  → invite                 staff invites only: WhatsApp + email to the owner, lead → invited
  → live                   lead → live; staff told "loja no ar"
```

Two ways in: a self-serve signup (ADR 0021, `/admin/comecar`) and a staff invite from a CRM
lead ("criar loja", `POST /control/v1/fleet/provisionings`). A signup whose phone or email is
already a lead graduates that lead. A store not live 30 min after it was born opens
`provisioning_stuck`; "tentar de novo" restarts it from `release`. Custom domains are a
follow-up the owner starts in the admin ([12](12-domains-and-tls.md)).

## What the Control Plane is NOT

- Not in the request path (except `state` and `loader_state` reads, which are
  edge-cached). A Control Plane outage pauses _operations_, never _serving_.
- Not the owner of business data — tenants/catalog/orders live in Core; the
  Control Plane stores operational state and mirrors identifiers only.
