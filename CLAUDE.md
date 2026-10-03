# Venduá — notes for Claude

Monorepo (bun workspaces): `packages/core` (Hono + Postgres API), `packages/kernel`
(storefront runtime, 1.x = Contract 2 — public surface in `packages/kernel/API.md`),
`packages/ui-defaults` (slot defaults + all default CSS), `packages/templates` (template
model, migrations, tokens, compat matrix), `packages/loader` (`v.js`), `packages/codemods`,
`packages/conformance`, `packages/cli`, `packages/agent-runtime` (Agent Runtime v3, ADR 0030;
Core's side is `packages/core/src/agent-host/`), `apps/control` (staff CRM console, React),
`packages/core/src/wa-gateway.ts` (stores' own WhatsApp, its own process — ADR 0026),
`apps/admin` (merchant admin PWA at `/admin/`, API `/admin/v1`),
`apps/print-agents` (Windows Go + Android Kotlin printing agents, ADR 0027),
`storefronts/*`, `site/`. `docs/README.md` has the architecture.

## Invariants (bugs if broken)

- Tenant isolation: every table has `tenant_id` + an RLS policy; every request-scoped query
  runs under `SET LOCAL vendua.tenant_id` (`platform/db.ts`).
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
- Agent work has one producer per runtime, each the only way to start work on its side (ADR
  0030 step 1): the CRM agent's `requestAgentTx` (`agent/dispatch.ts`) with a `source`, nothing
  else inserts runs, future touches on a lead are `agent_wakeups` rows (ADR 0016); Agent Runtime
  v3's `dispatchTx` (`agent-host/dispatch.ts`), a mailbox row with a `source` written inside the
  transaction that caused it, nothing else creates turns, future touches are timer rows of it.
- `packages/agent-runtime` imports nothing from Core (`tools/check-agent-runtime-boundary.mjs`);
  a turn's writes run behind the actor's lease fence in `withTenant`, and a tool takes its
  tenant and subject from the runtime, never from the model's arguments.
- What the team should hear about is a `recordStaffEventTx` call (`modules/staff-events.ts`,
  ADR 0023) inside the transaction that commits the change — never a direct Discord call, never
  inside a `Promise.all` with other statements of that tx (it runs in a savepoint). A store's own
  tx passes that store's `tenantId`; shoppers' names and phones never go in event data.

## Toolchain

- bun is pinned (`packageManager`, currently 1.4.2). Another version rewrites `bun.lock` —
  check `bun --version` before `bun install`; CI installs with `--frozen-lockfile`.
- Bumping any workspace's `version` (a Kernel release, say): run `bun install` and commit
  `bun.lock` with the bump. The lock records each workspace's version, and
  `--frozen-lockfile` doesn't notice a stale one, so CI stays green while the lock drifts.
- Format: `bunx prettier --write <paths>` (CI auto-fixes, but keep diffs clean).
- Typecheck per workspace: `bun run check`. Core tests: `cd packages/core && bun test`
  (`TEST_DATABASE_URL` is exported by the session hook and points at its own `vendua_test`
  database: a Core running on the dev `vendua` database would claim the runs tests queue).
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
- `.claude/settings.json` blocks reading build output (`dist/`, `qa-report/`) and runs
  prettier on every file Claude writes, except what `.prettierignore` lists (video projects
  under `videos/*/` included). `bun.lock` is ~120 KB: inspect it with `git diff`
  or a grep, never a whole-file Read.
- Marketing videos live in `videos/` (HyperFrames): read `videos/README.md` and load the
  `vendua-reel` skill first. ElevenLabs goes through `videos/tools/elevenlabs.py` with the
  `ELEVENLABS_API_KEY` environment secret, not the ElevenLabs MCP connector.
- `site/` is the marketing site: read `site/README.md` first. Its images are real admin
  screens captured by `site/scripts/assets.ts`, never hand-drawn UI, and the build fails on
  token drift from the admin or on banned copy.
- `scripts/shots.ts` (admin and site) can report failed module requests while other edits are
  hot-reloading: rerun before calling it a bug. Element shots include the sticky header.
- Copy that states a price, a plan or a feature date needs the user's decision. Don't infer it
  (e.g. "Total por mês" implies a monthly plan nobody decided on).

## Subagents

Agents: `test-runner` and `invariant-reviewer` in this repo, `Explore` (read-only search),
`Plan`, `general-purpose` (can edit). Only a subagent's final report enters your context.

No agent definition pins a model: **choose it yourself on every spawn** by passing `model` to
the Agent tool; a spawn that leaves it out falls back to Sonnet 5.5. Subagents run at high
effort: `test-runner` and `invariant-reviewer` set `effort: high`, and the built-in agents
inherit the session's effort, which `.claude/settings.json` saves as high for Sonnet 5.5 and
Opus 5.5.

- `model: "sonnet"` (Sonnet 5.5) for most work: search and research, running tests and checks,
  reading logs, routine edits, reviewing ordinary changes.
- `model: "opus"` (Opus 5.5) for:
  - UI and frontend work: screens, components, layout, styling, responsive or dark-mode work and
    visual polish in `apps/control`, `apps/admin`, `storefronts/*`, `packages/ui-defaults` or
    `site/`. Never give UI work to a Sonnet subagent; if this session runs on Opus 5.5 you may do
    it yourself.
  - Business-critical logic: money, checkout and orders, payments, tenancy and RLS,
    idempotency, auth, agent dispatch, Kernel exports, migrations. `invariant-reviewer` always
    runs on Opus.
  - Innovative work: a new design or architecture, or an open-ended problem with no precedent
    in the repo.

Check these triggers mid-task too, not only at the start:

- About to run a suite, a multi-workspace `bun run check`, e2e or read a long log → `test-runner`
  (Sonnet).
- About to open a third file just to answer "where/how is X done" → `Explore` (Sonnet).
- A change touches money, tenancy, idempotency, kernel exports or agent runs → after editing,
  `invariant-reviewer` (Opus) on the diff.
- Stuck on a failure after two attempts → one agent to investigate it cold while you continue.

Splitting a task that spans areas (e.g. Core route + admin screen + kernel export):

- Research in parallel — one agent per area, all in one message — then decide the design yourself.
- The UI part of a mixed task goes to a `general-purpose` agent on Opus (or to you, if you're on
  Opus 5.5), with the API shape it will consume settled first.
- Edits: do them yourself, or give parallel `general-purpose` agents disjoint file sets
  (never two on one file); run the checks once all are back.
- Don't split when each step needs the previous step's details, or the whole thing is a few edits.

A subagent sees none of the conversation. Its brief needs the goal, exact paths, the
constraints that apply (quote the invariant) and the answer format ("under 200 words,
file:line refs"). Don't redo its search; verify a surprising claim with one targeted Read.

Running agents (learned the hard way on the site rebuild):

- Parallel by default: every agent whose brief doesn't depend on another's result goes out in
  the same message, in the background. Serial subagents cost the same and only buy a clean
  context; go one at a time only when the next brief needs the last result.
- For a fan-out under ~10 agents, call Agent directly rather than the Workflow tool: a workflow
  caps concurrent agents at CPUs − 2, which is 2 in a 4-CPU cloud container.
- Design first, then delegate. Don't hand "build this screen/section from scratch" to an agent
  unless it has an approved reference: a mockup or study the user signed off, the design-spec
  section, the component API and the real content. Without one you get plausible, generic UI
  and a second pass. Agents are strongest at reviewing and polishing existing work with fresh
  eyes, so settle the design yourself (or with the user) and delegate the review.
- One owner per file. The brief says "edit ONLY these files; report anything else", and shared
  components get a single owner. Two agents on one file is a lost edit.
- Context several agents share (decisions, voice, tokens, banned words) goes in one scratchpad
  file, and each brief starts with "read <file> first" instead of pasting it.
- Shared infrastructure belongs to the lead: start the one dev server before launching. Agents
  never start or stop servers, and only one agent at a time runs `bun run build` or e2e.
- Integrate as each agent lands. Look at the result yourself (UI: screenshots at 375 and 1280 in
  both themes), run `bun run check`, and commit only that agent's files. Never commit files an
  agent is still editing, even when the stop hook asks; say why instead.
- A report is a set of claims. Before committing, check the API shapes, numbers and "check
  passed" it relies on with one targeted command.
- Background agents, workflows and dev servers die when the container restarts (it happens).
  Push finished work promptly, and after a restart relaunch only what's left.

## PRs

Once CI is green the PR is ready to merge.
