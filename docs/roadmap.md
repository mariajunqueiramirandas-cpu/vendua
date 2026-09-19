# Roadmap

> Status: Proposed · Last reviewed: 2026-09-18

**Organizing principle: the fleet is the product.** This roadmap is not "build
the platform, then learn to operate 1000 stores". Every phase must leave the
fleet _operable at its current size_ — we never ship a capability we can't
operate at the N we have, and we never let manual operations survive the stage
that created them. Manual ops at N=1 become permanent ops at N=100.

Ordering follows the fleet lifecycle: **produce → sell → deploy → operate →
migrate → generate → scale**. Two consequences versus a naive build order:

- The Control Plane and artifact pipeline land before the first real merchant
  — they are prerequisites for tenant #1, not a later phase.
- Monorepo machinery (scaffold, changed-path CI, affected builds, `_template`
  /`_examples`) is factory work, not agent-era tooling — it is what makes N
  storefronts one repo instead of N projects.
- **Commerce completeness is its own phase** (Phase 2) — the Quero Pudim port
  proved the reference storefront ships features Core can't express; a real
  merchant must not lose features versus the old stack.

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

## Phase 0 — Fleet-shaped foundations (weeks 0–4) ✅

Goal: stop guessing what the Contract must be — and start inside the real
layout, not a scratch project.

- [x] Monorepo skeleton **first**: `packages/`, `storefronts/`, workspace
      wiring. Spike storefronts live at `storefronts/<slug>/` from day one.
- [x] Core skeleton: tenancy, catalog, store settings/hours, server-side cart,
      checkout, orders, delivery zones. **`tenant_id` + RLS on every table
      from the first migration** — tenancy is the one thing that cannot be
      retrofitted.
- [x] Rough Kernel: provider, hooks, primitives, `<SystemSurfaces />` with a
      generic notice renderer.
- [x] Built **3 spike storefronts** semi-manually, including a full port of
      Quero Pudim Gourmet — now `storefronts/_examples/quero-pudim`, the
      curated read set for future agents.
