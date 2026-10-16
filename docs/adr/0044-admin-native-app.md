# ADR 0044: The merchant admin as an iOS and Android app, from the same code

- Status: Accepted. Phases 1–3 are built (2026-10-16, "As built" below); Phase 0's accounts,
  Phase 4's store review and Phase 5 wait on the calendar and on decisions, not on code.
- Date: 2026-10-15
- Amends: [ADR 0020](0020-merchant-identity.md) (a session can also travel as a bearer token) and,
  in its last phase, [ADR 0027](0027-print-agents.md) (the Android print agent moves into the app)

## Context

The admin (`apps/admin`) is a phone-first PWA at `painel.vendua.com.br/admin/`. It already behaves
like an app: a service worker precaches every screen, the query cache survives a cold start in
IndexedDB, web push carries new orders with an "Aceitar" action, and the board chimes, vibrates and
keeps the screen awake. What the web can't give it:

- **iPhone owners don't get order alerts until they "add to home screen"**, a step most never take.
  Even then, iOS web push has no custom sound, no action that works reliably, and no vibration.
- **A new order should sound like a kitchen bell, not a text message.** Native notification
  channels (Android) and notification sounds plus `time-sensitive` delivery (iOS) can do that;
  Web Push can't.
- **Merchants look for us in the App Store and Play Store**, and competitors are there.
- **Printing needs a second app on Android** (ADR 0027), and window printing is a no-op inside a
  WebView anyway.

We don't want a second codebase. The admin is large (onboarding, PDV, the copilot, kitchen display,
Vendedor threads) and changes daily, and its UI rules, budgets and screenshot gates
(`apps/admin/README.md`) are the product. One React app has to stay the source for web, iOS and
Android.

A sweep of the admin and Core (2026-10-15) found where the code assumes it is the website at
`painel.vendua.com.br/admin/`. Inside a Capacitor WebView the page's origin is `capacitor://localhost`
(iOS) or `https://localhost` (Android), there is no service worker on iOS, and nothing lives under
`/admin/`:

- **Auth is a same-origin cookie.** `vendua_admin` is `HttpOnly`, `SameSite=Lax`, `Path=/admin`
  (`admin/auth.ts:432-440`). Every call is a relative `fetch('/admin/v1…', {credentials:
'same-origin'})` (`lib/api.ts:83`). Core's one CORS handler echoes an Origin only for the
  request's own host (`app.ts:646-664`), and `adminGate` rejects a mutation whose Origin is another
  host (`auth.ts:487-504`). From the app, every call is cross-origin and refused.
- **The live stream is an `EventSource`** (`lib/live.ts:295`), which can't send an `Authorization`
  header.
- **Some media need the cookie.** Copilot and Vendedor attachments come from `/admin/v1/…/media`
  and render in `<img>`. Product photos come back as relative `/v1/media/…` paths, rendered as-is
  at 28 sites.
- **Push is Web Push only** (`lib/push.ts`, `admin/webpush.ts`, the `push_subscriptions` table).
  The "Aceitar" and "assumir" actions run inside `sw.js`.
- **Links we send to other people use `location.origin`**: team invites (`Team.tsx:402`) and
  referral links shared on WhatsApp (`Referrals.tsx:21`). In the app those would be
  `capacitor://localhost/…`.
- **Leaving the app and coming back.** The Mercado Pago card checkout and OAuth connect
  `location.assign` away and return to `/admin/?assinatura=retorno` or
  `/loja/pagamentos?mp=connected`. The e-mail sign-in link (`?link=`) and push `url`s are
  `/admin/…` URLs too.
- **Paths and base.** `<Router basename="/admin">` (`main.tsx:34`), Vite `base: '/admin/'`, and
  about a dozen literal `/admin/` navigations.
