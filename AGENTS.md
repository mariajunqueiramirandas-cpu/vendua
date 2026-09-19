# Venduá — agent instructions

Applies to every session in this repository. Written for any coding agent
that reads `AGENTS.md` (omp, Devin, Claude Code, Cursor). Nested `AGENTS.md`
files apply to their own directory.

## Project snapshot

- Venduá platform monorepo, **Phase 0 in flight**. The design docs in
  `docs/` are normative and design-complete.
- `site/` — `@vendua/site`, a SvelteKit teaser site. It is NOT a storefront
  and does not consume the Kernel (ADR 0002).
- `packages/core` — `@vendua/core`: Bun + Hono + Postgres skeleton (tenancy,
  catalog, settings/hours, server-side cart, checkout stub, orders). RLS on
  every table from the first migration.
- `packages/kernel` — `@vendua/kernel`: React runtime — provider, hooks,
  headless primitives, `<SystemSurfaces />` generic notice renderer.
- `storefronts/` — React spike storefronts consuming the Kernel. Storefronts
  are React; the site is SvelteKit. Never mix the two.
- `docs/roadmap.md` is the build order. `docs/phase-0-findings.md` collects
  observed contract touchpoints; `docs/contract-v1-draft.md` is the drafted
  Contract v1 from those observations.

## Repo map

```
site/            @vendua/site — SvelteKit teaser site
packages/core    @vendua/core — Hono API + Postgres (tenant_id + RLS)
packages/kernel  @vendua/kernel — React runtime for storefronts
packages/        other platform packages (Phase 1+)
storefronts/     one package per storefront (React + Kernel; `_examples/`, `_template/` reserved)
tools/           repo-level CI utilities (empty; Phase 1)
docs/            normative architecture, ADRs, roadmap — read before designing
.devin/agents/   Devin subagent profiles — auto-load in Devin CLI/Desktop
.agents/skills/  custom skills — auto-discovered by Devin (omp agents provider)
.claude/agents/  task-agent mirrors for Claude Code
.omp/            omp config: RULES.md (sticky rules), agents/ (task agents)
```

## Setup — fresh machine / Devin Cloud

```sh
export PATH="$HOME/.bun/bin:$PATH"  # bun is NOT on PATH by default
bun install                       # workspace root; bun.lock is authoritative
bunx playwright install chromium  # once, required for test:e2e
```

Bun 1.4.2 (pinned in `packageManager`). Core needs Postgres — see
`packages/core` below.

### packages/core dev loop

```sh
cd packages/core
docker compose up -d              # postgres:16 on localhost:5433 (vendua/vendua)
bun run migrate && bun run seed   # schema + 3 seeded tenants
bun run dev                       # API on :8787; tenant resolved from Host
bun run check && bun test         # tsc + bun:test
```

Tenant resolution: `Host`/`x-forwarded-host` → `domains` table. Seeded dev
hosts: `localhost:5174` quero-pudim, `localhost:5191` brasa,
`localhost:5192` forn. Storefront vite servers proxy `/storefront`,
`/checkout/v1`, `/v1` to :8787 — **object-form proxy entries only** (string
shorthand forces `changeOrigin:true`, rewrites Host → `TENANT_NOT_FOUND`),
and never a bare `/checkout` key (swallows the SPA route on reload).
Reserved API prefixes — no page route may live under `/storefront`, `/v1`,
or `/checkout/v1`.

postgres.js footgun: never pass `JSON.stringify(x)` into a jsonb param — it
double-encodes to a JSON string. Use `sql.json(x)`/`tx.json(x)`.

## Commands

Run from repo root; all delegate to `@vendua/site` via `bun --filter`.

| Command                | Proves                                   |
| ---------------------- | ---------------------------------------- |
| `bun run check`        | svelte-check — must report 0 errors      |
| `bun run build`        | static build → `site/build/`             |
| `bun run test:e2e`     | 16 Playwright tests; auto-starts preview |
| `bun run format:check` | prettier clean (config at repo root)     |

Per-package `bun run check`/`bun test` inside `packages/core`,
`packages/kernel`, `storefronts/<slug>` — run the package's own gate when you
touch it.

`test:e2e` requires a prior `bun run build` — the preview serves `site/build/`.

## Hard rules

- Never commit, push, open a PR, or merge unless the user explicitly asks — or a governing contract authorizes it for the task (e.g. `roadmap-executor` under `auto` policy merges its own PR once its gate passes).
- Never run destructive commands (rm -rf, git reset --hard, dropping data)
  without explicit confirmation.
- Never fabricate: no unverified claims, invented APIs, or "done" without
  running the check.
- Never edit generated files, lockfiles, or vendored code by hand.
- Ask before deleting code you didn't write or expanding scope beyond the
  request.

Mirrored in `.omp/RULES.md` for omp's sticky-rule enforcement — keep in sync.

## How to work

- Correctness first, then maintainability. Prefer the boring, proven option
  over the clever one.
- Read before editing: reuse existing patterns and conventions in the
  codebase. Never introduce a second convention beside an existing one.
