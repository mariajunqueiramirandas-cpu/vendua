# Deploying Venduá on Dokploy

One `docker-compose.yml` at the repo root runs the whole platform: Postgres,
the Core API (with the Control Plane), the storefront **edge** that serves every store from
immutable releases and proxies the reserved API prefixes to Core, and a one-shot **publish**
that turns each deploy's storefront builds into releases. Traefik (which Dokploy manages)
terminates TLS and maps domains.

## 1. Create the service

Dokploy → **Compose** → point at this repo → compose file path
`docker-compose.yml`. Dokploy builds every service from its Dockerfile.

## 2. Set environment variables

Copy `.env.example` into the service's environment and fill it in:

| Variable                                   | Purpose                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                        | Postgres superuser (migrations run as it)                         |
| `VENDUA_APP_DB_PASSWORD`                   | `vendua_app` app role — rotated on migrate                        |
| `SESSION_SECRET`                           | signs `vst.*` session tokens — required, stable across restarts   |
| `CONTROL_SECRET`                           | staff login key for the CRM at `/control/` — keep distinct        |
| `SEED_DEMO`                                | `1` creates the quero-pudim store if missing; `0` (default) = off |
| `SEED_OWNER_NAME` / `_PHONE` / `_EMAIL`    | that store's admin owner when the seed creates it (fake if unset) |
| `SEED_DOMAINS`                             | `slug:public-domain` per storefront — registers real domains      |
| `VENDUA_PROXY_HOPS`                        | XFF trusted suffix length — `1` for the Traefik→edge/nginx chain  |
| `VENDUA_EDGE_SECRET`                       | the edge's key for Core's `/edge/v1/resolve` — required           |
| `VENDUA_ARTIFACTS`                         | release store: unset = the `artifacts` volume; `s3://bucket/pfx`  |
| `S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`  | with an `s3://` store: R2/MinIO credentials                       |
| `S3_ENDPOINT` / `S3_REGION`                | with an `s3://` store: the endpoint (R2: account URL), region     |
| `VENDUA_PROBES`                            | `1` (default) = synthetic probes verify deployments and alert     |
| `VENDUA_PROBE_ORIGIN`                      | unset = probe `https://<host>`; `http://edge:8080` = edge only    |
| `GIT_COMMIT`                               | optional: the commit releases record (else `unknown`)             |
| `VENDUA_ADMIN_HOST`                        | the merchant admin's own domain, e.g. `painel.example.com`        |
| `VENDUA_STORE_DOMAIN`                      | stores live at `<slug>.<domain>` — the admin's store links        |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`   | web push for new orders (`npx web-push generate-vapid-keys`)      |
| `VENDUA_SUPPORT_WHATSAPP`                  | Ajuda's "chamar no WhatsApp" number (digits; optional)            |
| `RESEND_API_KEY`                           | email driver — sending + fetching received bodies                 |
| `RESEND_WEBHOOK_SECRET`                    | svix signing secret of the inbound webhook (see below)            |
| `MONID_API_KEY`                            | monid.ai enrichment tools (unset → hidden from the agent)         |
| `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64` | service-account key, base64'd — meeting → gcal sync (optional)    |
| `GOOGLE_CALENDAR_ID`                       | target calendar id for the gcal sync                              |
| `DAILY_API_KEY`                            | daily.co per-meeting video rooms (unset → static roomUrl)         |
| `IG_SIDECAR_SECRET`                        | Instagram DMs — Core↔ig-sidecar shared secret (see below)         |
| `IG_PROXY`                                 | static residential proxy for the ig-sidecar (recommended)         |
| `DISCORD_BOT_TOKEN`                        | the team's Discord bot — see [discord.md](discord.md)             |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET`        | Venduá's Mercado Pago application — stores connect by OAuth       |
| `MP_WEBHOOK_SECRET`                        | the application's webhook signing secret (x-signature)            |
| `MP_PLATFORM_ACCESS_TOKEN`                 | Venduá's own MP account — plan billing (assinatura + Pix)         |
| `MP_PUBLIC_KEY`                            | optional: card-form fallback key; MercadoPago.js in the admin     |
| `VENDUA_SIGNUP_ACCESS_CODE`                | signup without MP; staff mark the plan invoices paid (≥ 12 chars) |
| `VENDUA_SECRETS_KEY`                       | seals stores' MP tokens at rest (falls back to SESSION_SECRET)    |
| `WA_MAX_SESSIONS`                          | stores' WhatsApp sockets one `wa-gateway` holds (default 300)     |
| `WA_MIN_SEND_GAP_MS` / `WA_MAX_PER_HOUR`   | per-store pacing of shopper messages (1500 ms, 200/h)             |

Generate secrets with `openssl rand -hex 32`.

