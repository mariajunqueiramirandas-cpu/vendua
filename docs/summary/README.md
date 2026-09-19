# Venduá — Summary Docs

Condensed mirror of [`../architecture/`](../architecture/) and
[`../adr/`](../adr/) for quick human review. **The full docs are normative** —
these files compress, they don't replace. Coding agents must use the full set;
if a summary and a full doc disagree, the full doc wins.

## What Venduá is

Vertical SaaS for small food businesses. Every customer gets a storefront that
is real bespoke code (agent-generated), while catalog, cart, checkout, payments,
orders, delivery, auth, analytics and infra are shared in one Core. Commercial
goal: software-house perceived value at near-SaaS marginal cost.

## The one rule

Every platform capability is split across three owners:

| Axis                           | Owner      |
| ------------------------------ | ---------- |
| Existence & behavior           | Core       |
| Placement & default appearance | Kernel     |
| Appearance (optional)          | Storefront |

A feature that respects the split ships to 1000 storefronts touching zero
storefront repos. A feature that violates it becomes an N-storefront migration.

## Files

| File                                   | Covers                                                       | Full docs                        |
| -------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| [decisions.md](decisions.md)           | All 13 ADRs, one paragraph each                              | `adr/`                           |
| [platform.md](platform.md)             | Core, Kernel, Contract, slots, SDUI, loader                  | `architecture/01–05`             |
| [repo-and-fleet.md](repo-and-fleet.md) | Monorepo, artifacts, edge, Control Plane, trains, QA, compat | `architecture/06–11`             |
| [operations.md](operations.md)         | Domains/TLS, payments, analytics, incidents                  | `architecture/12–13, 15–16`      |
| [pipeline.md](pipeline.md)             | DesignSpec → agent → deploy                                  | `architecture/14`                |
| —                                      | Fleet-first roadmap                                          | [`../roadmap.md`](../roadmap.md) |
