# 13 — Payments

> Status: Proposed · Last reviewed: 2026-09-11
> Decision: [ADR 0009](../adr/0009-mercado-pago-marketplace.md)

Consumer payments go **directly into each merchant's own Mercado Pago account**
via MP's marketplace model: OAuth-connected sellers, Venduá's `application_fee`
on each transaction. Venduá never custodies merchant funds — no escrow, no
repasse, no CNPJ-of-record complexity on the money itself.

## Model

```
shopper → Kernel-owned checkout → Core /checkout/v1 →
  Mercado Pago payment/order on the merchant's OAuth token
  (+ application_fee = Venduá's take) →
  MP webhook → Core → order state machine → notifications
```

- **PIX first** (BR reality), then card via MP Bricks/SDK mounted _inside the
  Kernel-owned checkout_ — card data touches MP's fields, never storefront code
  or Venduá servers. This is why checkout can't be custom storefront code
  ([ADR 0004](../adr/0004-kernel-owned-checkout.md)).
- `application_fee` is set per-transaction in cents by Core from the tenant's
  plan. Venduá's margin is a platform parameter, not a per-store code path.

## Merchant connection (OAuth)

1. Merchant clicks "Conectar Mercado Pago" in admin → MP OAuth consent →
   redirect back to `/admin/v1/payments/mercadopago/callback`.
2. Core stores `access_token`/`refresh_token` encrypted (vault ref in
   `payment_connections`), records `mp_user_id`, scopes, expiry (~180-day
   refresh cycle).
3. A scheduled Core job refreshes tokens before expiry; failures transition
   `payment_connections.status → expiring → disconnected` with alerts to
   merchant (WhatsApp + admin notice) **before** it breaks.

## Connection health → storefront behavior

`payments.connectionStatus` is part of tenant state and flows through the
notices pipeline like everything else:

| Status                           | Storefront behavior                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connected`                      | normal                                                                                                                                                                                |
| `expiring`                       | merchant-facing admin notice only; shopper flow unchanged                                                                                                                             |
| `disconnected`                   | checkout degrades to **"pedir pelo WhatsApp"** (order captured as `payment: manual_whatsapp`) — the store never hard-fails; blocking notice explains to the merchant, not the shopper |
| `restricted` (MP-side KYC holds) | same degradation path, different merchant message                                                                                                                                     |

This is the "degrade, never die" pattern applied to payments: an auth problem
costs the merchant a payment method, not the store.

## Order and payment consistency

- Webhooks are the authoritative payment state (redirects/callbacks are hints,
  never truth). Handled idempotently: `provider_payment_id` unique, outbox
  processed once.
- Checkout sessions carry `Idempotency-Key`; a double-submit is one order.
- Money math happens exactly once, in Core: `totals = items + delivery_fee −
discounts`; MP receives the computed amount; `application_fee` is recorded on
  the payment row for reconciliation.
- Refunds: merchant-initiated in admin → MP refund API → webhook →
  `order_events` + customer notification. Partial refunds supported.
- Reconciliation report per tenant: orders vs MP settlements vs fees — built
  from `payments` + webhooks, not scraped statements.

## Provider interface

Only MP is implemented, behind an interface so future providers (Pagar.me,
Stripe) are adapters, not rewrites:

```ts
interface PaymentProvider {
  connectUrl(tenant, redirect): string;
  handleOAuthCallback(code, tenant): Promise<Connection>;
  refreshIfNeeded(conn): Promise<Connection>;
  createCheckout(order, conn, opts): Promise<CheckoutIntent>; // preference/PIX/order
  parseWebhook(headers, body): WebhookEvent; // verified, typed
  refund(payment, amount?): Promise<RefundResult>;
}
```

`CheckoutIntent` normalizes PIX QR payload / Bricks preference / redirect so
checkout UI is provider-agnostic.

## Compliance notes

- Venduá is a **marketplace/technology provider**, not the merchant of record:
  the merchant's MP account is the recipient; MP runs their KYC. Keep it that
  way — the moment Venduá aggregates funds, it acquires a payments business it
  doesn't want.
- Chargebacks land on the merchant (their account); admin surfaces status and
  evidence submission guidance.
- LGPD: customer PII in orders is tenant-scoped; payment PII stays at MP;
  Venduá stores only identifiers needed for reconciliation.
