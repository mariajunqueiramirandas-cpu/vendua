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
- The seed creates no threads/messages — open a lead's conversas →
  "+ whatsapp" (needs `lead.whatsapp` set — seeded leads have none; set via
  SQL), then compose a draft. To exercise day separators or the
  'atrasadas' task bucket, backdate `lead_messages.created_at` /
  `lead_tasks.due_at` via SQL, e.g. `now() - interval '1 day'`.
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

## Email inbound webhook (Resend svix)

`POST /control/v1/webhooks/email` takes two auth modes: the
`x-vendua-webhook` shared secret (env `VENDUA_WEBHOOK_SECRET`, else
HMAC-derived from `CONTROL_SECRET`) or Resend's svix signature — svix is
email-only; on other channels it 404s even when correctly signed. Verified
`email.received` → core fetches `api.resend.com/emails/receiving/{data.email_id}`
with `RESEND_API_KEY` → `ingestInbound` → 201 `{leadId,threadId,messageId,
leadCreated,alreadySeen}`. Other event types → 200 `{ignored}`. Unsigned,
bad signature, stale ts (>5 min), or bad channel → 404.

To mint a signed request locally:

- Secret: `whsec_$(openssl rand -base64 32)` → `RESEND_WEBHOOK_SECRET` env.
- Sign `HMAC-SHA256(key=base64_decode(secret minus 'whsec_'))` over
  `{svix-id}.{svix-timestamp}.{rawBody}`; header `svix-signature: v1,<b64>`;
  `svix-timestamp` in seconds, ±5 min window.
- The event body needs only `type` + `data.email_id`; a REAL `email_id`
  makes the Resend fetch return real content (requires `RESEND_API_KEY` —
  org secret; `api.resend.com` is reachable from the box). Without a valid
  key/id the webhook 502s.
- Replay dedupes on the RFC `Message-ID` (`provider_message_id`), not the
  svix id → second post → `alreadySeen:true`, same ids, no new rows.
- Seed creates no threads: any conversation in `#/inbox` (or Painel
  "por origem: inbound:email" > 0) proves the webhook path end-to-end.
  Inbound enqueues a `reply` agent run that drains with mock/log drivers —
  expected, no real email sent.

## Mobile / touch emulation (control)

- Phone shell is ≤760px width AND coarse-pointer keyed: `.tabbar`/`.msheet`/
  folded `.tbl`/snap board are `max-width`, but `.mv` stage select, always-on
  `.open`, and 40px targets are `any-pointer: coarse` — a resized desktop
  window will NOT show them. Emulate for real: Playwright
  `isMobile:true + hasTouch:true` (headed works on DISPLAY :0) or DevTools
  device toolbar set to "Mobile" — verify `matchMedia('(any-pointer: coarse)')`.
- Fast path when the CSS is `max-width`-only (check the diff): just resize
  the real window — `wmctrl -r :ACTIVE: -e 0,x,y,W,H` uses real px; CSS
  innerWidth lands ~W−30 (e.g. W=805 → ~773px). Verify with a console
  matchMedia probe. No emulation needed; coarse-pointer features still
  require real emulation.
- Full-screen `.drawer` at ≤760px covers the scrim entirely — scrim-tap close
  is untestable there (Escape/cancelar are the close paths); desktop keeps a
  visible scrim.
- Board cards: single tap is a no-op — open via the `.open` arrow link
  (always visible on coarse) or dblclick. `.mv` picks serialize per lead
  (rapid selects queue, last write wins); hold the PATCH with `page.route`
  to observe the queue deterministically.
- Nav badges poll `api.stats()` on mount + 30s — create a task/draft then
  reload to see the aggregated count on the "menu" tab.
- Waiting on `.tabbar, .rail` never resolves: `.rail` stays in the DOM but
  `display:none` on phones — wait on `.tabbar` alone.
- Marking a task done removes it from the default view (server-side
  `done=false` filter); "incluir concluídas" reshows it struck-through.

## Live discovery runs (gemini + tinyfish)

