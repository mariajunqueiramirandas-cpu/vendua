# WhatsApp ordering bot (P-017)

> Status: Tracked, not planned · Started 2026-10-01 · Gap: [P-017](../competitor-parity.md) (related: P-018 broadcasts, P-001 abandoned cart)

A bot on the **merchant's** WhatsApp that takes shopper orders in chat. Not the
sales agent that talks to leads (`agent/channels/whatsapp.ts`); that one is a
different product on Venduá's own number.

## What competitors ship

Y = stated by the vendor's page (marketing claim, not verified), ? = not
stated, V = vague. Only the stated column is evidence.

| Capability               | Anota AI | Goomer | Cardápio Web                                | OlaClick | Delivery Direto          | Takeat             | Instadelivery |
| ------------------------ | -------- | ------ | ------------------------------------------- | -------- | ------------------------ | ------------------ | ------------- |
| Takes full order in chat | Y        | Y      | Y                                           | Y        | N (sends the store link) | Y                  | N             |
| Menu and photos          | Y        | Y      | Y                                           | Y        | link                     | V                  | link          |
| Modifiers                | ?        | ?      | Y                                           | ?        | web store only           | ?                  | ?             |
| Address and delivery fee | ?        | Y      | Y                                           | ?        | web checkout             | ?                  | ?             |
| Pix in chat              | ?        | V      | Y                                           | V        | web checkout             | ?                  | ?             |
| Status updates           | Y        | Y      | Y                                           | V        | ?                        | Y                  | ?             |
| Human handoff            | Y        | Y      | Y                                           | Y        | ?                        | ?                  | ?             |
| Voice / audio            | Y        | ?      | ?                                           | ?        | ?                        | ?                  | ?             |
| Upsell                   | ?        | ?      | ?                                           | Y        | ?                        | ?                  | ?             |
| FAQ and opening hours    | V        | Y      | Y                                           | Y        | store status             | ?                  | ?             |
| Abandoned-order recovery | ?        | ?      | Y                                           | ?        | Y (15 min nudge, coupon) | cashback campaigns | ?             |
| Broadcasts               | Y        | ?      | Y (separate tool)                           | ?        | Y                        | Y                  | Y             |
| Multi-attendant inbox    | ?        | ?      | ?                                           | ?        | ?                        | ?                  | ?             |
| Transport                | ?        | ?      | WhatsApp Web extension (older bot); newer ? | ?        | official API, stated     | ?                  | ?             |

Also relevant: **iFood Ailo** (public test since 2025-10-10) takes an order by
text or audio on WhatsApp but sends the shopper to the iFood app to pay.
Brendi and Zaia exist but were not verified from primary pages.

Market observations: audio is stated only by Anota AI and Ailo; no vendor
states a multi-attendant inbox; several "bots" only send a link. The
table-stakes core is menu, order taking, status updates and human handoff.

## Feature checklist for Venduá

Proposed, not decided. Order is a suggested build sequence.

- [ ] Per-tenant WhatsApp connection (merchant number) and health in the admin
- [ ] Inbound message handling with the merchant's menu as context
- [ ] Menu and photos in chat; modifiers and combos by id
- [ ] Address capture and zone quote (reuse `/quote`)
- [ ] Order placement through the existing checkout path, with idempotency
- [ ] Pix `copyPaste` in chat; payment confirmation back to the chat
- [ ] Shopper status updates on every order transition
- [ ] Human handoff and a merchant inbox
- [ ] FAQ and opening hours from store settings
- [ ] Opt-in capture and template messages outside the 24 h window
- [ ] Audio understanding, upsell, abandoned-order recovery (differentiators)

## Platform constraints (Meta, official docs)

- **24 h window:** free-form replies only within 24 h of the shopper's last
  message; after that only approved templates. Templates are reviewed (up to
  24 h) and can be paused by quality rating.
- **Opt-in** is required to message shoppers. Brazil-specific rules (LGPD
  interplay): not found, needs a legal read.
- **Catalog and orders:** catalog and multi-product messages exist (up to 30
  products per message) and an order arrives as an order message. Modifiers are
  not a native catalog concept, so options need WhatsApp Flows or conversation
  logic.
