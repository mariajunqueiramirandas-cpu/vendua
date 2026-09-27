# Train dry-run — Kernel 1.2.0

The three in-repo storefronts rebuilt on Kernel 1.2.0 (commerce completeness,
roadmap Phase 2) in one run. Templates and tokens came from Core.

| Storefront                          | Tenant              | Kernel | Contract | Snapshot                   | Build | Compat | vendua check | Recorded              |
| ----------------------------------- | ------------------- | ------ | -------- | -------------------------- | ----- | ------ | ------------ | --------------------- |
| `storefronts/_template`             | loja-modelo         | 1.2.0  | 2        | templates:core tokens:repo | pass  | pass   | pass         | → loja-modelo         |
| `storefronts/quero-pudim`           | quero-pudim         | 1.2.0  | 2        | templates:core tokens:repo | pass  | pass   | pass         | → quero-pudim         |
| `storefronts/_examples/quero-pudim` | example-quero-pudim | 1.2.0  | 2        | templates:core tokens:repo | pass  | pass   | pass         | → example-quero-pudim |

Storefront source diff after the train: **none**. Each store picked up the kit
picker, gallery, coupon field, encomenda calendar, Pix copia e cola and QR, live
order status, "pedir de novo" and cross-device "meus pedidos" through Kernel
pages and SDK sections alone.

The same session ran the full conformance suite on a freshly scaffolded store
(29/29) and the Kernel 1.0.0 stale reference's S-series against this Core (10/10).

Result: **green**.
