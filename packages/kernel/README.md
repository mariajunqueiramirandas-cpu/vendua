# @vendua/kernel

Shared frontend runtime every storefront builds on (docs/architecture/02-kernel.md).
Phase 0 rough cut — provider, hooks, primitives, `<SystemSurfaces />` with the
generic notice renderer only.

## Mount contract (per 03)

```tsx
import '@vendua/kernel/src/styles.css';

<VenduaProvider config={config}>
  <SystemSurfaces />
  <App />
</VenduaProvider>;
```

## What's here

- `defineStorefront` + `StorefrontConfig` (contract: 1), `SLOT_KEYS` registry.
- `VenduaProvider` — api client, in-memory+sessionStorage checkout session,
  token → `--v-*` CSS vars on `:root`, query cache.
- Hooks: `useStore`, `useCatalog`, `useProduct`, `useNotices`, `useCart`,
  `useCheckout`.
- Primitives (headless, `data-vendua` hooks + ARIA, `asChild`): `AddToCart`,
  `QuantityStepper`, `CartTrigger`, `StoreStatusBadge`.
- `SystemSurfaces` + `SurfaceRegion` — forward-compat rules implemented:
  unknown `kind` → generic `system.Notice`, unknown severity → info,
  unknown action → link-if-href else omitted; overrides via slot registry
  inside an error boundary.
- `src/styles.css` — `@layer vendua`, `v-` classes, all values from `--v-*`.

## Deliberate Phase 0 gaps (recorded for Contract v1)

- Data hooks use a minimal internal cache, not TanStack — swap underneath the
  same hook signatures.
- `useCheckout().submit` exists but no step state machine, no Bricks mount.
- Consent surface (LGPD) and `system.EmergencyOverlay` are loader-only today.
- `Img` primitive, analytics beacon, SurfaceRegion context filtering are stubs.
- No package `exports` map enforcement yet (source imports); cli will pin it.
