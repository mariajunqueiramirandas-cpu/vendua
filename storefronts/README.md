# storefronts/

Every storefront is a package at `storefronts/<slug>/` — a React application
fragment compiled by `@vendua/cli` into a static artifact. Layout and rules:
[docs/architecture/03-storefront-contract.md](../docs/architecture/03-storefront-contract.md).

Reserved directories:

- `_template/` — `vendua scaffold` source; always green (Phase 1).
- `_examples/` — curated golden storefronts; the only sibling read set for
  agents (seeded from the strongest Phase 0 spike storefronts).

Isolation is enforced, not conventional: a `storefront:<slug>` PR may only
touch `storefronts/<slug>/**` (changed-path CI check, Phase 1).
