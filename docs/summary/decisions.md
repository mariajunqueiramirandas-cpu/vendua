# Decisions — all ADRs in brief

Status of all: **Proposed** (2026-09-11). Full text in [`../adr/`](../adr/).

| # | Decision | Why | Main cost |
| --- | --- | --- | --- |
| 0001 | One monorepo for all storefronts | Fleet codemods/trains need a single checkout; repo-per-store = N× CI/bots/API glue | Repo-size discipline; shared-CI blast radius; eventual `fleet-*` sharding |
| 0002 | React only, pinned by Kernel | Bounding the framework is the cheapest bound; multi-framework = O(frameworks) tax on every feature; best agent fluency + motion/3D ecosystem | No "bring your own framework"; React churn absorbed by Kernel team |
| 0003 | Storefronts are artifacts, not services | Per-tenant processes destroy marginal cost (1000 idle containers) | Catalog edits need targeted rebuilds; no per-store server logic ever |
| 0004 | Checkout & system surfaces are Kernel-owned | Payment correctness/PCI/idempotency engineered once; agents can't hallucinate a payment flow | "100% custom" isn't literal — checkout structure is shared |
| 0005 | System surfaces are server-driven (SDUI) | Features must reach stale storefronts without rebuilds; generic render turns version skew into a cosmetic gradient | Every new `kind` must render acceptably generically; SDUI must never creep into brand pages |
| 0006 | `v.js` loader as last-resort channel | Survives broken Kernel/storefront JS/Core outage; the kill switch | A third render system; frozen capability list is the only defense against creep |
| 0007 | Headless primitives are the commerce API | Correctness, QA hooks and analytics can't rely on convention across 1000 generated stores | Primitive API design is load-bearing for years |
| 0008 | Three-axis versioning; majors need codemods | API/Kernel/Contract evolve at different speeds; codemods convert migration cost into one-time engineering cost | Additive-only discipline; compat shims for one major; stale-store CI job upkeep |
| 0009 | Mercado Pago marketplace + OAuth + `application_fee` | No custody of merchant funds; PIX + MP fit the segment | Token refresh lifecycle; single-provider until a second adapter |
| 0010 | Automated domains & TLS | Zero-touch provisioning; `slug.vendua.com.br` wildcard + Caddy on-demand TLS for custom domains | Cold first-hit per domain; apex-domain DNS quirks; registro.br titularidade is manual-ish |
| 0011 | Ring-based fleet trains | Rollout is a first-class, gated, reversible operation; blast radius bounded by ring size | ~5000 CI-min per train at N=1000; ~3-day soak to stable |
| 0012 | Agent-agnostic pipeline; CI is the judge | No vendor lock-in; scaffold-first makes hallucination visible as a diff | Agent variance; pipeline only works once Contract + conformance are good (Phase 5) |
| 0013 | Core is a modular monolith on Postgres | One deploy/transaction boundary is the right simplicity; outbox + interfaces keep the services option open | Boundary-erosion discipline; one bad Core deploy stalls all writes |

## Rejected alternatives worth remembering

- **Repo-per-storefront** (0001): N× overhead, no atomicity, buys nothing.
- **Multi-framework / Web Components** (0002): per-framework tax; primitives/SDUI collapse to lowest common denominator.
- **Container per storefront / shared SSR now** (0003): economically fatal / premature; SSR host is the documented upgrade path if static-first fails.
- **Custom or hosted-redirect checkout** (0004): unbounded risk / breaks the premium illusion.
- **SDUI for everything** (0005): kills the bespoke differentiator.
- **Agents as the migration mechanism** (0008): unbounded nondeterministic cost; agents handle only the codemod failure tail.
- **Venduá as payment aggregator** (0009): custody + compliance burden — rejected outright.
- **Deep single-agent-vendor integration** (0012): strategic dead-end.
- **Microservices / BaaS for Core** (0013): distributed cost before the budget exists; checkout/payments/notices don't fit generic backends.
