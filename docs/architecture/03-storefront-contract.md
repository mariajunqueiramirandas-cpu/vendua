# 03 — The Storefront Contract

> Status: **Frozen — Contract v1** · Last reviewed: 2026-09-19
> Decisions: [ADR 0002](../adr/0002-single-storefront-framework-react.md), [ADR 0004](../adr/0004-kernel-owned-checkout.md), [ADR 0007](../adr/0007-headless-primitives.md), [ADR 0008](../adr/0008-contract-versioning.md)
>
> Frozen from the Phase-0 observations in [contract-v1-draft.md](../contract-v1-draft.md)
> (superseded — kept as provenance). Changes to this file are Contract events
> per ADR 0008: anything not marked additive needs a major.

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
  routes/                   # brand pages — arbitrary React code
    index.tsx               # REQUIRED — home/menu
    ...                     # any structure, any components
  overrides/                # optional slot overrides
  styles/                   # global styles, fonts, tokens css
  assets/                   # manifest-referenced; binaries go to the
                            # assets bucket at build time, not git
  package.json              # generated; deps are allow-listed
```

Anything outside `routes/`, `overrides/`, `styles/` is owned by the platform and
must not be edited by hand or agent.

## `vendua.config.ts` — normative reference

```ts
import { defineStorefront } from '@vendua/kernel';

export default defineStorefront({
  // Contract major this storefront is written against.
  contract: 1,

  // Release ring the tenant belongs to (set by Control Plane at
  // provisioning; not chosen by the storefront).
  ring: 'stable',

  // Design tokens → emitted as --v-* CSS variables. Kernel defaults
  // consume all of these.
  tokens: {
    color: { bg, surface, text, muted, accent, onAccent, danger, success },
    font:  { display, body, mono?, srcs? },   // srcs: FontSource[] — Kernel emits
                                             // @font-face (font-display: swap);
                                             // files live under assets/fonts/
    radius:{ sm, md, lg },
    space: { scale },                 // numeric or token list
    motion:{ duration, easing },      // baseline; stores may exceed it
  },

  // Optional: replace Kernel default components at named slots.
  // Values are lazy imports; keys MUST be in the slot registry.
  overrides: {
    'system.StorePausedNotice': () => import('./overrides/StorePausedNotice'),
    'checkout.Summary':         () => import('./overrides/CheckoutSummary'),
  },

  // Brand pages directory. Default './routes'.
  routes: './routes',

  // Budgets: 'default' or explicit overrides (must not exceed platform caps).
  budgets: 'default',
});
```

`defineStorefront` type-checks the config against the installed Contract major:
unknown slot keys, missing tokens, and wrong prop types are **build errors**.

## Required mounts

Every storefront root layout MUST render, exactly once:

```tsx
<VenduaProvider config={config}>
  <SystemSurfaces />
  <Router>{/* storefront routes */}</Router>
</VenduaProvider>
```

- `<SystemSurfaces />` MUST be inside the provider and rendered BEFORE the
  router — a sibling of `<Router />` as the sketch shows, not a child of a
  page or outlet — it owns blocking overlays that must cover brand pages.
- The reserved system route group `/(vendua)/*` is claimed by the Kernel for
  checkout, order tracking, auth and legal routes; storefront routes MUST NOT
  collide with it. In v1 the group is required once the Kernel ships its
  system routes (ADR 0004 lands them with the Kernel-owned checkout) — until
  then the storefront owns its checkout/order pages under the commerce rules
  below and nothing may map that prefix to anything else.
- The document `<head>` MUST include the loader script tag emitted by the
  scaffold (`<script src="https://cdn.vendua.com.br/v1/v.js" defer>`).

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

| Area                         | Rule                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                    | React only, version pinned by the Kernel. No other framework or meta-framework.                                                                                                          |
| Commerce behavior            | MUST go through Kernel primitives/hooks. No re-implementing add-to-cart, cart math, checkout entry, status checks.                                                                       |
| Network                      | MUST NOT call `fetch`/axios/Core APIs directly. All data via `@vendua/kernel` hooks. (Lint-enforced.)                                                                                    |
| Business rules               | MUST NOT be expressed in storefront code (min order, availability windows, fees, zone checks). Display Core's answer; disable via primitives.                                            |
| Server code                  | None. No API routes, no middleware, no edge functions, no SSR loaders of its own.                                                                                                        |
| Build                        | Only `@vendua/cli build`. No custom bundler config beyond allow-listed plugins.                                                                                                          |
| Dependencies                 | Allow-listed only (gsap, framer-motion, three/@react-three/*, lenis, lucide…). Each dep must appear on the allow-list with a size cap. Adding one is a platform PR, not a storefront PR. |
| Kernel internals             | No deep imports (package `exports` + lint). No monkey-patching Kernel modules.                                                                                                           |
| Overlays/modals for commerce | MUST use the corresponding primitive/slot. A storefront MUST NOT build a parallel cart, checkout, or payment UI.                                                                         |
| Cookies/storage              | Only via Kernel session utilities (LGPD-consent-aware). No ad-hoc localStorage of order/customer data.                                                                                   |
| Global CSS                   | Allowed, but MUST NOT target `v-*` classes or `[data-vendua]` hooks. Kernel styles are layered so resets can't break them (tested).                                                      |

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

## What storefronts freely control

Page structure and routing under `routes/`; all layout, typography, color,
imagery; motion and scroll choreography; WebGL/3D/canvas work; component
composition; copy; SEO content within brand pages; and the visual layer of every
primitive (`asChild`) and every overridable slot.

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

- The Contract is a single integer (`contract: 1`). It changes when required
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
