# Duá no WhatsApp do dono, and Venduá's own numbers on the gateway

> Status: Proposed, not planned · Started 2026-10-07 · Kind: differentiator · Builds on:
> [ADR 0034](../adr/0034-dua-copilot.md) (Copilot), [ADR 0026](../adr/0026-store-whatsapp-gateway.md)
> (the gateway), [ADR 0037](../adr/0037-self-hosted-stt.md) (voice),
> [ADR 0020](../adr/0020-merchant-identity.md) (merchant identity) · Needs: an amendment to ADR 0034

Owners run the store from the kitchen with their hands full. Duá Copilot works, but only inside the
admin. This feature lets owners and managers talk to the same Duá on WhatsApp, typing or sending a
voice note to a Venduá number:

- "acabou o pudim de leite" → the pudim is sold out until tomorrow.
- "pausa o delivery 20 minutos" → delivery is paused.
- "quanto vendi hoje?" → today's sales.

It uses the same tools, the same conversation and the same confirm-to-apply cards. On WhatsApp,
confirming means replying "SIM".

It needs groundwork first. Venduá's own WhatsApp, the CRM's number, which also sends the sign-in
codes, runs on a Baileys socket inside the Core process. It moves onto the gateway process the
stores already use, generalized so the gateway can hold platform sessions next to store sessions.
That move is worth doing on its own, and it is Part A. Part B is Duá.

Paths are under `packages/core/` unless they start with `apps/`, `packages/` or `docs/`.

## Summary

- **Part A: one gateway for every number.** `wa-gateway.ts` holds sessions owned by a store (as
  today) or by the platform. The CRM's socket in `agent/channels/whatsapp.ts` is retired: its
  inbound, history, LID mapping, outbound, pairing and health go through Postgres tables, as the
  store sessions' do. What the CRM gains: sealed credentials, a lease, pacing, deploys that don't
  drop the session, and Core free to run more than one instance.
- **Two platform numbers, recommended.** "Venduá Vendas" for CRM outreach, and "Venduá Lojas" for
  sign-in codes, notices and Duá. Today one number does cold outreach and sends every owner's
  sign-in code. A restriction caused by the outreach would lock owners out.
- **Part B: Duá by WhatsApp.**
  - **Who's asking.** The sender's phone is matched to its memberships through
    `merchant_memberships_for_phone`, the same proof the WhatsApp OTP relies on, and the person
    must have turned the WhatsApp door on in the admin.
  - **One conversation.** The message enters the person's existing Copilot conversation through
    `dispatchTx`.
  - **Replies** go back by WhatsApp.
  - **Cards** are rendered as text. "SIM" is matched by Core, not the model, and applied with the
    same `decideTx` the admin tap uses.
- **Voice notes** reuse the self-hosted STT the Vendedor uses (`vendedor/media.ts`), which takes no
  tenant.

## 1. Why

- **Owners are away from the admin.** A pizzaiolo with floury hands won't open a PWA to mark a
  product sold out, but will send a 4-second voice note.
- **Owners already write to our number, and we drop it.** The CRM ingest drops any message from a
  merchant phone (`agent/inbound.ts:65-69`): "a 'valeu' back is not a sales lead". So a reply to a
  billing notice or a sign-in code vanishes without a trace.
- **The Copilot is ready for a second door.** `decideTx` is a pure function of
  `(tx, Tenant, Merchant, id, decision)` (`copilot/actions.ts:719-767`). Its reads go through the
  admin's own routes, which enforce their roles, and `who()` re-reads the person on every tool call
  (`agent-host/agents/copilot/shared.ts:27-61`).
- **ADR 0034's context** quotes the owner (2026-10-01): our merchant AI is "a copilot inside the
  Venduá admin". This proposal adds a door outside the admin, so the owner amends that ADR or says
  no. Same Duá, same tools, nothing applied without the person's yes.

## 2. What it feels like

### The owner

