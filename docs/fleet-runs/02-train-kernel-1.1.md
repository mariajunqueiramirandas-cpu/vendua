# Train dry-run — Kernel 1.1.0

3 storefronts rebuilt in one run (templates/tokens pulled from Core).

| Storefront                          | Tenant              | Kernel | Contract | Snapshot                   | Build | Compat | vendua check | Recorded              |
| ----------------------------------- | ------------------- | ------ | -------- | -------------------------- | ----- | ------ | ------------ | --------------------- |
| `storefronts/_template`             | loja-modelo         | 1.1.0  | 2        | templates:core tokens:repo | pass  | pass   | pass         | → loja-modelo         |
| `storefronts/quero-pudim`           | quero-pudim         | 1.1.0  | 2        | templates:core tokens:repo | pass  | pass   | pass         | → quero-pudim         |
| `storefronts/_examples/quero-pudim` | example-quero-pudim | 1.1.0  | 2        | templates:core tokens:repo | pass  | pass   | pass         | → example-quero-pudim |

Storefront source diff after the train: **none**.

Result: **green**.