Mercado Pago: create the application at developers.mercadopago.com.br as **Checkout
Transparente** (card and Pix happen on our pages, never a redirect; stores connect by OAuth), set its redirect URL to `https://<VENDUA_ADMIN_HOST>/admin/v1/payments/mercadopago/callback`
and its webhook URL to `https://<VENDUA_ADMIN_HOST>/admin/v1/hooks/mercadopago?t=platform`
(events: payments, subscriptions). Store payments carry their own notification URL. Leave PKCE
off (Core's OAuth sends no `code_verifier`). The in-page card form runs under each store's
own `public_key` from OAuth, so its tokens are charged on that store's own token. `MP_PUBLIC_KEY`
(the application's production public key) is the fallback for a store whose OAuth answer
carried no key, and the key the admin starts MercadoPago.js with on the plan's payment screens
(its device fingerprint goes with the plan's Pix; without it the admin loads MP's security script). Without
`MP_CLIENT_ID`/`MP_CLIENT_SECRET` stores keep the offline methods (static Pix, cash, card on
delivery) and the admin says online payments aren't available; without
`MP_PLATFORM_ACCESS_TOKEN` self-serve signup stays closed, except to whoever has
`VENDUA_SIGNUP_ACCESS_CODE` (`openssl rand -hex 16`): typed at the last signup step, it creates
the store and its first plan invoice without Mercado Pago. The store stays closed until the team
marks that invoice paid in the CRM (Lojas → the store → marcar como pago); each renewal invoice
shows up there the same way. Unset it once plan billing is live. Never set
`VENDUA_PAYMENTS_DRIVER=fake` outside dev/CI (Core ignores it in production).

Rotating `VENDUA_SECRETS_KEY` makes every stored MP token unreadable: the stores show as
disconnected and their owners are asked to reconnect. Setting it for the first time is safe:
tokens sealed under the SESSION_SECRET-derived key still open (and are resealed on refresh).
Core warns at boot in production while it's unset.

## 3. Attach domains

In Dokploy, assign a domain to each web service (port 80):

- `site` → marketing domain (e.g. `vendua.example.com`)
- `core` → **internal only**; no domain. The storefront edge proxies
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

- `edge` → **nothing in the Domains UI** for the stores themselves. Dokploy's form rejects
  `*.vendua.com.br`, so the wildcard route is Traefik labels on the service in
  `docker-compose.yml` (`HostRegexp`, priority 1, on `dokploy-network`) — redeploy the compose
  and it's live. One process serves every store: for each host the edge asks Core which store
  and which release it is (`/edge/v1/resolve`, cached 30 s and served stale while Core is down),
  serves that release's files from the artifact store and injects the store's state and live
  design into the page; unknown hosts get the "loja não encontrada" 404. Exact hosts in the
  Domains UI (`admin`, `crm`, `site`) outrank the wildcard. TLS: the router sets `tls=true`
  with no resolver, so Traefik needs the wildcard certificate itself — either a DNS-01 resolver
  on Dokploy's Traefik for `*.vendua.com.br` (then add
  `traefik.http.routers.vendua-edge.tls.certresolver=<name>` and
  `tls.domains[0].main=vendua.com.br` / `tls.domains[0].sans=*.vendua.com.br`), or Cloudflare
  proxying with SSL mode "Full". DNS: one wildcard record `*.vendua.com.br` → the VPS; new
  stores need nothing else. A domain outside the wildcard (`pudim.com.br`) goes on `edge` in the
  Domains UI (port 8080), plus its `domains` row.

Store links (share, QR, "ver loja") always use the store's **primary** domain
row, then any public row, then `<slug>.<VENDUA_STORE_DOMAIN>` — never a URL
guessed from the slug alone.

Then set `SEED_DOMAINS` to match, e.g.
`quero-pudim:pudim.example.com` — tenant routing is
Host-header based, so each storefront's public domain must exist in the
`domains` table. Seed runs on boot when `SEED_DEMO=1` (off by default). In production it
only adds: it creates the store (with `SEED_OWNER_*` as its owner) when the slug is free, and an
existing store keeps its domains, settings, catalog and owners — it only gains `SEED_DOMAINS`
hosts it lacks (never a second primary). To add a domain later:

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

1. Dokploy → `edge` → Domains → add the host (port 8080, HTTPS on, Let's Encrypt).
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

## Voice-note transcription (stt)

The `stt` service ([ADR 0037](../adr/0037-self-hosted-stt.md), `services/stt`) transcribes
shoppers' voice notes for the Vendedor on this host's CPU, with Parakeet-TDT-0.6B-v3. No audio
goes to a third party and there is no per-minute charge.

1. Set `STT_SECRET`. It is one value, and compose hands it to both `core` and `stt`. Without it,
   the service idles and Core keeps using the cloud routes (or none).
2. Deploy. The first build downloads the 2.5 GB model export, which is a cached layer
   afterwards, and compiles it for the host's CPU. Compiling needs about 6 GB of RAM. The
   container needs about 1.5 GB at runtime.
3. Check the CRM, under IA → Voz. It shows whether the voice server is up and which model it
   runs, and it sets the order of the transcription routes. With no route saved, Core uses the
   voice server. Saving a list there picks another order or adds a cloud fallback. Keep
   "Venduá" first, because when a cloud route comes first the audio leaves the platform.

`STT_CPUS` (default 2) caps the cores it may use, so Core and Postgres keep theirs.
`STT_MODEL=parakeet-tdt-0.6b-v3-ptbr` builds the Brazilian Portuguese fine-tune instead: better
on spontaneous speech, worse on read speech (ADR 0037). If the image is built on another machine for a host without
AVX-512/AVX-VNNI, build with `--build-arg STT_REDUCE_RANGE=1`.

## Stores' own WhatsApp (order updates to shoppers)

The `wa-gateway` service ([ADR 0026](../adr/0026-store-whatsapp-gateway.md)) runs from Core's
image with its own entrypoint and links each store's WhatsApp as a device (Baileys, the
WhatsApp Web protocol). It needs nothing of its own: it shares Core's database role,
`SESSION_SECRET` and `VENDUA_SECRETS_KEY` (the logins are sealed under them, so both services
must have the same values). It never migrates; it starts once `core` is healthy.

- A store links its number in the admin (WhatsApp → gerar código) and chooses which order steps
  message its shoppers. Staff see connects and drops in Discord (`whatsapp.store`); a gateway
  that stops beating for 2 min while stores need it raises `channel.down` (`whatsapp_lojas`).
- Scale out by adding replicas: each claims stores by lease up to `WA_MAX_SESSIONS`. A deploy
  sends SIGTERM; the gateway closes its sockets (logins kept) and hands the leases back, so the
  new one reconnects every store within seconds. Messages wait in the queue meanwhile (they
  expire after 6 h).
- It is an unofficial client: WhatsApp can restrict a number that looks like spam. The gateway
  only sends order updates to people who ordered, paced per store, with SAIR to stop.

## 4. Deploy

Boot order is handled by healthchecks: `db` healthy → `core` migrates
(+seeds with `SEED_DEMO=1`) → `publish` runs once `core` is healthy; the `edge` starts on its
own (it serves its last snapshot until Core answers).

Every deploy then ships the storefronts through the Control Plane
([ADR 0022](../adr/0022-control-plane-v0-and-edge.md)):

1. The shared Docker build stage builds every storefront; `publish` runs
   `vendua release publish --all`: each build gets a content-addressed release id, QA checks and
   a `storefront.manifest.json`, is uploaded to the artifact store (skipped when that release is
   already there) and registered with Core. An unchanged storefront hashes to the release it
   already has, so a redeploy changes nothing.
2. Core promotes each new release to every `auto` store on that bundle (`_template` serves
   every store without its own): a pointer flip the edge follows within 30 s.
3. A probe that sees the edge serve the new release marks the deployment live. One that never
   verifies (5 min) or keeps failing is rolled back to the previous release automatically, the
   store is pinned there and staff get an alert.

The CRM (Lojas → frota) and `vendua fleet` show it all and hold the levers: promote a release,
roll a store back, pin/unpin, "verificar agora", incidents, and new stores from a lead
("criar loja" on the lead). From a laptop:
`VENDUA_CORE_ORIGIN=https://<crm-domain> CONTROL_SECRET=… bunx vendua fleet status`.

Probes fetch `https://<store host>` from inside the `core` container. If the VPS can't reach its
own public IP (no hairpin NAT), set `VENDUA_PROBE_ORIGIN=http://edge:8080`: probes then go
through the edge with the store's Host header (DNS and TLS unchecked).

## Services

| Service      | Image                                                      | Exposed port   |
| ------------ | ---------------------------------------------------------- | -------------- |
| `db`         | postgres:16-alpine                                         | internal only  |
| `core`       | `packages/core/Dockerfile` (Bun)                           | 8787, internal |
| `edge`       | `packages/edge/Dockerfile` (Bun) — every store             | 8080           |
| `publish`    | `storefronts/Dockerfile` `target: publish` — one-shot      | none           |
| `crm`        | `apps/control/Dockerfile` (nginx + conf baked in)          | 80             |
| `admin`      | `apps/admin/Dockerfile` (nginx + conf baked in)            | 80             |
| `site`       | `storefronts/Dockerfile` `target: site` (SvelteKit→nginx)  | 80             |
| `ig-sidecar` | `services/ig-sidecar/Dockerfile` (Go)                      | 8790, internal |
| `wa-gateway` | `packages/core/Dockerfile`, entrypoint `src/wa-gateway.ts` | 8791, internal |
| `stt`        | `services/stt/Dockerfile` (Python, ONNX Runtime)           | 8792, internal |

`site` and `publish` share the storefronts Dockerfile's `build` stage, so a deploy runs one
`bun install` + one vite pass for both (compose/bake dedupe the shared stage).

Adding a storefront with its own bundle = its folder under `storefronts/` and one `COPY` line
for its `package.json` in the Dockerfiles' manifest blocks (`--frozen-lockfile` needs it on
disk); the next deploy publishes it, and the store whose tenant it names
(`package.json` `vendua.tenant`) moves to it. No compose service and no Dokploy domain.
