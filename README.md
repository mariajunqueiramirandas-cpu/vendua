# Venduá

Monorepo for the Venduá platform: a vertical SaaS that produces and operates
bespoke, code-generated storefronts for small food businesses on a shared
backend (Venduá Core) and a shared frontend runtime (the Kernel).

**Status: pre-Phase 0.** The platform is design-complete on paper; no platform
code exists yet. The design docs in [`docs/`](docs/) are normative — start at
[`docs/README.md`](docs/README.md) for the reading order, or
[`docs/roadmap.md`](docs/roadmap.md) for the build order and fleet gates.

## Layout

```
vendua/
  site/          # @vendua/site — the Venduá marketing/teaser site (SvelteKit).
                 # Not a storefront; does not consume the Kernel.
  packages/      # platform packages: core, kernel, ui-defaults, cli,
                 # conformance, codemods, loader, control-plane, admin, edge
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
