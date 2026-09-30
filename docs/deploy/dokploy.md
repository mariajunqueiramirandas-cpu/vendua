# Deploying Venduá on Dokploy

One `docker-compose.yml` at the repo root runs the whole platform: Postgres,
the Core API, and each storefront as a static nginx container that also
proxies the reserved API prefixes to Core. Traefik (which Dokploy manages)
terminates TLS and maps domains.

## 1. Create the service

Dokploy → **Compose** → point at this repo → compose file path
`docker-compose.yml`. Dokploy builds every service from its Dockerfile.

## 2. Set environment variables

Copy `.env.example` into the service's environment and fill it in:

| Variable                                   | Purpose                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                        | Postgres superuser (migrations run as it)                       |
| `VENDUA_APP_DB_PASSWORD`                   | `vendua_app` app role — rotated on migrate                      |
| `SESSION_SECRET`                           | signs `vst.*` session tokens — required, stable across restarts |
| `CONTROL_SECRET`                           | staff login key for the CRM at `/control/` — keep distinct      |
| `SEED_DEMO`                                | `1` seeds the three demo tenants on boot; `0` = empty platform  |
| `SEED_DOMAINS`                             | `slug:public-domain` per storefront — registers real domains    |
| `VENDUA_PROXY_HOPS`                        | XFF trusted suffix length — `1` for the Traefik→nginx chain     |
| `VENDUA_ADMIN_HOST`                        | the merchant admin's own domain, e.g. `painel.example.com`      |
| `VENDUA_STORE_DOMAIN`                      | stores live at `<slug>.<domain>` — the admin's store links      |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`   | web push for new orders (`npx web-push generate-vapid-keys`)    |
| `VENDUA_SUPPORT_WHATSAPP`                  | Ajuda's "chamar no WhatsApp" number (digits; optional)          |
| `RESEND_API_KEY`                           | email driver — sending + fetching received bodies               |
| `RESEND_WEBHOOK_SECRET`                    | svix signing secret of the inbound webhook (see below)          |
| `MONID_API_KEY`                            | monid.ai enrichment tools (unset → hidden from the agent)       |
| `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64` | service-account key, base64'd — meeting → gcal sync (optional)  |
| `GOOGLE_CALENDAR_ID`                       | target calendar id for the gcal sync                            |
| `DAILY_API_KEY`                            | daily.co per-meeting video rooms (unset → static roomUrl)       |
| `IG_SIDECAR_SECRET`                        | Instagram DMs — Core↔ig-sidecar shared secret (see below)       |
| `IG_PROXY`                                 | static residential proxy for the ig-sidecar (recommended)       |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET`        | Venduá's Mercado Pago application — stores connect by OAuth     |
| `MP_WEBHOOK_SECRET`                        | the application's webhook signing secret (x-signature)          |
| `MP_PLATFORM_ACCESS_TOKEN`                 | Venduá's own MP account — plan billing (assinatura + Pix)       |
| `VENDUA_SECRETS_KEY`                       | seals stores' MP tokens at rest (falls back to SESSION_SECRET)  |

Generate secrets with `openssl rand -hex 32`.

Mercado Pago: create the application at developers.mercadopago.com.br (marketplace,
OAuth), set its redirect URL to `https://<VENDUA_ADMIN_HOST>/admin/v1/payments/mercadopago/callback`
and its webhook URL to `https://<VENDUA_ADMIN_HOST>/admin/v1/hooks/mercadopago?t=platform`
(events: payments, subscriptions). Store payments carry their own notification URL. Without
`MP_CLIENT_ID`/`MP_CLIENT_SECRET` stores keep the offline methods (static Pix, cash, card on
delivery) and the admin says online payments aren't available; without
`MP_PLATFORM_ACCESS_TOKEN` self-serve signup stays closed. Never set
`VENDUA_PAYMENTS_DRIVER=fake` outside dev/CI (Core ignores it in production).

