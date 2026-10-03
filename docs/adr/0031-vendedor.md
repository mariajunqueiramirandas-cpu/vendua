# ADR 0031: The Vendedor, an AI seller on the store's own WhatsApp

- Status: Proposed
- Date: 2026-10-03

## Context

Shoppers of food stores order on WhatsApp, and six of our eight primary competitors answer there
with a bot or an AI attendant ([`competitor-parity.md`](../competitor-parity.md), P-017). We only
send a link. The strongest, Domínio Tech's "Agente Vendedor", takes the whole order, charges Pix
in the chat and blocks amounts with no source in its system. Others (iFood Ailo, Brendi, Goomer,
Nuvem Chat) take orders too, and Meta's Business Agent is free inside the WhatsApp Business app.
Brendi's own team puts its completion rate near 65%.

Every store can already link its own number for order updates (ADR 0026). The gateway reads only
SAIR and VOLTAR and stores nothing else. The checkout is a single path (`placeOrderTx`), and the
cart, quote, Pix, loyalty, waitlist and encomenda modules exist.

The full design, the competitor scan and the failure modes are in
[`features/sales-agent.md`](../features/sales-agent.md). The merchant's screens are in
[`features/sales-agent-ux.md`](../features/sales-agent-ux.md), drawn on
[`sales-agent-screens.html`](../features/sales-agent-screens.html), and every feature is
listed in [`features/sales-agent-features.md`](../features/sales-agent-features.md).

## Decision

**Build the Vendedor: an AI seller on the store's own WhatsApp, on Agent Runtime v3
([ADR 0030](0030-agent-runtime-v3.md)), that places orders through the storefront's checkout.**

1. **Core decides, the model talks.**
   - Prices, totals, fees, discounts, change, times, availability and order state come only from
     Core.
   - The summary, the Pix code and the payment confirmation are cards Core renders.
   - Replies cite ledger figures that Core fills in, and a verifier blocks any other amount,
     time, product, promise or claim to be a person.
2. **One yes, one order.** `place_order` needs the summary card the shopper answered and an
   affirmative reply after it, and the cart's hash must still match. The hash covers line prices
   and options, fee, discount, payment adjustment, total, fulfilment and payment method, and is
   checked after the cart row is locked.
   - It runs in the in-process idempotency claim (extracted from `idempotency()` in
     `src/platform/http.ts`), keyed by conversation and hash.
   - After `placeOrderTx`, the order's total must equal the card's or the transaction rolls back.
   - Any change means a new card and a new yes.
3. **Same checkout, same kitchen.** Orders are born in `placeOrderTx` with
   `source = 'whatsapp_agent'`. The board, KDS, printers, stock, loyalty and status messages
   treat them like any order, and the merchant's accept is the human check.
4. **Shopper tools only.** The runtime binds the conversation, store, phone and cart. There is no
   tool that changes the menu, prices, hours, another order or another customer.
5. **Transport scope on the unofficial client (ADR 0026):**
   - **What it may send.** It answers, and it writes first only inside a conversation the shopper
     opened in the last 24 hours (recovery, an expired Pix, a requested back-in-stock).
   - **What the gateway stores.** Inbound messages, media and messages typed on the merchant's
     phone, only while the Vendedor is on, and the setup says so.
   - **The outbox.** Chat rows carry a `jid` and a widened phone check, so senders whose number
     WhatsApp hides, and foreign numbers, can be answered.
   - Broadcasts and re-engagement wait for the official API (phase V4).
6. **The merchant's controls are plain questions** (the team's board):
   - **Coverage, when it answers:** Ensaio (writes, never sends), quando eu demorar (1, 2 or 5
     min, or when closed), fora do horário, sempre.
   - **Capabilities, what it may do:** close the order (off sends a ready-sacola link), send the
     Pix, suggest add-ons, offer coupons the merchant picked within a monthly limit.
   - **Handoff rules:** complaint or delay, allergy, an order above an amount, a new customer
     paying cash, and when it takes back.
   - **Rules.** A rule the system can enforce is compiled into a guard and labelled "sempre
     cumprida"; any other rule is guidance and says so.
