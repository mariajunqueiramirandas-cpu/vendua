# 03 — The Storefront Contract

> Status: **Frozen — Contract v2** · Last reviewed: 2026-09-27
> Decisions: [ADR 0002](../adr/0002-single-storefront-framework-react.md), [ADR 0004](../adr/0004-kernel-owned-checkout.md), [ADR 0007](../adr/0007-headless-primitives.md), [ADR 0008](../adr/0008-contract-versioning.md), [ADR 0018](../adr/0018-page-composition.md)
>
> Contract v2 (ADR 0018, [17](17-page-composition.md)) replaced v1's free
> `routes/` pages with page templates composed from SDK and store sections. It
> landed before the first customer, so v1 had no live stores to carry: Kernel
> 1.x serves Contract 2 only (see the compat matrix in [11](11-backward-compatibility.md)).
> Changes to this file are Contract events per ADR 0008: anything not marked
> additive needs a major.

**This is the normative contract between Venduá and every storefront.** It is
what makes arbitrary design freedom operable at fleet scale. The Contract bounds
every axis _except_ visual design — framework, file layout, dependency policy,
required mounts, behavior ownership — and in return guarantees the storefront
three things:

1. It will keep working through every Kernel minor release without changes.
2. New Core capabilities reach it automatically (system surfaces, rungs 1–3).
3. A breaking change only ever arrives with a codemod and a compatibility
   window ([11](11-backward-compatibility.md)).

Enforcement is mechanical, not social: `vendua check` (lint + type tests) and
the Conformance Suite run on every build; non-conforming artifacts are not
deployable.

## What a storefront is

A package at `storefronts/<slug>/` in the monorepo. It is a **React application
fragment** compiled by `@vendua/cli` into a static artifact. It has no server
code, no middleware, no independent deployment. It is not a Next/Remix app —
the build pipeline is Venduá's.

## Required file layout

```
storefronts/<slug>/
  vendua.config.ts          # REQUIRED — the contract declaration
  main.tsx                  # REQUIRED — the mounts below, nothing else
  index.html                # REQUIRED — v.js tag + a no-JS shell
  sections/                 # the store's own sections and blocks (store:*)
    hero.tsx                #   export const schema = defineSection(…) + default component
    _shared/                #   helpers the sections share (not registered)
  templates/                # the store's initial composition — seeded into Core
    layout.json             #   header/footer shell, one sdk:page-content marker
    home.json  catalog.json  product.json  page.<handle>.json
  overrides/                # optional slot overrides — the last resort
  styles/                   # global styles; tokens + documented parts only
  assets/                   # manifest-referenced; binaries go to the
                            # assets bucket at build time, not git
  package.json              # generated; deps are allow-listed
```

Anything outside `sections/`, `templates/`, `overrides/`, `styles/` and `assets/`
is owned by the platform and must not be edited by hand or agent. After
provisioning, `templates/` is only the initial composition: the live templates
are store data in Core (merchant/staff edits, template migrations), and the
build bundles whatever Core holds as the last-known-good snapshot.

## `vendua.config.ts` — normative reference

```ts
import { defineStorefront } from '@vendua/kernel/config';

export default defineStorefront({
  // Contract major this storefront is written against.
  contract: 2,

  // Design tokens → emitted as --v-* CSS variables. Kernel defaults consume all
  // of these. Repo default only: once provisioned, tokens are store data in Core
  // and the build pulls them (an edit there triggers the rebuild).
  tokens: {
    color: { bg, surface, text, muted, accent, onAccent, danger, success },
    font:  { display, body, mono?, srcs? },   // srcs: FontSource[] — Kernel emits
                                             // @font-face (font-display: swap)
    radius:{ sm, md, lg },
    space: { scale },                 // numeric or token list
    motion:{ duration, easing },
  },

  // Optional, last resort: replace Kernel defaults at named slots. Lazy imports;
  // keys MUST be in the slot registry. Each one is counted (K14).
  overrides: {
    'system.PauseNotice': () => import('./overrides/PauseNotice'),
  },

  // Optional brand-page URLs (Kernel pages are fixed — see Reserved routes).
  paths: { catalog: '/cardapio', product: '/produto/:slug' },

  // Optional: old URLs kept alive.
  redirects: { '/cart': '/sacola' },

  // Optional: non-essential purposes the store asks consent for (LGPD).
  consent: { purposes: ['analytics'] },

  // Budgets: 'default' or explicit overrides (must not exceed platform caps).
  budgets: 'default',
});
```