- **Browser features that don't work, or work badly, in a WebView:** `navigator.vibrate` (does
  nothing on iOS), `window.print` (does nothing in either WebView: bag card, table QR sheet,
  receipt popup), Wake Lock (unreliable in WKWebView), `speechSynthesis` (missing from Android's
  WebView: the kitchen's spoken tickets), and file-based `navigator.share`.
- **Nothing to build on in Core:** no `/.well-known/` routes (the edge 404s them), no client
  version header, no minimum-version gate.

None of this is in the screens. It sits in about ten modules, which is what makes one codebase
realistic.

## Decision

### 1. One app, two build targets, one seam

- **Capacitor wraps the same React app.** No React Native and no second UI.
  `apps/admin/capacitor.config.ts`, `apps/admin/ios/` and `apps/admin/android/` live next to
  `src/`. One workspace, one `package.json`, one `bun.lock` entry.
- **Vite builds two targets from one source.** `vite build` stays the web build (`base:
'/admin/'`, service worker, web push). `vite build --mode native` writes `dist-native/` with
  `base: '/'`, no service worker plugin, and `VITE_API_ORIGIN=https://painel.vendua.com.br`. Both
  get the same bundle budgets.
- **Everything that differs goes through `src/platform/`.** `platform/index.ts` declares one
  interface; `web.ts` and `native.ts` implement it, and a Vite alias picks the file per mode. The
  web bundle never contains a byte of Capacitor, and the native bundle never contains the service
  worker code. The interface:
  - `http`: API origin, auth header, `mediaUrl()`
  - `session`: token get/set/clear
  - `stream`: the SSE reader
  - `push`: enable, disable, current, and the action callbacks
  - `haptic`, `keepAwake`, `share` (text, link, files), `print(html)`, `speak(text)`
  - `canPay`: whether the plan can be paid here (`false` on native, decision 1)
  - `openExternal(url)` (Mercado Pago and other trips out), `publicUrl(path)` (links for other
    people)
  - `updates`: check, apply, the banner state; `lifecycle`: resume, pause, back button
- **The boundary is checked, not hoped for.** `tools/check-admin-platform.mjs` runs in CI, like
  `check-agent-runtime-boundary.mjs`. It fails on `@capacitor/` imports outside `src/platform/`.
  It also fails on raw `fetch('/`, `EventSource(`, `location.origin`, `window.print`,
  `navigator.vibrate` and `navigator.share` outside `src/platform/` and `lib/api.ts`. A
  contributor who writes web-only code gets told before review.

### 2. The app is bundled, and updates itself from Core

- **The web assets ship inside the app**, not loaded from `painel.vendua.com.br`. Capacitor's
  `server.url` is a development aid, and Apple rejects website wrappers (guideline 4.2). A bundled
  app also opens offline, as the PWA does today. `server.url` stays for live reload in dev only.
- **Over-the-air updates come from our own Core, with no vendor.** The deploy that ships a Core
  also builds `dist-native/` from the same commit, zips it and bakes it into the Core image. Core
  answers two routes, mounted before the session gate so a signed-out app updates too:
  - `GET /admin/v1/app/bundle?native=N` → `{ version, url, sha256, requiresNative }`
  - `GET /admin/app/bundle/<version>.zip`
- **On the device, `@capgo/capacitor-updater` in manual mode** (open source, no cloud account)
  downloads, checks the sha256 and stages the bundle. The UX is the service worker's:
  - on a cold start with a newer bundle, it applies before first paint when the download finishes
    within ~3 s, else on the next launch;
  - while running, the existing "Tem uma versão nova · atualizar" toast applies it;
  - the app calls `notifyAppReady()` once the router has mounted and `/session` has answered. A
    bundle that crashes before that rolls back by itself.
  - During a start-first swap (ADR 0041) two Cores may answer. A manifest from one and a zip from
    the other fail the checksum and are retried later.
- **So the JS in an installed app is never older than a PWA tab left open for a day.** The
  JS-to-Core skew stays what ADR 0041 already handles. The new skew is JS-to-shell: a bundle can
  use a native plugin an older install doesn't have.
  - The JS feature-detects every plugin (`Capacitor.isPluginAvailable`) and falls back to the web
    behavior, so most native additions need no gate.
  - `apps/admin/app-version.json` holds `{ "version": "1.0.0", "native": 1 }`. `native` is bumped
    only when a bundle cannot run on an older shell. Core skips bundles whose `requiresNative` is
    higher than the shell's, and the app shows "Atualize o app na loja".
  - Core's `VENDUA_ADMIN_MIN_NATIVE` is a hard floor: below it, Core answers `426
CLIENT_TOO_OLD` and the app shows one screen with the store button.
  - CI fails a PR that changes a Capacitor dependency or `ios/`/`android/` without bumping
    `native`.
- **Every request says who is calling.** `x-vendua-client: web/<bundle>` or
  `ios/<version>/<native>/<bundle>`. Core logs it, and "Aparelhos conectados" shows "App
  iPhone" instead of a user agent string.

### 3. A session can travel as a bearer token

- **Same session, two transports.** The token is the cookie's own value,
  `<tenantId>.<sessionId>.<secret>`. The `merchant_sessions` row, the 60-day sliding expiry,
  revocation, role re-reads and "Aparelhos conectados" all stay exactly as ADR 0020 has them.
  `adminGate` reads `Authorization: Bearer` when present, else the cookie; a request never uses
  both.
- **The native client asks for a token.** The sign-in endpoints (`/auth/otp/verify`,
  `/auth/select`, the e-mail link, invite acceptance) and `/session/switch` see
  `x-vendua-client: ios|android/…`. They answer `{ token }` in the body and set no cookie.
  Sign-out deletes the row, as now.
- **CSRF.** A bearer request isn't ambient: a cross-site page can't make the browser attach it. So
  the gate skips the same-host Origin check for bearer requests, and still requires
  `x-vendua-admin: 1`, so the client code stays the same.
- **CORS for exactly two origins.** `capacitor://localhost` and `https://localhost` get
  `Access-Control-Allow-Origin` on `/admin/v1/*` and `/analytics/v1/collect` only, without
  credentials, allowing `Authorization`, `X-Vendua-Admin`, `X-Vendua-Client` and
  `Idempotency-Key`. The credentialed same-host rule (`app.ts:646`) is untouched, so no storefront
  origin gains anything.
- **The token lives in the Keychain (iOS) and the Android Keystore**, behind our own small plugin
  in the shell (`VenduaShell.session`). It is excluded from backups and readable after first
  unlock, so a notification action can use it with the phone locked. It never touches
  IndexedDB or `localStorage`, and the 401 path in `lib/persist.ts` clears it along with the
  cache.

### 4. The live stream: one reader for both platforms

- `live.ts` moves from `EventSource` to a small fetch-based SSE reader (`ReadableStream`, the same
  named events: `hello`, `change`, `presence`, `ping`, `signedout`). It sends the platform's auth
  header and keeps the existing reconnect and 20 s beat logic. The web uses it too, so the stream
  has one implementation. The web switch ships first, alone, so a regression shows on the web
  before any app exists.
- When the app goes to the background, iOS suspends the WebView and the stream dies. Resume runs
  the existing "on return" path (reconnect, refetch, update check). Notifications cover the gap.

### 5. Order alerts are native, and the best part of the app

- **Devices.** A new table `push_devices`:
  - columns: `id`, `tenant_id`, `user_id`, `session_id`, `platform` (`ios` | `android`), `token`,
    `app_version`, `created_at`, `last_ok_at`, `last_error`;
  - unique `(tenant_id, token)`, RLS like every table, and the token capped at 4 KB;
  - registration through `POST /admin/v1/push/devices` with an `Idempotency-Key`.
  - It's tied to the session, so signing out, "encerrar sessão" or removal from the team stops
    the alerts in the same transaction.
- **Sending.** `admin/nativepush.ts` sends to APNs directly (HTTP/2, an ES256 JWT, the same
  signing Core already does for VAPID) and to FCM HTTP v1 for Android. There is no Firebase SDK
  on iOS.
  - `workers.ts` fans every alert it already sends (`order.placed`, `payment.received`, the
    Vendedor and WhatsApp alerts, the sweeper's) to both tables, with the same `{ title, body,
tag, url, actions }`.
  - Dedupe stays in `push_deliveries`, and missed order alerts still fall back to WhatsApp.
  - An invalid-token answer deletes the row, like a 404/410 does for web push.
  - Secrets: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` and
    `FCM_SERVICE_ACCOUNT_JSON`. Without them, native push is off and nothing else changes.
- **The alert itself is built natively**, by a small `OrderAlerts` handler in the shell (about 100
  lines of Swift and 150 of Kotlin) instead of the default notification:
  - **Sound:** the "Pedido novo" chime, rendered once from `lib/sound.ts`'s synth to
    `.caf`/`.ogg` by a script, so the app and the board sound identical.
  - **Android:** a "Pedidos novos" channel at high importance with that sound and the
    `[180, 90, 180]` vibration. Data-only FCM messages, so we draw the actions ourselves.
  - **iOS:** `interruption-level: time-sensitive`, so Focus modes let it through; the silent
    switch still wins, as design spec §5.2 asks.
  - **"Aceitar" works from the lock screen without opening the app.** The handler POSTs
    `/orders/{id}/transition {to: 'confirmed'}` with the Keychain token and an `Idempotency-Key`
    of `accept-<orderId>`, then replaces the notification with "Pedido aceito". This is the
    service worker's action, unchanged in meaning. "Assumir" on Vendedor threads works the same
    way. A tap on the body opens the app on the notification's route.
  - Notifications collapse by `tag` (`apns-collapse-id`, the FCM `tag`). Seeing the board clears
    them, as `ORDERS_SEEN` does today.

### 6. Links in, links out

- **Universal Links and App Links for `painel.vendua.com.br/admin/*`.** Core serves
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`, and the edge
  (`apps/admin/nginx.conf`) proxies `/.well-known/` to Core.
  - On a phone with the app, an `/admin/…` link opens the app on that route: a push `url`, the
    e-mail sign-in link, a team invite, the print pairing QR.
  - The `/admin` prefix is stripped by the same helper `Router.tsx` uses.
- **Trips out open in an in-app browser** (`@capacitor/browser`: SFSafariViewController, Custom
  Tabs), not in the WebView. This covers the Mercado Pago checkout and OAuth, and help links. They
  come back through the same Universal Link Core already returns to; the app closes the sheet
  and routes there.
- **Links for other people come from `platform.publicUrl(path)`**, which is always
  `https://painel.vendua.com.br/admin/…` on both targets.

### 7. Shell details, done properly

- **Bundle ID** `br.com.vendua.painel` (next to `br.com.vendua.impressora`).
- **Safe areas and status bar.** Safe areas keep the CSS `env()` insets the PWA already uses. The
  status bar and Android navigation bar follow Creme/Noite.
- **Splash.** The native splash comes from the same sources as the PWA's (`@capacitor/assets`),
  and hides on first paint.
- **Android back button.** It closes the open sheet (vaul), then goes back a route, then
  backgrounds the app on Início. It never exits mid-flow.
- **Plugins:**
  - haptics → `@capacitor/haptics`, on iOS too for the first time;
  - wake lock → `@capacitor-community/keep-awake`;
  - kitchen voice → a native text-to-speech plugin;
  - file share → `@capacitor/share` with `@capacitor/filesystem`;
  - CSV exports → download with the token, then the share sheet;
  - `print(html)` → a native print dialog (UIPrintInteractionController, PrintManager) in
    `VenduaShell`.
- **Permission strings** for the camera, photo library and microphone (photos, copilot voice) in
  pt-BR. The microphone is asked for only when the copilot first records.
- **Unchanged pieces:** `PhotoField`'s file input, `getUserMedia`, IndexedDB persistence, Leaflet
  and the Aparência preview iframe work as they are. The spike confirms each on real devices.

### 8. CI keeps both targets honest

- **`admin-native` job (Linux, every admin PR):**
  - the native build with its budgets;
  - the platform boundary check;
  - a **cross-origin smoke**: `dist-native/` served from a second port against Core on `:8787`
    with a bearer session. It runs sign-in, Início, Pedidos, an order arriving over the stream,
    a copilot image and the Mercado Pago return route.
  - That reproduces the WebView's conditions (other origin, no cookie, no `/admin/`, no service
    worker) in Playwright, so a cookie-only call or a relative URL fails on the PR, without a
    phone.