- Real keys reach the core process as env vars: bind org secrets on the exec
  call that starts `bun run dev` (`env: {GEMINI_API_KEY: 'secret:org:GEMINI_API_KEY',
TINYFISH_API_KEY: ..., CONTROL_SECRET: ...}`). SESSION_SECRET has no org
  entry — any literal works. Integration rows persist in
  `control_integrations`; `secretRef` holds an env-var NAME and falls back to
  the driver's default (GEMINI_API_KEY/TINYFISH_API_KEY), so PUT
  `{driver, enabled:true}` alone wires the bound key.
- Staff API auth: `x-vendua-control: $CONTROL_SECRET` header (cookie auth is
  for the SPA); mutations also need an `Idempotency-Key` header.
  `POST /control/v1/integrations/:kind/test` does a real live probe —
  `{ok:true, detail:"gemini:… respondeu — N tokens"}`.
- `POST /control/v1/agent/runs {kind:'discovery', params:{query,segment,city}}`
  → `{runId}` + fire-and-forget `drain()`; poll `GET /agent/runs/:id`.
- Orphan trap: `bun --watch` restarts kill in-flight runs silently — the row
  sits 'running' with a stale claim until the 10-min lease, then drain()
  requeues and the whole trajectory RE-executes — the journal restarts at
  step 0, but every create_lead before the crash already committed, so
  pre-crash leads stay visible and re-created prospects return
  duplicate:true under the PR-#41 dedupe. A long plateau at N steps with a
  frozen `started_at` is an orphan, not a slow tool — check `now()-started_at`
  and whether steps grow after the lease. TinyFish extract calls are still
  legitimately minutes-slow, so a plateau isn't proof of death on its own.
- Evidence markers in run steps: web_search outs carry per-result `kind`
  (contact|profile|listing|site) + parsed phone/instagram; repeat extract_page
  on the same pageKey → `cached:true`; repeat create_lead → `duplicate:true`.
  Discovery leads get `tags ∋ 'descoberto'` + `discovered_via='agente'` → the
  #/descoberta "leads descobertos" list keys on that tag.

## Config page (#/config) specifics

- Login: after typing the password, screenshot-check the masked dot count
  before submitting — a partial `type` (e.g. only 1 char lands) produces a
  misleading "chave incorreta" even though the key is right.
- Provider-card `testar` chips are per-card useState — cleared on driver
  switch; only the latest result shows per card.
- whatsapp → baileys: the dark pair panel renders as soon as `baileys` is
  selected in the seg (the enabled check is against the _current_ row, not
  the pending driver) — preview shows "whatsapp desligado" before save.
- From this box the baileys socket DOES reach WhatsApp — real QR renders
  (`<img class="wa-qr">`, status 'qr') within ~2s of enabling, and
  `gerar código` with a valid 10–15-digit phone returns a real 8-char code.
  Invalid phone (<10 digits) → inline "número inválido…" without touching
  the socket — deterministic error path for testing.
- `desconectar número` only renders at status 'open' (i.e. a real phone
  actually paired) — unreachable without a WhatsApp account on hand.
- Switching whatsapp back to `log` tears the socket down
  (`GET /control/v1/wa/qr` → `{"qr":null,"status":"off"}`) — verify restore
  via `GET /control/v1/integrations`.
- openrouter `testar` can transiently fail `✗ internal error` on the first
  call right after enabling (free-model cold start); retry once before
  reporting a bug — a direct curl to `POST …/integrations/llm/test`
  (cookie-auth + `x-vendua-staff: 1`) distinguishes UI vs backend failure.

## Kernel query-cache wedge (known gap)

`useQuery` never refetches an already-`resolved` entry on mount — including
entries that resolved with an error. If a vite page reload lands while Core
is restarting (`--watch`), all queries wedge on error/empty until a manual
reload — e.g. checkout permanently shows "Sua sacola está vazia" even though
the server cart is intact. Workaround in tests: reload once more after Core
is back. Session token survives reload in `sessionStorage` (`vendua.session`),
so carts re-attach.

## Agent-feature test data (control CRM)

