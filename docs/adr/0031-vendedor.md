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
   - **Pacing.** Replies inside a conversation the shopper started have no ceiling (owner,
     2026-10-03). ADR 0026's 200-an-hour ceiling stays for messages the store starts, and the
     gap between sends applies per conversation.
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
   - **Allergies and dietary restrictions** may be remembered (owner, 2026-10-03). They are
     kept only after the shopper agrees, confirmed on every later use, never used to sell, and
     erasable by the shopper or the merchant.
   - **Providers:** any provider, but only through its zero-data-retention arrangement, which
     the gateway enforces per route (owner, 2026-10-03). Transcription, vision and voice
     providers are included. No training on conversations, and no phone numbers sent to model
     providers.
9. **The admin design spec changes** (decided by the owner on 2026-10-03; the first two are
   already applied to [`merchant-admin-design.md`](../merchant-admin-design.md)):
   - a shopper waiting for the merchant may push (law 13);
   - while it is on, the phone bar is Início · Pedidos · Vendedor · Cardápio · Mais, and Loja
     moves to Mais;
   - new components join §7 when the screens are built.
10. **Disclosure is the merchant's switch** (decided by the owner on 2026-10-03). On, it
    introduces itself as "<name>, assistente virtual da <loja>"; off, by name only. Either way
    it never claims to be a person, says it is the store's assistant when asked, and the
    verifier blocks a reply that claims otherwise.
11. **Its own onboarding, separate from the store's** (owner decision, 2026-10-03).
    - "Treinar a Ana" (`/vendedor/comecar`, [UX §3.12](../features/sales-agent-ux.md#312-treinar-a-ana-vendedorcomecar-new))
      runs after the store's journey, never inside it: Conhecer · Ensinar · Testar · Começar.
    - Ana guides it herself, reads the store, flags menu gaps that Core computes, interviews
      the owner and tests herself.
    - Its interviewer is a second agent on the runtime that only proposes. Every answer, rule
      or fix lands only when the owner confirms it.
12. **Phases V0 to V4**, each with exit gates measured by order-accuracy simulations and pilot
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
  raises the ban risk ADR 0026 accepted. With no ceiling on replies (the owner's call), that
  risk grows with volume. The reply-only scope, per-conversation pacing and the V4 official API
  reduce it; they don't remove it.
- Zero data retention narrows the provider list to those that offer it, and turns off any
  provider feature that stores data on their side.
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

Decided by the owner on 2026-10-03:

- **The phone bar:** yes (decision 9).
- **The push for a waiting shopper:** yes (decision 9).
- **Disclosure:** a merchant switch (decision 10).
- **How AI is charged:** deferred. It includes Cliente oculto runs, and no prices go in these
  docs until it is decided.
- **No reply limits** (decision 5).
- **Providers:** any, under zero data retention (decision 8).
- **Allergies:** remembered with consent and always confirmed (decision 8).
- **Its own onboarding**, separate from the store's (decision 11).

Still open, for the owner (the full lists are in
[`sales-agent.md` §10](../features/sales-agent.md#10-open-decisions) and
[`sales-agent-ux.md` §10](../features/sales-agent-ux.md#10-open-decisions)):

1. **Retention.** How long Venduá keeps message text, media, model inputs and outputs, and event
   metadata in its own database. The recommendation is in `sales-agent.md` §10.
2. **Defaults.** Every setting's value when a merchant first turns it on. The recommendation is
   in `sales-agent.md` §10.
3. **The product's name** in the admin, on the site and on plan pages ("Vendedor" is the working
   name; each merchant names their own agent).

## Links

- [`features/sales-agent.md`](../features/sales-agent.md): the design.
- [`features/sales-agent-features.md`](../features/sales-agent-features.md): every feature, by
  phase.
- [`features/sales-agent-ux.md`](../features/sales-agent-ux.md) and
  [`sales-agent-screens.html`](../features/sales-agent-screens.html): the merchant's screens.
- [ADR 0030](0030-agent-runtime-v3.md): the runtime.
- [ADR 0026](0026-store-whatsapp-gateway.md): the store's WhatsApp.
- [`features/whatsapp-bot.md`](../features/whatsapp-bot.md): the P-017 tracking file.
