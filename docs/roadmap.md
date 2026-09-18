# Roadmap

> Status: Proposed · Last reviewed: 2026-09-18

**Organizing principle: the fleet is the product.** This roadmap is not "build
the platform, then learn to operate 1000 stores". Every phase must leave the
fleet _operable at its current size_ — we never ship a capability we can't
operate at the N we have, and we never let manual operations survive the stage
that created them. Manual ops at N=1 become permanent ops at N=100.

Ordering follows the fleet lifecycle: **produce → deploy → operate → migrate →
generate → scale**. Two consequences versus a naive build order:

- The Control Plane and artifact pipeline land in Phase 2, not later — the
  first real merchant is provisioned, promoted, probed and rolled back through
  the same machinery as the thousandth.
- Monorepo machinery (scaffold, changed-path CI, affected builds, `_template`
  /`_examples`) is Phase 1 factory work, not agent-era tooling — it is what
  makes N storefronts one repo instead of N projects.

## Fleet stages — the gates that actually matter

Phases build capability; these stages gate _growth_. Do not grow past a stage
until its row is true.

| Stage        | N     | Must be true before growing past it                                                                           |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------- |
| First store  | 1     | Real paid order taken; provision/promote/rollback ran through the Control Plane — zero manual steps           |
| Pilot cohort | ~5    | Conformance + changed-path CI green on every storefront PR; probes live on all hostnames; `_examples/` seeded |
| Early fleet  | ~25   | One boring train shipped; one codemod rehearsal done; runbook covers the top 5 incidents                      |
| Growth       | ~100  | Agent pipeline is the default intake; Core HA + LKG proven by a real failover drill; train cost measured      |
| Fleet        | ~1000 | `fleet-*` shard rehearsed; Kernel publishing path proven; train economics budgeted                            |

## Phase 0 — Fleet-shaped foundations (weeks 0–4)

Goal: stop guessing what the Contract must be — and start inside the real
layout, not a scratch project.

- [x] Monorepo skeleton **first**: `packages/`, `storefronts/`, workspace
      wiring. Spike storefronts live at `storefronts/<slug>/` from day one.
- [x] Core skeleton: tenancy, catalog, store settings/hours, server-side cart,
      checkout stub, orders. **`tenant_id` + RLS on every table from the first
      migration** — tenancy is the one thing that cannot be retrofitted.
- [x] Rough Kernel: provider, 3–4 hooks, 3–4 primitives, `<SystemSurfaces />`
      with only a generic notice renderer.
