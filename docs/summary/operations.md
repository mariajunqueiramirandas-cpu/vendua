# Operations — Domains/TLS, Payments, Analytics, Incidents

Condenses `architecture/12–13, 15–16`. Full docs are normative.

## Domains & TLS (`12`)

- **Default**: `slug.vendua.com.br` at provisioning; wildcard cert (DNS-01) —
  live in seconds, permanent fallback forever.
- **Custom domain**: `pending → instructions_sent → verified → active →
  failed/repairing`. CNAME/ALIAS → `edge.vendua.com.br`; verify via TXT
  `_vendua.<domain>` (preferred) or CNAME; cert on first request via Caddy
  on-demand TLS gated by `ask` endpoint (only verified domains get certs —
  prevents minting abuse).
- **Re-verification**: a verified domain that breaks → `repairing` + merchant
  notified with exact fix; `slug.vendua.com.br` keeps selling.
- **Issuer-agnostic**: Cloudflare for SaaS is the documented swap past ~100
  custom domains.
- **Venduá-registered domains**: merchant's CNPJ is titular, Venduá technical
  contact; churn transfers to the merchant. registro.br is a legal/ops
  problem, flagged honestly.
- **Failure UX**: wrong DNS → `failed`/`repairing` + exact record; cert
  failure → retry, never blocks subdomain; expired → renewal-required notice
  on subdomain only.

## Payments (`13`)

MP marketplace: shopper money → **merchant's own MP account**; Venduá's take =
`application_fee` per transaction. **Never custody funds.**

- PIX first; card via MP Bricks mounted inside Kernel-owned checkout — card
  data never touches storefront code or Venduá servers.
- OAuth connect in admin → tokens in vault (`payment_connections` stores
  refs); scheduled refresh before ~180-day expiry; failures alert merchant
  before breaking.
- **Degrade, never die**: `disconnected`/`restricted` → checkout falls back to
  "pedir pelo WhatsApp" (`payment: manual_whatsapp`); merchant gets a blocking
  notice, shopper flow continues.
- Webhooks are authoritative (redirects are hints); idempotent via
  `provider_payment_id` + outbox. Money math once, in Core. Refunds via admin
  → MP API → webhook → events. Per-tenant reconciliation report.
- `PaymentProvider` interface — second provider (Pagar.me, Stripe) is an
  adapter, not a rewrite.
- Compliance: Venduá is technology provider, not merchant of record;
  chargebacks land on the merchant; payment PII stays at MP.

## Analytics (`15`)

Uniform funnel for free — primitives emit the taxonomy automatically; a wild
GSAP store and a default store emit identical events.

- Flow: primitive → batched consent-gated beacon → `/storefront/v1/events` →
  `analytics_events` → rollups. Lossy by design — never blocks commerce.
  First-party rotating `session_id`; no third-party trackers ambient.
- Auto events: `page_view`, `product_view`, `add_to_cart`, `cart_open`,
  `checkout_start`, `checkout_step`, `payment_submit`, `order_placed`
  (server-side, authoritative), `order_failed`, `notice_shown`,
  `notice_action`, `notify_me`. Storefront customs via
  `useAnalytics().track('custom.<name>')` — `custom.` prefix reserved +
  lint-checked.
- Merchant dashboards: funnel, top products, peak hours, zone conversion,
  repeat rate — Core queries, no external BI.
- Platform metrics: train health (checkout rate per Kernel release — a ring
  gate input), notice efficacy, per-segment conversion, agent-quality proxy.
- LGPD: consent surface gates purposes; `track()` no-ops pre-consent; raw
  events 13 months, rollups indefinite; tenant-scoped erasure.

## Operations & incidents (`16`)

Centralization trades many small failures for fewer bigger shared ones —
blast-radius engineering replaces independence.

- **SLOs**: serving 99.9%, `/storefront/v1` 99.9%, `/checkout/v1` 99.95%
  (revenue path), notifications 99% in 5 min, Control Plane best-effort.
- **Blast radius**: edge → all stores (≥2 nodes, LKG cache, loader works);
  Core → all live data (multi-instance, static shells keep serving); Postgres
  → everything (HA/failover drills, PITR); artifact store → deploys only; MP →
  payments only (WhatsApp fallback); CP → ops pause; train → ring-bounded;
  artifact → one tenant.
- **Kill switch**: per-tenant `loader_state=maintenance` (+message, edge-cached
  — works with Core down); global `kind: emergency` notice to all tenants.
- **Probes**: per hostname every 60 s — catalog 200 + `vendua-state`, loader
  ping, checkout smoke (sandbox). Failures → incident → auto-rollback eval →
  on-call WhatsApp/email.
- **Capacity**: peaks are meals (11–14, 18–23, weekends); over-provision edge;
  Core sized for checkout writes; loader endpoint must survive everything.
- **Comms**: status page on separate infra; merchant incident notices go
  through the same notices pipeline; every page gets a runbook entry or an
  automation fix.
