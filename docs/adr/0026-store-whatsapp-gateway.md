# ADR 0026: Each store's own WhatsApp, on a Baileys gateway

- Status: Accepted (implemented 2026-10-02, Core migration 0076)
- Date: 2026-10-02

## Context

Shoppers got no word about their order unless they kept the order page open or the merchant
tapped the WhatsApp link by hand ([`competitor-parity.md`](../competitor-parity.md), P-017's
neighbour). `transitionOrder` already wrote `order.*` rows to `outbox` that nothing read. Every
food competitor that leans on WhatsApp sends these updates, from the store's own number.

[`features/whatsapp-bot.md`](../features/whatsapp-bot.md) left the transport open: Meta's
official Cloud API per store (templates, a 24 h window, per-message charges, Embedded Signup,
coexistence limits on the merchant's own number) or an unofficial WhatsApp Web client like the
Baileys socket the sales agent already runs on the platform number. The user chose the
unofficial client, per store, built to run unattended (2026-10-02).

## Decision

**A store links its own number as a device.** The merchant asks for a code in the admin
(WhatsApp → gerar código), types it in WhatsApp → Aparelhos conectados → Conectar com número de
telefone, and keeps using WhatsApp on the phone as before. Venduá is one more linked device, like
WhatsApp Web; shoppers' replies land on the merchant's phone.

**A separate process, `wa-gateway`, runs the sockets** (`packages/core/src/wa-gateway.ts`, Core's
image with its own entrypoint). A Core deploy or crash never drops the stores' connections, and a
Baileys crash never takes checkout down. The sales agent's platform socket
(`agent/channels/whatsapp.ts`) is unchanged.

**Postgres is the only channel between Core and the gateway.** There is no HTTP between them:

- `store_whatsapp` (one row per store) holds what the merchant wants (`wanted`, a pairing
  request, a disconnect request, which steps to send) and what the socket is doing (`state`,
  `detail`, the pairing code, the linked number). Core writes the first half, the gateway the
  second.
- `store_wa_messages` is the outbound queue. Core inserts in the transaction that commits the
  order step, so a message exists only if the step does, and `(order_id, event)` is unique, so a
  replayed step never texts twice.
- `LISTEN vendua_wa` (triggers on both tables) wakes the gateway; a 5 s tick catches anything a
  notification missed.

**Leases spread stores across gateways, and an epoch fences every write.** A gateway claims a
store that needs a socket by setting `owner`, bumping `lease_epoch` and holding `lease_until`
(renewed every tick, 45 s). Each auth write, state report and send claim first checks
`owner + lease_epoch` under `FOR SHARE`, so a process that lost the lease mid-flight can't
corrupt the login the new owner is running. SIGTERM closes every socket (keeping the logins) and
hands the leases back. Capacity is `WA_MAX_SESSIONS` per process; more replicas take the rest.

**The login is sealed at rest.** `store_wa_auth` holds the linked device's Signal state, each
row AES-256-GCM sealed under `VENDUA_SECRETS_KEY` (else the `SESSION_SECRET`-derived key), like
Mercado Pago tokens. It is as strong as the merchant's phone. Every table has `tenant_id` and the
usual `tenant_isolation` + `control_access` policies.

**Sending is at-least-once with WhatsApp-side dedupe.** A message's WhatsApp id is derived from
its row id (`messageIdFor`). A gateway that dies after sending but before marking the row sent
leaves it `sending` with a lapsed lease; the next claim sends it again with the same id, and
WhatsApp shows it once. Failures retry at 30 s, 2 min, 8 min, 30 min, up to 5 attempts; a number
not on WhatsApp fails at once. Brazilian mobiles registered without the 9th digit are found by
probing both forms (`onWhatsApp`). Messages expire 6 h after they were queued: a "saiu para
entrega" that late is worse than none. Rows are kept 30 days.

**Core writes every word.** `store-whatsapp/messages.ts` renders each step from Core's own
figures (money is integer cents formatted by Core; times in the store's timezone). The merchant
chooses the steps: by default pedido recebido, pagamento confirmado, aceito (with the promised
time), pronto para retirar (pickup only), saiu para entrega and cancelado. The admin previews each
one on a sample order. Each message ends with the order's page on the store's own address,
`/pedido/<id>?t=vot.…` (amended 2026-10-06): a 30-day, tenant-bound token that reads only the
order's status, promised time, steps, items with their notes and the store's name. It never shows
the shopper's name, phone, address or payment details, and pay, card and reorder refuse it; the
device's cart session still reads everything. The Kernel strips it from the address bar and keeps
it on the device. Anyone the message is forwarded to sees the same status-only page.

**Shoppers can stop it.** The first message a store sends a number ends with "responda SAIR". A
bare SAIR/PARAR/STOP from a number the store texted about an order in the last 90 days records an
opt-out and an acknowledgement; VOLTAR undoes it. Anything else is the store's conversation: the
gateway doesn't store or read it, and it ignores groups, broadcasts and channels entirely.

**Bounded against bans and runaways.** Only order updates to people who ordered, the merchant's
own test, and (amended 2026-10-06, the owner's call) two messages a shopper asked for: the bag
reminder (one per bag, only after an explicit opt-in at checkout, off by default per store, never
for stores with the Vendedor, which recovers carts itself) and the "avise-me quando abrir" notice.
Both carry the SAIR footer, honour SAIR, queue behind order updates, expire after 1 h and have
their own hourly ceilings (20 reminders, 60 opening notices; one reminder per number a week). Per store: a pause between messages (`WA_MIN_SEND_GAP_MS`, 1.5 s plus
jitter) and an hourly ceiling (`WA_MAX_PER_HOUR`, 200). The device never marks itself online, so
the merchant's phone keeps its notifications. History sync is limited to the bootstrap Baileys
needs for its LID↔number map.

**Everyone hears about trouble.** The gateway reports connected, dropped (after 6 failed
reconnects), back, unlinked by the phone (401) and refused (403) as `whatsapp.store` staff events
in the store's transaction; unlinked and refused also push the store's owners and managers
("WhatsApp da loja desconectado"). Core watches the gateways' heartbeat (`wa_gateways`): when
stores want their WhatsApp and none has beaten for 2 min, the team gets
`channel.down whatsapp_lojas`, and `channel.up` when one is back. The admin tells "your WhatsApp
is reconnecting" from "Venduá's WhatsApp service is down" from the same data.

## Consequences

- A store can send order updates from its own number with no Meta approval, template review or
  per-message charge, and the merchant keeps the Business app.
- It is unauthorised by WhatsApp's terms. A number can be restricted (403); the gateway then stops
  that store and tells the merchant and the team. The pacing and the narrow scope reduce the risk;
  they don't remove it. Broadcasts and campaigns (P-018) must not run on this transport. The bag
  reminder and the opening notice widen the scope a little past order updates; the owner accepted
  that risk for stores that turn the reminder on.
- WhatsApp unlinks devices of a phone that stays offline for weeks; the store then shows
  "desvinculado" and the owner is pushed to re-pair.
- Baileys follows WhatsApp Web's protocol and breaks when it changes. The gateway deploys from
  Core's image, so an upgrade is a normal deploy; a version that can't link shows up as stores
  stuck in `error`.
- The transport sits behind `WaRuntime`/`StoreSession`, so a per-store move to the Cloud API, or
  a shopper ordering bot on top of `onInbound`, doesn't touch the queue or the order code.
- Shoppers' phones and message bodies are stored per store for 30 days, under RLS. Staff events
  carry only the store's name and the step, never a shopper.
