# ADR 0026: Privacy-first analytics on every surface, read in the CRM

- Status: Accepted (implemented 2026-10-02, Core migration 0076)
- Date: 2026-10-02

## Context

Storefronts already send funnel events through the Kernel beacon into `analytics_events`
([15-analytics](../architecture/15-analytics.md)). Only the merchant could see them, in the
admin's reports. Venduá's own surfaces, the marketing site and the merchant admin, counted
nothing. The team had no single view of traffic, signups or store conversion in the CRM.

The site's privacy page promised no cookies, nothing stored in the browser and no third
party. Any analytics had to keep those promises.

## Decision

- **One first-party collector.** `POST /analytics/v1/collect` lives in Core
  (`modules/web-analytics.ts`). The `site` and `admin` nginx proxy that exact path to Core, so
  the beacon stays on the page's own origin: no CORS, no third-party host and no SDK.
- **No identifiers stored.** The client sends the path, the referrer's host (landing page only),
  `utm_*`, the viewport width and a random per-view `id` (dedupe, because `sendBeacon` can't
  send headers). It sends no cookie and uses no storage. Core stores no IP and no user agent.
  - A visitor is `sha256(day salt | property | IP | UA)` truncated to 16 hex.
  - The salt lives one Brazil calendar day in `web_analytics_salts`. The database picks the
    day, never the caller, and minting a day deletes every other salt.
  - So a hash dedupes within a day and can't be linked across days or reversed afterwards.
  - Ranges count visitor-days.
- **Less is sent.**
  - Automation (`navigator.webdriver`), Do Not Track and Global Privacy Control send nothing.
    Core also drops requests carrying `Sec-GPC`/`DNT` headers or a bot user agent.
  - Paths lose their query and hash. Segments that look like ids, phones or emails become
    `:id`, on the client and again in Core. `utm_*` values with 4+ digits are dropped.
- **RLS as a one-way door.**
  - `web_analytics_events` is a platform table. The app role may insert but never read it.
    That rules out `ON CONFLICT` and `RETURNING`, so a replayed beacon surfaces as the unique
    violation instead.
  - Only `vendua.control` reads it. The CRM also gets a select-only `control_read` policy on
    `analytics_events` to read the funnel across stores.
  - Order totals reach the CRM only through `store_order_days()`, a security-definer function
    that returns per-store, per-day counts and sums. It returns nothing outside
    `vendua.control`, so staff never get a row-level read of `orders`. Cancelled and refunded
    orders don't count, as in the merchant's own reports. The average ticket is computed in
    Core.
  - The salt table has no policies at all. It is reached only through the security-definer
    `web_analytics_salt()`.
- **Retention.** Raw page views are kept 13 months. Minting a day's salt prunes older ones.
- **The CRM view.** Pipeline → Analytics (`/pipeline/analytics`) has three views, each over
  7/30/90 days:
  - site and painel: visitors, views, pages, referrers, campaigns, devices.
  - lojas: sessions (`page_view`, as the merchant's reports count visits) → cart → checkout
    → ordered, plus orders, sales and average ticket from the orders themselves.

  The routes are `GET /control/v1/analytics/web` and `/control/v1/analytics/storefronts`.

## Consequences

- The site's `/privacidade/` page now says that visits are counted anonymously, and exactly
  how. Changing what the collector keeps means changing that page in the same PR.
- Counts undercount on purpose: a visitor using GPC or DNT, a bot, or a browser without JS
  is not counted.
- The CRM itself is not tracked. It is a staff tool with a handful of users.
- The rate limiter is in-memory per Core process, like the storefront one. The edge
  (Traefik) is the distributed limit.
