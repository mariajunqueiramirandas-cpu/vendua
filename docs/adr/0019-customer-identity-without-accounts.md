# ADR 0019: Customer identity without accounts

- Status: Accepted (implemented 2026-09-27 — Kernel 1.2, roadmap Phase 2)
- Date: 2026-09-27

## Context

The Quero Pudim reference promises "sem senha, sem cadastro": a customer sees their
orders on any device, and a loyalty card counts their deliveries, keyed by their
WhatsApp number. The reference serves `GET /customer/orders?phone=` with no proof at
all, so anyone who types a phone number reads that person's order history,
addresses included.

We can't send a one-time code to the customer's WhatsApp from Core yet: the merchant's
number isn't connected to the platform before Phase 3, and sending from Venduá's own
number would put a platform sender in a merchant's customer relationship.

## Decision

A **customer token** binds `(tenant, phone)` for 90 days (`vcu.<phone>.<exp>.<hmac>`,
signed with the session secret, sent as `X-Vendua-Customer`). Core mints one in two
ways:

1. **The device that checks out** with a phone gets a token for that phone (in the
   checkout response).
2. **Any device that names one of the phone's order numbers** (`POST
/checkout/v1/customer/session { phone, orderNumber }`). Rate-limited (10/min per
   client) and a single error for "no such order" and "wrong phone".

A token unlocks **summaries only**: order number, date, state, total, item names and
quantities (`GET /customer/orders`), plus the loyalty card. Addresses, names and the
full order view still need that order's own session token, and "pedir de novo" on
another device's order goes through the same phone check.

## Consequences

- Someone who places an order with a victim's phone can then list the victim's
  order summaries. That costs a real order the merchant sees, and the exposure is
  limited to what was bought and when; no address, name or payment detail is shown.
  This is strictly better than the reference, which exposed everything to a typed
  phone number.
- Phone-OTP verification lands with the merchant admin (Phase 3). It becomes a
  third minting path with the same token and the same `useOrders`/`useLoyalty`
  hooks, so storefronts change nothing.
- Loyalty rewards are coupons bound to the phone. Redeeming one is checked against
  the checkout phone, so a leaked code is useless to anyone else.
