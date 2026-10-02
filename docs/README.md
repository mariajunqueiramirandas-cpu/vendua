# Venduá Platform — Documentation

This directory is the design documentation for the Venduá platform: a multi-tenant
system that produces and operates bespoke, code-generated storefronts on top of a
shared backend ("Venduá Core") and a shared frontend runtime ("the Kernel").

**Status of this directory: the docs remain normative, and real code now
implements part of them.** Phase 0–1 landed — Core, Kernel, the storefront
factory, and `apps/control` (the Founder CRM grown into an agent ops console)
all exist, plus the sales-side agent engine on `packages/core`. The
[Where we are](roadmap.md#where-we-are) table in the roadmap is the
current-state ledger; per conventions below, once a package exists, the
package wins. The Venduá marketing site lives at [`../site/`](../site/) and
is unrelated to the storefront framework choice.

Documentation language is English so it can be consumed directly by coding agents
and future hires. Customer-facing copy remains pt-BR.

For a quick human read, [`summary/`](summary/) condenses every doc to its
decisions and mechanisms. **Agents must use the full docs** — the summaries
are lossy by design and the full set is normative.

## Reading order

If you are new, read in this order:

1. [`architecture/00-overview.md`](architecture/00-overview.md) — the whole system
   on one page, including the one rule that makes the architecture work.
2. [`architecture/03-storefront-contract.md`](architecture/03-storefront-contract.md)
   — the normative contract every storefront must satisfy. **This is the most
   important document in the set.**
3. [`architecture/02-kernel.md`](architecture/02-kernel.md) — what the Kernel
   provides (hooks, primitives, defaults).
4. [`architecture/05-system-surfaces.md`](architecture/05-system-surfaces.md) —
   how global features reach storefronts without code changes.
5. [`architecture/01-core.md`](architecture/01-core.md) — the shared backend.
6. [`roadmap.md`](roadmap.md) — build order and exit criteria.
7. [`merchant-admin.md`](merchant-admin.md) — the store-owner product (current
   focus): design bar, scope and milestones.
   Its design spec is [`merchant-admin-design.md`](merchant-admin-design.md).

Then per topic as needed:

| Topic                                    | Doc                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Backend modules, data model, APIs        | [01-core](architecture/01-core.md)                                               |
| Kernel packages, hooks, primitives       | [02-kernel](architecture/02-kernel.md)                                           |
| Storefront requirements                  | [03-storefront-contract](architecture/03-storefront-contract.md)                 |
| Slot registry, overrides, tokens         | [04-extensions-and-overrides](architecture/04-extensions-and-overrides.md)       |
| Server-driven UI, loader (`v.js`)        | [05-system-surfaces](architecture/05-system-surfaces.md)                         |
| Monorepo layout, isolation               | [06-monorepo](architecture/06-monorepo.md)                                       |
| Artifacts, edge, hosting                 | [07-deployment-and-hosting](architecture/07-deployment-and-hosting.md)           |
| Fleet state, reconciler, ops API         | [08-control-plane](architecture/08-control-plane.md)                             |
| Majors, codemods, fleet trains           | [09-migrations-and-fleet-trains](architecture/09-migrations-and-fleet-trains.md) |
| Conformance + generation QA              | [10-qa-pipeline](architecture/10-qa-pipeline.md)                                 |
| Versioning and compat policy             | [11-backward-compatibility](architecture/11-backward-compatibility.md)           |
| Domains, DNS, TLS                        | [12-domains-and-tls](architecture/12-domains-and-tls.md)                         |
| Mercado Pago marketplace                 | [13-payments](architecture/13-payments.md)                                       |
| DesignSpec → agent → deploy              | [14-agent-pipeline](architecture/14-agent-pipeline.md)                           |
| Event taxonomy, funnels                  | [15-analytics](architecture/15-analytics.md)                                     |
| SLOs, incidents, kill switch             | [16-operations-and-incidents](architecture/16-operations-and-incidents.md)       |
| Templates, sections, blocks              | [17-page-composition](architecture/17-page-composition.md)                       |
| Menu import ("cole o link")              | [menu-import](menu-import.md), [phase 3](menu-import-phase3.md)                  |
| Kernel ownership gaps (investigation)    | [kernel-helper-gaps](kernel-helper-gaps.md)                                      |
| Competitor feature gaps (tracker)        | [competitor-parity](competitor-parity.md)                                        |
| Per-competitor profiles                  | [competitors/](competitors/README.md)                                            |
| Feature deep dives (iFood, WhatsApp bot) | [features/](features/README.md)                                                  |

## ADRs

Significant decisions are recorded as ADRs in [`adr/`](adr/). Current index:

| #                                                      | Decision                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [0001](adr/0001-monorepo-for-storefronts.md)           | One monorepo for all storefronts                            |
| [0002](adr/0002-single-storefront-framework-react.md)  | React as the single storefront framework                    |
| [0003](adr/0003-storefronts-as-artifacts.md)           | Storefronts are deployable artifacts, not services          |
| [0004](adr/0004-kernel-owned-checkout.md)              | Checkout and system surfaces are Kernel-owned               |
| [0005](adr/0005-server-driven-system-surfaces.md)      | System surfaces are server-driven                           |
| [0006](adr/0006-runtime-loader.md)                     | A tiny runtime loader (`v.js`) as the last-resort channel   |
| [0007](adr/0007-headless-primitives.md)                | Headless primitives are the commerce API                    |
| [0008](adr/0008-contract-versioning.md)                | Three-axis versioning; majors require codemods              |
| [0009](adr/0009-mercado-pago-marketplace.md)           | Mercado Pago Marketplace + OAuth + application fee          |
| [0010](adr/0010-automated-domains-tls.md)              | Automated domains and TLS                                   |
| [0011](adr/0011-ring-based-fleet-releases.md)          | Ring-based fleet releases with artifact promotion           |
| [0012](adr/0012-agent-agnostic-pipeline.md)            | Agent-agnostic generation pipeline, CI as judge             |
| [0013](adr/0013-modular-monolith-core.md)              | Core is a modular monolith on Postgres                      |
| [0014](adr/0014-crm-agent-v2.md)                       | CRM agent v2 (tools, policy, wakeups, memory)               |
| [0015](adr/0015-one-agent-config.md)                   | One agent, several jobs                                     |
| [0016](adr/0016-agent-dispatch-and-scheduler.md)       | One dispatcher, one agenda, one scheduler                   |
| [0017](adr/0017-due-time-scheduler.md)                 | Scheduler sleeps until due, wakes on change                 |
| [0018](adr/0018-page-composition.md)                   | Pages are composed from SDK and store sections              |
| [0019](adr/0019-customer-identity-without-accounts.md) | Customer identity without accounts (phone + order number)   |
| [0020](adr/0020-merchant-identity.md)                  | Merchant identity: phone OTP, tenant-scoped sessions, roles |
| [0021](adr/0021-self-serve-signup-and-plan-billing.md) | Self-serve signup and plan billing                          |
| [0022](adr/0022-control-plane-v0-and-edge.md)          | Control Plane v0 in Core, a Bun edge, pointer-flip releases |
| [0023](adr/0023-staff-events-on-discord.md)            | Staff events, delivered to Discord by an HTTP-only bot      |
| [0024](adr/0024-distance-based-delivery-pricing.md)    | Delivery priced by road distance from a confirmed pin       |
| [0025](adr/0025-free-trial-on-basic.md)                | A 14-day free trial on Venduá Basic, no card                |
| [0026](adr/0026-store-whatsapp-gateway.md)             | Each store's own WhatsApp, on a Baileys gateway             |
| [0027](adr/0027-print-agents.md)                       | Kitchen printing through a store-side print agent           |
| [0028](adr/0028-privacy-first-platform-analytics.md)   | Privacy-first analytics on every surface, read in the CRM   |

## Conventions

- Every doc header carries `Status` and `Last reviewed`. `Proposed` means no code
  exists; `Accepted` means decided and being implemented; `Implemented` means the
  code is the source of truth and the doc is descriptive.
- **Once a package exists, the package wins.** These docs describe intent; when
  implementation lands, schemas and catalogs move into the packages
  (`@vendua/kernel`, `@vendua/conformance`, …) and the docs link to them. Inline
  schemas here are design sketches, not source of truth.
- Terminology is normative. If a doc says "System Surface" it means exactly what
  the [glossary](glossary.md) says. Don't invent synonyms.
- Normative requirement levels use RFC 2119 words: MUST, SHOULD, MAY.