- **Android:** `cap sync android && ./gradlew assembleDebug lintDebug` on Linux whenever
  `android/`, `capacitor.config.ts`, `src/platform/` or a Capacitor dependency changes.
- **iOS (macOS runner):** builds only when `ios/` or `app-version.json` changes, and on dispatch
  (macOS minutes cost ten times as much).
- **`.github/workflows/admin-app.yml`**, shaped like `print-agents.yml`: when `app-version.json`
  names a version not released yet, Fastlane signs and uploads to TestFlight and the Play internal
  track.
  - Promotion to production stays a person's click in each console.
  - Store releases happen only when the shell changes; everything else ships with Core over the
    air.

### What we're not doing

- **CapacitorHttp:** it buffers responses, so no stream, and it treats uploads unevenly.
- **Cookies with `SameSite=None`:** iOS blocks third-party cookies in WKWebView.
- **A remote-URL wrapper.**
- **Firebase on iOS:** used only if the Bun HTTP/2 client fails the APNs spike.
- **Apple's critical alerts:** reserved for health and safety apps.

## Plan

Each phase ships on its own and leaves the web better or the same.

**Phase 0: accounts and decisions (calendar time, little work).**

- Apple Developer Program and Google Play as an organization: this needs the CNPJ's D-U-N-S
  number, which takes days to weeks. An organization Play account also skips the 12-tester rule
  for personal accounts.