Contract 2 removed `routes` (pages are templates) and deprecated `ring` (the
ring is Control Plane data; Kernel 1.x ignores it, Contract 3 removes it —
codemod `c3-rehearsal`).

`defineStorefront` type-checks the config against the installed Contract major:
unknown slot keys, missing tokens, and wrong prop types are **build errors**.

## Required mounts

Every storefront entry (`main.tsx`) MUST render, exactly once:

```tsx
import storefront from 'virtual:vendua/storefront'; // sections + snapshot, from vendua()

<VenduaProvider config={config} storefront={storefront}>
  <SystemSurfaces />
  <BrowserRouter>
    <StorefrontRoutes />
  </BrowserRouter>
</VenduaProvider>;
```

- `<SystemSurfaces />` MUST be inside the provider and rendered BEFORE the
  router — it owns blocking overlays that must cover every page.
- `<StorefrontRoutes />` is the route table: template pages (`/`, `paths.catalog`,
  `paths.product`, `page:<handle>` at `/<handle>`) and the Kernel's reserved
  `(vendua)` group, all inside the store's `layout` template.
- `vite.config.ts` MUST use the `vendua({ config })` plugin from
  `@vendua/kernel/vite` — the only sanctioned build path (snapshot, WCAG AA
  gate, artifact manifest).
- The document `<head>` MUST include the loader script tag emitted by the
  scaffold (`<script src="https://cdn.vendua.com.br/v1/v.js" defer>`).

### Reserved Kernel routes — the `(vendua)` group

Owned by the Kernel, rendered inside the store's layout, styled by its tokens:
`/sacola` (cart), `/checkout`, `/pedido/:id` (order status), `/pedidos` (order
history). Brand pages MUST NOT use these paths; new Kernel pages are additive.

### Reserved route prefixes

Core API mounts are reserved — no page route may live under them:

- `/storefront/v1` — tenant-facing reads (store, catalog, surfaces, zones)
- `/checkout/v1` — session, cart, quote, checkout, orders
- `/v1` — platform API
- `/control` — staff/control plane

Dev-server proxies forward ONLY these prefixes, in object form
(`'/checkout/v1': { target, changeOrigin: false }`). String shorthand forces
`changeOrigin: true`, rewriting `Host` so Core resolves `TENANT_NOT_FOUND`;
a bare `'/checkout'` key swallows the SPA's own checkout route on refresh.

## Rules of engagement

