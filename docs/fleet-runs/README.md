# Fleet runs — Phase 1b evidence

Reports produced by the real commands, in order, against the dev Core and the
three in-repo storefronts (`storefronts/_template` → tenant `loja-modelo`,
`storefronts/quero-pudim`, `storefronts/_examples/quero-pudim` → tenant
`example-quero-pudim`). Rings: `loja-modelo` and `example-quero-pudim` are
Venduá-owned canaries, `quero-pudim` is stable. No run edited storefront source.

| #   | Run                                                                   | Command                                                      | Outcome                                                                                                              |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| —   | [Contract-major rehearsal](c3-rehearsal.md)                           | `vendua codemod rehearse c3-rehearsal`                       | 3/3 green, failure tail 0%; then applied with `vendua codemod run`                                                   |
| 01  | [Migration dry run on Kernel 1.0](01-migration-dry-run-kernel-1.0.md) | `vendua templates migrate 2026-09-delivery-eta-on-product`   | all skipped — stores on 1.0.0 don't satisfy `>=1.1.0`                                                                |
| 02  | [Train, Kernel 1.1.0](02-train-kernel-1.1.md)                         | `vendua train --core --record`                               | 3/3 built, checked, compat-valid, recorded; zero store diffs                                                         |
| 03  | [Migration dry run on Kernel 1.1](03-migration-dry-run-kernel-1.1.md) | `vendua templates migrate …`                                 | 3/3 would apply                                                                                                      |
| 04  | [Apply to canary](04-migration-apply-canary.md)                       | `… --apply --ring canary`                                    | applied — review found the block in `after-cta` ([screenshot](img/canary-1-wrong-area.png))                          |
| 05  | [Canary rollback](05-canary-rollback.md)                              | `vendua templates rollback … --ring canary`                  | restored v1 as v3; cause: jsonb reorders manifest keys                                                               |
| 06  | [Train, Kernel 1.1.1](06-train-kernel-1.1.1.md)                       | `vendua train --core --record`                               | manifests now carry area `order`                                                                                     |
| 07  | [Re-apply to canary](07-migration-apply-canary.md)                    | `… --apply --ring canary`                                    | right after the price ([loja-modelo](img/canary-2-loja-modelo.png), [example](img/canary-2-example-quero-pudim.png)) |
| 08  | [Apply to stable](08-migration-apply-stable.md)                       | `… --apply --ring stable`                                    | quero-pudim ([390px](img/stable-quero-pudim-390.png))                                                                |
| 09  | [Token edit → rebuild](09-token-edit-rebuild.md)                      | `PUT …/tokens` → `vendua train --pending`                    | `tokens:core`, store restyled ([screenshot](img/token-edit-loja-modelo.png))                                         |
| 10  | [Maintenance kill-switch drill](10-maintenance-drill.md)              | `drill-maintenance storefronts/_template loja-modelo`        | overlay over a live Kernel and on a broken build; off → back                                                         |
| 11  | [Train, Kernel 1.2.0](11-train-kernel-1.2.md)                         | `vendua train --core --record`                               | 3/3 on the Phase 2 Kernel; zero store diffs; conformance 29/29, stale reference 10/10                                |
| 12  | [Migration dry run on Kernel 1.2](12-migration-dry-run-kernel-1.2.md) | `vendua templates migrate 2026-09-loyalty-teaser-on-product` | 3/3 would apply ([kit](img/phase2-kit.png), [checkout](img/phase2-checkout.png), [order](img/phase2-order.png))      |

The stale reference (Kernel 1.0.0 artifact, `packages/conformance/stale/`) runs the
S-series in CI on every merge; S09 there is the "new notice kind reaches a store
that was never rebuilt" proof.
