# The team's Discord bot

Everything that happens across the stack reaches the team's private Discord server: new leads
and replies, the agent's drafts and handoffs, orders and payments, signups and plan billing,
releases, deployments and incidents, failing routines and 500s, and a daily summary. The common
actions — approve or reject a draft, take or close a handoff, acknowledge or resolve an incident
— work from Discord buttons, attributed to whoever clicked. Design: [ADR 0023](../adr/0023-staff-events-on-discord.md).

The bot is HTTP-only: Core posts with the bot token and Discord calls Core back on the
interactions URL. There is no gateway connection and nothing new to deploy.

## Setup (once, ~10 minutes)

1. **Create the application** at [discord.com/developers/applications](https://discord.com/developers/applications)
   → _New Application_ ("Venduá"). On _General Information_ copy the **Application ID** and
   the **Public Key**.
2. **Bot token**: _Bot_ → _Reset Token_ → copy it into Dokploy → Environment as
   `DISCORD_BOT_TOKEN` and redeploy Core. No privileged intents are needed.
3. **Server id**: in Discord, _User Settings → Advanced → Developer Mode_ on, then right-click
   the server → _Copy Server ID_.
4. **CRM → Config → discord → conexão**: paste the application id, public key and server id,
   then **salvar e ativar**. The token row should read "presente no ambiente".
5. **Interactions endpoint**: copy **URL de interações** from the same panel
   (`https://<crm-domain>/control/v1/discord/interactions`) into _General Information →
   Interactions Endpoint URL_ and save. Discord verifies it on the spot (Core answers its PING
   and rejects a bad signature); this only works after step 4 is saved.
6. **Invite the bot**: **adicionar ao servidor** opens Discord's invite with exactly the
   permissions it needs (view channels, send messages, embed links, read history, mention
   roles, manage channels).
7. **Channels**: in **canais**, pick the team's role (it gets mentioned on urgent events and is
   the only role that sees the bot's channels), then **criar canais**. It creates a private
   "Venduá" category with `#atendimento #crm #vendas #assinaturas #frota #agente #sistema
#resumo` and wires them. Prefer existing channels? Pick them in the selects instead —
   anything unmapped falls back to **padrão**. **enviar teste** posts a card in each.
8. **Link the team**: in **Config → equipe**, add each person's Discord user ID
   (Developer Mode → right-click the user → _Copy User ID_). Only listed IDs can use commands
   and buttons; anyone else who tries gets a private reply with their own ID to paste there.

Slash commands register themselves on the server within a few seconds of step 4 (and again
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
- Discord rejects the endpoint URL: save the connection in the CRM first (step 4), and check the
  CRM host serves `/control/*` (the `crm` nginx proxies it to Core).
- Events that waited more than 2 hours for a first delivery (the bot was off) are skipped, not
  replayed; the delivery log keeps 30 days.
- Local development: `DISCORD_API_URL` points Core at a fake Discord API (production never sets it).
