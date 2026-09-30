# packages/

Platform packages live here — one directory per package, consumed by
storefronts as private workspace dependencies (no publishing, no registry).

Set per [docs/architecture/06-monorepo.md](../docs/architecture/06-monorepo.md):

| Directory      | Package               | Contents                                                                                                                             |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `core/`        | `@vendua/core`        | Backend modular monolith (Hono + Postgres + RLS), incl. the Control Plane (`src/modules/fleet`, ADR 0022)                            |
| `kernel/`      | `@vendua/kernel`      | Storefront runtime (1.x, Contract 2): hooks, primitives, surfaces, composition, Kernel pages, build plugin — [API.md](kernel/API.md) |
| `cli/`         | `@vendua/cli`         | `scaffold`, `dev`, `check`, `build`, `qa`; fleet: `train`, `codemod`, `templates`, `ops`, `release`, `fleet`                         |
| `ui-defaults/` | `@vendua/ui-defaults` | Token-driven default surfaces and slots                                                                                              |
| `conformance/` | `@vendua/conformance` | Playwright suite + lint rules + type tests                                                                                           |
| `codemods/`    | `@vendua/codemods`    | Contract migration transforms                                                                                                        |
| `loader/`      | `@vendua/loader`      | `v.js` source, versioned separately                                                                                                  |
| `templates/`   | `@vendua/templates`   | Page-template model, migrations, tokens/WCAG, compat matrix (framework-free)                                                         |
| `edge/`        | `@vendua/edge`        | Host→release resolution, artifact serving, state injection; the artifact store and release manifest (zero deps)                      |

The Control Plane is a Core module rather than a package (ADR 0022), and the merchant admin
lives in `apps/admin`.