- APNs key, Firebase project for FCM, the Play signing key.
- The listing's visibility (decision 2), before Phase 4.

**Phase 1: the seam, on the web only (≈1 week).**

- `src/platform/` with `web.ts` only.
- `mediaUrl()` at the 28 photo sites, `publicUrl()` for invites and referrals.
- The `/admin/` literals through the router helper.
- The fetch-based stream reader, the `x-vendua-client` header and the boundary check.
- Pure refactors, gated by today's shots. The mechanical sweeps (media sites, literals) can go to
  Haiku agents under one brief; the stream reader and the seam's shape are the lead's.

**Phase 2: Core (≈1 week).**

- Bearer sessions and token sign-in, plus the native CORS rule.
- `push_devices`, `nativepush.ts` and the `workers.ts` fan-out.
- The bundle manifest and zip, and the version floor.
- `/.well-known/` in Core and the edge.
- The review sign-in (decision 3).
- Migrations are additive (a new table and a new column only).
- The invariant review runs here: this phase touches auth, tenancy, idempotency and a migration.

**Phase 3: the shell (≈1.5 weeks).**

- `vite --mode native`, Capacitor, `native.ts` and `VenduaShell` (session, `OrderAlerts`,
  print).
- The updater, the plugins and deep links.
- The cross-origin smoke and the Android CI build.
- First on the team's phones, then TestFlight and the internal track with two or three pilot
  stores for a week of real orders.

