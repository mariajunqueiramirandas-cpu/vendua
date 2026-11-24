# The team's Telegram bot

Everything that happens across the stack reaches each linked team member's private Telegram DM: new
leads and replies, the agent's drafts and handoffs, orders and payments, signups and plan billing,
releases, deployments and incidents, failing routines and 500s, and a daily summary. Common actions
— approve or reject a draft, take or close a handoff, acknowledge or resolve an incident — work from
inline buttons in your DM and sync across every linked teammate's DM automatically. Design:
[ADR 0047](../adr/0047-staff-events-on-telegram.md).

The bot is webhook-only: Core posts with the bot token and Telegram calls Core back on the webhook
URL. There is no polling loop and nothing new to deploy.

## Setup (~1 minute)

1. **Create the bot** with [@BotFather](https://t.me/BotFather) on Telegram → send `/newbot`, pick a
   name and username, copy the token into Dokploy → Environment as `TELEGRAM_BOT_TOKEN`, and
   redeploy Core.
2. **CRM → Config → telegram → conectar**: Core reads `@bot` with `getMe`, generates a webhook
   secret, registers `https://<crm-domain>/control/v1/telegram/webhook` via `setWebhook`, registers
   the private-chat commands, and sets Duá's avatar if the bot doesn't have one yet.
3. **Link your DM**: click **abrir no Telegram** (generates a one-tap `t.me/<bot>?start=link_…`
   deep link valid for 24h) and tap **Começar / Start** in Telegram. Done — you're added to
   **Config → equipe** automatically and alerts start arriving in your DM.
4. **Add teammates (optional)**: click **gerar link de DM** in **Config → telegram** (or the link
   button on any row in **Config → equipe**) and send them the one-tap link, or let them DM `/start`
   to get their Telegram numeric ID.

Click **enviar teste** in **Config → telegram** to send a test card to every linked DM.

## Noise control in the flat DM

Every event lands in your chronological DM stream, tuned by level in **o que avisar**:

- `desligado`: not sent
- `silencioso`: arrives in your DM without vibrating (`disable_notification: true`)
- `normal`: normal push notification
- `urgente`: push notification with a `🔔` highlight (critical events default here)

Turning off **"mostrar trechos das conversas"** keeps lead messages and agent drafts out of
Telegram.

Cards are living: follow-ups (orders, drafts, handoffs, incidents, onboarding) edit the original
message in place across every linked DM; only meaningful transitions (incident resolved, order
cancelled, handoff taken) add a short reply.

## Managing and guiding the sales agent from DM

Everything in your Telegram DM works with **text or voice notes** (voice notes use Core's existing
transcription routes in **CRM → IA → Voz**):

- **Reply directly to cards** (or tap the card button):
  - **Handoff card** (`💬 responder ao agente` or swipe-reply): resolves the handoff, unpauses the
    lead, saves your note, and wakes the sales agent to reply to the lead with your guidance. Tap
    `✉️ responder ao lead` to send your message verbatim instead (keeping the agent paused).
  - **Draft card** (`✏️ reescrever` or swipe-reply): rejects the old draft and asks the agent to
    rewrite a fresh draft using your adjustment, then sends the new card back for 1-tap approval.
  - **Lead card** (`🤖 guiar agente` or swipe-reply): coaches the agent on that specific lead now.
- **Chat freely in your DM**: send any plain text or voice note (not a command, not replying to a
  card) to talk to the **`crm-manager` agent** (Agent Runtime v3). Ask about today's pipeline,
  conversations, spend, or pending drafts; teach rules (`teach_rule`), pause/resume leads, or ask
  for global changes (autonomy, instructions, discovery hunts, direct sends) — risky/global changes
  land as **1-tap Confirm / Cancel** cards right in your DM.
- **Instant control panel**: `/agente` switches autonomy (`off` / `copilot` / `supervised` /
  `autopilot`), toggles automatic jobs, manages rules, and triggers a Strategist review without
  needing an LLM call.

## Commands

`/agente` · `/ensinar [#segmento] <regra>` · `/memoria` · `/pendencias` (approve/reject drafts) ·
`/hoje` · `/lead [busca]` (with guide/pause/draft controls) · `/loja [busca]` · `/frota`
(acknowledge/resolve incidents) · `/resumo` · `/silenciar [categoria tempo]` · `/nova` (reset AI
manager chat history) · `/bot` · `/ajuda`.

## Troubleshooting

- **Config → telegram → saúde** shows 24h deliveries, the queue, failures, active mutes, and the
  last error. `/bot` shows the same in Telegram.
- **"token do bot recusado (401)"**: `TELEGRAM_BOT_TOKEN` is wrong or was revoked in `@BotFather` —
  update it and redeploy Core.
- **Telegram rejects the webhook**: check the CRM host serves `/control/*` over HTTPS and that
  _Config → agenda_'s public URL is the CRM's domain.
- **Voice notes aren't transcribing**: configure a transcription route (OpenAI Whisper or the STT
  sidecar) in **CRM → IA → Voz**.
- **Someone isn't getting DMs**: make sure they tapped **Começar / Start** in the bot DM and haven't
  blocked the bot.
- **Local development**: `TELEGRAM_API_URL` points Core at a local fake Telegram API (production
  never sets it).