- [ ] Build **3–5 storefronts semi-manually** (agent-assisted, human-steered),
      starting by porting the existing Quero Pudim Gourmet storefront. The
      strongest become `storefronts/_examples/` — the curated read set for
      future agents ([06](architecture/06-monorepo.md#agents-in-the-monorepo)).
- [x] Write down every place a store needed to touch behavior that should have
      been central — those become slots/primitives/API fields.
      → [`phase-0-findings.md`](phase-0-findings.md) + [`contract-v1-draft.md`](contract-v1-draft.md)

Exit: Contract v1 drafted from _observed_ needs; all spike code already lives
in the monorepo layout it will keep.

## Phase 1 — The storefront factory (weeks 4–8)

Goal: storefronts are _produced_, not hand-built — and the repo enforces it.

- [ ] Freeze Contract v1 ([03](architecture/03-storefront-contract.md)):
      `vendua.config.ts`, required mounts, reserved system routes, primitives,
      budgets, dependency policy.
- [ ] `@vendua/conformance` v1: commerce flow, paused/closed states, viewports,
      a11y baseline, byte budget — modeled on the teaser site's existing suite
      (see `site/tests/site.spec.ts` and `site/VALIDACAO.md`).
- [ ] `@vendua/cli`: `scaffold`, `dev`, `check`, `build`, `qa`.
      `storefronts/_template` always green.
- [ ] **Fleet isolation machinery**: CODEOWNERS, changed-path CI check
      (`storefront:<slug>` PRs touch only `storefronts/<slug>/**`), affected-
      graph build, cross-boundary import lint. This is the sandbox every later
      agent and contributor works inside.

Exit: `vendua scaffold && vendua build && vendua qa` is green on a fresh
storefront without any custom code — and a storefront PR physically cannot
touch platform code.

## Phase 2 — One tenant, operated for real (weeks 6–14, overlaps)

Goal: the first merchant is live **through the fleet machinery**, not around
it. This is the phase the old ordering got wrong — deployment and operations
are prerequisites for tenant #1, not a later phase.

- [ ] Mercado Pago OAuth + `application_fee` + PIX + webhook-driven order state
      machine ([13](architecture/13-payments.md)).
- [ ] Server-driven notices end-to-end: emit `store_paused` from Core, watch an
      _unmodified_ storefront render it ([05](architecture/05-system-surfaces.md)).
- [ ] Merchant admin MVP (catalog CRUD, hours, orders, MP connect).
- [ ] Edge v1: artifact serving + `vendua-state` injection
      ([07](architecture/07-deployment-and-hosting.md)); `slug.vendua.com.br`
      auto-provisioning + wildcard TLS ([12](architecture/12-domains-and-tls.md)).
- [ ] **Control Plane v0** ([08](architecture/08-control-plane.md)): tenants /
      storefronts / releases / deployments / domains tables; promote and
      rollback as pointer flips; 60 s synthetic probes per live hostname;
      provisioner state machine (tenant row → DNS → promote → invite).

Exit: a real merchant takes a real paid order on `*.vendua.com.br` — and their
storefront was provisioned, promoted, is being probed, and could be rolled
back entirely through the Control Plane. **Stage gate: First store.**

## Phase 3 — The fleet loop (weeks 12–18)

Goal: change reaches the fleet as a boring, gated, reversible operation —
proven while N is small enough to fix cheaply.

- [ ] Rings live: `canary` = Venduá-owned stores permanently; `early` recruits
      volunteer merchants (discount for ring membership).
- [ ] Ship a real Kernel minor through canary → early → stable with gates
      ([09](architecture/09-migrations-and-fleet-trains.md),
      [11](architecture/11-backward-compatibility.md)).
- [ ] Compat matrix + `kernel_skew` alerts + the permanent stale-storefront CI
      job ([11](architecture/11-backward-compatibility.md#the-staleness-guarantee--tested-not-asserted)).
- [ ] `v.js` loader live on all storefronts; per-tenant kill switch drilled
      once ([16](architecture/16-operations-and-incidents.md#the-kill-switch)).
- [ ] Deliberately ship one server-driven feature (e.g. "delivery estimate"
      notice) and verify it reaches a storefront that was never rebuilt.

Exit: a fleet train is _boring_; a rollback drill takes minutes; stale-store
CI has caught — or demonstrably would catch — a real break. **Stage gates:
Pilot cohort → Early fleet.**

## Phase 4 — Generation pilot (weeks 16–24)

Goal: agents produce storefronts through the exact path humans use — the PR
interface is the only interface.

- [ ] DesignSpec schema + validation ([14](architecture/14-agent-pipeline.md)).
- [ ] Agent task runner: sparse checkout per the contract
      ([06](architecture/06-monorepo.md#agents-in-the-monorepo)) → scaffold →
      agent PR → conformance + generation QA → fix loop → human approval →
      provisioner.
- [ ] Failure-bundle format + agent queue in the Control Plane.
- [ ] Track the metrics: iterations-to-green, agent-minutes per storefront,
      post-launch defect rate.
- [ ] First Contract major **rehearsal** on a staging cohort — the codemod
      machinery must be proven before it's needed for real
      ([09](architecture/09-migrations-and-fleet-trains.md#contract-majors)).

Exit: a new storefront goes from DesignSpec to live `*.vendua.com.br` site with
at most one human approval gate; cost per launched storefront is a measured
number. **Stage gate: Early fleet → Growth.**

## Phase 5 — Scale hardening (ongoing, before ~50 tenants)

- [ ] Core HA: multi-instance, managed Postgres or rehearsed failover,
      last-known-good serving ([16](architecture/16-operations-and-incidents.md)).
- [ ] Edge ≥2 nodes; status page on separate infra.
- [ ] Custom-domain automation incl. failure UX
      ([12](architecture/12-domains-and-tls.md)).
- [ ] WhatsApp intake agent → DesignSpec (only after the generation pipeline
      is proven; intake automation is its own product).

Exit: a real failover drill passed; a custom domain live end-to-end; the
rehearsed Contract major's failure tail measured under 20%.

## Phase 6 — The road to 1000 (before ~300 tenants)

The monorepo's documented end-state is `fleet-*` repos on published Kernel
versions ([06](architecture/06-monorepo.md#scaling-limits-and-the-sharding-trigger)).
This phase makes that path real before it is forced.

- [ ] **Shard rehearsal**: split a staging cohort into a `fleet-*` repo
      consuming published Kernel — prove the migration, don't theorize it.
- [ ] Private registry + Kernel publishing pipeline (required by sharding;
      also the agent-credential-isolation fix — a fleet repo shrinks the blast
      radius of agent PR traffic).
- [ ] Train economics: measured CI-minutes per storefront, remote-cache hit
      rate, runner capacity plan — N=1000 train cost becomes a budgeted number.
- [ ] Re-evaluate shard triggers: pull the split forward on operational
      grounds (CI blast radius, agent credentials, merge contention) if they
      arrive before the git-perf triggers.

Exit: sharding is rehearsed, not theoretical; the trigger decision is
evidence-backed.

## Metrics that gate growth

| Metric                                | Watch for                             | Source          |
| ------------------------------------- | ------------------------------------- | --------------- |
| Agent-minutes per launched storefront | the business-model number             | `agent_tasks`   |
| Iterations-to-green                   | scaffold/spec quality                 | `agent_tasks`   |
| Codemod failure tail                  | >20% → fix the codemod, not the queue | train reports   |
| Kernel skew                           | stores >2 minors behind               | Control Plane   |
| Train wall time + gate rejections     | train health trend                    | Control Plane   |
| Probe failure rate per hostname       | serving health                        | `health_checks` |

## Explicitly deferred

- Multi-framework support — never; [ADR 0002](adr/0002-single-storefront-framework-react.md).
- Per-storefront servers — never; [ADR 0003](adr/0003-storefronts-as-artifacts.md).
- Multi-tenant SSR host — only if product-page SEO/personalization proves the
  need; [07](architecture/07-deployment-and-hosting.md#option-b--multi-tenant-ssr-host-deferred).
- Repo-per-storefront — [ADR 0001](adr/0001-monorepo-for-storefronts.md).
- Microservices in Core — [ADR 0013](adr/0013-modular-monolith-core.md).
- `fleet-*` sharding itself — rehearsed in Phase 6, executed on trigger.
- Third-party courier/dispatch integrations — after Phase 6.
