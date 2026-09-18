# packages/

Platform packages live here — one directory per package, consumed by
storefronts as private workspace dependencies (no publishing, no registry).

Planned set ([docs/architecture/06-monorepo.md](../docs/architecture/06-monorepo.md)):

| Directory | Package | Contents |
| --- | --- | --- |
| `core/` | — | Backend modular monolith (Hono/Fastify + Postgres + RLS) |
| `kernel/` | `@vendua/kernel` | Storefront runtime: provider, hooks, primitives, `SystemSurfaces` |
| `ui-defaults/` | `@vendua/ui-defaults` | Token-driven default surfaces and slots |
| `cli/` | `@vendua/cli` | `scaffold`, `dev`, `check`, `build`, `qa` — the only build path |
| `conformance/` | `@vendua/conformance` | Playwright suite + lint rules + type tests |
| `codemods/` | `@vendua/codemods` | Contract migration transforms |
| `loader/` | `@vendua/loader` | `v.js` source, versioned separately |
| `control-plane/` | — | Fleet state, reconciler, fleet ops API |
| `admin/` | — | Merchant admin app (not a Kernel consumer) |
| `edge/` | — | Host→tenant resolution, artifact serving, state injection |

None of these exist yet — they land in Phase 0+ per
[docs/roadmap.md](../docs/roadmap.md).
