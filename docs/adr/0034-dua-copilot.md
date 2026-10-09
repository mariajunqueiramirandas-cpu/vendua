# ADR 0034: Duá Copilot, Duá working for the store's people in the admin

- Status: Accepted (built 2026-10-06, Core migration 0089); the WhatsApp door accepted and built
  2026-10-07 (Core migration 0101)
- Date: 2026-10-06

## Context

Duá sells to shoppers on the store's WhatsApp ([ADR 0031](0031-vendedor.md)). The people who run
the store still answer their own questions by opening screens: Início for today, Relatórios for a
week, Cardápio for stock, Loja to pause. The owner said (2026-10-01) that our merchant AI is "a
copilot inside the Venduá admin", with no Claude, ChatGPT or MCP integration
([`competitors/dominio-tech.md`](../competitors/dominio-tech.md) §4.2–4.3 proposed its shape).
The owner asked for it to be built on 2026-10-06.

Every admin route's logic was an inline closure. An assistant that reimplemented reads and
writes would drift from the screens: a different revenue number from Relatórios, a pause that
skips the billing-hold check, a price change with no audit row.

## Decision

**Duá answers from the admin's own routes and changes nothing by itself.** The owner's
decisions on 2026-10-06:

1. **Only Pangolim has it.** The plan feature is `copilot` (`plans.features`, staff-editable in
   the CRM like the others). Pilot plans don't have it. Other plans see the screen as the upsell.
2. **Its own daily cap, not the shoppers' allowance.** Copilot turns never claim
   `ai_conversations`. Cost is bounded per store per day by the budget key `copilot` in
   `agent_runtime.budgets`, which staff set in the CRM. No limit set means no cap, as for the
   other keys.

Amended 2026-10-07, the owner's call: **Duá also answers by WhatsApp.** Managers and owners who
turn it on in Perfil message a Venduá number by text or voice note and reach the same
conversation, tools and cards. A card is applied by a "SIM" reply that Core matches against a
closed grammar before the model sees it, through the same `decideTx` and the same role, expiry and
basis checks as the tap. The model still applies nothing. The design, including the platform
WhatsApp on the gateway it needs first, is
[`features/dua-no-whatsapp.md`](../features/dua-no-whatsapp.md). Built 2026-10-07: a yes by
WhatsApp is audited as "<name> pelo Duá (WhatsApp)", and cards that touch money (prices, coupons)
are confirmed only in the admin until the owner decides otherwise.

How it works:

- **Who.** Managers and owners. One conversation per person: the actor's subject is
  `copilot:<merchant_users.id>`. A tool re-reads the person and their role on every call, so a
  person removed from the team or demoted gets what their access allows now.
- **One producer.** `POST /admin/v1/copilot/messages` inserts the message and calls `dispatchTx`
  in the same transaction (`source: admin:<user id>`). The agent is `copilot` on Runtime v3, with
  the `interactive` lane and its own `copilot` transport. Replies are `copilot_messages` rows
  written in the step's transaction, and the SSE topic `copilot` (id = user id) refreshes the
  admin.
- **Routes as functions.** `handlers(d).named(name).read/write(role, fn)` is the same handler as
  `read/write(role, fn)`, also listed by name (a name used twice in one mount throws).
  `runRoute(tx, name, tenant, merchant, replay)` runs that handler inside a caller's tenant
  transaction, through a stand-in context that serves `req.param`, `req.query` and the replayed
  body (`bodyOf(c)`). The route's role check runs too. The named reads are home, reports,
  catalog, orders, order, marketing, store, customers and kitchen. The named writes are
  `store.pause`, `store.resume`, `store.patch`, `product.patch`, `products.bulk`,
  `coupon.create` and `coupon.patch`.
- **Read tools** (`store_now`, `sales_report`, `find_orders`, `menu`, `coupons`,
  `top_customers`, `kitchen_today`, `store_settings`) format those routes' answers. Every amount,
  percentage and time is a ledger figure, and the `grounded()` guard blocks a typed one, the same
  money rule as the Vendedor. Customer phones never reach the model.
