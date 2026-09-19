# Platform — Core, Kernel, Contract, Slots, SDUI

Condenses `architecture/01–05`. Full docs are normative.

## Core (`01`)

Single shared backend; owns **all** business logic. Modular monolith
(TypeScript, Hono/Fastify, Postgres + RLS `tenant_id` everywhere). Modules
(tenancy, catalog, store, cart, checkout, delivery, payments, orders,
notifications, identity, analytics, notices) talk via service interfaces +
transactional outbox — never each other's tables.

- **API surfaces**: `/storefront/v1` (public, host-resolved tenant, CDN-able),
  `/checkout/v1` (session-token, `Idempotency-Key` on all mutations),
  `/admin/v1` (merchant JWT), `/control/v1` (internal/mTLS).
- **Versioning**: integer major per surface, additive-only within a major,
  N and N−1 for ≥12 months. Typed errors: `code` is the contract.
- **Server-side cart is non-negotiable**: all pricing/modifier/fee math in
  Core; Kernel renders what Core returns.
- **Key behaviors**: `store.status` (`open|closed|paused` + `resumesAt`)
  auto-derived from `hours`; strict order state machine; delivery zones with
  `quote()`; `composeNotices()` feeds SDUI; WhatsApp notifications via outbox.

## Kernel (`02`)

Shared frontend runtime; the **only** way storefronts touch commerce. Contains
no business rules. Packages: `@vendua/kernel`, `ui-defaults`, `cli`
(`scaffold/dev/check/build/qa`), `conformance`, `codemods`, `loader` — private
workspace deps, internals hidden behind `exports`.

- **Provider tree**: `VenduaProvider` (hydrates from edge-injected
  `__VENDUA_STATE__` → correct first paint) → `SystemSurfaces` → app routes.
- **Hooks**: thin typed wrappers over Core (`useStore`, `useCatalog`,
  `useCart`, `useCartMutations`, `useDeliveryQuote`, `useCheckout`, `useOrder`,
  `useNotices`, `useCustomer`, `useAnalytics`). Never compute locally.
- **Primitives**: headless, own behavior, delegate visuals via `asChild`
  (`AddToCart`, `QuantityStepper`, `CartTrigger`, `CheckoutButton`,
  `ProductLink`, `StoreStatusBadge`, `NotifyMeButton`, `Img`). Each stamps
  `data-vendua` + ARIA — this is what makes conformance and uniform analytics
  work on arbitrary designs.
- **Overrides**: registry lookup per slot; overrides render inside error
  boundaries — a broken override degrades to the Kernel default, never to
  broken.
- **Tokens**: `vendua.config.ts → tokens` → `--v-*` CSS vars consumed by all
  defaults → untouched stores still look on-brand.
- **CSS isolation**: Kernel styles in `@layer vendua` with `v-` classes; `v.js`
  in Shadow DOM; hostile-CSS fixture in conformance.
- **MUST NOT contain**: pricing/rules, per-tenant conditionals, direct payment
  SDKs, fetch outside the Kernel client.

## Storefront Contract (`03`) — the most important doc

A storefront = React app fragment at `storefronts/<slug>/`, compiled by
`@vendua/cli` to a static artifact. No server code, no framework choice.

- **Required**: `vendua.config.ts` (`defineStorefront`: `contract`, `ring`,
  `tokens`, `overrides`, `routes`, `budgets`), `routes/index.tsx`, mounts
  (`VenduaProvider` + `SystemSurfaces` + `/(vendua)/*` system routes + `v.js`
  script tag).
- **Rules**: React only; commerce via primitives; no fetch/Core calls; no
  business rules; allow-listed deps only; no deep Kernel imports; no parallel
  cart/checkout UI; Kernel session utils for storage; no CSS targeting
  `v-*`/`[data-vendua]`.
- **Free to control**: routes, layout, typography, motion (GSAP/Framer),
  3D/WebGL, imagery, visual layer of every primitive/slot.
- **Budgets** (enforced in conformance): initial JS ≤250 KB gzip (cap 400),
  total `/` transfer ≤1.5 MB (cap 2.5).
- **Versioning**: `contract: N` integer; majors ≤1/year, always with codemod +
  dual-support window; Kernel semver independent — rebuilds on newer minors
  need zero code changes.

## Slots & overrides (`04`)

Slots = named typed extension points with Kernel defaults, namespaced
`system.*`, `checkout.*`, `cart.*`, `order.*`, `store.*`, `catalog.*`.
Props additive-only; every slot error-boundaried.

- Overrides MUST be presentational: props in, callbacks out; no fetch, no
  mutations, no API client (lint-enforced); must forward required
  `data-vendua` sub-hooks; lazy imports in config; SHOULD consume `var(--v-*)`.
- Registry governance: new slot = Kernel minor; new required props forbidden;
  rename/remove = Contract major + one-major alias + codemod; every slot ships
  a conformance fixture.
- Deprecation: `available → deprecated → removed (next major)` with lint
  warnings naming replacement + codemod id.

## System surfaces & SDUI (`05`)

How features exist everywhere without storefront changes (ladder rungs 2–3).
SDUI applies **only** to system surfaces — brand pages are real code, never
JSON.

- **Channels**: edge state injection (`__VENDUA_STATE__`, first paint) →
  Kernel fetch (`useNotices`, runtime) → `v.js` loader (always works).
- **Envelope**: `SurfacesEnvelope{version, store, notices[], checkout?,
timeline?}`; `Notice{id, kind, severity, title, body?, actions[], payload?,
dismissible, priority, startsAt?, endsAt?}`.
- **Forward-compat rules**: unknown `kind` → generic `system.Notice`; unknown
  `severity` → degrade to `info` (`blocking` always overlays); unknown action
  → `link` if `href` else omit; `payload` optional; absent surfaces render
  nothing; new kinds must be acceptable in generic render (it's the primary
  path on stale Kernels).
- **Placement**: `banner-stack` → `blocking-overlay` → `consent` → `emergency`
  (loader-owned); brand pages may mount `<SurfaceRegion>`.
- **`v.js`**: ~5 KB dependency-free CDN script, versioned separately, Shadow
  DOM, polls edge-cached state. Capabilities frozen: render blocking/emergency
  notices + health ping. Kill switch via Control Plane `loader_state`.
