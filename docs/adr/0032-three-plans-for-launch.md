# ADR 0032: Three plans for the launch, the middle one recommended

- Status: Accepted (implemented 2026-10-03, Core migration 0083)
- Date: 2026-10-03

## Context

[ADR 0021](0021-self-serve-signup-and-plan-billing.md) launched two plans: Venduá Basic at
R$ 39,90/mês and Venduá PRO+ at R$ 99/mês, which added a custom domain and a custom site.
[ADR 0025](0025-free-trial-on-basic.md) gave Basic a 14-day trial. Since then the product has
gained the kitchen display (ADR 0029), print agents (ADR 0027) and the loyalty card. The
Vendedor, an AI seller on the store's WhatsApp ([ADR 0031](0031-vendedor.md)), is being built.
ADR 0031 deferred how AI is charged.

Own-menu competitors charge about R$ 100–300/mês, and several gate their WhatsApp AI to their
higher tiers. Every Vendedor conversation costs Venduá model calls, so a flat price with no
limit could lose money on a busy store. Venduá has no paying stores yet.

The owner decided (2026-10-03):

- **Three plans.** The middle one should be the obvious choice.
  - **Venduá Mirim, R$ 69,90/mês:** the store at `<slug>.vendua.com.br`, menu, checkout, Pix
    and coupons.
  - **Venduá Bandeira, R$ 169/mês, recommended:** everything in Mirim, plus the kitchen display,
    automatic printing, the loyalty card and the Vendedor with 250 conversations a month.
  - **Venduá Pangolin, R$ 449/mês:** everything in Bandeira, plus a custom domain, a site made
    by our agent and 1.000 conversations a month.
- **The 14-day trial with no card moves to Bandeira.** Mirim and Pangolin have no trial. A trial
  includes 50 Vendedor conversations.
- **Extra conversations are sold in packs:** +100 conversations for R$ 39,90.
- **No fee per order on any plan.**
- **No founder's price.**
- **No grandfathering.** Nobody pays for Basic or PRO+, so the catalog is replaced in place.

## Decision

**The catalog stays data** (ADR 0021). `plans` gains three columns. `recommended` (at most one,
a partial unique index) marks the plan the signup preselects and the site leads with.
`ai_conversations` and `ai_trial_conversations` hold the Vendedor's allowance. `features` gains
`kds`, `printing`, `loyalty` and `vendedor` beside `customDomain` and `customSite`. Staff edit all
of these in the CRM (`PATCH /control/v1/plans/:id`). Recommending one plan takes the flag off the
other, and features merge key by key.

**Basic and PRO+ retire.** Stores on them move to Mirim and Pangolin, and so do subscriptions
and pending changes. The old rows stay, not public, only for the invoices that name them.

**Stores from before the catalog** (`spike` and other legacy ids, "Plano piloto") keep every
operational feature and 1.000 conversations, but no domain or site. These are the pilot stores
the team runs by hand, and the Vendedor's pilots among them.

**One gate for features, in Core.**

- `requireFeature(tx, tenantId, feature)` answers 403 `PLAN_REQUIRED` with `{ feature }`, or with
  `reason: 'unpaid'`.
- `planHas` returns the same answer as a boolean, for paths that must skip quietly.
- `planAccess` returns every feature at once, and the admin's `/session` carries it so any role
  sees what is locked.
- A plan's features count while it is paid (`active` or `past_due`) or in its trial. A trial opens
  everything except the domain and the site, which still wait for the first payment, as ADR 0025
  had it.

**What each feature gates:**

- **Kitchen display:** every `/admin/v1/kitchen*` route. The kitchen's data is kept, and orders
  keep moving from Pedidos.
- **Printing:**
  - The printer settings, pairing approval, adding and editing printers, the test print and
    "imprimir comanda" are gated.
  - A print agent's stream and printer updates stop. It can still report a job's result and
    disconnect.
  - `enqueueOrderPrintTx` queues nothing, and checks the plan only when the store has an
    automatic printer.
  - `GET /printers` still answers, with `included: false` and no devices, so the order screen
    offers no print.