```
Dono (áudio 0:04): "acabou o pudim de leite"
Duá:  Entendi "acabou o pudim de leite".
      Marcar Pudim de leite como esgotado até amanhã às 8h?
      Responda SIM para aplicar (vale até 21h40).
Dono: sim
Duá:  Feito: Pudim de leite esgotado até amanhã às 8h.
Dono: quanto vendi hoje?
Duá:  Hoje: 38 pedidos, R$ 1.912,40. Sexta passada no mesmo horário: R$ 1.640,00.
```

- **Several stores:** "Você fala por qual loja? 1 Quero Pudim · 2 Quero Pudim Centro". The choice
  sticks until the person sends `#loja`.
- **In the admin**, the Copilot screen shows the same conversation, and WhatsApp messages carry
  "pelo WhatsApp". A card applied by "SIM" shows as applied in both places.
- **Turning it on:** Perfil → "Duá pelo WhatsApp", off by default. It shows the Venduá Lojas
  number with a "salvar contato" link and a wa.me link that opens the chat with "oi".

### The Venduá team

- **CRM → Config → WhatsApp** pairs and watches both platform numbers, as it pairs one today. The
  state comes from the gateway's tables instead of the socket's memory.

## 3. What we already have

| Piece                    | Where                                                                                                                                                                                                                                                         | Note                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Copilot actor            | `agent-host/agents/copilot/index.ts:65-137`: lane `interactive`, transport `copilot`, budget `tenantDaily:'copilot'`; subject per `merchant_users.id`                                                                                                         | One conversation per person, whatever the door                      |
| Copilot entry            | `POST /admin/v1/copilot/messages` (`admin/routes-copilot.ts:33-62`): `write('manager')`, `requireFeature('copilot')`, `copilot_messages` row + `dispatchTx` (source `admin:<userId>`, dedupe `copilot:<rowId>`)                                               | The WhatsApp path does the same in the inbox consumer's transaction |
| Cards                    | `copilot_actions` (0089): `kind`, `title`, `lines`, `basis`, `money`, `min_role`, `status`, `expires_at` (30 min); `proposeTx`, `decideTx`                                                                                                                    | Rendered as text; "SIM" → `decideTx`                                |
| Identity                 | `merchant_users` (`unique(tenant_id, phone)`, national digits), `merchant_memberships_for_phone()` (0052, SECURITY DEFINER, the only cross-tenant read), `isMerchantPhone` (`admin/phones.ts:5`)                                                              | One phone can belong to several stores                              |
| OTP by WhatsApp          | `startOtp` → `whatsappOtpSender` → `sendWhatsApp('55'+phone)` (`admin/auth.ts:107-170`)                                                                                                                                                                       | Possession of the WhatsApp number is already our sign-in proof      |
| STT                      | `mediaProviders().transcribe(bytes, mime, {phrases})` (`vendedor/media.ts:147-230`), sidecar `STT_URL`                                                                                                                                                        | No tenant; phrases hint per store                                   |
| CRM socket               | `agent/channels/whatsapp.ts` (Baileys v7, in the Core process, booted at `index.ts:196`); auth in `wa_auth_state` (unsealed); no lease                                                                                                                        | What Part A retires                                                 |
| CRM inbound              | `onInboundMessage` / `onHistoryMessage` / `onLidMapping` callbacks (`index.ts:164-193`) → `ingestInbound` → `requestAgentTx`                                                                                                                                  | The same functions, fed from a table instead of callbacks           |
| CRM outbound and notices | `sendWhatsApp` callers: `agent/send.ts:223` (claim → send outside tx: at most once), `admin/notify.ts:24` (`platformNotify`: invites, billing notices, alerts, fallbacks), `admin/auth.ts:116` (OTP), `modules/staff.ts:111` (staff notices)                  | Become outbox rows                                                  |
| Socket state readers     | `waStatus()` (`agent/guardrails.ts:28,88`, `app.ts:464,2655`), `waIdentity()`, `whatsappRegistered()` (`agent/tools.ts:995`)                                                                                                                                  | Read the session row instead; the probe becomes a request row       |
| Store gateway            | `wa-gateway.ts` + `store-whatsapp/`: separate process, Postgres-only channel, lease (`owner`, `lease_epoch`, `lease_until`), sealed auth (`store_wa_auth`), paced outbox (`store_wa_messages`, at least once, `messageIdFor(rowId)`), heartbeat `wa_gateways` | Every table keyed by `tenant_id` with tenant RLS                    |

