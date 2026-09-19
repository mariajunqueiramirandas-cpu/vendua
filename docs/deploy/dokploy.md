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

| Variable                 | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `POSTGRES_PASSWORD`      | Postgres superuser (migrations run as it)                       |
| `VENDUA_APP_DB_PASSWORD` | `vendua_app` app role — rotated on migrate                      |
| `SESSION_SECRET`         | signs `vst.*` session tokens — required, stable across restarts |
| `CONTROL_SECRET`         | staff login key for the CRM at `/control/` — keep distinct      |
| `SEED_DEMO`              | `1` seeds the three demo tenants on boot; `0` = empty platform  |
| `SEED_DOMAINS`           | `slug:public-domain` per storefront — registers real domains    |
| `VENDUA_PROXY_HOPS`      | XFF trusted suffix length — `1` for the Traefik→nginx chain     |

Generate secrets with `openssl rand -hex 32`.

## 3. Attach domains

In Dokploy, assign a domain to each web service (port 80):

- `site` → marketing domain (e.g. `vendua.example.com`)
- `quero-pudim`, `brasa`, `forn` → each storefront's public domain
- `core` → **internal only**; no domain. Storefront nginx proxies
  `/storefront/v1`, `/checkout/v1`, and `/v1` to it.
- `crm` → the staff CRM domain (e.g. `crm.example.com`) — proxies only
  `/control` to `core`. Log in with `CONTROL_SECRET`. Don't put the domain
  directly on `core`: that removes one trusted proxy hop and the login
  rate limiter's client-IP math (`VENDUA_PROXY_HOPS=1` assumes the
  Traefik→nginx→core chain) collapses every staff IP into one bucket.

Then set `SEED_DOMAINS` to match, e.g.
`quero-pudim:pudim.example.com,brasa:grill.example.com` — tenant routing is
Host-header based, so each storefront's public domain must exist in the
`domains` table. Seed runs on boot when `SEED_DEMO=1`; to add a domain later:

```sql
insert into domains (host, tenant_id)
  select 'pudim.example.com', id from tenants where slug = 'quero-pudim';
```

(Exec into the `db` container or use Dokploy's database console.)

## 4. Deploy

Boot order is handled by healthchecks: `db` healthy → `core` migrates
(+seeds) → storefronts start once `core` is healthy.

## Services

| Service                          | Image                                                      | Exposed port   |
| -------------------------------- | ---------------------------------------------------------- | -------------- |
| `db`                             | postgres:16-alpine                                         | internal only  |
| `core`                           | `packages/core/Dockerfile` (Bun)                           | 8787, internal |
| `quero-pudim` / `brasa` / `forn` | `storefronts/Dockerfile` `target: storefront` (vite→nginx) | 80             |
| `crm`                            | `nginx:1.28-alpine` + `apps/control/nginx.conf`            | 80             |
| `site`                           | `storefronts/Dockerfile` `target: site` (SvelteKit→nginx)  | 80             |

All web services share the Dockerfile's `build` stage, so a deploy runs one
`bun install` + one vite pass total (compose/bake dedupe the shared stage).

Adding a storefront later = one more service block using
`storefronts/Dockerfile` with `target: storefront` + a `STOREFRONT` arg, one
`COPY` line for its `package.json` in the Dockerfile's manifest block
(`--frozen-lockfile` needs it on disk), plus its domain row.
