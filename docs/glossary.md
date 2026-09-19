# Glossary

> Status: Proposed · Last reviewed: 2026-09-11

Normative vocabulary for the platform. Code, docs, APIs and agent prompts MUST use
these terms with these meanings.

## Platform layers

**Core** — The shared multi-tenant backend. Owns all business logic: catalog,
cart, checkout, delivery, payments, orders, store status, identity, notifications,
analytics. Exposes versioned HTTP APIs. See
[architecture/01-core](architecture/01-core.md).

**Kernel** — The shared frontend runtime, distributed as workspace packages
(`@vendua/kernel`, `@vendua/ui-defaults`, …). Owns data fetching, server-side cart
client, headless primitives, system surface rendering, default UI, error
boundaries, analytics instrumentation. Contains no business rules.
See [architecture/02-kernel](architecture/02-kernel.md).

**Storefront** — A per-tenant frontend package living at `storefronts/<slug>/` in
the monorepo. Contains arbitrary React code for brand pages, design tokens, and
optional overrides. Compiles to an artifact; is never a running service.
See [architecture/03-storefront-contract](architecture/03-storefront-contract.md).

**Contract (Storefront Contract)** — The normative interface a storefront must
satisfy: framework, file layout, `vendua.config.ts`, required mounts, reserved
system routes, dependency and budget limits, primitive usage. Versioned by a
single integer (`contract: 1`, `2`, …).

## Frontend concepts

**Primitive (headless primitive)** — A Kernel component that owns commerce
_behavior_ (add to cart, quantity step, checkout entry) and renders no opinionated
markup: it accepts `asChild`/render delegation so the storefront controls all
visuals. Stamps test hooks, wires analytics, enforces disabled/closed/paused
states. See [architecture/02-kernel](architecture/02-kernel.md#primitives).

**Slot** — A named, typed extension point where a storefront may replace a Kernel
default component, e.g. `system.StorePausedNotice`, `checkout.Summary`.
Registered in `vendua.config.ts → overrides`.

**Override** — A storefront component bound to a slot. Presentational only:
typed props in, callbacks out, no data fetching. Always wrapped by a Kernel
error boundary that falls back to the default implementation on failure.
See [architecture/04-extensions-and-overrides](architecture/04-extensions-and-overrides.md).

**System surface** — UI whose _existence and behavior_ are decided by the Core and
whose _default look_ is provided by the Kernel: notices, checkout, order
tracking, legal pages, consent, error states. Rendered by `<SystemSurfaces />`
from server-driven payloads, so new capabilities reach old storefronts without
rebuilds. See [architecture/05-system-surfaces](architecture/05-system-surfaces.md).

**System routes** — Reserved routes under `/(vendua)/*` (checkout, order
tracking, legal, auth) that the Kernel renders inside every storefront.

**Design tokens** — Per-storefront values (colors, fonts, radius, spacing,
motion) declared in `vendua.config.ts` and emitted as CSS variables (`--v-*`).
Kernel defaults consume them so un-overridden surfaces still look on-brand.

**Loader (`v.js`)** — A tiny, Kernel-version-independent script served from
Venduá's CDN and included by every storefront. Renders critical overlays
(emergency notices, kill switch) in a Shadow DOM even if the Kernel is broken.
Not a second Kernel. See [architecture/05-system-surfaces](architecture/05-system-surfaces.md#the-loader-vjs).

## Deployment concepts

**Artifact** — The immutable build output of one storefront release: static
HTML/JS/CSS + `storefront.manifest.json`, stored in object storage under
`storefronts/<slug>/<release>/`. Deployment = pointing a hostname at an artifact.

**Release** — A Control Plane record binding `storefront + artifact + kernel
version + contract major + QA report`. Deployments promote releases, never
rebuild them.

**Edge** — The shared request-terminating layer: TLS, host → tenant resolution,
artifact serving, `<script id="vendua-state">` injection, asset CDN.
See [architecture/07-deployment-and-hosting](architecture/07-deployment-and-hosting.md).

**Provisioner** — The Control Plane module that turns an approved storefront
into a live site: hostname, cert, release promotion, analytics wiring, merchant
invite.

## Fleet operations

**Control Plane** — The service that knows the desired and actual state of every
tenant: storefront path, contract/kernel versions, releases, deployments,
domains, health, QA status, agent tasks. Reconciles drift; drives fleet trains.
See [architecture/08-control-plane](architecture/08-control-plane.md).

**Ring** — A named cohort of storefronts for staged releases: `canary`
(Venduá-owned demo stores), `early` (~10%), `stable` (everyone else).

**Fleet train** — The scheduled, automated rollout of a Kernel/Contract change
through the rings: build all affected artifacts once, promote ring by ring with
gates, roll back by re-promoting the previous release.
See [architecture/09-migrations-and-fleet-trains](architecture/09-migrations-and-fleet-trains.md).

**Codemod** — A deterministic source transform (ts-morph/jscodeshift) shipped
with every breaking Contract change. The supported unit of fleet migration.

**Conformance Suite** — The shared, deterministic Playwright suite every
storefront build must pass. Tests contract compliance, commerce flows, system
states, a11y, budgets. See [architecture/10-qa-pipeline](architecture/10-qa-pipeline.md).

**Generation QA** — The additional pipeline applied to agent-produced changes:
multi-viewport screenshots, LLM visual triage against the DesignSpec, human
approval where required.

## Intake / generation

**DesignSpec** — The structured JSON brief produced from a customer conversation
or human briefing; the input contract for any storefront-generation agent.
See [architecture/14-agent-pipeline](architecture/14-agent-pipeline.md).

**Failure bundle** — The packaged context the Control Plane hands to a coding
agent when automated migration/QA fails: logs, failing tests, screenshots,
traces, diff of the breaking change.

## Data model

**Tenant** — A merchant account. Owns catalog, orders, payment connection,
domains, storefronts.

**Notice** — A Core-emitted, server-driven message rendered on the `notices`
system surface (`kind`, `severity`, `title`, `body`, `actions`, `payload`).

**Application fee** — Venduá's per-transaction take, collected via Mercado Pago
`application_fee` on payments into the merchant's own account. Venduá never
custodies merchant funds.
