# apps/admin — the merchant admin

The store owner's product: a phone-first PWA served at `/admin/` on its own domain
(`VENDUA_ADMIN_HOST`; the `apps/admin/Dockerfile` proxy in production). It talks to
Core's `/admin/v1` API. The plan is in [docs/merchant-admin.md](../../docs/merchant-admin.md),
the design spec in [docs/merchant-admin-design.md](../../docs/merchant-admin-design.md),
and identity in [ADR 0020](../../docs/adr/0020-merchant-identity.md). Copy is pt-BR.

## Run it

```sh
# Core with dev sign-in codes (the code comes back in the /auth/otp/start response)
cd packages/core && (CONTROL_SECRET=dev SESSION_SECRET=devsecret VENDUA_WEBHOOK_SECRET=devhook \
  VENDUA_ADMIN_DEV_OTP=1 nohup bun src/index.ts > /tmp/core.log 2>&1 & echo $! > /tmp/core.pid)
cd apps/admin && bun run dev          # :5196/admin/, proxies /admin/v1 and /v1 to :8787
# the Aparência preview frames the real storefront: run it too
cd storefronts/quero-pudim && bun run dev
```

The seed makes one store, Quero Pudim, deliberately blank (no hours, delivery, Pix or menu),
with Vinícius, phone `(22) 98179-5040`, as its owner. A blank store opens Início straight into
`/bem-vindo`, the step-by-step onboarding (`features/onboarding`: one question per screen in
four parts, a guide, the store assembling beside it; `flow.ts` decides which questions a store
gets). Core keeps where it stopped (`GET/PATCH /admin/v1/onboarding`); re-seed to reset and run
it again ("continuar depois" is remembered by Core too: open `/admin/bem-vindo` directly).
`/bem-vindo?passo=horarios` opens one question and returns to the finale. CI and fleet runs need a menu and the canary
tenants instead: `cd packages/core && bun run seed:fixtures`. `bun scripts/demo-orders.ts` needs a menu
first (finish the onboarding), then places a few live orders.

## Gates (CI job `admin-gate`)

- `bun run check`: typecheck.
- `bun run build`: Vite build plus `scripts/budget.ts`. The limits are shell
  ≤420 KB gzip, each lazy route ≤60 KB, and latin fonts ≤90 KB. A new
  dependency that pushes the shell over budget belongs in a lazy route.
- `CHROMIUM=/opt/pw-browsers/chromium AXE=1 bun scripts/shots.ts [routes]`
  shoots 375/820/1440 in Creme and Noite into `shots/`. It fails on horizontal
  overflow, console errors or serious/critical axe violations. It signs in once
  and reuses `/tmp/vendua-admin-auth.json`. Set `BASE=http://localhost:8787/admin/`
  to check the production build that Core serves.

## The installed app (PWA)

The admin is meant to live on the merchant's home screen. What that takes, and where:

- **Service worker** (`sw.js`, built into `dist/sw.js` by the `vendua-sw` plugin in
  `vite.config.ts`). The build prepends `VERSION` (a hash of `dist/`) and `PRECACHE`
  (the shell, every route chunk, the pt-BR fonts, icons), so every screen opens offline
  and a deploy is one atomic version. A new version waits; the app shows "Tem uma versão
  nova · atualizar" (`lib/pwa.ts`), and the old version keeps working meanwhile. It looks
  for one on return, hourly, and whenever the live stream comes back after Core went away
  (a deploy); the sign-in screen takes a new version by itself (nothing to lose there). Pages
  load network-first, so a page opened after the deploy already runs the new version: it asks
  the waiting worker (`HAS`) whether it precaches the page's own files and, if so, lets it take
  over quietly instead of showing the banner. The worker also checks itself against the
  `index.html` the server serves now: a stale `sw.js` from a CDN (Cloudflare kept one at the
  edge; Core now sends `CDN-Cache-Control: no-store` for root files) is never announced. Product
  photos (`/v1/media`) are cached stale-while-revalidate; `/admin/v1` is never cached by
  the worker.
- **Last-known data** (`lib/persist.ts`): the query cache is saved to IndexedDB, so a cold
  start (even offline) opens straight to the board. Sign-out and store switches go
  through `resetClient()`, which wipes it; a 401 wipes it too, along with the in-memory
  cache and any write queued offline.
- **Signed out from under the app** (sair on another device, encerrar sessão, removed from
  the team, a redeploy with a fresh database): the live stream re-checks the session on
  every 20 s beat and sends `signedout`, and a stream Core refuses makes the app re-check
  `/session`; either way the open app drops to sign-in without a refresh. A failed re-check
  that isn't a 401 (Core mid-deploy, offline) keeps the app on its last session.
- **Manifest** (`public/manifest.webmanifest`): `id`, `launch_handler` (focus-existing;
  the open window routes the launch URL), shortcuts with icons (Pedidos, Cardápio, Novo
  produto → `/cardapio?novo=1`), store screenshots, a monochrome badge, and a
  `share_target`: a photo shared from the gallery is parked by the worker and opens
  "novo produto" with it (`lib/share.ts`).
