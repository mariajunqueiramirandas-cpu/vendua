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
  (:5196). Sign in as the seed owner, phone 22999990001.
- Self-serve signup (`/admin/comecar`) is closed until the CRM switch, WhatsApp, email and billing
  are set (ADR 0032). In dev, `log` drivers count: `psql -h localhost -p 5433 -U vendua -d vendua -c
  "insert into control_integrations (kind, driver, enabled) values ('whatsapp','log',true),
  ('email','log',true) on conflict do nothing; insert into control_settings (key, value) values
  ('signup', '{\"enabled\": true}') on conflict (key) do update set value = excluded.value"`,
  and start Core with `VENDUA_SIGNUP_ACCESS_CODE` (12+ characters) when there's no Mercado Pago.

## Storefronts through the edge (Phase 4)

Core with the Control Plane's probes pointed at a local edge, a real release, the edge serving it:

```sh
cd packages/core && (CONTROL_SECRET=dev SESSION_SECRET=devsecret VENDUA_EDGE_SECRET=devedge \
  VENDUA_PROBES=1 VENDUA_PROBE_ORIGIN=http://localhost:8080 nohup bun src/index.ts > /tmp/core.log 2>&1 &)
cd storefronts/_template && bun run build
VENDUA_ARTIFACTS=file:///tmp/artifacts CONTROL_SECRET=dev bunx vendua release publish _template --no-build
cd packages/edge && (PORT=8080 VENDUA_ARTIFACTS=file:///tmp/artifacts VENDUA_EDGE_SECRET=devedge \
  VENDUA_CORE_URL=http://localhost:8787 VENDUA_EDGE_CACHE_DIR=/tmp/edgecache nohup bun src/main.ts > /tmp/edge.log 2>&1 &)
curl -H 'host: quero-pudim.vendua.com.br' localhost:8080/    # or Chromium with
#   --host-resolver-rules="MAP *.vendua.com.br 127.0.0.1:8080"
CONTROL_SECRET=dev bunx vendua fleet status
```

- `bun packages/edge/scripts/smoke.ts` runs the whole loop (invite → publish → edge → probe →
  new release → rollback) against a Core started as above — the CI `edge-smoke` job.
- `cd packages/core && bun run seed:fleet` fills the CRM's Lojas → frota with releases, stores,
  a pinned store, a failing probe and incidents (run apps/control's `scripts/dev-seed.ts` first).
- `(cd dir && nohup bun … &)` backgrounds a subshell, so `$!` is that subshell, not bun: find
  the listener with `ps aux | grep "src/main.ts"` and kill its pid (never `pkill -f`).
- The fleet tests (`packages/core/test/fleet.test.ts`) confine the probe loop to their own
  stores, but a Core running with `VENDUA_PROBES=1` on the same database probes everything:
  stop it before running the Core suite (its agent worker also races the agent-run tests).

## Fleet commands

Need Core + `CONTROL_SECRET`: `bunx vendua train [--core --record]`,
`bunx vendua templates migrate <id> [--apply --ring r]`, `bunx vendua codemod rehearse <id>`,
`bunx vendua ops <tenant>`. Evidence of real runs goes in `docs/fleet-runs/`.
