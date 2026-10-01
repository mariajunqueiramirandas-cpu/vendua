# ADR 0023: Staff events, delivered to Discord by an HTTP-only bot

- Status: Accepted (implemented 2026-10-01, Core migration 0068)
- Date: 2026-10-01

## Context

The team learns what happens across the stack in four disconnected ways: the CRM (SSE hints,
in-app tasks), a daily email digest, `notifyStaff` (email/WhatsApp for three events: handoff, a
booked call, fleet incidents) and the logs. Most of what matters has no staff signal at all: a
store's first order (the Phase 4 exit), a signup, a plan paid or past due, a chargeback, a
merchant asking for help, a run that failed for good, a WhatsApp number that dropped, a
deployment that rolled itself back, a routine that keeps failing, a 500. `notifyStaff` is
fire-and-forget after commit (lost on a crash), carries plain strings, and every member gets
every message in their personal inbox.

The team already lives in a private Discord server. It wants one place where everything shows
up, routed by topic, and where the common actions (approve the agent's draft, take a handoff,
acknowledge an incident) can be done from a phone without opening the CRM.

## Decision

**A durable staff event log in Core.** Domain code records a structured event in the **same
transaction** as the change it describes: `recordStaffEventTx(tx, kind, data, opts)`
(`modules/staff-events.ts`). The event exists if and only if the change committed. Kinds are
a closed, typed catalog (`StaffEventMap`): each has a category, a default level, an optional
anchor and a pt-BR label. The table `staff_events` is a platform table: staff read and write it
under `vendua.control`; a store's own transaction may only **insert** rows for its own tenant
(an insert-only policy), so checkout can record `order.placed` without being elevated and
without being able to read anything back. Rows carry no customer PII: an order is its store,
number, total and method, never the shopper's name or phone (LGPD erasure must not have to
reach Discord). Rows are pruned after 30 days.

**Discord is the sink, and the bot is HTTP-only.** No gateway connection and no new process:

- Outbound: Discord's REST API with the bot token (`DISCORD_BOT_TOKEN`, an env var named by the
  `discord` integration's `secret_ref`, like every other provider). Each post carries a
  `nonce` derived from the event id with `enforce_nonce`, so a retry after a timeout returns
  the message Discord already created instead of posting twice. 429s are honoured through
  `retry_after`; 5xx and network errors back off; a 4xx is a configuration problem and is
  surfaced in the CRM.
- Inbound: an Interactions endpoint, `POST /control/v1/discord/interactions` (through the CRM's
  `/control` proxy, like the other vendor webhooks), verified with Ed25519 against the
  application's public key and a ±5 min timestamp window. It answers slash commands, buttons and
  autocomplete within Discord's 3 s budget; slow side effects (sending an approved message)
  continue after the response.

**Delivery is a scheduler job** (ADR 0017), not a new loop: `discord` sleeps until the earliest
due row and is woken by a statement-level trigger on `staff_events`. A pass is budgeted (25 rows,
8 s) so the other routines never wait on Discord. Runs show up in the CRM's routines list with
the other jobs. A second job, `discord-digest`, records the daily summary at the configured hour.

**Living cards.** Events about one thing share an anchor (`order:<id>`, `draft:<id>`,
`handoff:<task>`, `incident:<id>`, `onboarding:<tenant>`, `release:<id>`, `status:<id>`). The
first event posts a card; later ones edit it from the anchor's whole history (an order goes
recebido → pago → entregue on one message; an incident goes aberto → crítico → reconhecido →
resolvido). Edits never notify. A follow-up that matters (an incident resolved, an order
cancelled) also posts a short reply under the card. The onboarding card tracks the First-store
gate per store: cadastro, plano pago, loja no ar, primeiro acesso, Mercado Pago, primeiro pedido.

**Routing and noise are data.** The `discord` setting maps eight categories (atendimento, crm,
vendas, assinaturas, frota, agente, sistema, resumo) to channels, with a default channel for
any unmapped category, and gives every kind a level: `off`, `silent` (Discord's
`SUPPRESS_NOTIFICATIONS`), `normal`, or `ping` (mentions the staff role). Critical events ping
unless set silent. `/silenciar` mutes a category for a while (delivered silently, never
dropped). More than five events of one kind in a pass collapse into a summary. An event that
waited more than two hours for its first delivery (the bot was off) is skipped, not replayed.
"Criar canais" builds a private category (`@everyone` denied, the staff role and the bot
allowed) and saves the mapping.

**Staff-only by identity, not by channel.** An interaction is honoured only from the
configured guild and from a Discord user id listed on a member in Config → Equipe
(`staff.members[].discord`). Anyone else gets an ephemeral reply with their own id and how to
be added. Actions are attributed to that member's name (`approved_by`, `leads.owner`,
`incident acked`).

**Actions reuse the CRM's functions and idempotency.** Approve/reject a draft
(`approveMessage`/`rejectMessage`, then `dispatchMessage`), take or close a handoff
(`updateLead` owner, `completeTask`), acknowledge or resolve a fleet incident: each runs through
the same `claimControl` path as the CRM button, keyed by the Discord interaction id. Money stays
in the CRM: marking an invoice paid, promote and rollback are links, not buttons.

**Commands:** `/hoje`, `/pendencias`, `/lead`, `/loja`, `/frota`, `/resumo`, `/silenciar`,
`/bot`, `/ajuda`. They are registered as guild commands (instant) whenever their definition,
the application or the guild changes. Answers are ephemeral unless asked to publish.

## Consequences

### Positive

- One durable, typed record of what happened, written atomically with the change; the bot is
  one consumer and another sink (Slack, push) would be a second renderer, not new call sites.
- The Phase 4 gate is visible: a store's first paid order and its onboarding checklist arrive
  in the channel the moment they happen.
- The approval loop leaves the CRM: a draft can be approved from a phone in two taps.
- Crash loops, failing routines and 500s reach a human without anyone reading logs.

### Negative / costs

- One more table written on hot paths (one small insert per order and per inbound message).
- Discord is a third party: message excerpts and lead names leave our infrastructure. Excerpts
  can be turned off (`excerpts: false`), and shoppers' data never enters the log.
- Single-replica assumption: anchored events are delivered in id order by one pass; with
  several Core replicas a follow-up could race its opener (it would then post a fresh card).
- Discord's interaction endpoint must reach Core through the CRM host; if the CRM proxy is
  down, buttons fail while notifications keep flowing.

## Alternatives considered

- **A gateway bot (discord.js) as a separate service**: a long-lived websocket, a second
  deployable and a second credential story, for features we don't use (presence, message
  content). HTTP interactions do everything the team asked.
- **Webhooks only**: no buttons, no commands, no editing a card in place.
- **Extend `notifyStaff` with a Discord leg**: keeps the post-commit, string-only, lossy
  design, and would only cover the three events it already has.
- **Read the CRM's SSE bus**: in-process, payload-free hints that vanish on restart.

## Links

- [ADR 0016](0016-agent-dispatch-and-scheduler.md), [ADR 0017](0017-due-time-scheduler.md),
  [ADR 0022](0022-control-plane-v0-and-edge.md)
- [deploy/discord.md](../deploy/discord.md) — creating the application, the env var, the
  endpoint URL and linking the team