The leads/discovery surfaces only show the new agent fields when the columns
are populated — seeded leads have none. Seed via docker exec psql:

```sql
-- fit column (Leads + Descoberta found table): needs both score and reason
update leads set fit_score=8, fit_reason='ICP forte' where name='…';
-- found-leads table keys on tag 'descoberto' or discovered_via
update leads set tags='{descoberto}', discovered_via='agente' where name='…';
-- 'email bounce' chip: set email_bounced_at=now()
```

`leads.agent_mode` gates the LeadDetail goal seg + `agir` button (`off` hides
both; `draft`/`auto` show a third 'objetivo' seg writing `agent_goal` via
PATCH). `discovery_briefs` rows are plain inserts; re-enabling a paused brief
(or editing query/segment/city/target) nulls `last_run_at` by design, so the
next worker tick (~15s) fires a discovery run — the row's 'last run' cell
goes '—' then re-stamps. The leads dispatch bar clears selection on success;
the result line ("N disparados · M ignorados (Name: reason · …)") renders
outside the selection card so it survives the clear — fixed in 82345c6 after
it briefly shipped scoped inside the card where it never painted.

## Channel resolution + scripted mock runs

- Per-run channel override lives in `agent_runs.params.channel`
  (`auto`/absent = resolver picks; `whatsapp`/`email` = CANAL FORÇADO). UI
  surfaces: canal seg in the leads dispatch bar (`api.dispatch(ids, goal,
  channel)`), `canal:` `<select>` beside `agir` on LeadDetail
  (`runOnLead(id,'outreach',{channel})`).
- `resolveChannelTx` order: staff override > model arg > last inbound
  channel > whatsapp > email. Availability = contact data (`lead.whatsapp`
  or inbound wa `external_id`; `lead.email`) + enabled integration row in
  `control_integrations` + `email_bounced_at is null`. Dead request →
  `{blocked:true, reason, use:<first reachable>}` — the model is told to
  retry on `use`.
- The CANAIS line goes into the run's user-message context — NOT journaled
  into `steps`, so it is invisible in the run-detail UI. To surface channel
  resolution on camera, fire a scripted mock run (mock provider reads
  `params.script: [{text?, toolCalls:[{name,args}]}]` per chat call):

```sh
curl -X POST localhost:8787/control/v1/agent/runs \
  -H "x-vendua-control: $CONTROL_SECRET" -H "Idempotency-Key: $RANDOM" \
  -H 'content-type: application/json' \
  -d '{"kind":"outreach","leadId":"<lead>","params":{"script":[
    {"toolCalls":[{"name":"draft_message","args":{"leadId":"<lead>","body":"oi","channel":"whatsapp"}}]},
    {"toolCalls":[{"name":"draft_message","args":{"leadId":"<lead>","body":"oi","channel":"email"}}]},
    {"text":"ok"}]}}'
```

  On a no-whatsapp lead the first tool step journals
  `{blocked:true, reason:'lead has no whatsapp', use:'email'}` and the
  second `{channel:'email', via:'requested', message:{status:'draft'}}` —
  visible at `#/agente/runs/:id`.

## Launch stage (#/lancar)

- Discovery showcase screen: idle brief form (segmento/cidade/foco/meta
  3·5·10·15; launch disabled until any field set) → `POST /agent/runs` →
  `?run=<id>` streams the journal live (1300ms poll), lead cards on the
  right rail keyed to create_lead steps (`out.duplicate:true` renders the
  dimmed 'já existia' card).
- Mock `script` steps take `delayMs` (capped 30s) — pace a scripted
  discovery run at ~2-4s/step so the stream visibly fills on camera;
  navigate to `#/lancar?run=<id>` immediately after the POST.
- Clock note: the stage clock uses `started_at`; heartbeat/persist now
  write `alive_at` (migration 0012) so elapsed is real. History: heartbeat
  used to overwrite `started_at`, freezing the clock — if `alive_at` isn't
  in your schema, expect `elapsed ≈ 0`.
- The page merged `#/lancar` into `#/descoberta` (`/lancar` is a legacy
  alias → same component; `?run=` deep links preserved).

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