**Phase 4: the stores (≈1 week, mostly waiting on review).**

- Listings in pt-BR, with screenshots from `scripts/shots.ts` on the native build.
- The privacy questionnaires, matching ADR 0028's no-tracking stance.
- The listing's visibility (decision 2), the review sign-in's code handed to App Review, and fixes
  for what review sends back.

**Phase 5: later, each its own change.**

- **Print agent into the app (Android).** ADR 0027's Kotlin service becomes a `VenduaShell`
  plugin with its foreground service, so a tablet runs one app. The Play listing also settles
  ADR 0027's 2027 developer-verification problem for this app.
- **Re-ring in the background.** The 60 s sweeper re-sends an unaccepted order's alert under the
  same collapse id, up to a cap. This matches the board's 20 s re-ring while the app is closed.
- **Home-screen extras:** quick actions from the manifest's shortcuts, an Android widget ("hoje:
  R$ · pedidos") and an iOS Live Activity for an open day.
- **Share target parity:** an Android share intent, an iOS share extension.

Total: about four to five weeks of work from Phase 1 to submission, plus Phase 0's waiting.

## Decisions taken (the user, 2026-10-15)

1. **Paying stays on the web.** Today signup, the first plan payment (`PlanPay`, card via Mercado
   Pago or Pix) and invoice payment (`Account`) all live in the admin.
   - Apple (3.1.1) and Google Play require their own billing for a digital subscription bought
     inside an app, and both restrict links that steer to outside payment. The details have moved
     under regulators, Brazil's included, so re-check at submission.
   - So the native build signs in only, and signup, which ends in the first payment, stays on the
     web. The app shows the plan's state but no buy, pay or upgrade buttons and no link to them.
     `platform.canPay` is `false` on native and hides `PlanPay`, the invoice actions and the plan
     change in `Account`.
   - This also keeps Apple's in-app account-deletion rule (5.1.1(v), triggered by in-app account
     creation) out of v1. The words on the plan-state screen still state a plan, so the user
     approves them when that screen is built.