## 4. Part A: Venduá's numbers on the gateway

### 4.1 What the CRM's socket does today

Everything here has to survive the move:

- **Pairing.** By pair code (`POST /control/v1/wa/pair-code`) or QR (`wa_qr` setting,
  `GET /control/v1/wa/qr`), and logout.
- **History at pairing.** History sync is imported as context, scoped by the `whatsapp_history`
  setting (`agent/inbound.ts:70-82`). The store gateway skips the bulk syncs (recent and full,
  `store-whatsapp/runtime.ts:63,88`) and fetches one chat's history only on demand
  (`store-whatsapp/history.ts`, ADR 0033).
- **LID mapping.** LID↔PN pairs re-key leads (`adoptLidMappings`, `modules/threads.ts:1040`).
- **Inbound.** Messages go to `ingestInbound`, which drops team and merchant phones, writes leads,
  threads and messages, and wakes the lead's inbox through `requestAgentTx`.
- **Outbound.** Agent messages are claimed, then sent outside the transaction. Platform notices
  send directly with no queue.
- **Health.** `recordChannelState` `channel.down|up`, plus the outage watch.

### 4.2 Why the gateway

- **One Baileys stack.** One version to upgrade, one set of ban mitigations, and one reconnect and
  lease logic, instead of two diverging copies.
- **Sealed credentials.** The CRM's `wa_auth_state` is not sealed. The gateway seals its auth with
  AES-GCM (`store-whatsapp/auth-store.ts`).
- **A lease.** The CRM socket assumes a single Core instance. The gateway fences writes by
  `lease_epoch`.
- **Deploys don't drop the number.** Restarting Core today drops Venduá's WhatsApp until the socket
  reconnects. The gateway has its own lifecycle.
- **Media.** The gateway already downloads voice notes within caps (180 s, 8 MB). Duá needs that on
  the platform number.

### 4.3 Design: sessions with an owner

The gateway's unit becomes a session keyed `store:<tenantId>` or `platform:<name>`. Store sessions
keep their tables and behaviour exactly as they are. Platform sessions get their own tables in the
control scope (`control_access` RLS, written through `controlTx`), so no table loses its tenant key
and no RLS policy changes:

