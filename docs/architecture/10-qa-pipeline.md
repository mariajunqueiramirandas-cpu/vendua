# 10 — QA Pipeline

> Status: Proposed · Last reviewed: 2026-09-11

Two suites with different jobs:

- **Conformance** — deterministic, shared, runs on _every_ build of _every_
  storefront. Answers "does this store satisfy the Contract and keep the
  platform's invariants?" No AI involved.
- **Generation QA** — applied to agent-produced work. Answers "is this good?"
  Screenshots, visual triage, human approval where required.

The teaser site's existing suite (`site/tests/site.spec.ts` + `site/VALIDACAO.md`
style) is the prototype: viewports, axe, no-JS, byte budgets, link checks —
that shape generalizes directly into Conformance.

## Harness mechanics

- The Control Plane (or CI locally) seeds a **test tenant** with canonical
  fixtures: catalog with variants/modifiers/sold-out items, delivery zones,
  hours that produce open/closed/paused states, a sandbox payment connection.
- `vendua qa` builds the artifact and runs Playwright against the preview
  server serving _that artifact_ — we test what we ship.
- Every run produces a QA report artifact: `report.json`, screenshots per
  viewport, Playwright traces on failure. The report id goes into the release
  manifest (`qaRef`).

## Conformance Suite v1 — normative criteria

Format borrowed from this repo's `VALIDACAO.md`. IDs are stable; tests are
referenced by ID in failure bundles and codemod reports.

### Commerce flow (C-series)

| ID  | Requirement                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------- |
| C01 | Catalog browsable; every product card exposes `data-vendua="product-link"` and resolves                                 |
| C02 | `AddToCart` on a product with modifiers: required-group validation blocks, valid selection adds, cart totals match Core |
| C03 | Cart drawer/page: qty stepper mutates server cart; remove works; totals match Core                                      |
| C04 | Checkout entry: `CheckoutButton` starts a session; address → delivery → payment → review steps reachable                |
| C05 | Order placement reaches the sandbox payment step; success page renders `order.StatusPage` slot                          |
| C06 | Out-of-zone address: typed `OUT_OF_ZONE` surfaces as a notice; order cannot be placed                                   |
| C07 | Idempotent retry: double-submit of checkout produces exactly one order                                                  |

### System states (S-series)

| ID  | Requirement                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| S01 | `paused` fixture → blocking notice on first paint (from injected state), primitives disabled, checkout rejects `STORE_PAUSED` |
| S02 | `closed` fixture → `StoreClosedNotice` shows next opening; browsing still works                                               |
| S03 | Unknown `kind` fixture → generic `system.Notice` renders, no crash                                                            |
| S04 | Unknown `severity`/action `type` fixtures → degrade per spec, never crash                                                     |
| S05 | Override crash fixture → error boundary renders Kernel default, failure reported                                              |
| S06 | `v.js` present, health ping responds, blocking overlay renders with Kernel JS disabled                                        |
| S07 | `(vendua)/*` system routes all resolve and render Kernel defaults                                                             |

### Quality gates (Q-series)

| ID  | Requirement                                                                  |
| --- | ---------------------------------------------------------------------------- |
| Q01 | No layout overflow at 320, 360, 390, 768, 1280, 1440 px                      |
| Q02 | axe audit: zero serious+ violations on home, product, cart, checkout         |
| Q03 | `prefers-reduced-motion`: animations off, content complete                   |
| Q04 | No-JS: home/menu content legible; system surfaces show static fallback       |
| Q05 | Byte budgets per [03](03-storefront-contract.md#budgets)                     |
| Q06 | Internal links resolve; no dead routes; 404 renders `system.NotFound`        |
| Q07 | Contrast AA on token pairs used by default surfaces                          |
| Q08 | Hostile-CSS fixture (aggressive global reset) does not break Kernel defaults |
| Q09 | Focus order + visible focus on interactive elements; skip link works         |
| Q10 | Zoom 200% CSS: no loss of function                                           |

### Contract checks (K-series — lint/type, run pre-browser)

| ID  | Requirement                                                                                  |
| --- | -------------------------------------------------------------------------------------------- |
| K01 | `vendua.config.ts` type-checks; all override keys valid for declared Contract major          |
| K02 | Required mounts present (`VenduaProvider`, `SystemSurfaces`, system route group, `v.js` tag) |
| K03 | No direct fetch/API imports; no deep Kernel imports; deps within allow-list                  |
| K04 | All commerce triggers reachable via primitives (no parallel cart/checkout)                   |
| K05 | PR touches only `storefronts/<slug>/**`                                                      |

## Generation QA

Runs on agent PRs, on top of Conformance:

1. **Screenshot set**: 6 viewports × key routes (home, product, cart, checkout,
   order status, paused state) — stored on the release.
2. **Visual triage**: an LLM judge compares captures against the DesignSpec
   (palette, type, density, reference alignment) and flags diffs. **Triage
   signal only** — it orders human attention, it does not approve or reject.
3. **Human approval gate**: required at initial launch and for majors while the
   judge's agreement rate is unproven. Graduated automation: measure
   judge-vs-human agreement for a quarter before trusting auto-approval on
   minor iterations.
4. **Iteration loop**: agent receives failure bundle → fixes → re-runs. Hard
   cap on iterations (default 4); on cap, task escalates to human with the full
   history.

## Flake policy

- Conformance tests MUST be deterministic: fixed clock, seeded data, no live
  network beyond the harness. A test that flakes twice in a week is quarantined
  and fixed or deleted — flaky suites train everyone to ignore red builds.
- Visual-triage flakes are expected and harmless (it's triage, not a gate).

## What QA does NOT cover (by design)

- Merchant-visible copy quality, brand taste, motion feel — human review and
  the merchant's own approval at launch.
- Cross-browser matrix beyond Chromium for every build; a weekly Safari/
  Firefox spot-check runs on canary stores only.
