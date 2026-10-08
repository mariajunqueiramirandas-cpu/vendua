# Venduá — notes for Claude

Monorepo (bun workspaces): `packages/core` (Hono + Postgres API), `packages/kernel`
(storefront runtime, 1.x = Contract 2 — public surface in `packages/kernel/API.md`),
`packages/ui-defaults` (slot defaults + all default CSS), `packages/templates` (template
model, migrations, tokens, compat matrix), `packages/loader` (`v.js`), `packages/codemods`,
`packages/conformance`, `packages/cli`, `packages/agent-runtime` (Agent Runtime v3, ADR 0030;
Core's side is `packages/core/src/agent-host/`), `apps/control` (staff CRM console, React),
`packages/core/src/wa-gateway.ts` (stores' own WhatsApp, its own process — ADR 0026),
`packages/core/src/vendedor/` + `agent-host/agents/vendedor*` (the Vendedor, ADR 0031: the AI seller on
the store's WhatsApp, its ingest, sweeper and admin views),
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

The repo defines no custom agents: spawn `general-purpose` (all tools; edits and runs commands),
`Explore` (read-only search) or `Plan` (read-only design). `general-purpose` loads this file;
`Explore` and `Plan` don't, so their brief carries every rule they need. Only a subagent's final
report enters your context.

**Pass `model` and `effort` on every spawn** (the Agent tool takes `effort` from Claude Code
2.1.292; on an older install, pass `model` alone). Without `model` an agent runs on this session's
model, `Explore` and `Plan` included. A task that fits several rows takes the highest one (a test
that touches money is Opus work).

- `haiku`, `medium`: find where or how something is done; read a long log, doc or diff and pull
  out what matters; run a suite, typecheck, build or e2e and report what failed.
- `sonnet`, `high`: web and docs research; diagnosing a failure; routine edits to a settled
  design; tests that follow an existing pattern; reviewing an ordinary change.
- `opus`, `high`:
  - UI and frontend: screens, components, layout, styling, responsive and dark mode, visual polish
    in `apps/control`, `apps/admin`, `storefronts/*`, `packages/ui-defaults` or `site/`.
  - Business-critical logic: money, checkout and orders, payments, tenancy and RLS, idempotency,
    auth, agent dispatch, Kernel exports, migrations, and the invariant review.
  - A new design or architecture, an open-ended problem with no precedent here, a long migration
    or audit.

Why:

- Haiku 5.5 is the fastest model and costs about a twentieth of Sonnet. It is a good subagent for
  bounded lookups and for runs whose output is the result. It is far behind on agentic coding and
  can stop early on long tasks, so it never gets code changes that need judgment.
- Sonnet 5.5 is strongest at well-scoped everyday work and bug fixing.
- Opus 5.5 costs twice as much as Sonnet and is clearly stronger at open-ended work that needs
  sustained judgment.
- Opus-row work is done by Opus: yourself if this session runs on Opus 5.5 or Fable 5.1,
  otherwise an `opus` agent. Never Sonnet or Haiku.
- `high` effort: a subagent can't ask you anything, and below `high` Sonnet and Haiku sometimes
  stop to check in or skip verification.
- No `xhigh` or `max` unless the user asks: turns get much longer, and Sonnet at those levels
  launches reviewer agents nobody asked for.
- `fable` (Fable 5.1, 2.5× Opus) only when the user asks for it.

Delegate work whose reading or output would flood this conversation, and independent pieces that
can run at once. Keep iterative work with the user, steps that each need the previous step's
details, and a few-edit change in this thread. Check these triggers mid-task too:

- About to run a suite, a multi-workspace `bun run check`, e2e or read a long log → a
  run-and-report agent (below).
- About to open a third file just to answer "where/how is X done" → `Explore` on `haiku`.
- A change touches money, tenancy, idempotency, kernel exports or agent runs → after editing, the
  invariant review (below).
- Stuck on a failure after two attempts → one agent investigates it cold (`sonnet`, or `opus` in
  business-critical code) while you continue.

Reviewer agents run for the invariant review, the fresh-eyes UI review below, or when the user
asks. Don't add one to every change.

Splitting a task that spans areas (e.g. Core route + admin screen + kernel export):

- Research in parallel, one agent per area, all in one message. Then decide the design yourself.
- The UI part goes to Opus, with the API shape it will consume settled first.
- Edits: do them yourself, or give parallel `general-purpose` agents disjoint file sets (never two
  on one file). Run the checks once all are back.

A subagent sees none of the conversation. Its brief needs the goal and why, exact paths, the
constraints that apply (quote the invariant), what it must not touch, the check that proves it
done and the answer format ("under 200 words, file:line refs"). Ask for the check's output, not a
claim that it passed: Haiku and Sonnet sometimes report a change done without running anything.
Don't redo its search; verify a surprising claim with one targeted Read. Two standing briefs:

- **Run-and-report** (`general-purpose`, `haiku`, `medium`):

  > "Run `<command>` in `<dir>`. Don't edit files. Send the output to a scratchpad file and grep
  > it. Report the command and the pass/fail counts. For each failure give file:line, the test
  > name and the assertion or error line as printed. List environmental failures (DB down, port
  > taken) separately."

  Diagnose the failures yourself, or give them to a `sonnet` agent.

- **Invariant review** (`general-purpose`, `opus`, `high`):

  > "Review `git diff <base>...HEAD` plus uncommitted changes against 'Invariants (bugs if
  > broken)' in CLAUDE.md. Don't edit files. Read line ranges only. Confirm each finding in the
  > code. Report each violation as file:line — invariant — what is wrong — one-line fix, most
  > severe first. Then list the invariants you checked and found fine."

Running agents (learned the hard way on the site rebuild):

- Parallel by default: every agent whose brief doesn't depend on another's result goes out in
  the same message, in the background, and you keep working while they run. Serial subagents
  cost the same and only buy a clean context; go one at a time only when the next brief needs
  the last result.
- For a fan-out under ~10 agents, call Agent directly rather than the Workflow tool: a workflow
  caps concurrent agents at CPUs − 2, which is 2 in a 4-CPU cloud container.
- Design first, then delegate. Don't hand "build this screen/section from scratch" to an agent
  unless it has an approved reference: a mockup or study the user signed off, the design-spec
  section, the component API and the real content. Without one you get plausible, generic UI
  and a second pass.
  - Opus 5.5 without design direction falls back on a few default styles. "Avoid a generic look"
    only swaps one default for another, so name the specific patterns to avoid.
  - Agents are strongest at reviewing and polishing existing work with fresh eyes, so settle the
    design yourself (or with the user) and delegate the review.
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
