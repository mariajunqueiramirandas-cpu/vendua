# Venduá

Monorepo for the Venduá platform: a vertical SaaS that produces and operates
bespoke, code-generated storefronts for small food businesses on a shared
backend (Venduá Core) and a shared frontend runtime (the Kernel).

**Status: Phase 0.** Core + Kernel skeletons exist (`packages/core`,
`packages/kernel`); spike storefronts live under `storefronts/`. The design
docs in [`docs/`](docs/) are normative — start at
[`docs/README.md`](docs/README.md) for the reading order,
[`docs/roadmap.md`](docs/roadmap.md) for the build order and fleet gates,
and [`docs/contract-v1-draft.md`](docs/contract-v1-draft.md) for the drafted
Contract v1 built from Phase 0 observations.

## Layout

```
vendua/
  site/          # @vendua/site — the Venduá marketing/teaser site (SvelteKit).
                 # Not a storefront; does not consume the Kernel.
  packages/      # platform packages: core, kernel exist; ui-defaults, cli,
                 # conformance, codemods, loader, control-plane, admin, edge
                 # are Phase 1+
  storefronts/   # one package per storefront: _template, _examples, <slug>…
  tools/         # repo-level CI utilities, affected-graph scripts
  docs/          # normative architecture docs, ADRs, roadmap, summaries
  .omp/          # omp agent config: RULES.md (sticky rules), agents/
  .agents/       # skills/ — custom agent skills (omp + Devin convention)
  .claude/       # agents/ — task-agent mirrors for Claude Code / Devin
  AGENTS.md      # repo instructions for coding agents (site/AGENTS.md nests)
```

Rationale and isolation rules:
[`docs/architecture/06-monorepo.md`](docs/architecture/06-monorepo.md) +
[ADR 0001](docs/adr/0001-monorepo-for-storefronts.md).

## Working on the site

```sh
bun install
bun run dev        # http://127.0.0.1:5173
bun run check      # svelte-check
bun run build      # static build → site/build/
bun run test:e2e   # Playwright suite (starts preview automatically)
```

All root scripts delegate to `@vendua/site` via `bun --filter`; see
[`site/README.md`](site/README.md) for the full site documentation (pt-BR).

## Working on the platform

```sh
cd packages/core
docker compose up -d            # postgres :5433
bun run migrate && bun run seed # schema + 3 seeded tenants
bun run dev                     # API on :8787, tenant by Host header
```

Storefronts (React + `@vendua/kernel`) live in `storefronts/<slug>/` and
dev-serve via vite, proxying `/storefront`, `/checkout`, `/v1` to Core.
See [`packages/core/README.md`](packages/core/README.md) and
[`packages/kernel/README.md`](packages/kernel/README.md).