Rotating `VENDUA_SECRETS_KEY` makes every stored MP token unreadable: the stores show as
disconnected and their owners are asked to reconnect.

## 3. Attach domains

In Dokploy, assign a domain to each web service (port 80):

- `site` → marketing domain (e.g. `vendua.example.com`)
- `core` → **internal only**; no domain. Storefront nginx proxies
  `/storefront/v1`, `/checkout/v1`, and `/v1` to it.
- `crm` → the staff CRM domain (e.g. `crm.example.com`) — proxies
  `/control`, `/agendar` and `/book/v1` to `core`. Log in with
  `CONTROL_SECRET`. Don't put the domain
  directly on `core`: that removes one trusted proxy hop and the login
  rate limiter's client-IP math (`VENDUA_PROXY_HOPS=1` assumes the
  Traefik→nginx→core chain) collapses every staff IP into one bucket.
- `admin` → the merchant admin's own domain (e.g. `painel.example.com`), the
  same value as `VENDUA_ADMIN_HOST`. It proxies `/admin` (app, API, live
  stream) and `/v1/media` to `core`, and `/` redirects to `/admin/`. Store
  domains don't serve the admin: a storefront's third-party scripts share the
  store's origin and could otherwise act with the merchant's cookie. With
  `VENDUA_ADMIN_HOST` set, Core also refuses `/admin` on any other host and
  sends old `/admin` bookmarks to the admin domain. One domain serves every
  store; a person in several stores picks one after signing in.
  A subdomain of the store domain works (e.g. `painel.vendua.com.br` beside
  `<slug>.vendua.com.br`): the cookie is host-only, and cross-origin calls fail
  the Origin check. Keep that label out of store slugs — the Phase 4
  provisioner must reserve it.

- `stores` → **nothing in the Domains UI.** Dokploy's form rejects `*.vendua.com.br`,
  so the wildcard route is Traefik labels on the service in `docker-compose.yml`
  (`HostRegexp`, priority 1, on `dokploy-network`) — redeploy the compose and it's
  live. One container serves every store: for each host, nginx asks Core which store
  it is (`/storefront/v1/_bundle`, cached 30s) and serves that store's own bundle
  (`storefronts/<slug>/`, keyed by `package.json` `vendua.tenant` or the folder name),
  or the `_template` bundle for stores without one; unknown hosts get the "loja não
  encontrada" 404. Exact hosts in the Domains UI (`admin`, `crm`, `site`) outrank the
  wildcard. TLS: the router sets `tls=true` with no resolver, so Traefik needs the
  wildcard certificate itself — either a DNS-01 resolver on Dokploy's Traefik for
  `*.vendua.com.br` (then add `traefik.http.routers.vendua-stores.tls.certresolver=<name>`
  and `tls.domains[0].main=vendua.com.br` / `tls.domains[0].sans=*.vendua.com.br`), or
  Cloudflare proxying with SSL mode "Full". A domain outside the wildcard
  (`pudim.com.br`) goes on `stores` in the Domains UI, plus its `domains` row.

Store links (share, QR, "ver loja") always use the store's **primary** domain
row, then any public row, then `<slug>.<VENDUA_STORE_DOMAIN>` — never a URL
guessed from the slug alone.

Then set `SEED_DOMAINS` to match, e.g.
`quero-pudim:pudim.example.com` — tenant routing is
Host-header based, so each storefront's public domain must exist in the
`domains` table. Seed runs on boot when `SEED_DEMO=1`; to add a domain later:

```sql
insert into domains (host, tenant_id)
  select 'pudim.example.com', id from tenants where slug = 'quero-pudim';
-- make it the address every admin link uses (one primary per store)
update domains set is_primary = (host = 'pudim.example.com')
  where tenant_id = (select id from tenants where slug = 'quero-pudim');
```

