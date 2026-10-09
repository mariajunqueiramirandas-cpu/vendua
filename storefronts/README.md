# storefronts/

Every storefront is a package at `storefronts/<slug>/` — a React application
fragment compiled by `@vendua/cli` into a static artifact. Contract 2: pages are
templates (`templates/*.json`, live in Core) composed from Kernel SDK sections and
the store's own `sections/`. Layout and rules:
[docs/architecture/03-storefront-contract.md](../docs/architecture/03-storefront-contract.md);
the Kernel surface: [packages/kernel/API.md](../packages/kernel/API.md).

`package.json` → `vendua.tenant` names the Core tenant a store builds for (the
fleet commands use it). In-repo stores: `_template` → `loja-modelo` (:5175),
`quero-pudim` (:5174).

Shipping: every deploy runs `vendua release publish --all` (the compose `publish` service).
Each storefront folder is a **bundle**; its build becomes an immutable release the edge serves
and the Control Plane promotes to the stores on that bundle — `_template` serves every store
without a bundle of its own, and a bundle whose `vendua.tenant` names a store becomes that
store's ([07](../docs/architecture/07-deployment-and-hosting.md),
[ADR 0022](../docs/adr/0022-control-plane-v0-and-edge.md)).

Reserved directories:

- `_template/` — `vendua scaffold` source and the platform's only reference storefront;
  always green (Phase 1).

Isolation is enforced, not conventional: a `storefront:<slug>` PR may only
touch `storefronts/<slug>/**`, plus the store's own workspace entry in `bun.lock`
that `bun install` writes (changed-path CI check, Phase 1).
