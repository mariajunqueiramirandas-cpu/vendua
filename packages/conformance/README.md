# @vendua/conformance

Contract conformance checks for storefronts — `docs/architecture/10-qa-pipeline.md` C/S/Q/K IDs, modeled on `site/tests/site.spec.ts`.

```sh
vendua-conformance static <storefrontDir>   # K01–K04 (no browser)
vendua-conformance k05 <slug> [baseRef]     # git diff ⊆ storefronts/<slug>/**
vendua-conformance e2e <storefrontDir>      # build + preview + Playwright C/S/Q
```

Every command prints one line per check ID and exits non-zero on any failure.

## e2e mechanics

1. `bun run build` inside the storefront — we test the shipped artifact.
2. Seeds QA tenants `qa-open`, `qa-paused`, `qa-closed`, `qa-edge` into Postgres
   (`DATABASE_URL`, default `postgres://vendua:vendua@localhost:5433/vendua`).
   Idempotent: mutable state (orders, carts, idempotency keys) is wiped and
   domains/settings/zones/catalog rewritten each run.
   - `qa-closed` gets a window computed at seed time — `[now−120m, now−30m]` in
     the settings timezone — so it is always closed, never at a fixed minute.
3. Serves `dist/` on `:5199` (`VENDUA_PREVIEW_PORT`) through a small in-package
   preview server: static files + SPA fallback, and `/storefront/v1`,
   `/checkout/v1`, `/v1` proxied to `VENDUA_CORE_ORIGIN` (default
   `http://localhost:8787`) with the incoming Host header forwarded untouched —
   mirroring the production edge.
4. Browser tenant resolution: Chromium launches with
   `--host-resolver-rules=MAP *.localhost 127.0.0.1`, so
   `http://qa-open.localhost:5199/` reaches the preview with the right Host.
   Verified in-session before the suite was built on it. Node-side API reads
   use the same `*.localhost` hosts via NSS (`systemd-resolved` maps them to
   loopback); the preview binds `::` dual-stack to serve both.
5. Hostile fixture: for `qa-edge.localhost` only, `GET /storefront/v1/surfaces`
   is answered locally with an envelope of unknown kinds/severities/action
   types — S03/S04 verify degradation instead of crashes. Everything else on
   qa-edge proxies normally.

## Report

`<storefrontDir>/qa-report/`:

- `report.json` — per-ID `pass`/`fail`/`skip` + detail + summary
- `screenshots/` — home/catalog/state pages at 390 and 1440 px
- `traces/` — Playwright traces, retained only on failure

## Honest gaps (skipped with reason, not faked)

- **S05** — needs a fixture storefront whose slot override throws at render;
  none exists under `storefronts/` and this package may not create one.
- **S07** — the Phase-0 kernel mounts no `(vendua)/*` system route group.
- **C04/C05/C06** — checkout steps are driven through documented conventions
  (name/phone inputs, `Continuar` buttons, delivery/payment radios). A
  storefront that deviates fails the check honestly rather than passing a
  weaker one.
- **S01** — the harness has no edge-injected state; "blocking notice on first
  paint" is asserted as "overlay renders shortly after load".
- `data-vendua="product-link"` is driven from markup when present; where the
  hook is absent the suite falls back to slug-matching anchors so downstream
  C-checks still exercise the flow while C01 reports the missing hook.

## Observed platform behavior (surfaced, not fixed)

- The preview server prints a per-path request/status table after each run.
  On `storefronts/quero-pudim` it shows a self-sustaining delivery-sync loop:
  `useCart.mutations.setDelivery` resolves → `invalidateQuery('cart')` evicts
  the entry → the checkout page's `items.length` dep flickers 1→0→1 → the
  sync effect re-fires → another `POST /checkout/v1/cart/delivery`. One run
  logged 223 delivery POSTs + 238 cart GETs against `qa-open` — enough to
  trip the per-tenant rate limiter and destabilize C04–C07 (disabled submit,
  mid-test page churn). Root cause sits in `packages/kernel`
  (evict-on-invalidate) × `storefronts/quero-pudim/routes/checkout.tsx`
  (`items.length` effect dep) — both outside this package's ownership, so the
  failures are reported as signal, not patched over.