| Table                  | Mirrors             | Columns (sketch)                                                                                                                                                                 |
| ---------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_wa_sessions` | `store_whatsapp`    | `name` pk (`vendas`, `lojas`), `wanted`, `state`, `detail`, `pair_phone`, `pair_code`, `identity_phone`, `owner`, `lease_epoch`, `lease_until`, `history_scope`                  |
| `platform_wa_auth`     | `store_wa_auth`     | `session`, `category`, `name`, `data` (sealed)                                                                                                                                   |
| `platform_wa_outbox`   | `store_wa_messages` | `id`, `session`, `to_jid`, `body`, `media_id`, `purpose` (`otp`, `notice`, `crm`, `dua`), `dedupe_key` unique, `state`, `attempts`, `wa_id`, `expires_at`                        |
| `platform_wa_inbox`    | `shopper_messages`  | `id`, `session`, `from_jid`, `alt_jid`, `push_name`, `body`, `media_id`, `provider_id` unique, `kind` (`message`, `history`, `lid_mapping`), `from_me`, `sent_at`, `consumed_at` |
| `platform_wa_media`    | `shopper_media`     | `id`, `session`, `mime`, `seconds`, `bytes` (caps as shopper media), `expires_at`                                                                                                |
| `platform_wa_probes`   | —                   | `id`, `session`, `phone`, `result`, `answered_at`, for `whatsappRegistered`                                                                                                      |

**In the gateway.** `Gateway` gains a `PlatformSession` adapter. It reuses connect, pair code,
reconnect, sealing, lease and pacing from `store-whatsapp/session.ts` and `runtime.ts`. What
differs:

- History sync at pairing, as the CRM does today, scoped by `history_scope`.
- No shopper triage and no Vendedor gate.
- Inbound, history and LID pairs are written to `platform_wa_inbox`, with
  NOTIFY `vendua_platform_wa`.
- Outbox priorities: `otp` > `dua` > `notice` > `crm`. Pacing is per session. An `otp` row skips
  the jitter.

**In Core.** An inbox consumer (one loop in the Core process, `skip locked`) replaces the socket
callbacks:

- `kind = 'lid_mapping'` → `adoptLidMappings`, unchanged.
- `vendas` messages and history → `ingestInbound`, unchanged. It stays the only path into
  `requestAgentTx` for the CRM agent, so the producer invariant holds. Merchant phones are still
  not leads. Instead of being dropped silently, they get one fixed reply per day pointing to the
  Lojas number and the app.
- `lojas` messages → the Duá router (§5). A non-merchant sender gets a fixed reply (open
  decision 5).

**Callers.** `sendWhatsApp(sql, wa, to, text)` becomes
`enqueuePlatformWa(tx, { session, to, body, purpose, dedupeKey })`:

- **Login OTP** (`whatsappOtpSender`, `admin/auth.ts:107-118`). The send stays detached
  (`auth.ts:150-155`): a known phone must answer as fast as an unknown one, so nobody can tell
  which phones are merchants by timing. The enqueue happens off the response path, as the send
  does today. Purpose `otp` puts it first in the pump. A failure is still only logged, and
  "entrar com e-mail" (`apps/admin/src/features/auth/Login.tsx:300`) stays where it is.
- **Signup OTP** (`modules/billing/signup.ts:189`, through `platformNotify`). It awaits its send
  and answers 503 `OTP_UNAVAILABLE` on failure (`signup.ts:194`). It enqueues with purpose `otp`
  and waits up to 8 s for `sent` (LISTEN), then answers the same 503.
- **CRM agent sends** (`agent/send.ts`). The claim and the outbox row are written in one
  transaction. Delivery becomes at least once, deduped by WhatsApp through
  `messageIdFor(row id)`. Today it is at most once, and a crash between send and finalize loses the
  record.
- **`platformNotify` and staff notices.** Enqueue with purpose `notice`, with a dedupe key from the
  caller.
- **Socket state readers.** `waStatus()` and `waIdentity()` read `platform_wa_sessions`.
  `whatsappRegistered()` writes a probe row and waits for the answer, with the same timeout and
  `null` on no answer, as today.
- **Pairing routes** (`/control/v1/wa/*`) set `wanted`, `pair_phone` and logout on the session row,
  as the admin does for stores. QR pairing is kept only if the team wants it (open decision 7).
  Store sessions are pair-code only.

**Health.** The gateway writes the platform sessions' state. `recordChannelState` emits
`channel.down|up whatsapp` from it (`modules/system-events.ts:105`), and the console's status
reads the session row instead of the socket's memory. `channel-health.ts` is a rollup of lead
sends and doesn't change.

### 4.4 Cutover

1. Ship the adapter, the tables and the consumer behind `WA_PLATFORM_TRANSPORT=socket|gateway`
   (default `socket`).
2. Rehearse on a test number: pair, history, LID mapping, OTP, a CRM thread, restart Core,
   restart the gateway.
3. On the day: stop the CRM socket, copy `wa_auth_state` into `platform_wa_auth` sealed (same
   credentials, same linked device, no re-pair), flip to `gateway`, and watch the lease and the
   first OTP.
4. **The rollback is a re-pair, not a flag flip.** Once the gateway writes new Signal keys, the old
   rows are stale. That's why the rehearsal comes first.

### 4.5 The second number

With platform sessions, a second number is a row and a pairing. The recommendation:

- **Vendas:** CRM outreach and lead conversations.
- **Lojas:** OTPs, owner notices, invites and Duá.

Owners already have Lojas saved, because it sends their codes. Outreach risk stays on a number that
can be lost without locking anyone out. That's open decision 2, the owner's call.

## 5. Part B: Duá by WhatsApp

### 5.1 Who is asking

1. **Resolve the sender's number.** A `@lid` sender is resolved through the session's LID mapping.
   An unresolved LID gets "Não consegui confirmar seu número; use o app" and goes no further.
2. **Normalize** to national digits (`normalizePhone`, `modules/customer.ts:19`), trying the
   9th-digit variants (`phoneVariants`, `store-whatsapp/text.ts:42`).
3. **Look up memberships** with `merchant_memberships_for_phone(p)`: active users in active
   stores.
4. **Check eligibility.** The membership is eligible when:
   - the person turned on "Duá pelo WhatsApp" (`merchant_users.prefs.duaWhatsapp`, set from an
     authenticated admin session);
   - their role is `manager` or `owner`, the same floor as the HTTP route (open decision 4 for
     attendants);
   - the store's plan has `copilot`.

   Revoking or demoting a person takes effect on their next message, because `who()` re-reads them.

WhatsApp possession of the number is the proof our sign-in already accepts, since the OTP goes to
the same WhatsApp. The opt-in adds an explicit yes from inside an authenticated session.

### 5.2 Which store

- **One eligible membership:** that store.
- **Several:** a numbered list. The choice is stored until `#loja` in `platform_wa_dua_context`
  (control scope): `phone` (primary key), `tenant_id`, `user_id`, `chosen_at`.

### 5.3 The turn

In one inbox-consumer transaction that sets **both** RLS contexts. `withTenant`
(`platform/db.ts:38-55`) sets only `vendua.tenant_id`, and `platform_wa_inbox` is control-scoped,
so the transaction also runs `set_config('vendua.control', '1', true)`, as
`modules/payments/jobs.ts:46` does. That keeps "consumed" atomic with the dispatch. A small helper,
`withTenantAndControl`, keeps it in one place, and it is used only by this consumer:

1. Insert the `copilot_messages` row (author `merchant`), with a new column `channel` set to
   `'whatsapp'` (`'admin'` for existing rows).
2. Call `dispatchTx` with kind `message.inbound`, source `whatsapp:<userId>` and dedupe
   `copilot-wa:<inbox row id>`. That is the "mailbox row with a source written inside the
   transaction that caused it" of the Agent Runtime v3 producer rule.
3. `emitAdminTx(…, 'copilot', userId)`, so an open admin shows it live.
4. Mark the inbox row consumed.

**Voice.** Before the transaction, the consumer transcribes the note with
`mediaProviders().transcribe`, using the store's product names as phrases, as the Vendedor does.
The message carries `kind: 'voice'` and the confidence. Below a threshold, Duá says what it
understood before proposing anything ("Entendi …").

**Replies.** The copilot transport (`copilot/view.ts:115-146`) writes the `dua` row as today. When
the turn's trigger came by WhatsApp, it also enqueues a `platform_wa_outbox` row (purpose `dua`,
dedupe `dua:<copilot_messages.id>`) with the text rendering of the reply and its cards. A reply
goes back through the door the question came from, and the admin shows both.

### 5.4 Cards and "SIM"

- **Rendering.** The title, each line as `label: from → to`, and "Responda SIM para aplicar · vale
  até HH:MM". With several open cards in one reply they are numbered, and the person answers
  "SIM 2". There are no buttons: the gateway sends text, and interactive messages are unreliable
  on unofficial clients.
- **Matching is deterministic and runs before the model.** The consumer matches a reply against a
  closed grammar: `sim`, `s`, `pode`, `ok`, `sim <n>`, `não`, `nao`. A match on an open, unexpired
  card of this person calls `decideTx(tx, tenant, merchant, actionId, 'confirm' | 'decline')`. That
  is the same function as the admin tap, with the same role, expiry and basis-drift checks, the
  route re-run as "<name> pelo Duá", and the route's own `audit_log` row. The audit meta gains
  `channel: 'whatsapp'`.
- **The model never applies anything.** A reply outside the grammar is a new message to Duá.
- **Nothing open:** "Não tem nada esperando sua confirmação." **Drifted basis:** "Os dados mudaram
  desde a proposta; quer que eu refaça?"
- **Money cards** (`copilot_actions.money` set: prices, coupons). Open decision 3. The
  recommendation: "SIM" applies single-product changes whose lines show the exact before and after,
  as in the app, and bulk changes (`products.bulk`) are app-only.

### 5.5 Limits

- 30 inbound messages per phone per 10 minutes. Past that, one "calma, já respondo" and the rest
  wait.
- Inbound bodies cut at 2,000 characters, the cap the admin route applies
  (`admin/routes-copilot.ts:38`); voice capped at 180 s and 8 MB.
- The store's `copilot` daily budget applies unchanged. When it is spent, Duá says so and points to
  the app.
- Proactive messages from Duá to owners (a morning summary, alerts) are out of scope. The existing
  notices move to the Lojas number unchanged.

## 6. Controls

| Control                           | Where                   | Default | Who         |
| --------------------------------- | ----------------------- | ------- | ----------- |
| Duá pelo WhatsApp (per person)    | Perfil                  | off     | the person  |
| Allow it for managers (per store) | Equipe                  | on      | owner       |
| Platform numbers, pairing, health | CRM → Config → WhatsApp | —       | Venduá team |

## 7. Measuring it

- People who turned it on, and their weekly messages against their admin Copilot use. Does the
  second door add use, or move it?
- Cards proposed over WhatsApp: applied, declined, expired. Time from proposal to "SIM".
- Voice share and transcription confidence. Read-backs that the person corrected.
- **Part A:** OTP delivery time (p50 and p95) before and after; disconnects per week; CRM sends
  lost (should be zero).

## 8. Phases

| Phase | Ships                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| W0    | Platform sessions in the gateway; the CRM, OTPs and notices through the outbox and inbox; rehearsal; cutover |
| W1    | The second number (if decided); OTPs and notices move to Lojas; merchant replies get the fixed answer        |
| W2    | Duá by text: identity, store choice, dispatch, replies, cards and "SIM"; the Perfil switch                   |
| W3    | Voice notes                                                                                                  |

W0 changes the CRM agent's send path and the OTP. W2 adds a producer source and applies changes.
After each, `invariant-reviewer` runs on the diff (`CLAUDE.md`).

## 9. Open decisions

1. **Amend ADR 0034** to add the WhatsApp door (the owner's call).
2. **One platform number or two** (Vendas and Lojas). Two is recommended.
3. **Money cards by "SIM",** or app-only.
4. **Attendants.** Today the HTTP gate is `manager`. Attendant-level routes exist (orders, kitchen,
   pause and resume), so a narrow attendant Duá is possible.
5. **Non-merchants writing to Lojas:** a fixed reply, or hand them to the CRM as leads.
6. **Plan.** The same `copilot` feature, or its own. That's the owner's call; don't state it in copy.
7. **QR pairing** for platform sessions, or pair code only like the stores.

## 10. Risks

- **The number is restricted.** Today one number carries outreach and every sign-in code. W1's split
  limits the damage, and "entrar com e-mail" stays available.
- **A one-way cutover.** Signal keys move with the session, so the rehearsal on a test number is not
  optional.
- **Someone else holds the phone.** Whoever holds the owner's unlocked phone can talk to Duá.
  That's already true of the admin PWA logged in on that phone. The opt-in, immediate revocation,
  the money-card rule and "pelo Duá (WhatsApp)" in the audit log bound it.
- **Unofficial client.** Both platform numbers already run on Baileys today. The move changes where
  the session runs, not the exposure.

## Change log

- 2026-10-07: first proposal.
