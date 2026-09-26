# @vendua/kernel

The shared frontend runtime every storefront builds on (docs/architecture/02-kernel.md).
Kernel 1.x implements **Contract 2** — page composition from SDK and store sections
(ADR 0018, docs/architecture/17-page-composition.md).

- **Public surface:** [API.md](API.md) — frozen for v1; `test/api-surface.test.ts` guards it.
- **Defaults:** every slot's default lives in `@vendua/ui-defaults` (token-driven, `@layer vendua`).
- **Build:** `@vendua/kernel/vite` — template/token snapshot, WCAG AA gate, artifact manifest.
- **Versioning:** real semver. Minors/patches never need a storefront edit; the compat
  matrix lives in `@vendua/templates` (`COMPAT_MATRIX`) and CI checks every manifest.

```sh
bun run check   # typecheck
bun test        # DOM tests (happy-dom) + API freeze
```
