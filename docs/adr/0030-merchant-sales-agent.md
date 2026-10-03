# ADR 0030: A shopper-facing sales agent with its own turn engine

- Status: Proposed
- Date: 2026-10-02
- Design: [`features/merchant-sales-agent.md`](../features/merchant-sales-agent.md)

## Context

Most food competitors ship a WhatsApp bot that takes shoppers' orders (P-017). The strongest ones
now handle voice notes, Pix in the chat and a human takeover
([research](../research/shopper-sales-agents-2026-10/README.md)). Stores can already link their
own WhatsApp ([ADR 0026](0026-store-whatsapp-gateway.md)), but the gateway reads only SAIR and
VOLTAR from shoppers.

The obvious path is the CRM agent's engine (ADRs 0014–0017): queued runs with step budgets,
journal replay, a workspace autonomy slider, drafts for approval, agent-written memory, wakeups
and a single model. It was built for a founder working B2B leads over days. A shopper waits
seconds, hundreds of them talk to one store on a Friday night, and every message about money binds
the store. The user asked for a new design rather than the CRM's.

## Decision

1. **A separate product and engine.** `packages/core/src/seller/` with its own tables and its own
   process. It reuses the LLM provider seam and the scripted-provider test pattern from `agent/`,
   and nothing else. The CRM agent is unchanged.
2. **Turns, not runs.** A turn is short and runs in a per-conversation actor. It waits for the
   shopper's burst to settle, makes one model call with parallel read tools, and ends on exactly
   one terminal action (`reply`, `react`, `handoff`, `stay_silent`). It has a latency budget in
   seconds, and it restarts when the shopper writes again before the reply goes out. Nothing is
   replayed after a crash: every side effect is keyed (cart lines by `lineKey`, orders by quote,
   messages by `turnId + part`), so a turn just runs again.
3. **One entry point.** Turns start only through `requestSellerTurnTx` (`seller/dispatch.ts`) with
   a `source`. When this ships, `CLAUDE.md` adds the invariant beside `requestAgentTx`.
4. **A `seller-worker` process** from Core's image, like `wa-gateway`. It claims conversations
   with a lease and an epoch fence, has per-store concurrency caps, and drains on SIGTERM.
   Postgres stays the only channel between the gateway, the worker and Core.
5. **The Core cart is the conversation's state.** The worker creates a normal cart server-side and
   calls the same module functions as the checkout routes, inside `withTenant`. The model reads the
   cart every turn; it does not remember the order.
6. **Money by reference.** The model's text can name an amount only as a reference
   (`{{total}}`, `{{price:<id>}}`, …) that Core fills in. Summaries, Pix codes and product captions
   are Core-rendered parts. A guard rejects raw figures. "Money is computed only in Core" now
   covers prose too.
7. **A commit gate in code.** `place_order` requires all four of these:
   - the last agent message was a `confirm` for this quote, with no other question in that turn
   - the cart and quote hash are unchanged
   - a yes from the shopper arrived after it
   - the order goes through `placeOrderTx` with the key `seller:<thread>:<hash>`, using the
     existing claim pattern
8. **Coverage modes instead of autonomy levels.** The modes are Ensaio (shadow drafts with an
   agreement score), Quando eu demorar, Fora do horário and Sempre. On top of them are
   per-skill permissions in plain words. There are no approval drafts, because a shopper can't
   wait for one.
9. **The merchant's phone is the console.** A message the merchant sends from the phone pauses the
   agent in that chat. A handoff marks the chat unread (and labels it on WhatsApp Business). The
   admin's Conversas screen has the same controls.
10. **Memory the merchant approves.** Store knowledge is made of cards the merchant writes or
    approves from proposals. Shopper preferences are derived from orders, plus non-sensitive
    stated preferences. Live facts are never memory. Health data is never stored.
11. **Two model tiers chosen per turn by deterministic signals.** A per-store prompt prefix is
    cached across all of that store's shoppers. Failover goes to the other tier, then to link
    mode. This ADR fixes the tiering, not the model ids.
12. **ADR 0026 is amended for stores with the agent on.** The gateway stores inbound messages
    (text, voice, image, location), the merchant's own phone replies and presence. It sends
    replies on a separate **reply lane** with its own pacing. Its limits are the user's decision
    (ban risk). Broadcasts and campaigns stay off this transport. Proactive messages are only the
    narrow, event-driven ones in the design's §4.11.
13. **Evaluation per store.** Scripted CI cases cover the gates. **Cliente oculto** runs ~20
    synthetic shoppers on the store's own menu, each with a hidden target cart, and scores the
    placed order line by line. The merchant sees the result before going live.

## Consequences

- New tables, all with `tenant_id`, RLS and `control_access`: `seller_settings`,
  `shopper_threads`, `shopper_messages`, `seller_turns`, `seller_knowledge`, `shopper_prefs`,
  `seller_signals` and `seller_evals`. Also new: `orders.source` (shared with the iFood work), and
  `store_wa_messages` gains the `reply` kind, `parts` and `thread_id`.
- The `LlmProvider` seam gains structured output, image input, and cached-token accounting kept
  apart from fresh tokens. A `stt` driver joins the integrations.
- New admin surfaces (Vendedor, Conversas, Ensinar, Cliente oculto, Configurar) follow the admin's
  design system. They deliberately share nothing with the CRM's agent screens.
- Staff events gain `seller.*` kinds, with no shopper data.
- Some Baileys behaviours must be verified before M0: typing without going online, marking a
  chat unread or labelling it from a linked device, reactions, location messages, and voice-note
  downloads. Where one fails, the feature degrades as the design describes.
- Sending shoppers' messages to an LLM and a speech provider needs those providers'
  data-processing terms and a line in each store's privacy notice.
- Open for the user: plan and price, reply-lane limits, push for handoffs, retention, orders from
  new numbers without prepayment, the bottom-bar slot and name, and providers (design §12).