7. **It sells within the merchant's budget.**
   - Reorder at today's prices.
   - One suggestion per order, computed by Core from the store's own orders.
   - The shopper's own coupons applied first.
   - Incentives only from coupons the merchant chose.
   - Encomendas when closed, pickup out of zone, substitutes or the waitlist when sold out.
8. **Data.**
   - **New tables:** tenant-scoped, under RLS.
   - **Orders** gain `source` and `thread_id`, shared with the iFood work.
   - **LGPD forget** covers conversations, media and facts, and closes today's gaps (cart
     addresses, message bodies).
   - **Memory:** no health data is kept by default.
   - **Providers:** no training on conversations; no phone numbers sent to model providers.
9. **The admin design spec changes in three places:**
   - a shopper waiting for the merchant may push (law 13);
   - the Vendedor takes a phone-bar slot while it is on;
   - new components join §7.
10. **Phases V0 to V4**, each with exit gates measured by order-accuracy simulations and pilot
    stores ([`sales-agent.md` §8](../features/sales-agent.md#8-phases)).

## Consequences

- Shoppers can order, pay and track in the chat they already use, any time the merchant chooses,
  and every figure they see is the store's.
- The merchant sees what it does and why, can take over by replying from the phone, teaches it
  in words, and checks it on its own menu (Cliente oculto, Ensaio) before trusting it.
- Revenue it closed and revenue it helped are reported apart, because orders carry their source.
- Several Core pieces must land first, each useful on its own:
  - cart, quote and coupon logic moved out of routes into module functions;
  - the in-process idempotency claim;
  - cash change;
  - catalog search;
  - `mintCouponTx`;
  - `orders.source`;
  - a single-use sacola link;
  - outbox consumers.
- The cash-change field and the sacola link are additive Kernel changes with the usual
  `API.md`, api-surface test, version bump, `CHANGELOG.md` and `bun.lock` steps.
- Replying to shoppers sends far more on the unofficial client than order updates do, which
  raises the ban risk ADR 0026 accepted. Pacing, the reply-only scope and the V4 official API
  reduce it; they don't remove it.
- The store's WhatsApp gateway stops being "order updates only" while the Vendedor is on. It
  stores conversations for the retention the owner sets.

## Alternatives considered

- **A link-sender only** (what Delivery Direto does). Cheap, but it sells nothing in the chat,
  and most primary competitors already take the order there.
- **The official Cloud API first.** It has templates, opt-in outreach and Meta's own payments
  message, but it means per-message charges since 2026-10-01, Embedded Signup and coexistence
  limits. The design keeps it as a per-store option in V4.
- **Meta's Business Agent on the merchant's app.** It is free, but nothing Meta states ties it to
  the store's modifiers, delivery pricing, stock or kitchen. It and the Vendedor must not both
  answer one number, so setup asks the merchant to turn Meta's off.
- **The CRM agent's engine.** It has no tenancy and no exactly-once effects (see ADR 0030).

## Open decisions

For the owner; the full list is in [`sales-agent.md` §10](../features/sales-agent.md#10-open-decisions)
and [`sales-agent-ux.md` §10](../features/sales-agent-ux.md#10-open-decisions).

1. The per-store ceiling for replies on the unofficial client, and which stores should wait for
   the official API.
2. Model providers that may see store and shopper data under LGPD.
3. How AI is charged, Cliente oculto runs included. No prices here.
4. Retention of conversations and media.
5. Disclosure wording. Recommended: "assistente virtual" always, as the board does.
6. Whether allergies may be remembered, after a legal read.
7. Defaults for recovery, suggestions and unknown numbers.
8. The product's name.
9. The phone-bar slot, and the push for a waiting shopper.

## Links

- [`features/sales-agent.md`](../features/sales-agent.md): the design.
- [`features/sales-agent-features.md`](../features/sales-agent-features.md): every feature, by
  phase.
- [`features/sales-agent-ux.md`](../features/sales-agent-ux.md) and
  [`sales-agent-screens.html`](../features/sales-agent-screens.html): the merchant's screens.
- [ADR 0030](0030-agent-runtime-v3.md): the runtime.
- [ADR 0026](0026-store-whatsapp-gateway.md): the store's WhatsApp.
- [`features/whatsapp-bot.md`](../features/whatsapp-bot.md): the P-017 tracking file.
