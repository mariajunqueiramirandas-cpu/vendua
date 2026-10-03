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
  - **Venduá Pangolim, R$ 449/mês:** everything in Bandeira, plus a custom domain, a site made
    by our agent and 1.000 conversations a month.
- **The 14-day trial with no card moves to Bandeira.** Mirim and Pangolim have no trial. A trial
  includes 50 Vendedor conversations.
- **Extra conversations are sold in packs:** +100 conversations for R$ 39,90.
- **No fee per order on any plan.**
- **No founder's price.**
- **No grandfathering.** Nobody pays for Basic or PRO+, so the catalog is replaced in place.

Later the same day the owner added these decisions:

- **The top plan is spelled "Pangolim"** (id `pangolim`).
- **Pangolim launches closed.** Venduá can't offer own domains yet. The plan stays listed as the
  top anchor, but no store can pick it until staff open it.
- **Pack conversations last 30 days** from the pack's payment.
- **Owners hear when Duá runs out** of conversations.
- **Pangolim opens when own domains are built.** Staff open it in the CRM then.
- **The AI seller is Duá**, Venduá's mascot, on every store. Stores no longer name it, the
  mascot is its face, and copy says "o Duá" and "ele". "Vendedor" stays the code name (routes,
  tables, the `vendedor` feature key).

## Decision

**The catalog stays data** (ADR 0021). `plans` gains three columns. `recommended` (at most one,
a partial unique index) marks the plan the signup preselects and the site leads with.
`ai_conversations` and `ai_trial_conversations` hold the Vendedor's allowance. `features` gains
`kds`, `printing`, `loyalty` and `vendedor` beside `customDomain` and `customSite`. Staff edit all
of these in the CRM (`PATCH /control/v1/plans/:id`). Recommending one plan takes the flag off the
other, and features merge key by key.

**A plan can be listed but closed.** `plans.available` (default true) says whether a store may
pick the plan. Pangolim starts with `false`. Signup, starting a subscription and changing plans
answer 409 `PLAN_UNAVAILABLE` for a closed plan, except the store's own current plan, so a
store already on it can still pay. The admin and the site show a closed plan with its price and
perks, and with "Ainda não está aberto para assinatura." where its button would be. They never
preselect it, and Conta's upgrade offer skips it. Staff open or close a plan in the CRM ("aberto
para assinatura"). The recommended plan must stay open: closing it, or recommending a closed
plan, answers 409 `RECOMMENDED_PLAN_CLOSED`.

**Basic and PRO+ retire.** Stores on them move to Mirim and Pangolim, and so do subscriptions
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
  trial gets `ai_trial_conversations` for its whole length and can't use packs. Pangolim has 50
  too, because a Bandeira trial can switch to it and stays a trial.
- **Order of spending.** The month's allowance goes first, then packs, the one that lapses
  soonest first (migration 0084). A pack's conversations count for `PACK_DAYS` (30) from its
  payment (`ai_credits.expires_at`). Each pack conversation records the credit that paid for it
  (`ai_conversations.credit_id`), so what is left of each pack is exact.
- **When it runs out,** `claimForTurnTx` emits `vendedor.exhausted` with the period (its month's
  reset date, or `trial`). The push worker sends owners and managers "O Duá ficou sem conversas"
  once per `push_deliveries` row: a store that stays out hears it again about every two days,
  never once per shopper. Duá's home shows it too (`allowance` in `GET /vendedor`), with "comprar
  mais conversas" for the owner.
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
- **The Vendedor** (merged from ADR 0031's work):
  - **A plan without it is the switch off.** `loadAgent().enabled` is the merchant's switch and
    the plan; `switchedOn` keeps the switch, so an upgrade brings it back unchanged. The same
    rule covers the WhatsApp gateway, the web chat and the proactive turns.
  - **Its name is not a setting.** Every payload names it Duá, a stored name from before reads as
    Duá, and `PATCH /vendedor/settings` with `name` answers 422. It introduces itself as "o Duá,
    assistente virtual da <loja>", or "o Duá, da <loja>" with disclosure off. Its coupons start
    `DUA-`.
  - **Its face is the mascot everywhere,** small sizes included (the owner's call over the brand
    kit's V mark below 48 px): the admin's avatars, the site's demo and the storefront chat, which
    carries a 2.7 KB crop in `ui-defaults` because the assistant is always Duá.
  - **Turning it on needs the plan,** and so do the test chat, Cliente oculto and the onboarding
    interviewer. Those three are the owner's own tools and don't count conversations.
  - **Ingest claims a conversation** (`thread:<id>`) before it dispatches a shopper's message to
    an agent or Ensaio floor. When it can't, the thread goes to the store: "Vou chamar alguém da
    loja" once, `owner_reason` "conversas do mês esgotadas" (or "plano sem o Duá"), waiting in
    the inbox, and no handback timer. The next message asks again.
  - **The conversation screens stay open on every plan,** so threads handed to the store can be
    answered; the Vendedor's other screens show the plan that includes it.
- **Copy.** The site's pricing and the signup copy name these plans. The site's banned-words check
  still allows exactly "14 dias grátis", which now belongs to Bandeira. If staff change a price,
  a trial or a limit in the CRM, the site copy must change with it.
- **The margin depends on conversation cost,** which is still unmeasured. The limits are data, and
  the pilots will set them.

## Alternatives considered

- **Modules priced one by one.** These are harder to choose between and to bill on a Mercado Pago
  card assinatura, and give the site no headline price. Packs are the one add-on.
- **Four tiers.** A decoy pattern works better with three.
- **AI unlimited under fair use.** This is simple to sell, but its cost is unbounded per store.
- **A cut of the sales the Vendedor closes.** It is measurable through `orders.source`, but it
  breaks "no fee per order".
