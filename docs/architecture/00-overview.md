# 00 — Architecture Overview

> Status: Proposed · Last reviewed: 2026-09-11

## What Venduá is

A vertical SaaS for small food businesses (bakeries, dessert shops, restaurants,
delivery). Unlike digital-menu platforms, every customer gets a storefront that
is **real, bespoke code** — as if a software house built it — while catalog,
cart, checkout, payments, orders, delivery, auth, analytics and infrastructure
are shared by all tenants in one Core.

Commercial goal: software-house perceived value at near-SaaS marginal cost. That
is only possible if _producing_ a storefront is cheap (coding agents + a
generation pipeline) and _maintaining_ 100–1000+ storefronts does not require an
agent per change (centralized platform + programmatic rollout).

## The one rule

Every platform capability is decomposed into three axes, owned by three
different layers:

| Axis                               | Owned by   | Question answered                                                           |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------- |
| **Existence & behavior**           | Core       | Does the feature exist for this tenant, right now? What are the rules?      |
| **Placement & default appearance** | Kernel     | Where does it mount? What does it look like if the storefront does nothing? |
| **Appearance (optional)**          | Storefront | How does it look to match _this_ brand?                                     |

A feature that respects this split ships to 1000 storefronts by touching zero
storefront repositories. A feature that violates it (e.g. behavior implemented
inside storefront code, or a system surface with no default) becomes an
N-storefront migration — and, if unlucky, N agent tasks.

Everything else in this documentation set exists to enforce that rule:
the Contract bounds what a storefront can do; primitives keep commerce behavior
in the Kernel; system surfaces keep feature _existence_ server-driven; the
loader is the escape hatch when even the Kernel is too old.

## Layers

```
            ┌──────────────────────────────────────────────────────┐
  Intake    │  WhatsApp agent / human briefing → DesignSpec          │
            └──────────────┬───────────────────────────────────────┘
                           ▼
  Generation  ┌──────────────────────────────────────────────────────┐
              │  Coding agent (Devin / Claude Code / human)           │
              │  scaffold → implement → conformance + generation QA   │
              │  → PR touching only storefronts/<slug>/               │
              └──────────────┬───────────────────────────────────────┘
                           ▼
  Operation   ┌──────────────────────────────────────────────────────┐
              │  Control Plane: tenants, releases, deployments,       │
              │  domains, health, fleet trains, agent queue           │
              └──────────────┬───────────────────────────────────────┘
                           ▼
  Runtime     ┌──────────────────────────────────────────────────────┐
              │  Edge: TLS · host→tenant · artifact serving ·         │
              │  vendua-state injection · CDN                         │
              ├──────────────────────────────────────────────────────┤
              │  Storefront artifact: custom React code on            │
              │  @vendua/kernel (hooks · primitives · SystemSurfaces  │
              │  · defaults) + v.js loader                            │
              ├──────────────────────────────────────────────────────┤
              │  Core APIs: /storefront · /checkout · /admin          │
              │  Postgres · Mercado Pago · WhatsApp notifications     │
              └──────────────────────────────────────────────────────┘
```

## How a global feature ships: the ladder

Ordered by "how much storefront involvement is required". Every feature is
implemented at the **highest rung that can express it**.

| #   | Mechanism                                                    | Reaches stale storefronts         | Needs rebuild         | Needs code change           |
| --- | ------------------------------------------------------------ | --------------------------------- | --------------------- | --------------------------- |
| 1   | Backend-only change (rules, hours, pricing, promos)          | Immediately                       | No                    | No                          |
| 2   | Server-driven system surface (new `kind`, new checkout step) | Immediately, via generic renderer | No                    | No                          |
| 3   | Loader (`v.js`) overlay — emergencies only                   | Immediately, always               | No                    | No                          |
| 4   | New Kernel default component / new slot                      | After fleet rebuild               | Yes (automated train) | No                          |
| 5   | Additive hook/prop extension                                 | After rebuild, opt-in             | Yes                   | Optional                    |
| 6   | Contract major + codemod                                     | After codemod + train             | Yes                   | Automated; failures → agent |
| 7   | New brand surface / redesign                                 | That storefront only              | Yes                   | Agent or human              |

Rungs 1–3 cover "the fleet must have it now". Rung 4 covers "the fleet should
have it, properly styled". Rungs 6–7 are the only ones that may consume agent
time, and rung 6 is designed to keep that tail small (target <15% of stores per
major, majors at most once a year).

Worked example — _"store paused, orders return at 18:00"_:

1. Core: `store.status` gains `paused` + `resumesAt`; emits a `notices[]` entry
   of kind `store_paused`; checkout rejects with typed error `STORE_PAUSED`.
   Feature is **true** on every store immediately (rung 1–2): any Kernel ever
   shipped renders the notice generically.
2. Kernel 2.4 adds a polished `StorePausedNotice` default; the next fleet train
   delivers it with zero storefront edits (rung 4).
3. A storefront MAY override slot `system.StorePausedNotice`. If the override
   crashes, the error boundary renders the Kernel default — the store keeps
   working (rung 4 fallback).
4. If a store's entire frontend is broken, `v.js` can still show a blocking
   "paused until 18:00" overlay (rung 3).

## Non-negotiable constraints (the short list)

- **One framework: React.** [ADR 0002](../adr/0002-single-storefront-framework-react.md)
- **Storefronts are artifacts, not services.** [ADR 0003](../adr/0003-storefronts-as-artifacts.md)
- **One monorepo.** [ADR 0001](../adr/0001-monorepo-for-storefronts.md)
- **Checkout is Kernel-owned.** [ADR 0004](../adr/0004-kernel-owned-checkout.md)
- **Commerce behavior goes through primitives, not storefront code.**
  [ADR 0007](../adr/0007-headless-primitives.md)
- **No breaking change without a codemod and conformance coverage.**
  [ADR 0008](../adr/0008-contract-versioning.md)
- **Venduá never custodies merchant funds.** [ADR 0009](../adr/0009-mercado-pago-marketplace.md)

## What "custom" means — and what it doesn't

A storefront has full freedom over: page structure and routes (outside reserved
system routes), layout, typography, motion (GSAP, Framer), 3D/WebGL (R3F,
custom shaders), component composition, imagery, and the visual design of every
primitive and overridable slot.

A storefront does **not** control: the framework, the checkout flow, payment
handling, pricing/cart math, business rules, server code, middleware, or the
npm dependency graph beyond an allow-list. Those restrictions are what make the
fleet operable; none of them are where a bakery's brand lives.

## Scale targets and where it hurts

| Concern                      | 100                 | 300               | 1000+                                        |
| ---------------------------- | ------------------- | ----------------- | -------------------------------------------- |
| Kernel release rebuilds      | ~500 CI-min         | ~1500             | ~5000 — needs trains + artifact promotion    |
| Codemod failure tail (5–15%) | hours of agent time | days              | standing agent queue, real cost line         |
| Core outage blast radius     | bad                 | very bad          | existential — rings + LKG + loader mandatory |
| Kernel version skew          | manageable          | needs skew alerts | strict N/N-1 API policy                      |
| Generic-looking fallback UI  | visible             | brand complaints  | tokens must be excellent                     |

## Non-goals

- A JSON page builder for brand pages. SDUI applies **only** to system surfaces.
- Storefront-controlled business logic. If it affects money, stock, or delivery,
  it lives in Core.
- Supporting storefronts outside the Contract. There is no "escape hatch plan";
  there is the Contract.
