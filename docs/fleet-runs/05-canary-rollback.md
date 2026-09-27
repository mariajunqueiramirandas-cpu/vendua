# Canary rollback — `2026-09-delivery-eta-on-product`

Canary review (screenshots) showed the block in `after-cta`: Core returns build
manifests from jsonb, which reorders object keys, so `findArea` walked areas in the
wrong order. Rolled back by ring (each store gets a new version restoring v1), fixed
in Kernel 1.1.1 (manifests carry area `order`), retrained, re-applied (06–08).

| Store               | Ring   | Page    | Outcome | Versions | Note              |
| ------------------- | ------ | ------- | ------- | -------- | ----------------- |
| example-quero-pudim | canary | product | applied | 2 → 3    | rolled back to v1 |
| loja-modelo         | canary | product | applied | 2 → 3    | rolled back to v1 |
