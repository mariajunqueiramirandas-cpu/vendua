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

Subagents run on Sonnet 5.5 (`.claude/settings.json`); only their final report enters your
context. Delegate when the work is noisy or wide and you need the conclusion, not the output:

- Test runs — the `test-runner` agent runs a suite and returns only failures with causes.
- Searches across many files or areas ("where is X handled across Core, kernel and the apps?"),
  and reading the huge files above to answer one question — use `Explore`.
- Independent investigations in parallel (several agents in one message).

Do it yourself when you already know the file or symbol, for a single grep, and for edits
that depend on this conversation. A subagent sees none of the conversation: give it paths,
the goal and the answer format ("under 200 words, file:line refs"). Don't redo its search.

## PRs

No automated reviewer runs on PRs — don't wait for review comments. Once CI is green the PR
is ready to merge. If a human leaves review comments, fix real ones, reply on every thread
(with the commit) and resolve it.
