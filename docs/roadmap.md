# Roadmap

> Status: In progress · Last reviewed: 2026-09-26

## Where we are

| Phase                         | State   | Notes                                                                                                                      |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0 — Foundations               | ✅ Done | Monorepo, Core skeleton, Kernel, 3 spike storefronts, Contract v1 drafted                                                  |
| 1 — Storefront factory        | ✅ Done | Contract frozen, conformance, CLI, fleet isolation, Founder CRM — which has since grown well past its v0 scope (see below) |
| 1b — Kernel v1 + updatability | ⬜ Next | **Current priority.** Complete SDK surface + proven update path, before any customer                                       |
| 2 — Commerce completeness     | ⬜ Open | Order lifecycle, catalog depth, growth surfaces — all unchecked                                                            |
| 3 — Payments + merchant admin | ⬜ Open | The "buy a plan → provisioned store" self-serve path; starts once 1b's exit is met                                         |
| 4 — First tenant operated     | ⬜ Open | Edge, Control Plane v0, provisioner — the other half of the 1-hour signup→store promise                                    |
| 5–8 — Fleet loop → scale      | ⬜ Open | Blocked on 2–4 having a fleet to operate                                                                                   |

**Ahead of the roadmap:** the Founder CRM (`apps/control`) grew into the agent
ops surface, and the sales-side agent engine shipped on `packages/core` —
the same `agent_runs` machinery the Phase-6 generation pipeline will reuse:

- **Outbound negotiation loop** — reply / outreach / discovery / strategist
  jobs (staff-card triage folded into outreach); per-lead negotiation
  checklist (`leads.agent_plan`), dossier + intent/goal fields, agent-driven
  `unsubscribe` with a farewell, `request_human` escalation, quotable-facts
  offer (`pitch.offer`).
- **Agent v2** ([ADR 0014](adr/0014-crm-agent-v2.md)) — one module per tool
  with metadata, autonomy policy, self-scheduled `agent_wakeups`, memory v2
  (`agent_memory_items` + structured `lead_facts`), `agent_run_steps` journal,
  per-lead inbox with one active run per lead, lifetime per-lead cost cap.
- **One agent, one dispatcher, one scheduler** — a single `agent` setting
  (preset slider + job switches, [ADR 0015](adr/0015-one-agent-config.md));
  `requestAgentTx` is the only producer and runs carry `source` provenance
  ([ADR 0016](adr/0016-agent-dispatch-and-scheduler.md)); the scheduler sleeps
  until the next due time and wakes on `pg_notify`, no tick
  ([ADR 0017](adr/0017-due-time-scheduler.md)).
- **Channels** — email, WhatsApp (pair code/QR, history-sync ingest, LID/PN
  alias merge) and Instagram cold-outreach DMs via the `ig-sidecar`; tools
  the install can't run are hidden from the model instead of erroring.
- **Simulation harness** — `bun run sim` drives the real pipeline against
  persona-LLM leads and an LLM judge; results persist to `sim_runs`. Scripted
  provider tests cover the agent deterministically in CI.
- **Worker robustness** — attempt caps + backoff, journal replay/resume,
  claim-fenced mutating tools, stranded-run recovery, per-lead serialization.
- **Ops surfaces** — the redesigned console (Hoje, Pipeline, Inbox +
  approvals, Planos, Estúdio, Relatórios, Config) with SSE live updates and
  real phone layouts; daily digest email, channel-health chip, CPL per
  segment, stale-draft regen, run provenance labels.
- **Backlog** — [`agent-improvements.md`](agent-improvements.md) is the
  maintained list; every numbered item has shipped, two follow-ups remain.

