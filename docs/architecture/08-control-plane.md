# 08 — The Control Plane

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0011](../adr/0011-ring-based-fleet-releases.md)

The Control Plane is what makes 300 storefronts a _managed fleet_ instead of
300 freelance projects. It holds the desired and actual state of every tenant
and reconciles the difference. It is CLI-first; the UI is a thin client over
the same API.

## Schema (entities)

```sql
tenants(id, slug, name, plan, status, created_at)          -- mirrored w/ Core
storefronts(id, tenant_id, repo_path, contract_major,
            kernel_version, ring, scaffold_version)
releases(id, storefront_id, artifact_uri, manifest jsonb,
         qa_report jsonb, qa_status, created_at, promoted_at)
deployments(id, storefront_id, release_id, ring,
            status,        -- pending|live|rolled_back|failed
            started_at, finished_at)
domains(id, tenant_id, hostname, kind,                    -- subdomain|custom
        verification_state, verification_method,
        cert_state, last_checked_at)
health_checks(id, tenant_id, at, probe, status, latency_ms, detail jsonb)
incidents(id, scope, tenant_id?, severity, opened_at, resolved_at, summary)
agent_tasks(id, tenant_id, kind,                          -- generate|fix|migrate
            status, failure_bundle_uri, attempts, cost_usd, created_at)
kernel_versions(version, contract_major, released_at, status)
compat_matrix(contract_major, kernel_min, kernel_max, api_majors int[])
```

Desired state is declarative: `storefronts.kernel_version` is what the tenant
_should_ run; `deployments` records what it _does_ run. The reconciler closes
the gap.

## Reconciler

A loop (or event-driven equivalent) that continuously:

- Detects drift: storefront's live release ≠ desired release → schedule
  deployment.
- Watches rings: when a train advances a ring, enqueue promotions for all
  storefronts in it; halt on gate failure.
- Verifies domains: re-check `verification_state`, renew cert state, flag
  `custom_domain_broken` incidents when a verified domain stops resolving.
- Runs health probes: per live hostname, synthetic checks (catalog page 200,
  `vendua-state` present, `__VENDUA_LOADER__` ping, checkout-session smoke test
  against a sandbox flag) on a 60 s cadence; open incidents on failure and
  auto-rollback when policy allows.
- Ages agent tasks: re-queue failed migrations with failure bundles; escalate
  after N attempts.

## Fleet operations API (CLI surface)

```
vendua-fleet status [--ring] [--kernel]           # fleet dashboard, text or json
vendua-fleet trains start <kernel-version>        # begin a ring rollout
vendua-fleet trains advance|halt <train-id>
vendua-fleet releases promote <storefront> <release>
vendua-fleet releases rollback <storefront>
vendua-fleet qa rerun <storefront>
vendua-fleet agents enqueue <task> --bundle <uri>
vendua-fleet domains verify|repair <hostname>
vendua-fleet incidents list|ack|resolve
vendua-fleet loader set-state <tenant> maintenance --message "…"
```

## Dashboards that matter

- **Fleet by Kernel version** — skew is the enemy; stores >2 minors behind are
  flagged.
- **Train view** — per-ring pass/fail, soak timers, gate status.
- **QA health** — conformance pass rate per Kernel release; a release that
  drops pass rate is a suspect, not a success.
- **Build-failure classification** — codemod-fail vs conformance-fail vs
  infra-fail; only the first two go to the agent queue.
- **Domain health** — verification age, cert expiry, broken custom domains.
- **Agent spend** — minutes/cost per storefront, iterations-to-green.

## The agent queue interface

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

## Provisioner

A Control Plane module that turns an approved storefront into a live site:
create `slug.vendua.com.br` DNS record → register domain row → promote release
→ enable analytics → send merchant invite. Custom domains are a follow-up task
([12](12-domains-and-tls.md)). Every step is idempotent and resumable — the
provisioner is a state machine, not a script.

## What the Control Plane is NOT

- Not in the request path (except `state` and `loader_state` reads, which are
  edge-cached). A Control Plane outage pauses _operations_, never _serving_.
- Not the owner of business data — tenants/catalog/orders live in Core; the
  Control Plane stores operational state and mirrors identifiers only.