| Area                         | Rule                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                    | React only, version pinned by the Kernel. No other framework or meta-framework.                                                                                                                                                                                                  |
| Commerce behavior            | MUST go through Kernel primitives/hooks. No re-implementing add-to-cart, cart math, checkout entry, status checks. Cart and checkout are Kernel pages.                                                                                                                           |
| Network                      | MUST NOT call `fetch`/axios/Core APIs directly. All data via `@vendua/kernel` hooks. (Lint-enforced.)                                                                                                                                                                            |
| Business rules               | MUST NOT be expressed in storefront code (min order, availability windows, fees, zone checks). Display Core's answer; disable via primitives.                                                                                                                                    |
| Server code                  | None. No API routes, no middleware, no edge functions, no SSR loaders of its own.                                                                                                                                                                                                |
| Build                        | Only `@vendua/cli build`. No custom bundler config beyond allow-listed plugins.                                                                                                                                                                                                  |
| Dependencies                 | Allow-listed only (gsap, framer-motion, three/@react-three/*, lenis, lucide…). Each dep must appear on the allow-list with a size cap. Adding one is a platform PR, not a storefront PR.                                                                                         |
| Kernel internals             | No deep imports (package `exports` + lint). No monkey-patching Kernel modules.                                                                                                                                                                                                   |
| Overlays/modals for commerce | MUST use the corresponding primitive/slot. A storefront MUST NOT build a parallel cart, checkout, or payment UI.                                                                                                                                                                 |
| Prices                       | Render a product's price with the Kernel `ProductPrice` primitive (`productPriceLabel` for an `aria-label`, since 1.13), never by formatting `basePriceCents` yourself — promo prices and later price display arrive without a store edit. Money is Core's: never add prices up. |
| Cookies/storage              | Only via Kernel utilities (`useCustomer`, order history, consent). No ad-hoc localStorage of order/customer data.                                                                                                                                                                |
| Copy and imagery             | Belong in section settings (templates), not JSX — K12 flags copy longer than four words in `sections/`.                                                                                                                                                                          |
| Page composition             | Pages are templates. Sections are presentation; they declare areas (block categories) wherever an SDK block could sit.                                                                                                                                                           |
| Global CSS                   | Allowed. MUST NOT target `v-*` classes or `[data-vendua]` hooks; MAY target documented `[data-part]` hooks and set `--v-<component>-*` properties (Kernel `API.md`). Kernel styles are layered so resets can't break them (tested).                                              |

## Semantics pinned in v1

Observed in the Phase-0 spikes; now contractual:

- **`closed` ≠ `paused`.** `closed` is schedule-derived — checkout still runs
  (orders are pre-orders for the next window, which `resumesAt` names).
  `paused` is a manual merchant action and blocks checkout (`STORE_PAUSED`).
  Storefronts display the state; they never decide it.
- **`useCart` resolves without a session** — `cart: Cart | null`, `null`
  before the first mutation. `CartTrigger` counts only `status: 'open'`
  carts; a completed cart is history, not a bag.
- **`asChild` composition is fixed**: the primitive's `onClick` runs first,
  then the child's; `className`s concatenate; `disabled` ORs; child `aria-*`/
  `data-*` props override primitive defaults — except `data-vendua`, which is
  always the primitive's marker.
- **Session transport**: Bearer token on every `/checkout/v1` route,
  `Idempotency-Key` on every mutation, order reads scoped to the token that
  placed them. `ERROR_CODES` is the exhaustive set storefronts may switch on.
- **Notices** carry `payload.resumesAt` (next window boundary) and
  `payload.region` (targets a `<SurfaceRegion name>` by name).
- **`useOrder(id)` polling is storefront-driven `refetch`** — server push
  (SSE) is an additive Kernel minor when it lands; the hook signature holds.
- **`vocabulary` is free-form** `Record<string, string>` — no inflected-forms
  registry in v1.
- **Product imagery**: `figureVariant` (built-in motif enum) is landed;
  `imageUrl`/`stockQuantity` are additive Core fields, not v1 requirements.

## Semantics pinned in v2

- **Unknown section/block types render nothing** (reported); unknown settings are
  ignored; invalid values fall back to the schema default.
- **Live templates win**: `/storefront/v1/state?templates=1` per page, the build's
  snapshot as last-known-good, Kernel defaults for pages neither has.
- **Areas accept categories, not block names** (`purchase-extras`, `badge`,
  `social-proof`, `promo`, `info`, `media`; additive).
- **Section schemas are literal** (`type`, `areas`) — the build publishes them in
  the manifest so template migrations can target areas without running store code.
- **Slot renames keep an alias for the major**: `system.StorePausedNotice` still
  reaches `system.PauseNotice` in Contract 2.

## What storefronts freely control

The markup, motion and styling of their own sections (`store:*`) and blocks;
which sections a template starts with and in what order; all layout, typography,
color, imagery; WebGL/3D/canvas work; the visual layer of every primitive
(`asChild`), SDK section (tokens, variants, documented parts) and, as a last
resort, every overridable slot.

## Budgets

| Budget                           | Default                            | Hard cap |
| -------------------------------- | ---------------------------------- | -------- |
| Initial JS (gzip, route `/`)     | ≤ 250 KB                           | 400 KB   |
| Total initial transfer `/`       | ≤ 1.5 MB                           | 2.5 MB   |
| LCP element                      | server/edge-rendered text or image | —        |
| Route-level JS for system routes | Kernel-owned                       | —        |
| Per-dep size                     | per allow-list entry               | —        |

Budgets are enforced in the Conformance Suite, not at build time — a violation
fails QA, blocking release.

## Contract versioning

- The Contract is a single integer (`contract: 2`). It changes when required
  mounts, config shape, slot semantics, or rules change incompatibly.
- Majors are rare (target ≤ 1/year), always ship with a codemod and a
  conformance test covering the change, and are rolled out via fleet train —
  never silently. Policy in [09](09-migrations-and-fleet-trains.md) and
  [ADR 0008](../adr/0008-contract-versioning.md).
- Kernel semver is independent: within a Contract major, Kernel changes are
  additive or behavior-compatible; a storefront rebuilt on a newer Kernel minor
  requires **zero** code changes.
- Compat matrix (Contract major × Kernel line × Core API major) is maintained
  in the Control Plane; see [11](11-backward-compatibility.md).

## Lifecycle of a storefront

1. `vendua scaffold <slug>` — creates a package that **already passes**
   conformance. This is the only sanctioned starting point (for humans and
   agents): generation transforms a green baseline, never a blank repo.
2. Development against a seeded dev tenant (`vendua dev`).
3. `vendua qa` — conformance suite locally/CI.
4. Merge to `main` → CI builds artifact → Control Plane records release.
5. Provisioner attaches hostname, promotes release, merchant is live.