- **Proposals, never writes.** A `propose_*` tool calls `proposeTx`. It runs the named write
  route once in a savepoint that is always rolled back. That run surfaces the route's own refusal
  (validation, `BILLING_HOLD`, `COUPON_EXISTS`) and reads the state after it. The tool then
  inserts a `copilot_actions` row with the card's title and its from → to lines. The proposal
  kinds:

  | Kind                | Change                            |
  | ------------------- | --------------------------------- |
  | `store.pause`       | pause the store                   |
  | `store.resume`      | resume the store                  |
  | `store.operations`  | prep time, the high-demand notice |
  | `store.special_day` | close on a day, or special hours  |
  | `product.update`    | price, availability, stock        |
  | `products.price`    | a percentage across products      |
  | `coupon.create`     | a new coupon                      |
  | `coupon.update`     | activate, end date, use limit     |

- **The tap is the only apply** (and, once the WhatsApp door is built, a "SIM" through the same
  `decideTx`; see the 2026-10-07 amendment). `POST /admin/v1/copilot/actions/:id {decision}` runs in the
  request's idempotency claim. It locks the row and checks it is that person's (404 otherwise),
  still `proposed`, not past `expires_at` (30 minutes), and allowed for their role. It then runs
  the route for real, as the merchant named "<name> pelo Duá". Before that it re-reads the
  values the card showed as "from" (its `basis`: the prices, the product's fields, the coupon's,
  the prep time, that day's hours) and refuses on any change, so a tap never applies to values
  nobody saw. The route's audit row and
  `emitAdminTx` are therefore the screen's own, and "Quem mudou o quê" shows who asked through
  Duá. A store refusal at that moment is recorded on the card (`failed`, pt-BR reason), not
  thrown, so a retry replays it. A special day merges into the list as it is at confirm time,
  never a stale copy.
- **Out of scope**: cancelling or refunding orders, payments, team, plan and appearance. Duá
  names the screen instead.
- **Online QA** skips Copilot: its rubric scores a seller talking to shoppers.

Added 2026-10-09: **voice messages and photos, in the admin and on WhatsApp.** The admin's
composer records a voice message or attaches a photo; `POST /admin/v1/copilot/messages/media`
(`{ kind: 'voice' | 'image', mime, data, text?, screen? }`, base64, 2 MB) hears or reads it before
the idempotency claim (a replay answers from the claim, as `POST /media` does) and then writes the
same message and mailbox row as a typed one (`copilotInboundTx` in `src/copilot/media.ts`, which
the WhatsApp door uses too, now that the platform gateway also downloads photos).

- **Duá reads text only.** A voice message is its transcript (the Vendedor's STT, the store's
  product names as hints; below 0.6 confidence it is marked so Duá repeats what it heard). A photo
  is shrunk to a metadata-free WebP and read once by a `fast` model (`readStaffPhoto`: what it
  shows and its legible text, verbatim); Duá gets that reading between `[foto enviada; …]` and
  `[fim da foto]`, followed by the caption. Bytes never enter the event log, and the money rule
  holds: prices read from a photo go only into proposals, never into Duá's words.
- **The photo stays for the screen**: `copilot_media` (migration 0115, tenant RLS), served to its
  sender alone by `GET /admin/v1/copilot/media/:id`, deleted with its message by "Nova conversa".
- **Bounded**: 60 voice messages and photos per person per day, both doors (the reading calls are
  outside the `copilot` budget, which counts turns). `GET /copilot` says what this Core can take
  (`media: { voice, image }`), so the mic shows only with a transcription route configured.

## Consequences and known risks

- The route registry is module-level: last mount wins. Production mounts one admin app per
  process. Tests mount the same code several times, which is harmless because every handler
  takes its database from the transaction it is given.
- A new named route must only use `c.req.param`, `c.req.query` and `bodyOf(c)` from its context.
  Anything else (headers, `c.get`) is missing in a replay.
- A dry run is only as side-effect free as the handler. The named writes do database work and
  `pg_notify` only, both rolled back with the savepoint. A future handler that calls out over HTTP
  must not be named.
- A sale that draws stock, or anyone editing a price, between the proposal and the tap fails the
  card ("isso mudou"); the person asks Duá again and sees the values of now.
- A turn queued before a downgrade or a suspension reads and proposes nothing: the tools check the
  plan and the store on every call.
- With no model route configured, a turn fails after its attempts and Duá's fallback line is
  written, so the admin never waits forever.
