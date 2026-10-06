# Venduá

Monorepo for the Venduá platform: a vertical SaaS that produces and operates
bespoke, code-generated storefronts for small food businesses on a shared
backend (Venduá Core) and a shared frontend runtime (the Kernel).

**Status: Phase 1 done; the sales-side agent engine shipped ahead of
schedule.** `packages/core` + `packages/kernel`, the storefront factory
(Contract, conformance, CLI, isolation) and `apps/control` — the Founder CRM
grown into an agent ops console — all exist. Core also carries the outbound
agent engine (negotiation runs, simulation harness, guardrails, reporting);
see the [Where we are](docs/roadmap.md#where-we-are) table in the roadmap for
the current-state ledger. The design docs in [`docs/`](docs/) are normative —
start at [`docs/README.md`](docs/README.md) for the reading order,
[`docs/roadmap.md`](docs/roadmap.md) for the build order and fleet gates,
and [`docs/contract-v1-draft.md`](docs/contract-v1-draft.md) for the drafted
Contract v1 built from Phase 0 observations.

## Layout

```
vendua/
  site/          # @vendua/site — the Venduá marketing site (SvelteKit).
                 # Not a storefront; does not consume the Kernel.
  apps/          # apps/control — staff console: CRM board, agent ops (threads,
                 # plan board, discovery, digest settings)
  packages/      # platform packages: core (+ the Control Plane), kernel, cli,
                 # conformance, ui-defaults, codemods, loader, templates, edge
  storefronts/   # one package per storefront: _template, <slug>…
  tools/         # repo-level CI utilities, affected-graph scripts
  docs/          # normative architecture docs, ADRs, roadmap, summaries
```

Rationale and isolation rules:
[`docs/architecture/06-monorepo.md`](docs/architecture/06-monorepo.md) +
[ADR 0001](docs/adr/0001-monorepo-for-storefronts.md).

## Working on the site

```sh
bun install
bun run dev        # http://127.0.0.1:5173
bun run check:site # svelte-check
bun run build      # static build → site/build/
bun run test:e2e   # Playwright suite (starts preview automatically)
```

`dev`, `build`, `preview`, `format` and `test:e2e` delegate to `@vendua/site` via `bun --filter`
(`check:site` is its typecheck alone); see [`site/README.md`](site/README.md) for the full site
documentation. `bun run check` and `bun run test` run every workspace's check and unit tests the
way CI does (`tools/workspaces.mjs`; Core's database tests stay in `packages/core`).

## Working on the platform

```sh
bun run dev:stack               # Core :8787, merchant admin :5196, CRM :5195 (--seed fills them)
bun run dev:stop                # stops what dev:stack started
```

Or Core by hand:

```sh
cd packages/core
docker compose up -d            # postgres :5433
bun run migrate && bun run seed # schema + one blank dev tenant, quero-pudim, with its owner
bun run dev                     # API on :8787, tenant by Host header
```

Storefronts (React + `@vendua/kernel`) live in `storefronts/<slug>/` and
dev-serve via vite, proxying `/storefront`, `/checkout`, `/v1` to Core.
See [`packages/core/README.md`](packages/core/README.md) and
[`packages/kernel/README.md`](packages/kernel/README.md).
