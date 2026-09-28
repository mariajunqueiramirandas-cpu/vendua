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
- Fleet commands (need Core + `CONTROL_SECRET`): `bunx vendua train [--core --record]`,
  `bunx vendua templates migrate <id> [--apply --ring r]`, `bunx vendua codemod rehearse <id>`,
  `bunx vendua ops <tenant>`. Evidence of real runs goes in `docs/fleet-runs/`.

## Running locally (cloud sessions)

The SessionStart hook (`.claude/hooks/session-start.sh`) installs deps and starts a migrated,
seeded Postgres 16 on :5433. Then:

```sh
# Core API on :8787 (the hook doesn't start it)
cd packages/core && (CONTROL_SECRET=dev SESSION_SECRET=devsecret VENDUA_WEBHOOK_SECRET=devhook \
  nohup bun src/index.ts > /tmp/core.log 2>&1 &)
# CRM dev server on :5195 (proxies /control/v1 → :8787); login key: dev
cd apps/control && (nohup bun run dev > /tmp/control.log 2>&1 &)
bun scripts/dev-seed.ts            # 40 leads + threads/drafts/tasks (skips if already seeded)
CHROMIUM=/opt/pw-browsers/chromium bun scripts/shots.ts /pipeline /inbox   # 375/820/1440 screenshots
```

- Core rate-limits `/control/v1/login` to 10/min per IP — `scripts/shots.ts` reuses one saved
  cookie (`/tmp/vendua-control-auth.json`); don't script UI logins in loops.
- Don't `pkill -f <pattern>` (or `pgrep -f` + kill) where the pattern also appears in your
  own command line — it kills the shell running it. Save `$!` to a pidfile when starting Core.
- Docker + Compose are installed but the daemon isn't running: start it on demand with
  `(nohup dockerd > /tmp/dockerd.log 2>&1 &)`. It can pull from Docker Hub, so the real
  Dokploy images can be checked with `docker compose build core` (it builds the CRM inside) — images are large, so
  mind the session's disk allowance and `docker system prune` afterwards.

## apps/control (CRM)

`apps/control/README.md` holds the binding UI/data rules. Highlights:

- Tailwind v4 tokens only (light + dark), shared components in `src/components/`,
  one folder per area in `src/features/`, live style reference at `/#/_ui`.
- TanStack Query keys come from `qk` in `src/lib/query.ts`; the cache stores the raw API
  response (unwrap with `select`) because screens share keys; SSE invalidation lives in
  `src/lib/live.ts`.
- Every list gets a real phone layout (`DataList` `mobileRow`); check 375px for overflow.
- Prod: Core's Docker image builds `apps/control` and serves `dist/` at `/control/`
  (Dokploy compose; `crm` nginx proxies `/control` to core).

## apps/admin (merchant admin)

`apps/admin/README.md` holds the rules. Highlights:

- Merchant identity is phone OTP over WhatsApp with per-tenant sessions and
  owner/manager/attendant roles (ADR 0020). Every admin mutation writes `audit_log` in
  its own tx, and live updates are `emitAdminTx` → SSE.
- To run it, start Core with `VENDUA_ADMIN_DEV_OTP=1` (the sign-in code comes back in
  the response), then `cd apps/admin && bun run dev` (:5196). Sign in as the seed owner,
  phone 22999990000.
- Gates: `bun run build` (bundle budgets) and
  `CHROMIUM=/opt/pw-browsers/chromium AXE=1 bun scripts/shots.ts` (375/820/1440 ×
  Creme/Noite; overflow, console and axe).
- Style: `theme.css` tokens only, and `depth-*` for shadows (they compose with `ring-*`).

## PRs

No automated reviewer runs on PRs — don't wait for review comments. Once CI is green the PR
is ready to merge. If a human leaves review comments, fix real ones, reply on every thread
(with the commit) and resolve it.