- **Pix:** Meta's Brazil payments flow sends an `order_details` message with a
  `reference_id`; the shopper pays by Pix copy-and-paste; the business sends
  `order_status`. WhatsApp does not reconcile, we would, by `reference_id`.
- **Coexistence** (keep the Business app on the same number) needs a Solution
  Partner or Tech Provider, caps throughput at 20 messages per second and does
  not support catalogs or orders. The app must be opened at least every 13 days
  (third-party source).
- **Cost:** Meta announced per-message charges for service and utility messages
  from 2026-10-01 and token-based billing for its own agent. Rates not
  verified; do not assume in-window replies stay free.
- **Unofficial clients** (what our current transport is) are unauthorised and
  carry number-ban risk per secondary sources. A news report says Meta's API
  terms bar general-purpose chatbots from 2026-01-15; a task-specific order bot
  is likely fine but the policy text must be read.

## What we already have

| Piece              | State                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport          | Per store since [ADR 0026](../adr/0026-store-whatsapp-gateway.md): the `wa-gateway` links each store's own number (Baileys). Inbound text reaches `StoreSession.onInbound`; only SAIR/VOLTAR are acted on today. |
| Order birth        | `placeOrderTx` (`modules/place-order.ts:22`), single entry point, behind `idempotency()` in `platform/http.ts`. Orders have no `source`.                                                                         |
| Catalog            | `GET /catalog`, `/products/:slug`, modifiers with min/max, pricing rules and quantities, combos, availability schedules                                                                                          |
| Quote and cart     | `/session`, `/cart/items`, `/cart/delivery`, `/quote` (cart session, shopper identified by phone, ADR 0019)                                                                                                      |
| Pix                | `createPix` returns `copyPaste` (`payments/provider.ts`); static-key fallback in `modules/pix.ts`                                                                                                                |
| Order transitions  | Each step queues a `store_wa_messages` row in its own transaction; the store's WhatsApp sends it (ADR 0026)                                                                                                      |
| Merchant alerts    | push plus a WhatsApp fallback to owners (`admin/workers.ts`)                                                                                                                                                     |
| Planned, not built | WhatsApp Cloud API templates for order status (`architecture/01-core.md:104`)                                                                                                                                    |
| ADR / roadmap      | none for a shopper bot; roadmap Phase 7 "WhatsApp intake agent" is merchant onboarding                                                                                                                           |

## Open decisions

1. **Transport.** Decided (2026-10-02): the unofficial client per store, on the
   `wa-gateway` ([ADR 0026](../adr/0026-store-whatsapp-gateway.md)). Order
   updates run on it; an ordering bot would sit on its `onInbound` hook.
2. **Whose number?** Merchant's own (coexistence limits apply) or a Venduá
   number per store.
3. **Scope.** Link-sender (cheap, what Delivery Direto does) versus full
   in-chat ordering (what most primary competitors claim).
4. **Cost model.** Who pays Meta's per-message charges.
5. **Shared dependency:** orders need a `source` column; the iFood work needs
   the same ([ifood-integration](ifood-integration.md)).

## Sources

Vendor pages: anota.ai/home/funcionalidade/atendente-virtual/,
anota.ai/ajuda/robo-automacao-whatsapp/, goomer.com.br/blog/chatbot-delivery,
cardapioweb.com/chatbot/, ajuda.cardapioweb.com/automacao/chatbot-cardapinho,
olaclick.com/sistema-para/pizzaria/chatbot-ia-pizzaria/,
site.deliverydireto.com.br/recuperador-de-pedidos, takeat.app/solucoes,
blog.instadelivery.com.br/disparos-whatsapp-instadelivery/, canaltech (Ailo).

Meta (developers.facebook.com/documentation/business-messaging/whatsapp/):
`messages/send-messages`, `templates/overview`, `pricing`,
`pricing/non-template-messages`, `payments/payments-br/overview/`,
`catalogs/catalogs-overview/`, `flows/guides/implementingyourflowendpoint`,
`embedded-signup/onboarding-business-app-users/`. Third party: 360dialog
coexistence docs, omnichat unofficial-API article, Yahoo Tech news item.

## Change log

- 2026-10-01: first pass.
