# ADR 0042: Signup coupons — free days and/or a discount on the first paid months

- Status: Accepted (implemented 2026-10-13, Core migration 0118)
- Date: 2026-10-13

## Context

Signup ([ADR 0021](0021-self-serve-signup-and-plan-billing.md)) charges the plan's price from the
first month, except Bandeira's 14-day trial ([ADR 0025](0025-free-trial-on-basic.md), moved by
[ADR 0032](0032-three-plans-for-launch.md)). The access code (`VENDUA_SIGNUP_ACCESS_CODE`) only
replaces Mercado Pago with a payment the team confirms by hand. The team had no way to give a
partner, a fair's visitors or a referred merchant something on signup: a one-time code for one
person, or a code many people can use.

The user decided (2026-10-13):

- **A coupon can give free days, a discount on the first paid months, or both.** The discount is
  a percentage or a fixed R$ amount off each discounted month.
- **Coupons are configurable:** staff choose the code, the plans it works on, an expiry and how
  many times it can be used (1 = one-time).
- **A coupon's free days override the one-trial-per-phone rule.** A phone that already had its
  trial can still use a coupon with free days. Each coupon still works once per phone.

## Decision

**Coupons are platform data, made in the CRM.** `signup_coupons` (control-only RLS) holds the
code, a note, `plan_ids` (null = every plan), `free_days` (0–365), the discount (`percent` 1–99
or `amount` in cents, for 1–24 months), `max_uses` (null = unlimited), `uses`, `expires_at` and
`active`. Lojas → Planos → "cupons de cadastro" lists them, with who used each:

- `POST /control/v1/signup-coupons` makes one coupon with a typed code, or `quantity` (≤ 200)
  coupons with generated codes (`PREFIX-XXXX-XXXX`, no 0/O/1/I/L), one use each by default.
- `PATCH /control/v1/signup-coupons/:id` changes only `active`, `note`, `max_uses` and
  `expires_at`. **The terms never change once made**: for other terms, staff make another
  coupon. Stores keep the terms they redeemed anyway (below).

**Signup takes one coupon.** `GET /admin/v1/signup/coupon?code&planId` shows what it gives and,
on that plan, each discounted month's price (computed in Core). `POST /admin/v1/signup` takes
`coupon`. Inside the transaction that creates the store, under the phone's lock,
`redeem_signup_coupon()` (security definer: the uses count and other stores' redemptions are
outside the new store's RLS; it refuses any tenant but the transaction's own) locks the coupon
row, checks it is on, unexpired, for this plan, not used up and not used by this phone, writes a
`signup_coupon_redemptions` row with the terms as redeemed, and counts the use. A refusal (422
`COUPON_INVALID`, `COUPON_EXPIRED`, `COUPON_USED_UP`, `COUPON_PLAN`, 409 `COUPON_ALREADY_USED`)
rolls the store back with it. A replay of a signup that went through finds its store and its
redemption, so a one-time code used up by that very signup still replays.

The admin asks "tenho um cupom" on the last step, and `/admin/comecar?cupom=CODE` arrives with it
applied. Conta shows the coupon while it still gives something, and each invoice its discount.
The `store.created` staff event carries the coupon.

**Free days are a free first period**, ADR 0025's machinery with the coupon's length:
`trialing` until then, no payment method asked, the store open at once, then the first invoice,
and a store that doesn't pay pauses. They replace the plan's trial, aren't limited by the phone's
trial history, and set `trial_phone` like a trial (that phone's later plan trial is used up).
Free days need Mercado Pago after them, so they don't combine with an access code (422
`COUPON_NEEDS_BILLING`); a discount does.

**The discount lives in SQL.** `period_charge_cents(tenant, price, period_start)` is the price,
less the store's coupon while fewer than `discount_months` non-void period invoices before that
period carry a discount (`invoices.discount_cents > 0`). `signup_coupon_price` is the one formula:
half-up percent, and never below R$ 1,00 (Pix and the MP assinatura need an amount) nor above the
price. Every period charge goes through it:

- the first Pix invoice, the renewals, the first month after free days and repricing all write
  `discount_cents` with the amount;
- a card assinatura is created at the discounted amount, and `syncPlanPrices` compares the card's
  `charge_cents` against `period_charge_cents(..., 'infinity')`. After the last discounted
  charge, the next tick puts the assinatura back at the plan's price;
- a card charge counts as discounted when MP took less than the price in a discounted month.

Counting issued invoices, not only paid ones, keeps two open invoices from both taking the last
discounted month. A percentage follows plan changes (it applies to the new plan's price); a fixed
amount stays fixed. Mid-period upgrade differences, Duá packs and anything that isn't a period
invoice never get a discount.

## Consequences

- A 100% discount is not offered: months without a charge are free days.
- Changing a coupon's terms means making a new one; switching one off never touches stores that
  already used it.
- Copy that names a coupon's offer is the team's, in the CRM. The site carries no coupon copy.
- A store's discount is read from its own redemption row, under its RLS, by every billing path
  that prices a period; there is no separate counter to keep in step.
