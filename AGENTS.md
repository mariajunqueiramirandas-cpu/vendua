# Venduá — agent instructions

Applies to every session in this repository. Written for any coding agent
that reads `AGENTS.md` (omp, Devin, Claude Code, Cursor). Nested `AGENTS.md`
files apply to their own directory.

## Project snapshot

- Venduá platform monorepo, **pre-Phase 0**. The design docs in `docs/` are
  normative and design-complete; almost no platform code exists yet.
- The only real code is `site/` — `@vendua/site`, a SvelteKit teaser site.
  It is NOT a storefront and does not consume the Kernel (ADR 0002).
- Storefronts will be React; the site is SvelteKit. Never mix the two.
- `docs/roadmap.md` is the build order. Phase 0 = monorepo skeleton (done),
  Core/Kernel skeletons, 3–5 spike storefronts. Do not create `packages/*`
  or `storefronts/*` stubs ahead of it.

## Repo map

```
site/            @vendua/site — SvelteKit teaser site (the only app today)
packages/        platform packages (empty; Phase 0+)
storefronts/     one package per storefront (empty; Phase 0+)
tools/           repo-level CI utilities (empty; Phase 1)
docs/            normative architecture, ADRs, roadmap — read before designing
.omp/            omp config: RULES.md (sticky rules), agents/ (task agents)
.agents/skills/  custom skills (omp agents provider + Devin convention)
.claude/agents/  task-agent mirrors for Claude Code / Devin import
```

## Setup — fresh machine / Devin Cloud

```sh
bun install                       # workspace root; bun.lock is authoritative
bunx playwright install chromium  # once, required for test:e2e
```

Bun 1.4.2 (pinned in `packageManager`). No env vars, secrets, or services —
the site is fully static.

## Commands

Run from repo root; all delegate to `@vendua/site` via `bun --filter`.

| Command | Proves |
| --- | --- |
| `bun run check` | svelte-check — must report 0 errors |
| `bun run build` | static build → `site/build/` |
| `bun run test:e2e` | 16 Playwright tests; auto-starts preview |
| `bun run format:check` | prettier clean (config at repo root) |

`test:e2e` requires a prior `bun run build` — the preview serves `site/build/`.

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

## Delegation — default to subagents

- Bias hard toward delegating. Spawn a subagent for anything that is: a
  separate file/module, an independent investigation, a verification pass,
  or parallelizable with other work.
- Pick the most specific agent available: explore with a scout-type agent,
  design with an architect-type, verify with a verifier-type, debug with a
  debugger-type, implement with a general task agent. In omp these exist as
  `scout`, `architect`, `verifier`, `debugger`, `task`, `sonic`; in Devin,
  spawn the equivalent focused subagent.
- **Any UI/frontend work — pages, components, layouts, styling, design
  systems, landing pages, dashboards — goes to a design-specialist
  subagent** (omp: `frontend-designer`). It carries the `frontend-design`
  anti-slop contract; never hand UI to a generic agent.
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

| Learning | File |
| --- | --- |
| Repo-wide workflow, commands, pitfalls | `AGENTS.md` |
| Site-specific workflow or pitfall | `site/AGENTS.md` |
| A hard rule that must always hold | `.omp/RULES.md` (keep it short) |
| A reusable procedure/playbook | `.agents/skills/<name>/SKILL.md` |
| Architecture or design decision | `docs/` (ADRs for decisions) |

**Rules:**

- Edit the file closest to the knowledge. Terse, concrete, verified —
  same bar as code.
- No session trivia: "fixed bug X" is git history, not an instruction.
  Record the *generalizable* lesson.
- Keep it small: these files load into every session's context. Every
  line must earn its tokens.
- Repo copies are canonical. `~/.omp/agent/AGENTS.md` and `RULES.md` are
  global snapshots — refresh them when the repo versions change.
- New skills need `name` + `description` frontmatter and live one level
  under `.agents/skills/` to be discovered.

## Communication

- Terse and concrete: exact files, symbols, APIs. Facts, decisions, risks —
  no filler or ceremony.
- State uncertainty at the claim. Name the tradeoff. Push back on risky
  plans with evidence.
