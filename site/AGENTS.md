# site/ — @vendua/site

Applies to work under `site/`. Root `AGENTS.md` applies too; this file adds
site-specific rules.

## What this is

The Venduá marketing/teaser site. SvelteKit + Svelte 5, fully static via
adapter-static, no backend, no forms, no analytics. It is **not** a
storefront and does not consume the Kernel — the platform Contract does not
apply here.

## Commands (run from repo root)

- `bun run dev` — dev server at `http://127.0.0.1:5173`
- `bun run check` — svelte-check; must be 0 errors
- `bun run build` — static build → `site/build/` (runs content validation
  - postbuild)
- `bun run test:e2e` — 16 Playwright tests; needs a prior `bun run build`
- `bun run format` / `format:check` — prettier, config at repo root
  (`--config ../.prettierrc.json`)

## Conventions

- Content lives in `src/lib/content/site.ts` — copy changes go there, not
  inline in components.
- `VALIDACAO.md` is the acceptance contract (pt-BR): functional criteria
  F01–F05, budgets, no-JS behavior. Read it before changing behavior.
- Tests: `tests/site.spec.ts` — viewports 320–1440, axe, no-JS, byte
  budgets, link checks. Extend this file; don't create parallel suites.
- Screenshots/perf output go to `artifacts/` (gitignored).
- Docs and site copy are pt-BR; platform docs in `../docs/` are English.

## Pitfalls

- `bun.lock` is at the workspace root — never create a site-local lockfile.
- Docker builds use the **repo root** as context:
  `docker build -f site/Dockerfile -t vendua .`
- `.svelte-kit/` is generated — never edit or commit it.
- `publicDomain` in `site.ts` gates canonical/OG/sitemap output; leave it
  empty until the real domain is confirmed.
