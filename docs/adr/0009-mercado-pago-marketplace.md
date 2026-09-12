# ADR 0009: Mercado Pago Marketplace + OAuth + application fee

- Status: Proposed
- Date: 2026-09-11

## Context

Payments must land in each merchant's own account — Venduá should never custody
merchant funds (escrow/repasse drags in licensing, reconciliation liability and
a payments business we don't want). The market is Brazil: PIX is table stakes
and Mercado Pago dominates this merchant segment.

## Decision

Venduá integrates as an MP **marketplace**: merchants connect via OAuth;
payments are created on the merchant's own MP credentials with Venduá's
`application_fee` per transaction. Checkout mounts MP Bricks/SDK **inside the
Kernel-owned checkout** (card data never touches storefront code or Venduá
servers). Webhooks are the authoritative payment state. The integration sits
behind a `PaymentProvider` interface so a second provider is an adapter, not a
rewrite.

## Consequences

### Positive

- No custody: funds settle directly to the merchant; Venduá's take is the
  per-transaction `application_fee`.
- PIX + card + the MP brand merchants already trust; their KYC stays theirs.
- Degradation path is clean: disconnected/restricted → "pedir pelo WhatsApp",
  not a dead store.

### Negative / costs

- MP OAuth tokens expire (~180-day refresh cycle) — token lifecycle is a Core
  job with alerting; a missed refresh is a payment outage for that tenant.
- `application_fee` mechanics and marketplace approval carry MP-side review
  requirements — commercial onboarding cost.
- Single-provider risk until a second adapter exists (interface makes this a
  bounded gap, not a rewrite).

## Alternatives considered

- **Venduá as payment aggregator (subadquirente)**: custody, compliance and
  reconciliation burden — rejected outright.
- **Stripe-first**: weaker PIX/Brazil-merchant fit for this segment; possible
  second provider later.
- **Per-merchant BYO PSP keys in storefront**: leaks payment config into the
  least-controlled layer — forbidden by Contract anyway.

## Links

- [architecture/13-payments](../architecture/13-payments.md)
