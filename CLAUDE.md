# Venduá — notes for Claude

Monorepo (bun workspaces): `packages/core` (Hono + Postgres API), `packages/kernel`
(storefront runtime, 1.x = Contract 2 — public surface in `packages/kernel/API.md`),
`packages/ui-defaults` (slot defaults + all default CSS), `packages/templates` (template
model, migrations, tokens, compat matrix), `packages/loader` (`v.js`), `packages/codemods`,
`packages/conformance`, `packages/cli`, `apps/control` (staff CRM console, React),
`apps/admin` (merchant admin PWA at `/admin/`, API `/admin/v1`),
`storefronts/*`, `site/`. `docs/README.md` has the architecture.

## Invariants (bugs if broken)

- Tenant isolation: every table has `tenant_id` + an RLS policy; every request-scoped query
  runs under `SET LOCAL app.tenant_id` (`platform/db.ts`).
- Money is integer cents, computed only in Core — clients never recompute totals.
- Every mutating endpoint takes an `Idempotency-Key` through the claim pattern in
  `platform/http.ts`; checkout creates at most one order per cart.
- Storefronts talk to Core only through the kernel api client (never raw `fetch`).
- Inputs are bounded (length/size caps) and bad ids return stable 4xx, never a 500.
- Storefront pages are templates (Core data) + sections; store code never calls cart
  mutations or builds product URLs by hand, and store CSS never targets `.v-*` /
  `[data-vendua]` — `vendua check` (K01–K15) enforces it.
- Kernel changes are additive within a Contract major; a new export needs `API.md` +
  `test/api-surface.test.ts`, a version bump and a `CHANGELOG.md` line.
- Agent work is requested only through `requestAgentTx` (`agent/dispatch.ts`) with a `source`;
  nothing else inserts runs. Future touches on a lead are `agent_wakeups` rows (ADR 0016).

## Toolchain

- bun is pinned (`packageManager`, currently 1.4.2). Another version rewrites `bun.lock` —
  check `bun --version` before `bun install`; CI installs with `--frozen-lockfile`.
- Format: `bunx prettier --write <paths>` (CI auto-fixes, but keep diffs clean).
- Typecheck per workspace: `bun run check`. Core tests: `cd packages/core && bun test`
  (`TEST_DATABASE_URL` is exported by the session hook).
- Comments are sparse — only non-obvious _why_.
- Kernel tests run in happy-dom (`packages/kernel/bunfig.toml` preloads it).
- Conformance e2e in a container: add `/etc/hosts` lines for `qa-*.localhost` (no
  system resolver for `*.localhost`) and pass `CHROMIUM=/opt/pw-browsers/chromium`.

## Working here

- Starting Core / the CRM / the admin, seeding, screenshots, fleet commands and Docker: the
  `local-stack` skill (`.claude/skills/local-stack/SKILL.md`). `apps/control` and `apps/admin`
  each have a `CLAUDE.md` with their UI rules; it loads when you work in that app.
- Don't `pkill -f <pattern>` (or `pgrep -f` + kill) where the pattern also appears in your
  own command line — it kills the shell running it. Save `$!` to a pidfile instead.
- Some files are huge: `packages/core/src/agent/runner.ts`, `agent/tools.ts` and `src/app.ts`
  (~100 KB each), `test/agent-reclaim.test.ts` (~200 KB). Grep for the symbol and Read a
  line range — never the whole file.
- `.claude/settings.json` blocks reading `bun.lock` and build output (`dist/`, `qa-report/`)
  and runs prettier on every file Claude writes.

## Subagents

Subagents run on Sonnet 5.5 at low effort (`.claude/settings.json`) unless their definition
pins a model; only their final report enters your context. Agents: `test-runner`,
`invariant-reviewer` and `frontend-designer` (Opus 5.5, medium effort) in this repo, `Explore`
(read-only search), `Plan`, `general-purpose` (can edit).

UI and frontend design work is always done by Opus 5.5: screens, components, layout, styling,
responsive or dark-mode work and visual polish in `apps/control`, `apps/admin`,
`storefronts/*`, `packages/ui-defaults` or `site/`. If this session runs on Opus 5.5 you may do
it yourself; on any other model, hand it to `frontend-designer`. Never give design or UI edits
to `general-purpose` or `Explore` (Sonnet); they can still research or do non-visual work.

Check these triggers mid-task too, not only at the start:

- About to run a suite, a multi-workspace `bun run check`, e2e or read a long log → `test-runner`.
- About to open a third file just to answer "where/how is X done" → `Explore`.
- A change touches money, tenancy, idempotency, kernel exports or agent runs → after editing,
  `invariant-reviewer` on the diff.
- Stuck on a failure after two attempts → one agent to investigate it cold while you continue.

Splitting a task that spans areas (e.g. Core route + admin screen + kernel export):

- Research in parallel — one agent per area, all in one message — then decide the design yourself.
- The UI part of a mixed task goes to `frontend-designer` (unless you're on Opus 5.5), with the
  API shape it will consume settled first.
- Edits: do them yourself, or give parallel `general-purpose` agents disjoint file sets
  (never two on one file); run the checks once all are back.
- Don't split when each step needs the previous step's details, or the whole thing is a few edits.

A subagent sees none of the conversation. Its brief needs the goal, exact paths, the
constraints that apply (quote the invariant) and the answer format ("under 200 words,
file:line refs"). Don't redo its search; verify a surprising claim with one targeted Read.

## PRs

No automated reviewer runs on PRs — don't wait for review comments. Once CI is green the PR
is ready to merge. If a human leaves review comments, fix real ones, reply on every thread
(with the commit) and resolve it.
