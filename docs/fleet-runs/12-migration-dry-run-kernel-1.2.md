# Migration dry run — `2026-09-loyalty-teaser-on-product` on Kernel 1.2

`vendua templates migrate 2026-09-loyalty-teaser-on-product`. This is a dry run:
nothing was written.

| Store               | Ring   | Page    | Outcome | Versions |
| ------------------- | ------ | ------- | ------- | -------- |
| example-quero-pudim | canary | product | applied | 1        |
| loja-modelo         | canary | product | applied | 1        |
| quero-pudim         | stable | product | applied | 1        |

The conformance fixture tenants (`qa-*`) have no recorded build, so they are
skipped: "store kernel version unknown". The block renders nothing until a store
turns its stamp card on, so the rollout is canary → stable with no visual change
until then.

Walkthrough on the example tenant at 390px after the train (Chromium). The order
page updated 41–43 ms after a staff transition, with no polling:
[kit picker](img/phase2-kit.png) · [encomenda checkout](img/phase2-checkout.png) ·
[order with Pix](img/phase2-order.png).
