# OBSERVATIONS — forn spike

Terse log of every place I had to touch, or wished I could touch, central
behavior. Grouped by where the fix belongs. Each item is a candidate slot /
primitive prop / API field for Contract v1.

## Kernel — broken or blocking

1. **`@vendua/kernel/src/styles.css` is unreachable.** The documented import
   specifier fails at dev-server boot (vite resolve error, app 500s):
   `packages/kernel/package.json` `exports` only maps `.` and `./config`.
   Workaround in storefront: `resolve.alias` in `vite.config.ts` pinning the
   specifier to `../../packages/kernel/src/styles.css`. Fix = add the
   `./src/styles.css` (or `./styles.css`) subpath export.

2. **`api.order(id)` never sends the session token** (`checkout/v1/orders/:id`
   is fetched with no `auth()` header) while Core requires one → always
   `SESSION_REQUIRED`. There is no `useOrder` hook either. Consequence: the
   confirmation screen has no reliable re-read on reload. Workaround: persist
   the checkout response in `sessionStorage['vendua.forn.order.<id>']`
   (`components/last-order.ts`). Contract v1 wants `useOrder(id)` and/or a
   signed public order-read.

3. **`useCheckout().submit` doesn't invalidate the `cart` query.** After a
   successful checkout the comanda kept rendering the completed cart as open:
   badge showed the old count, `/finalizar` re-presented the form, and a
   resubmit minted a **second real order** (nº 03 — see Core §1). Storefront
   workaround: `useKernel().invalidate('cart')` after submit, plus a
   last-order gate on `/finalizar`.

4. **Query cache is module-level and survives `<VenduaProvider>` remounts;**
   `useKernel().invalidate(key)` only pings *mounted* subscribers and
   `invalidateQuery` (the function that actually evicts the entry) is not
   exported. To clear stale `cart` after a session reset, `EpochSync` has to
   subscribe via `useCart()` first, then invalidate. Also observed: an
   in-flight refetch never notifies subscribers that mount *during* the fetch
   — the post-checkout badge can stick at the old count until next navigation
   (~1 in 3 races). Contract wants a public `invalidateQuery`-level API or
   query-key versioning per session epoch.

## Core — broken or missing

1. **`validateCheckout` doesn't refuse a completed cart.** Same session +
   `POST /checkout` twice → two orders (observed nº 02 and nº 03, identical).
   Should be a 409/4xx on `cart.status === 'completed'`.

2. **No session lifecycle.** Once a cart completes, the `vst.*` token is
   dead: every cart mutation returns `CART_NOT_FOUND`, and nothing mints a
   new session except manually clearing `sessionStorage['vendua.session']`
   and remounting the provider (that's what "montar outra sacola" does).
   Contract v1: `ensureSession` should detect a completed cart and rotate,
   or mutations should expose `newCart()`.

3. **`resumesAt` drifts per request.** Across ~7 minutes the value moved
   06:05 → 06:12 (request-time-relative?), while the seeded window is a fixed
   06:30–11:30. The system notice's "Abrimos sáb., 06:12" and my printed
   "fornada 6h30–11h30" visibly disagree. Expect `nextOpenAt` computed from
   the hours windows, not from now.

4. **Missing on `StoreProfile`:** `currency` (BRL is hardcoded storefront-side),
   a display-ready `nextOpenLabel` (each storefront re-implements
   hoje/amanhã/weekday formatting — mine is `components/format.ts`), and the
   delivery `zones` list (`/store` doesn't expose the seeded zone rows, so a
   delivery-enabled tenant can't enumerate neighborhoods/fees; unexercised
   here since forn is pickup-only). `pickup address` exists — good.

5. **Missing on catalog types:** the API returns `figureVariant`, `tags`, and
   category `slug`, but kernel's `CatalogProduct`/`CatalogCategory` types omit
   them — I had to re-declare them in `components/catalog-ext.ts` to render
   per-product marks. Also `modifierGroups[]` is typed on `ProductDetail` but
   forn seeds none, so the modifier-chip UI on `/produto/:slug` is unexercised.

## System surfaces / primitives

1. **Override props are untyped** (`Record<string, unknown>`): my
   `system.StoreClosedNotice` override hand-narrows `{notice, onDismiss}`.
   Should ship a `NoticeOverrideProps` type. The override mechanism itself
   worked end-to-end — the notice renders as the lit shop sign.

2. **Notice body is a pre-baked string** ("Fechado agora / Abrimos {fmt}…").
   The sign wanted the reopening time as its own typographic element; only
   the formatted copy is available. Pass structured fields
   (`opensAt`/`resumeLabel`) on the notice object.

3. **`CartTrigger` hard-codes `aria-label="sacola, N itens"`** from raw
   `itemCount` and can't be overridden via `asChild` — after checkout it
   announced "5 itens" while my status-gated badge showed 0. Primitives that
   merge a11y props should let the child win.

4. **`StoreStatusBadge` hard-codes labels + `title` shows raw ISO**
   (`retorna 2026-09-19T09:12:…`). Fine for a spike; contract wants
   localizable labels and a formatted resume time (ties to Core §3).

5. **`AddToCart` worked as documented** (stamps `data-vendua`, disables on
   sold-out, `asChild` styling, `onAdded`/`onError`). Wanted: an `isAdding`
   render-prop so the button can show a busy state instead of my `setTimeout`
   flash.

6. **Vite 8 footgun for the next spikes:** `server.proxy` string-shorthand now
   defaults `changeOrigin: true`, silently rewriting Host → `TENANT_NOT_FOUND`.
   The mission's "changeOrigin:false (default preserves Host)" is stale —
   spell `changeOrigin: false` explicitly (done in `vite.config.ts`).

## States designed but not reachable with this seed

- `STORE_PAUSED` (pause + resume copy exists, seeded never pauses).
- `ORDER_MIN_NOT_MET` (`minOrderCents: 0`), `OUT_OF_ZONE` (pickup-only).
- `store.deliveryEnabled = true` checkout branch.
- Empty catalog (`categories` all empty) — "vitrine vazia" panel exists.
