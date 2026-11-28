# ADR 0049: The team changes one store's plan from the CRM

- Status: Accepted (implemented 2026-11-28, Core migration 0158)
- Date: 2026-11-28

## Context

The CRM already edited the plan catalog (Lojas → Planos: prices, trials, Duá conversations,
features, AI packs, signup coupons) and could mark one invoice paid by hand. It could not act on
one store: move it to another plan, give it free months or Duá conversations, open a trial as a
paid plan, or cancel it for the owner. Each of those took SQL.

The owner decided (2026-11-28):

- **A plan change by the team is a courtesy until the renewal.** The new plan applies at once,
  up or down, and no difference is charged apart. The next charge is already at the new price.
- **The team can turn a trial into a paid plan without charging** ("como se fosse um pago,
  gratuitamente"), and give free months, Duá conversations and cancel or resume.

## Decision

**Same billing code as the owner's Conta.** `POST /control/v1/stores/:id/billing/<action>`
(`control-store-billing.ts`) runs each action as a staff claim (Idempotency-Key, ADR 0022) in the
store's tenant scope. It calls the subscription state machine in `billing/subscriptions.ts`.
Owner messages and Mercado Pago cancellations wait for the commit, as in the owner's routes.

- `plan` → `staffChangePlan`: any catalog plan, open or closed to signups. An owner's waiting
  upgrade invoice is voided and a waiting downgrade is dropped. The charge already issued is
  repriced. A card assinatura gets the new amount last. A paid store moving onto the site plan
  gets its site request now.
- `activate` → `staffActivateFree`: only `trialing` or `pending`. The plan is `active` from now
  for 1–12 months on that day of the month (`billing_month_after`). No invoice is paid, so the
  team hears no payment and no referral or partner reward fires. Unpaid first-period invoices are
  voided. A card assinatura would charge on its own old dates, so it is cancelled and the plan
  pays by Pix. The owner can authorize a card again in Conta, and it starts at the period end.
- `free-months` → `billing_credits` with reason `staff`, one row per month. A row is applied like
  a referral month: a Pix plan moves its next charge on, and a card plan gets each of its next
  charges refunded. A plan set to end has no charge to give back, so it is refused.
- `ai-credits` → `ai_credits` with source `staff` and no invoice, for 1–365 days. They are spent
  like a pack. Unlike a pack ([ADR 0032](0032-three-plans-for-launch.md)), they also count during
  a trial: a paid pack can't be bought in a trial, and the team's conversations should work
  wherever the plan has Duá.
- `cancel` / `resume` → the owner's `cancelSubscription` / `resumeSubscription`. The team's event
  says "A equipe cancelou".

Each action writes the store's audit log as "Equipe Venduá" and a `billing.staff` staff event
(silent; it shows on the store's timeline in the CRM). A cancel is already a `billing.problem`.
The owner is told on WhatsApp and email.

## Consequences

- "Indique e ganhe" counts only `reason = 'referral'` months, and the free-month messages say
  who gave them.
- A store opened without charging counts in MRR as `active` at its plan's price until its first
  real charge. Nothing marks a courtesy period yet. If MRR needs to exclude these stores, that
  needs a flag on the subscription.
- Migration 0158 is additive (ADR 0041): `ai_credits.invoice_id` becomes nullable, with a check
  that only `staff` rows lack one. `billing_credits.reason` gains `staff`. A previous Core counts
  staff rows as packs and referral months.
