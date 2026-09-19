---
name: testing-vendua
description: How to set up and end-to-end test vendua storefronts and the control board locally — seeded tenants, scaffolding real test tenants, board auth, store-state overrides, and known kernel pitfalls.
---

# Testing vendua locally

## Devin Secrets Needed

None — everything runs locally against a seeded Postgres.

## Stack bring-up

```sh
cd packages/core                            # bun is on PATH (~/.local/bin/bun)
docker compose up -d                        # postgres :5433, vendua/vendua
bun run migrate && bun run seed             # schema + 3 seeded tenants
SESSION_SECRET=test-secret bun run dev      # API :8787 — REQUIRED for /control routes
```

`SESSION_SECRET` gates the control surface; without it the board auth is a
dead end. `bun --watch` (the dev script) hot-restarts on file save — expect
~1s ECONNREFUSED windows when the tree changes mid-test.

## Tenant resolution

Tenants resolve from the **Host header** → `domains` table. Seeded dev hosts:
`localhost:5174` quero-pudim, `:5191` brasa, `:5192` forn.
`storefronts/_template` is **not** a registered tenant — loading it yields
`TENANT_NOT_FOUND`. To test a real storefront UI:

```sh
bunx vendua scaffold <slug>   # allocates port ≥5200, registers tenant+domain,
                              # seeds catalog (3 items; item 1 has a required
                              # modifier group), zone "Entrega"/Centro R$5,00
bun install                   # registers the new workspace in bun.lock
bunx vendua dev <slug>        # vite on the allocated port
```

Cleanup: `rm -rf storefronts/<slug> && bun install` (drops lockfile entries).
DB rows are left behind — consistent with existing `ph1demo` leftovers.

### Closed-by-hours trap

Scaffolded tenants seed hours 09:00–18:00 America/Sao_Paulo. If the box clock
is outside that window the store is closed and checkout is blocked. Widen for
testing:

```sql
docker compose -f packages/core/docker-compose.yml exec -T postgres psql \
  -U vendua -d vendua -c \
  "update store_settings set hours='[{\"day\":\"everyday\",\"open\":\"00:00\",\"close\":\"23:59\"}]'::jsonb where tenant_id=(select id from tenants where slug='<slug>');"
```

(check the actual column/type first — `store_settings` has `hours` jsonb and
`status_override`.)

## Store status overrides

```sql
update store_settings set status_override='paused'   -- blocking overlay, primitives off
-- or 'closed'                                        -- dismissible banner, browse ok
-- or null                                            -- back to derived hours status
where tenant_id=(select id from tenants where slug='<slug>');
```

Verify via `curl -H "Host: <slug-host>" localhost:8787/storefront/v1/store`.

## Control CRM (`apps/control`, React — replaced the old inline-HTML board)

- Serve either `cd apps/control && bun run dev` (vite :5195, base `/control/`,
  proxies `/control/v1` → :8787 preserving Host) or `bun run build` → Core
  serves `dist/` at `http://localhost:8787/control/`. Routes are hash-based
  (`/control/#/leads`); deep links work under any prefix.
- Auth: `POST /control/v1/login {key: $CONTROL_SECRET}` → `vendua_control`
  cookie (path `/control`). Unauth'd API calls → 404 (existence hidden), wrong
  key → 404, UI shows "chave incorreta". Mutations need `x-vendua-staff: 1` +
  `Idempotency-Key` (the SPA's api.ts sends both).
- Keyboard nav: `d f l i a e t g c` switch views; on /leads `/` focuses
  search, `n` opens the new-lead drawer. Composer: ctrl+enter sends,
  shift+ctrl+enter drafts.
- Kanban DnD: real mouse drag works via the computer tool —
  `left_mouse_down` takes NO coordinate, so `mouse_move` onto the card
  first, press, then several stepped `mouse_move`s (Chrome starts the HTML5
  drag after ~5px), screenshot mid-drag to capture the lime `.over`
  highlight, then `left_mouse_up`. `.board-col` now has min-height so empty
  column space is a valid drop target; dropping on the header/cards is
  still the reliable target.
- Two-tap `ConfirmBtn` (descadastrar/arquivar) arms for only ~2.6s — batch
  the arm + confirm clicks in one tool call or the first arm expires.
- Keyboard: global nav keys are skipped while any input/checkbox is focused
  — click neutral page space first. `?` opens the shortcuts modal via the
  `shift+slash` chord (a bare `?` keysym may arrive as `/`).
- Send guardrails are real: whatsapp dispatch fails with `lead
unsubscribed` if `unsubscribed_at` is set and `lead has no whatsapp` if
  the column is null (seeded leads have no whatsapp) — set one via SQL for
  a happy-path send; UI shows `falhou` on the bubble.
- The seeded whatsapp thread (Padaria Trigo Real) has a single draft — to
  exercise day separators or the 'atrasadas' task bucket, backdate
  `lead_messages.created_at` / `lead_tasks.due_at` via SQL, e.g.
  `now() - interval '1 day'`.
- No `psql` on the box — query via
  `docker exec core-postgres-1 psql -U vendua -d vendua -c "..."`. Pass `-i`
  or individual `-c` flags; heredoc stdin is silently dropped without `-i`.
- Coordinate space ≠ CSS px: tool screenshots are 1024×768 but the window
  is ~1600×1156 (~1.56× scale plus ~75px browser chrome on Y). For precise
  clicks get rects via `browser_console` (`el.getBoundingClientRect()`) and
  divide by ~1.56 — or click positions read straight from the screenshot.
- Agent: `agent_runs` is a durable queue; worker drains on 15s poll, but
  POST /leads and /leads/:id/run drain inline (runs finish ~instantly with
  the `mock` llm driver, which replies "ok" unless params carry `script`).
  Integration drivers live in `control_integrations` (llm/email/whatsapp/
  discovery); `mock`/`log` need no secrets. `agent_memory` in
  `control_settings` holds facts saved by the `remember` tool.
- Guardrails default: quiet 21:00–08:00 America/Sao_Paulo,
  firstContactDraftOnly → agent first-contact lands in /aprovacoes.
- Old notes: cookie-auth mutations need `x-vendua-staff: 1` (CSRF);
  Idempotency-Key required → replay → 200 + `x-idempotent-replay`.

## Kernel query-cache wedge (known gap)

`useQuery` never refetches an already-`resolved` entry on mount — including
entries that resolved with an error. If a vite page reload lands while Core
is restarting (`--watch`), all queries wedge on error/empty until a manual
reload — e.g. checkout permanently shows "Sua sacola está vazia" even though
the server cart is intact. Workaround in tests: reload once more after Core
is back. Session token survives reload in `sessionStorage` (`vendua.session`),
so carts re-attach.

## CLI verification (shell-only)

```sh
bunx vendua check <slug>   # tsc + conformance static K01–K04
bunx vendua build <slug>   # vite build
bunx vendua qa <slug>      # build + conformance e2e (playwright chromium)
```

`qa` needs playwright chromium installed (`bunx playwright install chromium`,
already in repo maintenance) and a **free :5199** preview port; it seeds its
own `qa-open/qa-paused/qa-closed/qa-edge` tenants and mutates the fixture's
`dist/` — do NOT run two qa/e2e runs concurrently on the same storefront dir
(teardown of one deletes dist under the other's preview → ENOENT failures).
`_template` works as a qa fixture.