(Exec into the `db` container or use Dokploy's database console.)

### PRO+ custom domains

A PRO+ owner adds their domain in the admin (Conta → Endereços) and follows the DNS steps
shown there: a CNAME to `<slug>.<VENDUA_STORE_DOMAIN>` and a TXT `_vendua.<host>` with their
verification value. Core checks DNS every 15 minutes; when both match the domain turns
`dns_ok` and staff get an email. Then, in this order:

1. Dokploy → `stores` → Domains → add the host (port 80, HTTPS on, Let's Encrypt).
2. Wait for the certificate (open `https://<host>` — the "loja não encontrada" page is fine).
3. CRM → Lojas → the store → "Ativar domínio". Core adds it to `domains` as the primary host,
   so every link the admin builds moves to it.

Signup reserves the admin's label (`painel`) and the other platform names from store slugs.

## Inbound email (agent inbox)

Mail to `*@auto.<domain>` is received by Resend (the `auto.` domain's MX
points at Resend inbound) and pushed to Core:

1. Resend → **Webhooks** → add `https://<crm-domain>/control/v1/webhooks/email`,
   event `email.received`. The route lives under `/control`, so the `crm`
   nginx proxy reaches it.
2. Copy the webhook's signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`
   and redeploy — unsigned or unverifiable events get a 404.
3. `RESEND_API_KEY` must be set: the event carries metadata only, Core
   fetches the body via `GET /emails/receiving/{id}`.

`VENDUA_WEBHOOK_SECRET` is a separate shared secret for manual/relay posts
(`x-vendua-webhook` header) — unset, it's derived from `CONTROL_SECRET`.

## Instagram DMs (agent cold outreach)

The `ig-sidecar` service (`services/ig-sidecar`, Go on mautrix-meta's Instagram
client) holds the logged-in Instagram session; Core stores the credential in
`ig_auth_state` and pushes it back whenever the sidecar restarts empty.
This is Instagram's private web API, not the official Graph API — it can DM
people who never wrote first, and Instagram can challenge or restrict the account.

1. Set `IG_SIDECAR_SECRET` (one value — compose hands it to both services) and,
   ideally, `IG_PROXY` pointing at a static residential proxy in Brazil.
2. CRM → config → conexões → instagram → **usar sidecar**, then **entrar com
   usuário e senha** (2FA and in-app approvals are answered on the same card),
   or paste browser cookies / a "Copy as cURL" if Instagram asks for a CAPTCHA.
3. Estúdio → limites → **DMs frias no instagram / dia** caps agent first
   contacts account-wide (default 15; replies don't count). Start low on a
   young account.

A logged-out session shows up on the card as "reconectar conta" — log in again
there. The sidecar is AGPL-3.0 (its `LICENSE`); keep it a separate service.

## 4. Deploy

Boot order is handled by healthchecks: `db` healthy → `core` migrates
(+seeds) → storefronts start once `core` is healthy.

## Services

| Service      | Image                                                     | Exposed port   |
| ------------ | --------------------------------------------------------- | -------------- |
| `db`         | postgres:16-alpine                                        | internal only  |
| `core`       | `packages/core/Dockerfile` (Bun)                          | 8787, internal |
| `stores`     | `storefronts/Dockerfile` `target: stores` — every store   | 80             |
| `crm`        | `apps/control/Dockerfile` (nginx + conf baked in)         | 80             |
| `admin`      | `apps/admin/Dockerfile` (nginx + conf baked in)           | 80             |
| `site`       | `storefronts/Dockerfile` `target: site` (SvelteKit→nginx) | 80             |
| `ig-sidecar` | `services/ig-sidecar/Dockerfile` (Go)                     | 8790, internal |

All web services share the Dockerfile's `build` stage, so a deploy runs one
`bun install` + one vite pass total (compose/bake dedupe the shared stage).

Adding a storefront with its own bundle = its folder under `storefronts/`
and one `COPY` line for its `package.json` in the Dockerfile's manifest block
(`--frozen-lockfile` needs it on disk); the next deploy puts it in the `stores`
image. No compose service and no Dokploy domain.