- **Loyalty:**
  - Turning a program on is gated. Turning it off never is.
  - On a plan without loyalty, the storefront reads no program and a delivered order mints no
    reward.
  - The stored program and the stamps, which are derived from orders, come back on an upgrade.
  - Reward coupons already issued stay redeemable.
- None of these checks can fail a checkout or an order transition.

**The Vendedor's conversations** (`modules/billing/ai-allowance.ts`):

- **What counts as a conversation.** One shopper's conversation counts once per 24 hours from
  when it started, however many messages it has.
- **The allowance.** A paid plan gets `ai_conversations` per calendar month (São Paulo time). A
  trial gets `ai_trial_conversations` for its whole length and can't use packs. Pangolin has 50
  too, because a Bandeira trial can switch to it and stays a trial.
- **Order of spending.** The month's allowance goes first, then packs. Pack conversations don't
  expire.
- **The Vendedor's only entry point** is `claimAiConversationTx(tx, tenantId, subjectKey)`, called
  in the transaction that starts its turn.
  - A new conversation takes a per-store lock, and records one `ai_conversations` row with what
    paid for it:
    `plan`, `trial` or `pack`.
  - It answers `{ ok: false, reason: 'plan' | 'exhausted' }` when it can't.
  - What the Vendedor does then (hand off to the merchant, send a link) is ADR 0031's call.
- **The admin's Conta** reads the allowance from `GET /account` (`ai`).

**Packs are one-off Pix invoices.**

- `POST /admin/v1/account/ai-packs { packId }` (owner, idempotent) opens an `invoices` row of
  kind `ai_pack`. It is priced from `ai_packs`, a platform catalog staff edit in the CRM, and
  keeps the pack's conversations as bought, so a later catalog change doesn't alter what it
  credits.
- **Who can buy.** Packs are only for a paid plan that includes the Vendedor. During a trial the
  route answers 409 `AI_PACK_NEEDS_PAID_PLAN`.
- **One open pack invoice at a time.** Asking again returns it, with a new Pix if the old one
  lapsed. A different pack or price voids it first.
- **Payment** runs the usual Pix settlement. `markInvoicePaid` inserts one `ai_credits` row per
  invoice (unique), so a replayed webhook credits once.
- Pack invoices never remind and never move the period: every sweep already reads only
  `kind = 'period'`.

## Consequences

- **Superseded decisions.** ADR 0021's two plans and prices, and ADR 0025's trial on Basic. The
  trial's mechanics are unchanged; it now belongs to Bandeira. ADR 0031's open decision "how AI is
  charged" is answered here.
- **The Vendedor.** Its work in progress must call `claimAiConversationTx` before it answers a
  new conversation, and check `planHas(tx, tenantId, 'vendedor')` where it is switched on.
- **Copy.** The site's pricing and the signup copy name these plans. The site's banned-words check
  still allows exactly "14 dias grátis", which now belongs to Bandeira. If staff change a price,
  a trial or a limit in the CRM, the site copy must change with it.
- **The margin depends on conversation cost,** which is still unmeasured. The limits are data, and
  the pilots will set them.
- **Still open, for the owner:**
  - Whether pack conversations should expire.
  - Telling owners when Ana runs out of conversations (the Vendedor's admin screens).
  - The final spelling of "Pangolin" (Portuguese: "Pangolim").

## Alternatives considered

- **Modules priced one by one.** These are harder to choose between and to bill on a Mercado Pago
  card assinatura, and give the site no headline price. Packs are the one add-on.
- **Four tiers.** A decoy pattern works better with three.
- **AI unlimited under fair use.** This is simple to sell, but its cost is unbounded per store.
- **A cut of the sales the Vendedor closes.** It is measurable through `orders.source`, but it
  breaks "no fee per order".
