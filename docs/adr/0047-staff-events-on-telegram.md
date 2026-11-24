# ADR 0047: Staff events delivered to per-member Telegram DMs (replacing Discord)

- Status: Accepted (implemented 2026-11-23, Core migration 0144; supersedes Discord delivery from
  [ADR 0023](0023-staff-events-on-discord.md))
- Date: 2026-11-23

## Context

[ADR 0023](0023-staff-events-on-discord.md) built a durable, typed staff event log (`staff_events`,
`recordStaffEventTx`) and delivered it to a private Discord server. While the event log design held
up cleanly, Discord proved high-friction day to day: configuring an application, OAuth invite,
server roles, 8 channels, and Developer Mode user IDs — and keeping the Discord mobile app open
just to receive alerts and approve drafts.

The team wants to simply **DM one Telegram bot** with minimal setup, receive a clean chronological
stream tuned by per-event noise levels, and act on drafts, handoffs, and incidents from their phone.

## Decision

**Keep the durable `staff_events` log intact; replace only the sink.** Every `recordStaffEventTx`
call site, anchor, dedupe key, and RLS policy from ADR 0023 stays unchanged.

**Telegram Bot API over HTTPS webhooks — still zero extra processes.**

- Outbound: `POST https://api.telegram.org/bot<token>/<method>` with `TELEGRAM_BOT_TOKEN` (env var
  named by the `telegram` integration's `secret_ref`). Rate limits (`429 retry_after`) are tracked
  per chat bucket and globally; transient 5xx/network errors back off; one teammate blocking the bot
  (`403`) is logged without blocking delivery to the rest of the team.
- Inbound: `POST /control/v1/telegram/webhook`, authenticated by constant-time comparison of
  `x-telegram-bot-api-secret-token` (generated automatically on `connect` and sent to `setWebhook`).
  Private DMs only (`chat.type === 'private'`).

**Per-member flat DM stream with synchronized living cards.**

- Every staff member linked in `Config → Equipe` (`staff.members[].telegram`) receives events in
  their own 1:1 DM with the bot.
- Per-recipient message pointers live in `staff_event_messages (event_id, anchor, chat_id,
message_id)` (platform table, RLS `vendua.control = '1'`, cascades on `staff_events` pruning).
- Follow-up events and inline-button actions edit the anchored card in place across **every** linked
  teammate's DM so nobody sees stale buttons or approves/resolves twice.
- Event levels (`off`, `silent`, `normal`, `ping`) control noise in the flat stream: `silent` (and
  category `/silenciar` mutes) sends with `disable_notification: true`; `ping` / `critical` adds a
  `🔔` highlight.

**Zero-ceremony onboarding.**

1. Create a bot in `@BotFather` (`/newbot`) and set `TELEGRAM_BOT_TOKEN`.
2. Click **conectar** in `Config → Telegram`: Core calls `getMe`, `setWebhook`, `setMyCommands`
   (`all_private_chats`), and sets Duá's avatar via `setMyProfilePhoto` if none exists.
3. Click **abrir no Telegram** (`https://t.me/<bot>?start=link_<token>`): tapping **Start** consumes
   a single-use 24h token from `telegram_state.linkTokens` and links (or adds) the person in
   `Config → Equipe` automatically — no copying numeric IDs.

**Managing & guiding the sales agent from DM (migration `0145_telegram_agent_manager.sql`).**

- **Direct card replies & ForceReply prompts (`telegram_prompts`)**: replying (text or voice note)
  to a Handoff card resolves the handoff, unpauses the lead, and wakes `crmAgent` with staff's
  answer (`staff.request`); replying to a Draft card rejects it and queues `staff.regenerate`
  (`draftOnly: true`); replying to a Lead card wakes `crmAgent` with staff guidance. Handoff cards
  also offer a direct-send button (`composeMessage` + `dispatchMessage`, keeping the agent paused).
- **Deterministic controls**: `/agente` (inline autonomy & job toggles), `/ensinar` + `/memoria`
  (pinned rules in `agent_memory_items`), and `/lead` pause/mode buttons run directly with zero LLM
  calls.
- **Conversational Sales Manager (`crm-manager` on Agent Runtime v3)**: free-text messages and
  transcribed voice notes (`mediaProviders(sql).transcribe`) dispatch to a dedicated `interactive`
  actor under `PLATFORM_TENANT_ID` (`subject_kind = 'telegram_staff'`). Internal coaching tools
  (`teach_rule`, `guide_lead`, `rewrite_draft`, `answer_handoff`, `set_lead_agent`) apply
  transactional changes immediately; global/external mutations (`propose_*`) write
  `telegram_proposals` cards delivered via `telegram_dm_outbox` with 1-tap Confirm/Cancel buttons.

**Zero-downtime migrations (ADR 0041).** `0144_telegram_bot.sql` extends
`control_integrations_kind_check` and the `control_settings` wake trigger additively while keeping
`'discord'` valid until no previous Core replica is running; `0145_telegram_agent_manager.sql` adds
`telegram_dm_outbox`, `telegram_prompts`, and `telegram_proposals` additively with `vendua.control`
RLS policies.

## Consequences

### Positive

- 60-second setup: no server, no roles, no channels, no Developer Mode ID copying.
- Private DMs avoid Telegram's 20 msg/min group limit and work identically for a solo operator or a
  small team.
- Interactive mobile UX: `/lead`, `/loja`, and `/silenciar` work cleanly via inline button pickers
  without needing typed command arguments; HTTP webhooks also unlock future conversational/voice
  workflows without adding a gateway daemon.

### Trade-offs

- No separate per-category channels or `@role` mentions — noise discipline relies on per-event
  levels (`off`/`silent`/`normal`/`ping`) and `/silenciar`.
- Telegram's `sendMessage` has no outbound idempotency nonce like Discord's `enforce_nonce`, so a
  mid-flight timeout after Telegram accepted the message can duplicate a card on retry.
- `callback_data` is capped at 64 bytes, so action payloads use compact prefixes (`d:a:<uuid>`,
  `h:t:<uuid>`, `i:r:<uuid>`).

## Links

- [ADR 0023](0023-staff-events-on-discord.md) — original staff event log design
- [ADR 0041](0041-zero-downtime-deploys.md) — additive migration rules
- [deploy/telegram.md](../deploy/telegram.md) — setup and commands
