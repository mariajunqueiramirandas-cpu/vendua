---
name: local-stack
description: Start Venduá's stack in a cloud session (Core API on :8787, CRM apps/control on :5195, merchant admin apps/admin on :5196), seed dev data, take 375/820/1440 screenshots, run fleet commands (vendua train / templates migrate / codemod rehearse / ops) or build the Dokploy Docker images. Use before starting Core or any app, or running scripts/shots.ts.
---

# Running Venduá locally

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
- Merchant admin: start Core with `VENDUA_ADMIN_DEV_OTP=1` added (the sign-in code comes back
  in the response), then `cd apps/admin && (nohup bun run dev > /tmp/admin.log 2>&1 &)`
  (:5196). Sign in as the seed owner, phone 22981795040.

## Fleet commands

Need Core + `CONTROL_SECRET`: `bunx vendua train [--core --record]`,
`bunx vendua templates migrate <id> [--apply --ring r]`, `bunx vendua codemod rehearse <id>`,
`bunx vendua ops <tenant>`. Evidence of real runs goes in `docs/fleet-runs/`.