- Fix root causes, not symptoms. No special-casing inputs, suppressing
  warnings, or papering over errors unless explicitly asked.
- Clean cutovers: when changing a contract, migrate every caller. No shims,
  aliases, or deprecated paths left behind.
- Delete weightless code. Refuse needless abstractions. The best change is
  often a deletion.

## Verification

- Never claim done without proof: run the test, command, or scenario that
  exercises the change, and name it with its result.
- Bug fixes: reproduce first, fix, confirm the reproduction no longer
  triggers.
- Match the project's existing test conventions; don't add test scaffolding
  where none exists.

## Delegation — delegate by default

- You are an orchestrator, not an implementer. Spawn a subagent for anything
  that is: a separate file/module, an independent investigation, a
  verification pass, a research or search task, an edit touching more than a
  couple of spots, or anything parallelizable with other work. When in
  doubt, delegate — the only work that stays in the top-level session is
  trivial, single-point edits you can verify immediately.
- Decompose at planning time: turn the task into self-contained,
  subagent-shaped units with clear acceptance checks, then fan out.
  - Devin Cloud: read the profile file and pass its body verbatim as the
    child-session or workflow-agent prompt.
  - Devin CLI/Desktop: profiles auto-load; invoke by name.
- Pick the most specific profile available: `architect` for read-only
  analysis/design, `debugger` for unknown faults, `verifier` for
  post-implementation checks, `frontend-designer` for UI, a general task
  agent for implementation.
- **Any UI/frontend work — pages, components, layouts, styling, design
  systems, landing pages, dashboards — goes to a design-specialist
  subagent** (`frontend-designer`). It carries the `frontend-design`
  anti-slop contract; never hand UI to a generic agent.
- In Devin Cloud, verifying a running app in the browser goes to the
  testing agent — not a code-reading subagent.
- Fan out independent slices in one batch; never serialize work that can
  run in parallel.
- Keep interpretation, decomposition, and taste at the top level. Give each
  subagent complete, self-contained instructions and a clear acceptance
  check.
- A subagent's "done" is a claim, not proof — verify its output before
  reporting.

## Anti-slop framework

Before yielding any non-trivial work, run this gate:

1. **Real, not plausible** — the deliverable works end-to-end; no stubs, no
   "should work", no narrowed scope.
2. **Checked, not assumed** — you ran the specific test/command/scenario and
   can state the result.
3. **Root, not symptom** — the fix addresses the cause; nothing is
   suppressed or special-cased to hide it.
4. **Lean, not padded** — no dead code, no speculative abstraction, no
   unrequested extras.
5. **Honest, not smooth** — if something is missing or unverified, say
   exactly what; never paper over a gap.

## Frontend design

- Treat `frontend-design` as the mandatory contract for all UI work. Its
  slop checklist is a reject-on-sight list: generic hero, feature-card
  grid, purple gradient, Inter-by-default, fake content, happy-path-only.
- The bar is "could only have been made for this product". If swapping the
  logo makes it generic, it's slop — redo it.
- Design every state, not just the happy path. Verify against the rendered
  surface, not just the code.

## Evolving these instructions

These files are living documents. When you learn something durable about
this repo, write it down — the next agent (human or machine) should not
have to rediscover it.

**Record when you learn:**

- A command, flag, or sequence that wasn't obvious (setup, build, deploy,
  debugging).
- A pitfall that cost you time: a footgun, a misleading error, a config
  that must live somewhere unexpected.
- A convention the codebase follows that isn't written down.
- A reusable procedure worth repeating — that's a new skill, not a note.

**Where to write it:**

| Learning                               | File                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| Repo-wide workflow, commands, pitfalls | `AGENTS.md`                                                           |
| Site-specific workflow or pitfall      | `site/AGENTS.md`                                                      |
| A hard rule that must always hold      | § Hard rules here + `.omp/RULES.md`                                   |
| A reusable procedure/playbook          | `.agents/skills/<name>/SKILL.md`                                      |
| A subagent contract                    | `.devin/agents/<name>.md` + `.claude/agents/`, `.omp/agents/` mirrors |
| Architecture or design decision        | `docs/` (ADRs for decisions)                                          |

**Rules:**

- Edit the file closest to the knowledge. Terse, concrete, verified —
  same bar as code.
- No session trivia: "fixed bug X" is git history, not an instruction.
  Record the _generalizable_ lesson.
- Keep it small: these files load into every session's context. Every
  line must earn its tokens.
- Repo copies are canonical. `~/.omp/agent/AGENTS.md` and `RULES.md` are
  global snapshots — refresh them when the repo versions change.
- New skills need `name` + `description` frontmatter and live one level
  under `.agents/skills/`; new subagents need the same frontmatter and live
  flat under `.devin/agents/`.

## Communication

- Terse and concrete: exact files, symbols, APIs. Facts, decisions, risks —
  no filler or ceremony.
- State uncertainty at the claim. Name the tradeoff. Push back on risky
  plans with evidence.
