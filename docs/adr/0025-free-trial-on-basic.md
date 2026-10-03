# ADR 0025: A 14-day free trial on Venduá Basic, no card

- Status: Accepted (implemented 2026-10-02, Core migration 0075); the trial moved to Venduá Bandeira by [ADR 0032](0032-three-plans-for-launch.md)
- Date: 2026-10-02

## Context

Under [ADR 0021](0021-self-serve-signup-and-plan-billing.md) a new store pays its first month
before it can take an order: signup ends at a Pix or a Mercado Pago card authorization, and the
store waits behind `billing_hold` until the money lands. That is the moment a new merchant is
least sure the product is worth it.

The user decided (2026-10-02):

- **Venduá Basic starts with 14 days free, and no credit card is asked.** PRO+ has no trial.
  Prices don't change.
- **When the 14 days end unpaid, the store pauses for new orders until it's paid.** The admin
  keeps working, nothing is deleted, and it reopens the moment the payment lands.
- **One trial per owner (WhatsApp number).**

## Decision

**The trial is plan data.** `plans.trial_days` (0–60) is how many free days a new store of that
plan gets — 14 for `basic`, 0 for `pro_plus`. Staff edit it in the CRM beside the price; a
change applies to stores that sign up afterwards.

**A trial is a free first period.** Its subscription is `trialing` with
`current_period_end = trial_ends_at`, and everything that keys on a period's end treats it like
a paid one: the first Pix invoice is issued five days before the end, and a card switched on
during the trial is an assinatura whose first charge (`start_date`) is the trial's end. Paying
during the trial doesn't shorten it: the first paid month starts when the trial ends. The method
starts as the monthly Pix, so nothing about a card is asked; the owner can switch to card in
Conta at any time.

**Signup asks for it.** `POST /admin/v1/signup` with `trial: true` (only for a plan with
`trial_days > 0`, not with an access code) opens the store at once — no `billing_hold` — and
answers `next: { kind: 'trial', endsAt }`. Whether the phone already had a trial is checked under
the per-phone lock signup already takes, through `phone_had_trial()`, a security-definer twin of
`merchant_memberships_for_phone` that answers only that boolean; a phone that had one gets
`409 TRIAL_USED` and the normal paid signup. `otp/verify` tells the admin beforehand
(`trialEligible`).

**The end is a billing job.** Three days before and on the last day the owners hear when it ends
and what happens next (`trial_reminded` claims each notice once). At the end, unpaid: the
subscription goes back to `pending` (nothing paid yet), the store pauses behind `billing_hold`
like a fresh signup waiting for its first payment, the owners are told, and the team gets a
`billing.problem` `trial_ended`. A card the owner authorized gets the usual one-day grace for
Mercado Pago's charge to arrive. Paying the first invoice then activates the plan and lifts the
hold — the ordinary first-payment path. A trial cancelled in Conta runs to its end and closes the
store then, like any cancelled period.

**During the trial** a plan change swaps the plan at once with no pro-rata invoice (nothing was
paid), and PRO+ features stay locked until the first payment (`requireFeature` counts only
`active`/`past_due`). Início shows "seu teste grátis acaba em N dias" in its last three days.

## Consequences

- ADR 0021's "the store opens when the first payment lands" now reads "…or at once, on a trial";
  its state machine gains `trialing`, and the "suspension is a staff decision" rule still holds
  for stores that paid — only a trial that never converted pauses by itself.
- The marketing site says "14 dias grátis, sem cartão" for Basic; its banned-words check allows
  exactly that phrase. If staff change Basic's trial length in the CRM, the site copy must change
  with it.
- A trial store is a real, open store: the provisioning, onboarding and staff onboarding card
  treat it like a paid one; the card's "plano pago" step waits for the first real payment.