**Priority call (2026-09-26): no customers before the Kernel is complete and
updatable.** Every store launched on an incomplete Kernel is a store that later
needs hand migration; the whole model depends on the first tenant already
sitting on a Kernel that can be changed under it without touching its code.
So [Phase 1b](#phase-1b--kernel-v1-complete-updatable-by-construction) comes
before the "ad → paid plan → agent-built store live in ~1 hour" path
(Phases 3/4) — the sales agent keeps building pipeline meanwhile, but nobody
is onboarded until 1b's exit is met.

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

| Stage        | N     | Must be true before growing past it                                                                                                                                                                                                   |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First store  | 1     | Phase 1b exit met (Kernel v1 complete; a Kernel minor and a Contract-major rehearsal reached every in-repo storefront untouched); real paid order taken; provision/promote/rollback ran through the Control Plane — zero manual steps |
| Pilot cohort | ~5    | Conformance + changed-path CI green on every storefront PR; probes live on all hostnames; `_examples/` seeded                                                                                                                         |
| Early fleet  | ~25   | One boring train shipped; one codemod rehearsal done; runbook covers the top 5 incidents                                                                                                                                              |
| Growth       | ~100  | Agent pipeline is the default intake; Core HA + LKG proven by a real failover drill; train cost measured                                                                                                                              |
| Fleet        | ~1000 | `fleet-*` shard rehearsed; Kernel publishing path proven; train economics budgeted                                                                                                                                                    |

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

## Phase 1 — The storefront factory (weeks 4–8) ✅

Goal: storefronts are _produced_, not hand-built — and the repo enforces it.

- [x] Freeze Contract v1 ([03](architecture/03-storefront-contract.md)):
      `vendua.config.ts`, required mounts, reserved system routes, primitives,
      budgets, dependency policy.
- [x] `@vendua/conformance` v1: commerce flow, paused/closed states, viewports,
      a11y baseline, byte budget — modeled on the teaser site's existing suite
      (see `site/tests/site.spec.ts` and `site/VALIDACAO.md`).
- [x] `@vendua/cli`: `scaffold`, `dev`, `check`, `build`, `qa`.
      `storefronts/_template` always green.
- [x] **Fleet isolation machinery**: CODEOWNERS, changed-path CI check
      (`storefront:<slug>` PRs touch only `storefronts/<slug>/**`), affected-
      graph build, cross-boundary import lint. This is the sandbox every later
      agent and contributor works inside.
- [x] **Founder CRM v0** — merchant-intake pipeline for Venduá itself: a
      `leads` table in Core + a staff-only board (lead → contacted → invited →
      live, notes per merchant). Doesn't wait for the Control Plane — merchant
      conversations start before the fleet exists, and tracking them in a
      spreadsheet is exactly the manual-ops debt this roadmap avoids. Phase 4
      merges it into the Control Plane's provisioner states.
      **Grown far past v0** — `apps/control` is now the agent ops console
      (inbox + approvals, Planos, Estúdio, discovery segments + CPL, digest
      and schedule settings); see [Where we are](#where-we-are).

Exit: `vendua scaffold && vendua build && vendua qa` is green on a fresh
storefront without any custom code — and a storefront PR physically cannot
touch platform code.

## Phase 1b — Kernel v1 complete, updatable by construction

Goal: the SDK a storefront is written against is finished, and every kind of
change in [09](architecture/09-migrations-and-fleet-trains.md#change-classes--process-map)
has been shipped to the in-repo storefronts (`_template`, `_examples/*`,
`quero-pudim`, `forn`, `brasa`) without hand edits. **No customer is onboarded
before this exit.** Items that used to sit in Phases 3, 5 and 6 moved here
because they are what "updatable" means; the ones that need real merchants
(early ring, volunteer discounts) stay where they were.

### 1b-i — The SDK surface ([02](architecture/02-kernel.md), [04](architecture/04-extensions-and-overrides.md))

- [ ] Default implementation for **every** registered slot. Today only the
      notice slots render; `checkout.*`, `cart.*`, `order.*`, `catalog.*`,
      `store.HoursTable` and `system.ConsentBanner` / `ErrorFallback` /
      `NotFound` / `EmergencyOverlay` exist only as keys in `SLOT_KEYS`.
      Token-driven, in `@layer vendua`, split out as `@vendua/ui-defaults`.
- [ ] Every slot renders a storefront override inside an error boundary with
      the default as fallback, plus a conformance fixture with canonical props.
      Unskip `[S05]` with a fixture storefront whose override throws.
- [ ] Missing primitives: `ProductLink`, `CheckoutButton`, `NotifyMeButton`,
      `Img` — each stamps its `data-vendua` hook and ARIA semantics.
- [ ] Missing hooks: `useDeliveryQuote`, `useCustomer`, `useAnalytics`; typed
      error codes map to default surfaces when the storefront doesn't handle
      them.
- [ ] Analytics beacon: primitives and surfaces emit the standard taxonomy
      ([15](architecture/15-analytics.md)); custom events go through an
      allow-listed `track()`.
- [ ] Token contrast check at build (WCAG AA on default surfaces blocks
      release).
- [ ] `vendua check` lint rules: `no-deep-kernel-imports`, `override-purity`,
      `require-primitives`, `no-v-namespace` (alongside the existing
      direct-fetch and slot-key checks).
- [ ] Kernel API review and freeze for v1.0: every export is intended, the
      `exports` map hides the rest, and each storefront in the repo builds on
      the frozen surface with no casts.

### 1b-ii — Updatability ([09](architecture/09-migrations-and-fleet-trains.md), [11](architecture/11-backward-compatibility.md))

- [ ] Kernel gets real semver (it is `0.0.0` today); the build writes an
      artifact manifest with Kernel version × Contract major × Core API majors,
      and CI checks it against a compat matrix.
- [ ] Staleness CI job: a reference storefront built on the oldest supported
      Kernel line re-runs the S-series on every Core and Kernel merge
      ([11](architecture/11-backward-compatibility.md#the-staleness-guarantee--tested-not-asserted)).
      _(was Phase 5)_
- [ ] `v.js` moves out of `packages/core/src/loader.ts` into `@vendua/loader`,
      built and versioned separately; per-tenant maintenance switch drilled on
      a Venduá-owned store. _(was Phase 5)_
- [ ] Server-driven notices end to end: Core emits `store_paused`, an
      unmodified storefront renders it; then ship one new notice kind and
      verify it reaches a storefront that was never rebuilt. _(was Phases 3
      and 5)_
- [ ] Train dry-run: a Kernel minor (e.g. a new slot default) rebuilds every
      in-repo storefront in one affected-graph run, conformance green on all,
      zero storefront diffs. Promotion by ring waits for the Control Plane
      (Phase 4); the build + judge half is proven here.
- [ ] `@vendua/codemods` + `vendua codemod run <id> --dry`, then a **Contract
      major rehearsal** (a slot rename with alias window) over every in-repo
      storefront: codemod, typecheck, conformance, failure-tail measured.
      _(was Phase 6)_
- [ ] Design updates through tokens: changing a storefront's tokens restyles
      every Kernel default and every `var(--v-*)` in its own CSS on the next
      build, with no component edits — asserted by a conformance visual
      check.

Exit: every slot, primitive and hook in the v1 spec exists with a default and a
fixture; a Kernel minor and a Contract-major rehearsal both reached every
in-repo storefront with zero hand edits; the stale reference storefront is green
in CI; `v.js` renders the kill switch on a broken build. **Gate for the first
customer.**

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
- [ ] **Self-serve signup + subscription billing** — the core product path
      once 1b is done: a visitor goes from plan selection on the site to a paid
      Venduá subscription and a provisioned store with zero staff
      involvement. Pre-auth signup surface in Core, a plan catalog
      (`tenants.plan` already exists), and Venduá-side recurring billing —
      distinct from shopper→merchant payments (which settle into the
      merchant's own MP account; this is the merchant paying Venduá).
      Paid signup hands off to the provisioner (Phase 4); the invite path
      stays for sales-assisted deals.
- Server-driven notices end to end moved to
  [Phase 1b](#1b-ii--updatability-09-11).

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
      provisioner state machine (tenant row → DNS → promote → live),
      triggered by either a staff invite or a paid self-serve signup.
- [ ] **Founder CRM → Control Plane** — the Phase-1 intake board folds into
      the Control Plane: `lead` records graduate into the provisioner's
      invite→live states, and self-serve signups enter the same pipeline
      directly — so onboarding is tracked in the same tool that operates
      the fleet, never a separate spreadsheet.

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
- [ ] `kernel_skew` alerts in the Control Plane on top of the compat matrix
      and stale-storefront CI job built in Phase 1b.
- [ ] Kill switch drilled on a real merchant's store
      ([16](architecture/16-operations-and-incidents.md#the-kill-switch)) —
      the loader itself and its first drill land in Phase 1b.

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
- [ ] Re-run the Contract-major rehearsal (first done in Phase 1b on the
      in-repo storefronts) on a staging cohort of agent-generated stores —
      their failure tail is the number that matters
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
