# 05 — System Surfaces and Server-Driven UI

> Status: Proposed · Last reviewed: 2026-09-11
> Decisions: [ADR 0005](../adr/0005-server-driven-system-surfaces.md), [ADR 0006](../adr/0006-runtime-loader.md)

System surfaces are the mechanism that lets a feature **exist everywhere**
without touching storefront code — rungs 2–3 of the shipping ladder in
[00](00-overview.md#how-a-global-feature-ships-the-ladder). They are
server-driven: the Core decides _that_ a surface appears and what it says; the
Kernel decides _where_ it mounts and _how it looks by default_; the storefront
may restyle it via slots.

**Scope discipline — read this first.** Server-driven UI applies **only** to
system surfaces: notices, blocking states, checkout structure, order timeline,
consent, legal, emergency overlays. Brand pages are never SDUI — they are real
code. This is deliberately _not_ a page builder; the moment a brand surface is
expressible as JSON it stops being bespoke, which is the product.

## Delivery channels

A system surface reaches a storefront through one of three channels:

| Channel             | Delivered by                                     | Reaches                         | Use                                           |
| ------------------- | ------------------------------------------------ | ------------------------------- | --------------------------------------------- |
| **State injection** | Edge injects `window.__VENDUA_STATE__` into HTML | Every request, first paint      | Store status, blocking notices — zero-flicker |
| **Kernel fetch**    | `useNotices()`/surface queries to Core           | Runtime updates                 | Non-blocking notices, timeline updates        |
| **Loader**          | `v.js` polls a tiny Core endpoint                | Always, even with broken Kernel | Emergency notices, kill switch                |

## The notices envelope — schema v1

`GET /storefront/v1/surfaces?context=<surface-context>` returns:

```ts
interface SurfacesEnvelope {
  version: 1;
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string };
  notices: Notice[];
  checkout?: CheckoutSurface; // steps/config the checkout surface needs
  timeline?: TimelineSurface; // for order tracking contexts
}

interface Notice {
  id: string;
  kind: string; // registry below; OPEN — server may add kinds
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  body?: string; // plain text / markdown-lite
  actions?: NoticeAction[]; // max 2
  payload?: Record<string, unknown>; // kind-specific data for specialized slots
  dismissible: boolean;
  priority: number;
  startsAt?: string;
  endsAt?: string;
}

type NoticeAction =
  | { type: 'link'; label: string; href: string }
  | { type: 'notify'; label: string; channel: 'whatsapp' | 'push' }
  | { type: 'dismiss'; label: string }
  | { type: string; label: string; [k: string]: unknown }; // forward-compat
```

### Forward-compatibility rules (normative)

These rules are why a Kernel shipped in January correctly renders a feature
invented in August:

1. **Unknown `kind` MUST render via the generic `system.Notice` slot** using
   `title`/`body`/`severity`/`actions`. Specialized slots only enhance.
2. **Unknown `severity` MUST degrade** `warning→info`, anything→`info`.
   `blocking` always produces a modal/overlay covering commerce actions.
3. **Unknown action `type` MUST render as a `link`** if it carries an `href`,
   else be omitted.
4. **`payload` is always optional** — consumers ignore keys they don't know.
5. **Absent surfaces render nothing** — absence is valid, not an error.
6. New `kind`s MUST be authored so the generic rendering is _acceptable_ — the
   generic path is not an edge case, it is the primary path on stale Kernels.
   Conformance includes a "future kind" fixture test.

### Kind registry (v1)

| kind               | severity | Generic render                          | Specialized slot                       |
| ------------------ | -------- | --------------------------------------- | -------------------------------------- |
| `store_paused`     | blocking | modal: title/body + resume time in body | `system.StorePausedNotice`             |
| `store_closed`     | warning  | banner                                  | `system.StoreClosedNotice`             |
| `out_of_zone`      | warning  | banner                                  | —                                      |
| `promo`            | info     | banner                                  | `system.Notice` theming                |
| `service_incident` | warning  | banner                                  | —                                      |
| `emergency`        | blocking | overlay                                 | `system.EmergencyOverlay` (loader too) |
| `consent_required` | info     | banner                                  | `system.ConsentBanner`                 |

## Placement points

`<SystemSurfaces />` owns fixed mount points, in z-order:

1. `banner-stack` — non-blocking notices, top of viewport, token-styled.
2. `blocking-overlay` — `severity: blocking` notices; covers the page, disables
   commerce primitives (primitives consult store status themselves).
3. `consent` — LGPD consent, lowest z, once per consent version.
4. `emergency` — owned by the loader; Kernel defers to it.

Brand pages may additionally mount `<SurfaceRegion name="catalog.notices" />`
to inline context-appropriate notices inside their own layout — same envelope,
region-filtered.

## Walkthrough: `store_paused` end-to-end

1. Merchant pauses the store (or `hours` trigger it). Core sets
   `store.status='paused'`, `resumesAt`, and `composeNotices` emits
   `kind:'store_paused'` with a human-readable body including the resume time.
2. Edge injects it into `__VENDUA_STATE__` → every storefront's first paint
   already shows the blocking overlay (Kernel 1.0, generic render, store
   tokens). `AddToCart`/`CheckoutButton` primitives read status → disabled.
   Checkout API rejects submissions with `STORE_PAUSED` anyway (server truth).
3. Fleet train later ships Kernel 2.4 with a polished specialized slot; stores
   get it on rebuild with zero edits. A store may register an override for
   `system.StorePausedNotice`; if it breaks, error boundary → default.
4. If the storefront JS is entirely broken (bad deploy), `v.js` still renders
   the blocking overlay — the store can't silently take orders.

## The loader (`v.js`)

A ~5 KB, dependency-free script served from `cdn.vendua.com.br/v1/v.js`,
included via a `<script defer>` tag that the scaffold injects and the Contract
requires.

- **Version-independent**: it does not import the Kernel; it is built and
  released separately on its own slow cadence. It renders inside Shadow DOM so
  no storefront CSS can break it.
- **Capabilities (exhaustive)**: fetch `/storefront/v1/state` on load + interval
  - `visibilitychange`; render `severity: blocking` and `kind: emergency`
    notices as a minimal overlay (title, body, first action); expose
    `window.__VENDUA_LOADER__` health ping for synthetic monitoring.
- **Kill switch**: Control Plane can set a tenant's `loader_state` to
  `maintenance` with a message (e.g. "instabilidade — peça pelo WhatsApp:
  +55…"), rendering even if Core storefront APIs are degraded (the loader's
  endpoint is served by the edge from a cached Control Plane snapshot).
- **Explicit non-goals**: no styling beyond a neutral overlay, no interactivity
  beyond notice actions, no commerce. The day `v.js` grows a feature, the
  architecture lost its escape hatch — resist this.

## Testing rules

- Conformance ships fixture envelopes: known kinds, unknown kinds, unknown
  severities, unknown action types, malformed payloads. Every storefront build
  renders them in a harness route; snapshots verify generic fallbacks and that
  `blocking` covers the viewport.
- A new server `kind` cannot ship without: generic-render copy review +
  conformance fixture + (optionally) a specialized slot queued for the next
  Kernel minor.