- **OS integration**: the app icon badge counts orders waiting (`setBadge`); order
  notifications close when the board is seen; "Tela ligada" on Pedidos holds a screen
  wake lock (`lib/wakeLock.ts`); Início offers install (Chromium prompt or iPhone steps)
  and then push (`features/home/DeviceCard.tsx`).
- **Native feel** (`app/Router.tsx`, `app/nativeFeel.ts`, `app/nav.ts`,
  `app/PullToRefresh.tsx`, `ui/Sheet.tsx`): every screen change is a View Transition
  started in one place, the Router's history listener. `html[data-vt]` names it: `push`
  (one level deeper: slides in from the right), `pop` (the mirror), `tab` (sibling roots,
  a cross-fade) or `fade`; the depth table in `nav.ts` decides. From 768 px push and pop
  cross-fade, and reduced motion makes every one a 120 ms fade. When the browser animated
  a back gesture itself (`hasUAVisualTransition`, the iOS edge swipe) nothing runs on top.
  Shared elements: a tappable carries `data-vt-src="order:<id>"` and the next screen
  `data-vt-dst="order:<id>"`; the Router morphs one into the other (and back on pop).
  On phones a drill-down's header shows "‹ Pedidos" (the screen it returns to) in place of
  the store avatar. A navigation from inside a sheet replaces the sheet's history entry.
  Back closes an open sheet, back/forward restore scroll, a tap on the current tab scrolls
  to the top (deeper in it, returns to its root), pulling down refetches the screen, and
  `html[data-kb]` (keyboard up) hides the tab bar. Touch feedback is `press` (scale) and
  `press-row` (rows darken), never hover; offsets above the tab bar use `--tabbar-h`.
  `vite.config.ts` strips Phosphor's unused thin/light weights (re-add one there before
  using it).
- **Install art** (`scripts/pwa-assets.ts`, committed to `public/`): the badge, shortcut
  icons and the iOS splash screens (`scripts/splash-devices.ts`; the `<link>`s are
  written at build). `--screenshots` recaptures the store screenshots from a running app.

Test the worker against the production build (`BASE=http://localhost:8787/admin/`): in
dev it isn't registered.

## The kitchen (Cozinha)

`/cozinha` is the kitchen display and `/cozinha/painel` the screen that faces the customers
([ADR 0029](../../docs/adr/0029-kitchen-display.md), `features/kitchen`). The Shell drops its
rail, bars and pull-to-refresh there (`bare` in `app/Shell.tsx`) but keeps the live stream,
sound and toasts. The screens own their keys (bump bars send keystrokes; the list is under
`?`). Per-device choices (station, sound, voice, "tudo junto", the panel's options) live in
localStorage under `vendua-kds-*` / `vendua-painel-*`. Item marks, rush and stations are Core's
(`/admin/v1/kitchen`). Every move of the order itself is the same transition Pedidos uses.
"Pronto" is held for `UNDO_MS` with "desfazer" before it's sent. To see a busy service, give the
store a menu (`seed:fixtures`) and place orders (`bun scripts/demo-orders.ts`).

## Rules

- **Tokens only.** Colours, radii, type and motion live in `src/ui/theme.css`
  (Creme + Noite; `noite:` is the dark variant). No hex values in features,
  except the onboarding mock, which imitates a storefront.
- **Shadows are `depth-1/2/3`.** They compose with `ring-*`. Don't hand-write
  `box-shadow`.
- **Components** live in `src/ui/`, with one folder per area in `src/features/`.
  `/_ui` is the living reference; add new components there.
- **Data:** keys come from `qk` in `src/lib/query.ts`. The cache stores the raw
  API response and screens unwrap it with `select`. `src/lib/live.ts` maps SSE
  topics to invalidations, batched per burst; a reconnect refetches what's on
  screen, and a stream silent past Core's 20 s `ping` is reopened. Mutations
  pause while offline.
- **Money** is integer cents from Core. The client formats (`lib/format.ts`) and
  never totals.
- **Mutations** go through `lib/api.ts`, which adds the `x-vendua-admin` header
  and an `Idempotency-Key`. Use `useMutation` from `lib/query.ts`, not TanStack's:
  a mutation's retries (dropped connection, timeout, `IDEMPOTENCY_IN_PROGRESS`)
  resend its key, so Core replays instead of applying it twice. Requests time out
  (reads 20 s, writes 30 s, uploads 60 s) rather than hang on a weak signal.
- **Phones first.** Every screen works at 375px with thumb-reachable actions.
  Check 375 in the shots before anything else.
- Keep the shell small: screens and sheets are lazy, through `app/routes.ts`. A screen
  there has its chunk (`chunks`, wrapped by `screen()` so a chunk that's already here renders
  without suspending), the query it opens with, and a skeleton in `app/routeSkeletons.tsx`.
  After the first screen the shell fetches every allowed screen's code while idle (not on
  data-saver or 2G), and `usePreload()` / `intent()` on a link start the chunk and the data
  on hover, touch or focus. A new screen goes in all three places.
- **Loading states have the screen's shape** (`ui/skeletons.tsx`: rows, tiles, board, form
  sections, stats, detail). Lists keep their rows while a new search loads; a detail opens
  with what a list already had (an order from the board) and fills in.
- **Sign-out and store switches** call `resetClient(qc)`, never `qc.clear()` alone: the
  persisted cache must go with the session.
