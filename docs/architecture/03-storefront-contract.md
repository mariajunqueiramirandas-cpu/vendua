# 03 — The Storefront Contract

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0002](../adr/0002-single-storefront-framework-react.md), [ADR 0004](../adr/0004-kernel-owned-checkout.md), [ADR 0007](../adr/0007-headless-primitives.md), [ADR 0008](../adr/0008-contract-versioning.md)

**This is the normative contract between Venduá and every storefront.** It is
what makes arbitrary design freedom operable at fleet scale. The Contract bounds
every axis *except* visual design — framework, file layout, dependency policy,
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
    font:  { display, body, mono? },
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

- `<SystemSurfaces />` MUST be inside the provider and above the router outlet —
  it owns blocking overlays that must cover brand pages.
- The reserved system route group `/(vendua)/*` MUST be included. The Kernel
  fills it with checkout, order tracking, auth and legal routes. Storefront
  routes MUST NOT collide with it.
- The document `<head>` MUST include the loader script tag emitted by the
  scaffold (`<script src="https://cdn.vendua.com.br/v1/v.js" defer>`).

## Rules of engagement

| Area | Rule |
| --- | --- |
| Framework | React only, version pinned by the Kernel. No other framework or meta-framework. |
| Commerce behavior | MUST go through Kernel primitives/hooks. No re-implementing add-to-cart, cart math, checkout entry, status checks. |
| Network | MUST NOT call `fetch`/axios/Core APIs directly. All data via `@vendua/kernel` hooks. (Lint-enforced.) |
| Business rules | MUST NOT be expressed in storefront code (min order, availability windows, fees, zone checks). Display Core's answer; disable via primitives. |
| Server code | None. No API routes, no middleware, no edge functions, no SSR loaders of its own. |
| Build | Only `@vendua/cli build`. No custom bundler config beyond allow-listed plugins. |
| Dependencies | Allow-listed only (gsap, framer-motion, three/@react-three/*, lenis, lucide…). Each dep must appear on the allow-list with a size cap. Adding one is a platform PR, not a storefront PR. |
| Kernel internals | No deep imports (package `exports` + lint). No monkey-patching Kernel modules. |
| Overlays/modals for commerce | MUST use the corresponding primitive/slot. A storefront MUST NOT build a parallel cart, checkout, or payment UI. |
| Cookies/storage | Only via Kernel session utilities (LGPD-consent-aware). No ad-hoc localStorage of order/customer data. |
| Global CSS | Allowed, but MUST NOT target `v-*` classes or `[data-vendua]` hooks. Kernel styles are layered so resets can't break them (tested). |

## What storefronts freely control

Page structure and routing under `routes/`; all layout, typography, color,
imagery; motion and scroll choreography; WebGL/3D/canvas work; component
composition; copy; SEO content within brand pages; and the visual layer of every
primitive (`asChild`) and every overridable slot.

## Budgets (defaults; caps in conformance config)

| Budget | Default | Hard cap |
| --- | --- | --- |
| Initial JS (gzip, route `/`) | ≤ 250 KB | 400 KB |
| Total initial transfer `/` | ≤ 1.5 MB | 2.5 MB |
| LCP element | server/edge-rendered text or image | — |
| Route-level JS for system routes | Kernel-owned | — |
| Per-dep size | per allow-list entry | — |

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
