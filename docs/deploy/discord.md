# The team's Discord bot

Everything that happens across the stack reaches the team's private Discord server: new leads
and replies, the agent's drafts and handoffs, orders and payments, signups and plan billing,
releases, deployments and incidents, failing routines and 500s, and a daily summary. The common
actions — approve or reject a draft, take or close a handoff, acknowledge or resolve an incident
— work from Discord buttons, attributed to whoever clicked. Design: [ADR 0023](../adr/0023-staff-events-on-discord.md).

The bot is HTTP-only: Core posts with the bot token and Discord calls Core back on the
interactions URL. There is no gateway connection and nothing new to deploy.

## Setup (once, ~5 minutes)

The token is the only thing copied by hand: Core reads everything else from Discord with it.

1. **Create the application** at [discord.com/developers/applications](https://discord.com/developers/applications)
   → _New Application_ ("Venduá"), then _Bot_ → _Reset Token_ → copy it into Dokploy →
   Environment as `DISCORD_BOT_TOKEN` and redeploy Core. No privileged intents are needed.
2. **CRM → Config → discord → conexão → conectar**: Core reads the application id and public
   key with the token (`GET /applications/@me`), saves and enables the integration, then sets
   the app's Interactions Endpoint URL to `https://<crm-domain>/control/v1/discord/interactions`
   (Discord verifies it on the spot against the key just saved). If Discord refuses it, the
   panel shows the URL to paste in _General Information → Interactions Endpoint URL_. A bot or
   app still on Discord's default picture gets Duá's face as avatar and app icon; one the team
   set is left alone.
3. **adicionar ao servidor** opens Discord's invite with exactly the permissions it needs (view
   channels, send messages, embed links, read history, mention roles, manage channels). Pick the
   team's server; back in the CRM, Core finds it among the bot's servers on its own (**já
   adicionei** checks again). A bot already in several servers asks which one.

4. **Channels**: in **canais**, pick the team's role (it gets mentioned on urgent events and is
   the only role that sees the bot's channels), then **criar canais**. A fresh server has no
   roles: leave it on "sem cargo" and the channels are made for the whole server, with nobody
   mentioned; pick a role later and run **criar canais** again to lock them to it. The bot owns
   these channels' permissions: each run resets any it finds different (an old role, a
   hand-added one). It creates a private "Venduá" category with `#atendimento #crm #vendas #assinaturas #frota #agente #sistema
#resumo` and wires them. Prefer existing channels? Pick them in the selects instead —
   anything unmapped falls back to **padrão**. **enviar teste** posts a card in each.
5. **Link the team**: in **Config → equipe**, add each person's Discord user ID
   (Developer Mode → right-click the user → _Copy User ID_). Only listed IDs can use commands
   and buttons; anyone else who tries gets a private reply with their own ID to paste there.

**configurar à mão** keeps the old fields (application id, public key, server id, token
variable) for a token under another env name or a server picked by id.

Slash commands register themselves on the server within a few seconds of step 3 (and again
whenever they change); **registrar comandos** forces it.

## What arrives where

| Channel        | Events (default level)                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#atendimento` | agent handoff (mention), draft to approve (buttons), merchant help request (mention), PRO+ site requests, access-code invoices waiting for "marcar como paga"                                                              |
| `#crm`         | inbound new lead, lead replied (silent), lead invited / live, unsubscribed (silent), call booked / rescheduled / cancelled                                                                                                 |
| `#vendas`      | one card per order that follows it (recebido → pago → entregue / cancelado), a store's **first order** (mention), chargebacks and provider refunds, Mercado Pago connected / dropped                                       |
| `#assinaturas` | new store with a live onboarding checklist (cadastro, plano pago, no ar, primeiro acesso, Mercado Pago, primeiro pedido, domínio), plan paid, card rejected / past due / cancelled / odd Pix, custom domain ready (silent) |
| `#frota`       | releases (silent), failed deployments with automatic rollback, staff promote/rollback/pin (silent), store live, incidents (critical mentions) with buttons                                                                 |
| `#agente`      | runs that failed for good, a lead hitting the cost cap, WhatsApp/Instagram down (mention) and back                                                                                                                         |
| `#sistema`     | Core restarts (silent; a warning at 3+ per hour), 500s grouped by route (≤ 1 per 10 min each), routines failing for 2+ minutes and recovering, status-page notices                                                         |
| `#resumo`      | the daily summary at the configured hour                                                                                                                                                                                   |

Every event's level is editable in **o que avisar**: `desligado`, `silencioso` (posted without
a notification), `normal`, `com menção` (mentions the team role). Critical events mention the role
unless set silent. "mostrar trechos das conversas" off keeps lead and draft text out of Discord.

Cards that mark a moment carry a Duá thumbnail: help and handoffs (headset), first order, a new
store's onboarding (boas-vindas, then sucesso), store or site live (publicar), first plan payment,
chargebacks (segurança), billing and deployment failures and incidents (erro, then sucesso), a
channel down (offline, then sucesso) and the daily summary (horários). Routine cards stay bare.
The art lives in `apps/control/public/discord/` (cut from `brand/mascote` on a cream tile so the
green survives Discord's dark theme) and is served by Core at `<crm>/control/discord/<pose>.webp`.

Cards are living: follow-ups edit the original message (an order, a draft, a handoff, an
incident, a store's onboarding) instead of posting new ones; only changes that matter (an
incident resolved, an order cancelled) add a short reply under the card.

## Commands

`/hoje` · `/pendencias` (approve drafts right there) · `/lead busca` · `/loja busca` · `/frota`
(acknowledge incidents) · `/resumo [publicar]` · `/silenciar categoria tempo` (posts arrive
without notifying; nothing is dropped) · `/bot` (queue, errors, routing, your link) · `/ajuda`.
Answers are private to whoever asked, except `/silenciar` and `/resumo publicar`.

## Troubleshooting

- **Config → discord → saúde** shows deliveries, the queue, failures and the last error.
  `/bot` shows the same from Discord.
- "o canal não existe mais" / "sem permissão": a mapped channel was deleted or the bot lost
  access — pick another channel or re-run **criar canais**.
- "token do bot recusado": `DISCORD_BOT_TOKEN` is wrong or was reset — update it and redeploy.
- Discord rejects the endpoint URL: check the CRM host serves `/control/*` (the `crm` nginx
  proxies it to Core) and that _Config → agenda_'s public URL is the CRM's domain — that is the
  base **conectar** registers.
- Events that waited more than 2 hours for a first delivery (the bot was off) are skipped, not
  replayed; the delivery log keeps 30 days.
- Local development: `DISCORD_API_URL` points Core at a fake Discord API (production never sets it).
