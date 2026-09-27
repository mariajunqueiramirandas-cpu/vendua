# storefronts/

Every storefront is a package at `storefronts/<slug>/` — a React application
fragment compiled by `@vendua/cli` into a static artifact. Contract 2: pages are
templates (`templates/*.json`, live in Core) composed from Kernel SDK sections and
the store's own `sections/`. Layout and rules:
[docs/architecture/03-storefront-contract.md](../docs/architecture/03-storefront-contract.md);
the Kernel surface: [packages/kernel/API.md](../packages/kernel/API.md).

`package.json` → `vendua.tenant` names the Core tenant a store builds for (the
fleet commands use it). In-repo stores: `_template` → `loja-modelo` (:5175),
`quero-pudim` (:5174), `_examples/quero-pudim` → `example-quero-pudim` (:5176).

Reserved directories:

- `_template/` — `vendua scaffold` source; always green (Phase 1).
- `_examples/` — curated golden storefronts; the only sibling read set for
  agents (seeded from the strongest Phase 0 spike storefronts).

Isolation is enforced, not conventional: a `storefront:<slug>` PR may only
touch `storefronts/<slug>/**` (changed-path CI check, Phase 1).
