# storefronts/_examples

Curated golden storefronts — the canonical read set for humans and agents
(docs/architecture/06). Maintained by the platform team.

- `quero-pudim/` — Phase-0 full port of the Quero Pudim Gourmet reference
  storefront onto the Kernel. Every page of the reference is here: catalog
  with modifier groups, 3-step checkout, order confirmation + my-orders,
  sold-out states, and its `OBSERVATIONS.md` documents where the contract
  had to grow. Snapshot of `storefronts/quero-pudim` — the live tenant keeps
  its own copy; this one tracks contract evolution (it builds for its own
  canary tenant, `example-quero-pudim`, :5176). Contract 2 port: 12 store
  sections/blocks around the SDK purchase panel and Kernel pages.
