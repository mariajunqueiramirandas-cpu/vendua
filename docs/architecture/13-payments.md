# 13 — Payments

> Status: Implemented (Core migration 0054, Kernel 1.7) · Last reviewed: 2026-09-30
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

- **PIX first** (BR reality): an MP dynamic Pix (`POST /v1/payments`, 30-minute expiry)
  shown by the Kernel-owned order page with its QR and copia e cola. Card goes through
  MP's hosted checkout (Checkout Pro: a preference and a redirect back to the order page
  with `?pagamento=retorno`) — card data touches MP's pages only, never storefront code
  or Venduá servers, which is why checkout can't be custom storefront code
  ([ADR 0004](../adr/0004-kernel-owned-checkout.md)). The redirect replaced the in-page
  Bricks plan: no card fields or MP SDK in the storefront bundle at all.
- `application_fee` is set per-transaction in cents by Core from the tenant's
  plan (`plans.fee_bps`). Venduá's margin is a platform parameter, not a per-store code
  path; today it is **0 on every plan** (the user's decision, 2026-09-30) — Venduá earns
  the plan only ([ADR 0021](../adr/0021-self-serve-signup-and-plan-billing.md)).
- MP requires a payer email on Pix and shoppers don't give one: Core sends
  `MP_PAYER_EMAIL` when set, else `pagador@<store domain>`.

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

| Status                           | Storefront behavior                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connected`                      | normal                                                                                                                                                                                                                                             |
| `expiring`                       | merchant-facing admin notice only; shopper flow unchanged                                                                                                                                                                                          |
| `disconnected`                   | Pix degrades to the store's static Pix key (copia e cola + the merchant's "recebi", as before Phase 3); `card_online` disappears from checkout — the store never hard-fails; the admin (Início, Pagamentos) and a WhatsApp to the owner explain it |
| `restricted` (MP-side KYC holds) | same degradation path, different merchant message                                                                                                                                                                                                  |

A Pix that MP refuses at creation (or that keeps failing) degrades the same way for that
order. A card checkout MP can't create answers `PAYMENT_UNAVAILABLE` and the order page
offers a retry or the store's WhatsApp.

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
- Refunds: merchant-initiated in admin → MP refund API (partial supported, capped by
  Core's `refundableCents`) → the order page shows the amount returned. Cancelling an
  online-paid order refunds it in the same request, or fails (`REFUND_FAILED`) and leaves
  the order untouched. A shopper WhatsApp notification is not sent: the platform doesn't
  message shoppers on a store's behalf yet.
- The live order stream sees payment changes: `version` = order events + `orders.rev`,
  which every payment change bumps (with `pg_notify`).
- Webhooks can be lost: a job reconciles pending payments younger than 48 h every 2 min,
  and expires Pix past its deadline.
- Reconciliation report per tenant: orders vs MP settlements vs fees — built
  from `payments` + webhooks, not scraped statements (admin → Pagamentos → extrato:
  gross, MP fee, Venduá fee, net, refunds per month).
- Open: a Pix paid after its order was cancelled, or paid twice, is recorded but not
  refunded automatically — the merchant refunds it from the order.

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
