# Venduá — notes for Claude

Monorepo (bun workspaces): `packages/core` (Hono + Postgres API), `packages/kernel`
(storefront runtime), `apps/control` (staff CRM console, React), `storefronts/*`, `site/`.
Read `REVIEW.md` for the invariants that matter (tenant isolation, money in cents,
idempotency) and `docs/README.md` for architecture.

## Toolchain

- bun is pinned (`packageManager`, currently 1.4.2). Another version rewrites `bun.lock` —
  check `bun --version` before `bun install`; CI installs with `--frozen-lockfile`.
- Format: `bunx prettier --write <paths>` (CI auto-fixes, but keep diffs clean).
- Typecheck per workspace: `bun run check`. Core tests: `cd packages/core && bun test`
  (`TEST_DATABASE_URL` is exported by the session hook).
- Comments are sparse — only non-obvious _why_.

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
- Don't `pkill -f <pattern>` where the pattern also appears in your own command line — it
  kills the shell running it.
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

## PRs

Devin posts automated reviews on PRs — verify each finding against the code, fix real ones,
reply on every thread (with the commit) and resolve it.
