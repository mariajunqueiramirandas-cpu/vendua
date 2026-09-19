# packages/

Platform packages live here — one directory per package, consumed by
storefronts as private workspace dependencies (no publishing, no registry).

Planned set ([docs/architecture/06-monorepo.md](../docs/architecture/06-monorepo.md)):

| Directory        | Package               | Contents                                                          |
| ---------------- | --------------------- | ----------------------------------------------------------------- |
| `core/`          | `@vendua/core`        | Backend modular monolith (Hono + Postgres + RLS)                  |
| `kernel/`        | `@vendua/kernel`      | Storefront runtime: provider, hooks, primitives, `SystemSurfaces` |
| `cli/`           | `@vendua/cli`         | `scaffold`, `dev`, `check`, `build`, `qa` — the only build path   |
| `ui-defaults/`   | `@vendua/ui-defaults` | Token-driven default surfaces and slots                           |
| `conformance/`   | `@vendua/conformance` | Playwright suite + lint rules + type tests                        |
| `codemods/`      | `@vendua/codemods`    | Contract migration transforms                                     |
| `loader/`        | `@vendua/loader`      | `v.js` source, versioned separately                               |
| `control-plane/` | —                     | Fleet state, reconciler, fleet ops API                            |
| `admin/`         | —                     | Merchant admin app (not a Kernel consumer)                        |
| `edge/`          | —                     | Host→tenant resolution, artifact serving, state injection         |

`core/`, `kernel/`, and `cli/` exist today; the rest land in Phase 1+ per
[docs/roadmap.md](../docs/roadmap.md).
