# 13 — Payments

> Status: Implemented (Core migration 0054, Kernel 1.7; in-page card Kernel 1.17) · Last reviewed: 2026-10-03
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
  shown by the Kernel-owned order page with its QR and copia e cola.
- **Card in the page, no redirect** (Kernel 1.17): the order page mounts MP's Card Payment
  Brick. Card number, expiry and CVV are MP's Secure Fields — iframes served by MP — so card data
  never touches storefront code or Venduá servers (PCI SAQ A), which is why checkout can't be
  custom storefront code ([ADR 0004](../adr/0004-kernel-owned-checkout.md)). The Brick hands the
  Kernel a single-use token; the Kernel posts it to `POST /checkout/v1/orders/:id/card` and Core
  creates the payment (`POST /v1/payments` on the merchant's token, 3-D Secure `optional`).
  Core charges the order total, never an amount from the page.
  - `/pay` with `{"card":"form"}` answers `{kind:'card', publicKey, amountCents, declined}` —
    showing the form reserves nothing. The key is `MP_PUBLIC_KEY` (Venduá's application, MP's
    current marketplace guidance) or, unset, the store's own `public_key` from OAuth.
  - One card at a time: a submit reserves a `creating` attempt (MP key `${orderId}:${attempt}`);
    while it is in flight or in review at MP, another submit gets `409 PAYMENT_IN_PROGRESS` —
    a second token would be a second charge. A submit MP never answered is retried after 2
    minutes under the same attempt, so MP's idempotency key replays a payment it did take. A
    failed lookup at MP answers `503`, never "MP has nothing". A decline answers
    `{kind:'declined', reason}` and the shopper types another card (attempt + 1).
  - 3-D Secure: a `pending_challenge` answer comes back as `{kind:'challenge', url, creq}`; the
    Kernel posts `creq` into an iframe on the same page and, on MP's `COMPLETE` message, calls
    `/pay` to sync (the webhook settles it too). An unanswered challenge can be replaced by a
    new card once MP confirms the old payment is cancelled.
  - Money that lands on an order already paid (a replaced card MP settled anyway, a Pix paid
    twice) is flagged `paid_twice` in Pagamentos and posted to the team; the job re-reads
    cancelled card attempts for 48 h so a lost webhook can't hide it.
  - Kernels before 1.17 still get MP's hosted checkout (Checkout Pro preference, redirect back
    with `?pagamento=retorno`) until their store takes the Kernel train.
- `application_fee` is set per-transaction in cents by Core from the tenant's
  plan (`plans.fee_bps`). Venduá's margin is a platform parameter, not a per-store code
  path; today it is **0 on every plan** (the user's decision, 2026-09-30) — Venduá earns
  the plan only ([ADR 0021](../adr/0021-self-serve-signup-and-plan-billing.md)).
- MP requires a payer email on Pix and shoppers don't give one: Core sends
  `MP_PAYER_EMAIL` when set, else `pagador@<store domain>`. A card payment uses the email the
  shopper types into the Brick (it shows the field because we pass none).

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
order. A card payment MP can't take answers `PAYMENT_UNAVAILABLE` and the order page offers a
retry or the store's WhatsApp.

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
- Open: a payment that lands twice on one order is recorded and flagged (`paid_twice`), not
  refunded automatically — the merchant refunds one from the order.

## Provider interface

Only MP is implemented, behind an interface so future providers (Pagar.me,
Stripe) are adapters, not rewrites:

```ts
interface PaymentProvider {
  connectUrl(tenant, redirect): string;
  handleOAuthCallback(code, tenant): Promise<Connection>;
  refreshIfNeeded(conn): Promise<Connection>;
  createPix(token, req): Promise<ProviderPayment>;
  createCardPayment(token, req): Promise<ProviderPayment>; // a Brick token; may need 3DS
  createCardCheckout(token, req): Promise<CardCheckout>; // hosted, Kernels before 1.17
  parseWebhook(headers, body): WebhookEvent; // verified, typed
  refund(payment, amount?): Promise<RefundResult>;
}
```

`PayNext` (`pix` / `card` / `challenge` / `declined` / `none`, plus `redirect` for older
Kernels) normalizes what the order page does next, so checkout UI stays provider-agnostic.

## Compliance notes

- Venduá is a **marketplace/technology provider**, not the merchant of record:
  the merchant's MP account is the recipient; MP runs their KYC. Keep it that
  way — the moment Venduá aggregates funds, it acquires a payments business it
  doesn't want.
- Chargebacks land on the merchant (their account); admin surfaces status and
  evidence submission guidance.
- LGPD: customer PII in orders is tenant-scoped; payment PII stays at MP;
  Venduá stores only identifiers needed for reconciliation.