2. **The app is called "Venduá"** in both stores. Whether the listing is public from day one or
   invite-only during the pilot (unlisted on iOS, a closed track on Play) is still open; it is
   decided at Phase 4.
3. **A review sign-in is built**, in Phase 2. App Review can't receive a WhatsApp code.
   - `VENDUA_REVIEW_LOGIN=<phone>:<code>` makes `/auth/otp/verify` accept that fixed code for
     that one phone. The phone must belong only to a demo store (`tenants.is_demo`, added in the
     same migration), so the code can never open a real store.
   - Same per-IP and per-code attempt limits as every sign-in. Unset means off.
   - The code is rotated after each review, and every sign-in through it is a
     `recordStaffEventTx` event under the demo store's `tenantId`, so the team sees each use. The
     event data carries no phone.
4. **The print agent moves into the app later** (Phase 5), not in v1. Until then the Android
   print agent keeps shipping as an APK on GitHub Releases (ADR 0027), unchanged.

## As built (2026-10-16)

Phases 1–3 follow the decision above. Where the code settled a detail the text left open, or
differs from it:

- **The seam.** `src/platform/index.ts` re-exports `@platform-impl`, which Vite points at `web.ts`
  or `native.ts` (`vite.config.ts`). `tools/check-admin-platform.mjs` (CI `admin-native`) enforces
  §1. The website's PWA code moved under `platform/web/`.
- **Who is calling.** The website sends `web/<commit>`, the app
  `ios|android/<store version>/<native>/<bundle>`, and the alert buttons
  `…/<native>/alert`. The bundle is named by content, `<store version>-<hash>`
  (`scripts/bundle-native.ts`), and the app reads it from the bundle's own `bundle.json`.
- **Photos.** `/v1/media` answers with `Access-Control-Allow-Origin: *`: its URLs are already
  public, and the app loads them from its own origin. Private media (a copilot photo) goes through
  `platform.http.privateMedia`, a bearer fetch to a blob URL.
- **CORS for development.** Outside production, `VENDUA_ADMIN_APP_ORIGINS` adds origins to the two
  (CI's smoke serves the app's bundle from `http://localhost:5197`).
- **The stores' update.** A 426 shows `StoreUpdate` over everything; a bundle that needs a newer
  shell shows a toast once and the app keeps its current bundle. The Play link is fixed; the App
  Store link is `VITE_APP_STORE_URL`, set once the listing exists (Phase 4). Without it the screen
  names the store and shows no button.
- **Alerts in the app.** "Aceitar" sends the service worker's own key, `push-accept-<orderId>`, so
  a tap on the website's alert and on the app's can't confirm twice. While it is on its way the
  Android alert loses its buttons ("Aceitando o pedido…"); a refusal replaces it with "Não deu para
  aceitar daqui", which opens the order. "Assumir" opens the app (Android 12+ lets no notification
  receiver start an activity), takes the conversation natively, then routes there. With the app
  open, iOS lists an order or a waiting shopper in the notification centre without a banner, since
  the board already rang. Android has three channels: "Pedidos novos", "Clientes esperando" and
  "Avisos da loja".
