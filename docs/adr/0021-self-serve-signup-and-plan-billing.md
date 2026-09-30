# ADR 0021: Self-serve signup and plan billing

- Status: Accepted (implemented 2026-09-30, Core migration 0054, Phase 3)
- Date: 2026-09-30

## Context

Phase 3's promise is "a visitor goes from plan selection to a paid Venduá subscription and a
provisioned store with zero staff involvement". Until now a store was born only from the seed
(`platform/seed.ts`) or `vendua scaffold`, `tenants.plan` was a label nothing read, and the
site's only call to action was "Em breve".

The user decided the commercial terms (2026-09-30):

- **Venduá Basic — R$ 39,90/mês**: the store at `<slug>.vendua.com.br` with the standard look;
  no own domain, no custom site.
- **Venduá PRO+ — R$ 99/mês**: own domain + a site made by our AI agent.
- **No per-order fee** from Venduá on either plan (Mercado Pago keeps its own fee).
- Merchants pay by **card** (recurring) or a **monthly Pix**, their choice. No SMS.

## Decision

**Plans are data.** `plans` (platform table, readable by all, written under `vendua.control`)
holds id, name, price in cents, `fee_bps` (Venduá's cut of store orders, 0 today) and features
(`customDomain`, `customSite`). Staff edit them in the CRM; a price change applies to future
charges. `tenants.plan` points at a plan id; older ids (`spike`, `starter`…) read as "Plano
piloto" with no price.

**Plans are billed on Venduá's own Mercado Pago account**, beside the marketplace flows of
[ADR 0009](0009-mercado-pago-marketplace.md) that never touch store money:

- card → an MP assinatura (preapproval) the owner authorizes on MP; its monthly charges arrive
  as `subscription_authorized_payment` webhooks and become `invoices` rows;
- Pix → Core issues one `invoices` row per month with an MP Pix charge; the owner pays the QR in
  Conta; reminders go by WhatsApp (and email) three days before, on the due date and after.

`subscriptions` has one row per store (`pending → active → past_due`, `cancelled` at the end of
the paid period when the owner cancels). Upgrades apply at once; downgrades wait for the period
end (`pending_plan_id`). An unpaid period moves the store to `past_due` and the admin says so,
but **the store stays open** — suspension is a staff decision, not a job.

**Signup lives in the merchant admin** (`/admin/comecar`, pre-auth routes under
`/admin/v1/signup`), not on the marketing site: it needs the admin host's cookie and Core's
same-origin rule, and the site stays static with no forms. The site links to it.

1. Plan → store name and address (slug check; platform names like `painel`, `admin`, `api`
   are reserved) → owner name and email → WhatsApp code (the login OTP table with
   `purpose = 'signup'`, which sends to phones that aren't members yet) → payment method.
2. `POST /signup` calls `provision_store()`, a security-definer function (the app role can't
   insert tenants or domains under RLS): tenant, primary `<slug>.<store domain>` host,
   settings, the owner, storefront ops. The store renders at once from the `_template`
   bundle the `stores` container serves for stores without their own.
3. The store is paused behind `store_settings.billing_hold` until the first payment lands;
   then the hold and the provisioning pause lift and the owner lands in `/bem-vindo`.

Signup is idempotent by natural keys (the verified phone + slug return the same store; no
second store or charge), capped at three stores per phone per day, and closed
(`BILLING_UNAVAILABLE`) when the install has no platform MP token.

**PRO+ features are workflows, not automation we don't have yet.** A custom domain is verified
by Core (CNAME to the store's host + a TXT token) and activated by staff after they turn TLS on
in Dokploy (`activate_custom_domain()`), because Traefik issues certificates only for hosts it
has a route for. The site request opens a `site_requests` row and tells staff; the generation
pipeline (Phase 6) will take these over.

## Consequences

- The first-store stage gate's "provisioned with zero manual steps" is met for the default
  host; custom domains still need one staff step (TLS) until Phase 7's domain automation.
- `invoices` and `payments` are separate: one is what Venduá charges a store, the other what a
  store's shoppers paid it. Reconciliation of each reads only its own table.
- Plan and price copy has one source (`plans`); the admin and signup read prices from the API,
  and the site's copy matches the decision above.
