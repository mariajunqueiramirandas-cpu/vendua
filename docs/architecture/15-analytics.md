# 15 — Analytics

> Status: Proposed · Last reviewed: 2026-09-11

Because all commerce behavior flows through Kernel primitives, Venduá gets a
**uniform funnel across every storefront for free** — the strongest structural
argument for primitives ([ADR 0007](../adr/0007-headless-primitives.md)).
A wildly custom GSAP storefront and a default one emit identical funnel events.

## Event flow

```
primitive/surface → kernel beacon (batched, consent-gated)
  → POST /storefront/v1/events → core analytics module
  → analytics_events (tenant_id, name, at, session_id, props)
  → rollups → merchant dashboards / platform metrics
```

- Batched `sendBeacon`/keepalive fetch; lossy under failure by design —
  analytics never blocks commerce.
- `session_id` is a short-lived, rotating, first-party identifier — no cookies
  required for funnel math; LGPD consent governs anything beyond it.
- No third-party trackers in the Kernel by default. If a merchant wants Meta
  Pixel etc., it's an explicit per-tenant integration (and a consent purpose),
  never ambient.

## Event taxonomy v1 (normative)

Auto-emitted — storefronts get these without writing a line:

| Event | Emitted by | Key props |
| --- | --- | --- |
| `page_view` | router integration | path, referrer |
| `product_view` | `ProductLink` target resolve | product_id |
| `add_to_cart` | `AddToCart` | product_id, qty, modifiers, value |
| `cart_open` | `CartTrigger` | item_count, cart_value |
| `checkout_start` | `CheckoutButton` | cart_value |
| `checkout_step` | checkout surface | step name, duration |
| `payment_submit` | checkout surface | method |
| `order_placed` | Core (server-side, authoritative) | order_id, value, method |
| `order_failed` | Core/checkout | code |
| `notice_shown` / `notice_action` | `SystemSurfaces` | kind, severity, action |
| `notify_me` | `NotifyMeButton` | subject (store/product) |

Custom events: `useAnalytics().track('custom.<name>', props)` — the `custom.`
prefix is reserved for storefronts and lint-checked; platform names can't be
emitted by storefront code (prevents funnel pollution).

## Merchant-facing analytics

Per-tenant dashboards (admin): funnel (view → cart → checkout → paid), top
products, peak hours, delivery-zone conversion, repeat-customer rate. These
are Core queries over `analytics_events` + `orders` — no external BI tool in
the critical path.

## Platform-facing analytics

Cross-tenant (aggregated, no PII): train health (checkout success rate per
Kernel release — a release gate input), notice efficacy (paused-notice →
notify-me conversion), per-segment conversion, agent-quality proxy
(post-launch defect/funnel regression per generated storefront).

## LGPD notes

- Consent is a system surface (`system.ConsentBanner`); analytics purposes are
  declared there; `track()` no-ops pre-consent for non-essential purposes.
- Order-linked events carry `customer_id` only after order placement (the
  customer consented via the transaction); browsing events are session-scoped
  only.
- Retention: raw events 13 months, rollups indefinite. Deletion requests are
  tenant-scoped erasure jobs in Core.
