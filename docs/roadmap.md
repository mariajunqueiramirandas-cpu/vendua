# Roadmap

> Status: Proposed · Last reviewed: 2026-09-11

Build order. Each phase has explicit exit criteria — do not start the next phase
until they hold. The ordering is deliberate: every phase exists to _discover or
de-risk_ something the next phase depends on.

## Phase 0 — Contract extraction spikes (weeks 0–4)

Goal: stop guessing what the Contract must be.

- [ ] Core skeleton: tenancy, catalog, store settings/hours, server-side cart,
      checkout stub, orders. Postgres + `tenant_id` everywhere.
- [ ] Rough Kernel: provider, 3–4 hooks, 3–4 primitives, `<SystemSurfaces />`
      with only a generic notice renderer.
- [ ] Build **3–5 storefronts semi-manually** (agent-assisted, human-steered),
      starting by porting the existing Quero Pudim Gourmet storefront.
- [ ] Write down every place a store needed to touch behavior that should have
      been central — those become slots/primitives/API fields.

Exit: Contract v1 drafted from _observed_ needs, not designed in the abstract.

## Phase 1 — Contract v1 + Conformance (weeks 4–8)

- [ ] Freeze Contract v1 ([03](architecture/03-storefront-contract.md)):
      `vendua.config.ts`, required mounts, reserved system routes, primitives,
      budgets, dependency policy.
- [ ] `@vendua/conformance` v1: commerce flow, paused/closed states, viewports,
      a11y baseline, byte budget — modeled on the teaser site's existing suite
      (see `tests/site.spec.ts` and `VALIDACAO.md`).
- [ ] Monorepo scaffold (`storefronts/<slug>`, `@vendua/cli scaffold`),
      CODEOWNERS + changed-path CI check.

Exit: `vendua scaffold && vendua build && vendua qa` is green on a fresh
storefront without any custom code.

## Phase 2 — Core to production quality (weeks 6–14, overlaps)

- [ ] Mercado Pago OAuth + `application_fee` + PIX + webhook-driven order state
      machine ([13](architecture/13-payments.md)).
- [ ] Server-driven notices end-to-end: emit `store_paused` from Core, watch an
      _unmodified_ storefront render it ([05](architecture/05-system-surfaces.md)).
- [ ] Merchant admin MVP (catalog CRUD, hours, orders, MP connect).
- [ ] `slug.vendua.com.br` auto-provisioning + wildcard TLS
      ([12](architecture/12-domains-and-tls.md)).
- [ ] Edge v1: artifact serving + `vendua-state` injection
      ([07](architecture/07-deployment-and-hosting.md)).

Exit: a real merchant takes a real paid order on a `*.vendua.com.br` domain with
a storefront built only of Kernel defaults + tokens.

## Phase 3 — Control Plane v1 (weeks 10–16)

- [ ] Schema + reconciler: tenants, storefronts, releases, deployments, domains,
      health ([08](architecture/08-control-plane.md)).
- [ ] CLI-first fleet ops; UI later. Synthetic health probes per hostname.
- [ ] Release promotion/rollback as pointer flips.

Exit: `vendua-fleet releases promote <storefront> <release>` and
`vendua-fleet status` answer real questions.

## Phase 4 — First fleet train (weeks 14–18)

- [ ] Ship a real Kernel minor through canary → early → stable with gates
      ([09](architecture/09-migrations-and-fleet-trains.md),
      [11](architecture/11-backward-compatibility.md)).
- [ ] Deliberately ship one server-driven feature (e.g. "delivery estimate"
      notice) and verify it reaches a storefront that was never rebuilt.

Exit: a fleet train is _boring_. If it isn't boring, fix it before Phase 5.

## Phase 5 — Agent generation pipeline (weeks 16–24)

- [ ] DesignSpec schema + validation ([14](architecture/14-agent-pipeline.md)).
- [ ] Agent task runner: scaffold → agent PR → conformance + generation QA →
      fix loop → human approval → provisioner.
- [ ] Failure-bundle format + agent queue in the Control Plane.
- [ ] Track the metrics: iterations-to-green, agent-minutes per storefront,
      post-launch defect rate.

Exit: a new storefront goes from DesignSpec to live `*.vendua.com.br` site with
at most one human approval gate.

## Phase 6 — Scale hardening (ongoing, before ~50 tenants)

- [ ] `v.js` loader live on all storefronts ([05](architecture/05-system-surfaces.md#the-loader-vjs)).
- [ ] Custom-domain automation incl. failure UX ([12](architecture/12-domains-and-tls.md)).
- [ ] Core HA: multi-instance, managed Postgres or rehearsed failover,
      last-known-good serving ([16](architecture/16-operations-and-incidents.md)).
- [ ] WhatsApp intake agent → DesignSpec (only after the pipeline above is
      proven; intake automation is its own product).
- [ ] First Contract major rehearsal on a staging cohort before it's ever needed
      for real.

## Explicitly deferred

- Multi-framework support — never; [ADR 0002](adr/0002-single-storefront-framework-react.md).
- Per-storefront servers — never; [ADR 0003](adr/0003-storefronts-as-artifacts.md).
- Multi-tenant SSR host — only if product-page SEO/personalization proves the
  need; [07](architecture/07-deployment-and-hosting.md#option-b--multi-tenant-ssr-host-deferred).
- Repo-per-storefront — [ADR 0001](adr/0001-monorepo-for-storefronts.md).
- Microservices in Core — [ADR 0013](adr/0013-modular-monolith-core.md).
- Third-party courier/dispatch integrations — after Phase 6.