- **The shell.** Android is Java (the Capacitor template's language, no Kotlin plugin to add to
  the build). The session is AES-GCM under a Keystore key, and backups and device transfer exclude
  the app's data. iOS uses the Keychain
  (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) and its own `UNUserNotificationCenter`
  delegate (`ios.handleApplicationNotifications: false`), set before launch ends so an "Aceitar"
  that cold-launches the app is answered. Printing is `UIPrintInteractionController` and
  `PrintManager` over a WebView of the ticket's HTML. Android's safe areas come from Capacitor 8's
  `SystemBars`: older WebViews are padded inside the bars, newer ones get `env()`.
- **A browser stand-in.** `VenduaShell` has a web implementation (`platform/native/shell-web.ts`,
  session in `sessionStorage`) so the app's bundle runs in a desktop browser for live reload and
  CI's smoke. It is imported eagerly: `main.tsx` awaits `platform.ready()` at the top level, so a
  lazy chunk that imports from the entry would deadlock.
- **Art and sound** come from scripts, committed with their output: `scripts/app-assets.ts` (icons,
  adaptive and themed icons, splash for Creme and Noite, from `public/icons/icon.svg`) and
  `scripts/render-chime.ts` (`NEW_ORDER` in `lib/sound.ts`, rendered offline).
- **CI.** `ci.yml`'s `admin-native` job runs the seam check, `tools/check-admin-native.mjs`,
  `scripts/native-version.ts --check`, the app's bundle under the website's budgets, the
  cross-origin smoke (`scripts/native-smoke.ts`: sign-in on screen, bearer and no cookie, CORS,
  a new order over the stream), and the bundle Core offers against its checksum.
  `admin-app.yml` builds Android (`assembleDebug lintDebug`) and iOS (simulator, unsigned) on PRs
  that touch the shell, iOS only when the iOS side changed. On `main` it runs Fastlane to Play's
  internal track and TestFlight once the secrets in `apps/admin/fastlane/README.md` exist.
- **The edge.** `painel.vendua.com.br` is the admin's own nginx (`apps/admin/nginx.conf`), which
  proxies `/.well-known/` to Core; the storefront edge needs nothing.
- **Configuration**, all off when unset:
  - Core: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_SANDBOX=1` (development
    builds), `FCM_SERVICE_ACCOUNT_JSON`, `VENDUA_ADMIN_MIN_NATIVE`, `VENDUA_IOS_APP_IDS`,
    `VENDUA_ANDROID_CERT_SHA256`, `VENDUA_REVIEW_LOGIN`, and `VENDUA_ADMIN_APP_ORIGINS` (development
    only).
  - The app's build: `VITE_API_ORIGIN` (default `https://painel.vendua.com.br`),
    `VITE_APP_STORE_URL`, and `CAP_SERVER_URL` for live reload.

Still open: the plan screen's wording inside the app (decision 1 hides every button; the plan's
name and state still show, and their words need the user's approval), the listing's visibility
(decision 2), and everything in Phase 0, 4 and 5.

## Consequences

- **One codebase for three targets.** A screen change ships to web and app with the same deploy,
  over the air. Only shell changes go through store review, and those are rare and versioned.
- **The web gets better in Phase 1 before any app exists.** No relative URLs, one stream reader,
  a client version in every log line.
- **Merchants on iPhone get real order alerts for the first time,** with "Aceitar" from the lock
  screen. On Android they get a sound made for a kitchen.
- **New standing costs:**
  - two store accounts (Apple's yearly fee, Google's once);
  - a macOS runner now and then;
  - APNs and FCM credentials to rotate;
  - store review on shell releases;
  - a signing key that, as with the print agent, must never be lost. Play App Signing holds the
    app key, and we keep the upload key offline.
- **The admin grows one rule:** platform-specific code lives in `src/platform/`, and the boundary
  check enforces it.
- **Some web bugs only show in a WebView** (audio policy, keyboard resizing, iOS's suspended
  timers). The cross-origin smoke catches the structural ones; the rest need a look on a real
  phone before each shell release.