- [x] Every store-touch point written down → [`phase-0-findings.md`](phase-0-findings.md) + [`contract-v1-draft.md`](contract-v1-draft.md). The port surfaced 15
      feature gaps — tracked in the [feature-gap ledger](#feature-gap-ledger)
      below and assigned to phases.

Exit met: Contract v1 drafted from observed needs; spike code lives in the
monorepo layout it keeps.

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
- [ ] **Founder CRM v0** — merchant-intake pipeline for Venduá itself: a
      `leads` table in Core + a staff-only board (lead → contacted → invited →
      live, notes per merchant). Doesn't wait for the Control Plane — merchant
      conversations start before the fleet exists, and tracking them in a
      spreadsheet is exactly the manual-ops debt this roadmap avoids. Phase 4
      merges it into the Control Plane's provisioner states.

Exit: `vendua scaffold && vendua build && vendua qa` is green on a fresh
storefront without any custom code — and a storefront PR physically cannot
touch platform code.

## Phase 2 — Commerce completeness (weeks 8–12)

Goal: Core expresses everything a real merchant storefront needs — the
Quero Pudim reference must run on the platform with **zero storefront-side
workarounds**. Each gap below lands as schema + API + Kernel support; the
`_examples/quero-pudim` golden gets migrated off its defensive shims as proof.

### 2a — Order lifecycle (the post-checkout truth)

- [ ] `items[]` (name, qty, unitPriceCents, modifiers) on `GET /orders/:id` —
      today storefronts snapshot `cart.items` into sessionStorage to render
      the order page.
- [ ] `notes` on `CheckoutInput` → `OrderView` ("Alguma observação?").
- [ ] Structured address fields (street/number/complement/bairro/cep) instead
      of one freeform string.
- [ ] Orders-by-phone (`GET /customer/orders?phone=`) + Kernel `useOrders(phone)`
      — "sem senha, sem cadastro" order history across devices.
- [ ] Realtime order updates — Kernel-owned `useOrder(id)` polling/SSE wrapper
      (storefronts can't open EventSource per the contract).

### 2b — Catalog depth

- [ ] `imageUrl`/`gallery[]` on products (media table) — ports render
      `figureVariant` SVG fallbacks today.
- [ ] `stockQuantity` + `lowStockThreshold` on products ("Restam N", qty cap).
- [ ] Combos entity: `slots[] { name, minSelect, maxSelect, qtyPerItem }` +
      `items[]` per slot + checkout validation — kills the seeded "Kits as
      modifier-groups" hack.
- [ ] Preorder/encomendas: `requiresPreorder`, `preorderLeadDays`,
      `scheduledFor` on `CheckoutInput` + payment-method constraints
      (encomendas are Pix-only in the reference).

### 2c — Growth surfaces

- [ ] Coupons: `POST /checkout/v1/coupons/validate` + `discountCents` on cart
      totals.
- [ ] Waitlist: `POST /storefront/v1/waitlist` (productId, phone) — replaces
      the wa.me deep-link workaround.
- [ ] Loyalty card: `GET /customer/loyalty?phone=` (points/stamps).
- [ ] Cross-device cart recovery: `POST /cart` accepting items, or Kernel
      `importCart(items)` — the `?cart=` share-link flow.
- [ ] CEP lookup / address autocomplete + distance-based zone pricing
      (replaces bairro-name matching).
- [ ] Pix fields on the store profile (`pixKey`, `pixBeneficiary`, QR payload)
      — surfaced on the store page, not only post-checkout instructions.
      Payment capture itself stays in Phase 4.

Exit: `_examples/quero-pudim` compiles with every `(p as { … })` defensive
cast and sessionStorage workaround deleted; conformance can assert the real
flows.

## Phase 3 — Payments + merchant admin (weeks 12–16)

Goal: money moves through the platform and a merchant can run the store
without touching a repo.

- [ ] Mercado Pago OAuth + `application_fee` + PIX + webhook-driven order
      state machine ([13](architecture/13-payments.md)).
- [ ] Merchant admin MVP: catalog CRUD (incl. Phase-2 fields), hours,
      zones/fees, orders, MP connect.
- [ ] Server-driven notices end-to-end: emit `store_paused` from Core, watch
      an _unmodified_ storefront render it
      ([05](architecture/05-system-surfaces.md)).

Exit: a merchant edits catalog/hours and receives paid PIX orders without
engineer involvement.

## Phase 4 — One tenant, operated for real (weeks 14–20, overlaps)

Goal: the first merchant is live **through the fleet machinery**, not around
it — deployment and operations are prerequisites for tenant #1.

- [ ] Edge v1: artifact serving + `vendua-state` injection
      ([07](architecture/07-deployment-and-hosting.md)); `slug.vendua.com.br`
      auto-provisioning + wildcard TLS
      ([12](architecture/12-domains-and-tls.md)). The Dokploy compose is the
      interim/self-hosted path until this lands.
- [ ] **Control Plane v0** ([08](architecture/08-control-plane.md)): tenants /
      storefronts / releases / deployments / domains tables; promote and
      rollback as pointer flips; 60 s synthetic probes per live hostname;
      provisioner state machine (tenant row → DNS → promote → invite).
- [ ] **Founder CRM → Control Plane** — the Phase-1 intake board folds into
      the Control Plane: `lead` records graduate into the provisioner's
      invite→live states, so onboarding is tracked in the same tool that
      operates the fleet — not a separate spreadsheet.

Exit: a real merchant takes a real paid order on `*.vendua.com.br` — and their
storefront was provisioned, promoted, is being probed, and could be rolled
back entirely through the Control Plane. **Stage gate: First store.**

## Phase 5 — The fleet loop (weeks 18–24)

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

## Phase 6 — Generation pilot (weeks 22–30)

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

## Phase 7 — Scale hardening (ongoing, before ~50 tenants)

- [ ] Core HA: multi-instance, managed Postgres or rehearsed failover,
      last-known-good serving ([16](architecture/16-operations-and-incidents.md)).
- [ ] Edge ≥2 nodes; status page on separate infra.
- [ ] Custom-domain automation incl. failure UX
      ([12](architecture/12-domains-and-tls.md)).
- [ ] WhatsApp intake agent → DesignSpec (only after the generation pipeline
      is proven; intake automation is its own product).

Exit: a real failover drill passed; a custom domain live end-to-end; the
rehearsed Contract major's failure tail measured under 20%.

## Phase 8 — The road to 1000 (before ~300 tenants)

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

## Feature-gap ledger

Every feature the Quero Pudim reference ships that the platform couldn't
express during the port (source:
[`storefronts/quero-pudim/OBSERVATIONS.md`](../storefronts/quero-pudim/OBSERVATIONS.md)).
Two landed during Phase-0 review; the rest are scheduled.

| Gap                                  | Status                                                |
| ------------------------------------ | ----------------------------------------------------- |
| Delivery zones readable pre-checkout | ✅ Landed — `GET /storefront/v1/zones`                |
| Order view / polling                 | ✅ Landed — `useOrder(id)` + session-bound order auth |
| Order items on the order view        | Phase 2a                                              |
| Order notes                          | Phase 2a                                              |
| Structured address                   | Phase 2a                                              |
| Orders-by-phone                      | Phase 2a                                              |
| Realtime order updates               | Phase 2a                                              |
| `imageUrl` / gallery                 | Phase 2b                                              |
| Stock quantity + low-stock           | Phase 2b                                              |
| Combos / kits                        | Phase 2b                                              |
| Preorder / encomendas                | Phase 2b                                              |
| Coupons                              | Phase 2c                                              |
| Waitlist                             | Phase 2c                                              |
| Loyalty card                         | Phase 2c                                              |
| `?cart=` share links                 | Phase 2c                                              |
| CEP lookup + distance pricing        | Phase 2c                                              |
| Pix key on store profile             | Phase 2c (fields) + Phase 3 (capture)                 |

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
- `fleet-*` sharding itself — rehearsed in Phase 8, executed on trigger.
- Third-party courier/dispatch integrations — after Phase 8.
