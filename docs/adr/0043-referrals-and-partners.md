# ADR 0043: Stores bring stores, partners bring stores

- Status: Accepted (implemented 2026-10-13, Core migration 0120)
- Date: 2026-10-13

## Context

The only growth lever after signup opened was a staff-made coupon ([ADR 0042](0042-signup-coupons.md)).
Competitors pay for distribution: Domínio runs a partner program with recurring commission,
Instadelivery has "Embaixadores" and Yampi has resellers ([competitors](../competitors/README.md)).
Accountants and suppliers already advise the small shops Venduá sells to.

The owner decided (2026-10-13):

- **Store referral: one free month for both sides.** The new store gets its first month free on
  top of its trial. The referring store gets its next month free once the new store pays its
  first month.
- **Partners: 20% of every paid plan invoice of the stores they bring, for each store's first
  12 months.** Staff approve partners in the CRM and pay them out monthly by Pix.

## Decision

**A link carries the code.** A store's link is its own address: `/admin/comecar?indica=<slug>`
(Conta e plano → Indique e ganhe). A partner's link is `/admin/comecar?parceiro=<CODE>`. Signup
keeps the code in its draft. `GET /admin/v1/signup/referral` says who the code is and how many
welcome days it gives. `POST /admin/v1/signup` takes `referral`. A code that is nobody's is
dropped and never blocks a signup.

**The welcome month is free days.** A store's referral gives `30 + the plan's trial` free days,
or 30 when this phone already had its trial. Signup treats those days like a coupon's (ADR
0042): no payment method is asked and the one-trial-per-phone rule doesn't apply. The welcome
has limits:

- Each WhatsApp gets it once, kept in `store_referrals.phone_key` with a partial unique index.
- It never comes from the new owner's own store, nor from a partner's code.
- A coupon's free days win over it, but the referral is still recorded.

`record_store_referral()` records the referral inside the signup transaction, under the phone's
lock. It is security definer: it has to read other tenants and partners.

**Payment triggers the rest.** `markInvoicePaid` calls `referral_on_paid()` in the paying store's
own transaction. That call does one of two things:

- A partner's store pays a period or upgrade invoice. If the partner is active and the store is
  within its first `commission_months`, the call writes `partner_commissions`: `commission_bps`
  of what was actually paid, rounded in SQL in Core. A refunded month earns nothing.
- A referred store pays its first period invoice. The call marks the referral rewarded and owes
  the referrer one month: a `billing_credits` row.

**A credit is applied by the referrer's own billing.** A Pix and Mercado Pago's assinatura both
need an amount (never R$ 0), so a free month is not a 100% discount:

- **Pix plans.** The billing jobs' `credits` step moves `current_period_end` (and
  `trial_ends_at`, while trialing) one month later. It voids any renewal invoice already issued
  for the old date and withdraws its Pix. The owner hears the new date.
- **Card plans.** Mercado Pago charges on its own schedule, so the next approved charge is
  refunded in full through `platformRefund`. The refund's idempotency key is the credit's id, so
  a replay never refunds twice. The invoice records `credited_cents`. If the refund is refused,
  the credit stays owed and the team hears.
- **Stores not paying yet.** A credit waits while the store is pending, past due or cancelled.

**Partners apply on the site** (`/parceiros/` → `POST /site/v1/partners`). The endpoint is
rate-limited per IP, has a honeypot field, and is idempotent by phone. An application lands as
`pending`, with a `partner.applied` staff event.

The CRM page is Lojas → Parceiros:

- Staff approve, pause or reject partners, edit the Pix key and copy the partner's link.
- "registrar pagamento" settles every due commission in one payout. Core sums the payout at that
  moment; the CRM never sends an amount.
- The same page lists store-to-store referrals and whether each referrer's month was earned.

## Consequences

- `store.created` names the referral ("loja X" or "parceiro Y") on the team's card.
- Card refunds come from Venduá's own Mercado Pago account balance.
- The free month is honest only when there is something to give back, so the referrer's month
  waits until its plan is active.
- Paying out is manual (a Pix from the team). An automatic payout needs a payout API, which
  Mercado Pago doesn't offer for this.
