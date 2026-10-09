# @vendua/domains-sync

The sidecar that gives verified custom domains a route and a certificate in Traefik (ADR 0038,
"TLS needs no staff step"). Every `DOMAINS_SYNC_INTERVAL_MS` it asks Core for the hosts to serve
(`GET /sync/v1/custom-hosts`, header `x-vendua-sync`) and renders one Traefik dynamic file. Per
host: a `websecure` router with the ACME resolver and a `web` router redirecting to HTTPS, both to
the edge's Docker service at priority 2 (the store wildcard is 1, Dokploy's hosts are higher).

- The file is rewritten only when its content changes, through `<file>.tmp` + rename. Traefik
  only loads `.yml`/`.yaml`/`.toml` files, so it never sees the temp file.
- Core down, a non-200, a timeout (10 s) or a malformed body leave the current file untouched;
  the next tick tries again. A failed fetch never shrinks the list.
- Hosts are checked again here, whatever Core sent: lower-case DNS names only (≥ 2 labels, an
  alphabetic or `xn--` TLD, ≤ 253 chars), never the store domain or a name under it (the wildcard
  serves those), never a `DOMAINS_SYNC_DENY` host or `localhost`; at most 5000. Drops are logged.
- A file Traefik would reject (an older image wrote `routers: {}`, which takes the whole file
  provider down, Dokploy's `redirect-to-https@file` included) is replaced with the empty one at
  start and on every failed fetch, with or without Core: it routed nothing anyway.
- Without `VENDUA_SYNC_SECRET` it logs that and idles instead of exiting, so the container
  doesn't crash-loop.
- `bun src/prune-acme.ts [--write]` (by hand, inside the container) drops the per-store
  `<slug>.<VENDUA_STORE_DOMAIN>` certificates left in `/traefik-dynamic/acme.json` that hide the
  wildcard ([deploy doc](../../docs/deploy/dokploy.md#wildcard-certificate)).

**Why it isn't part of the edge.** Whoever writes this file can route any host, the admin's and
the CRM's included. The edge faces the internet; this process has no inbound route, talks only
to Core, and is the only one with the Traefik dynamic directory mounted.

## Environment

| Variable                   | Default                                      |                                                   |
| -------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `VENDUA_CORE_URL`          | `http://core:8787`                           |                                                   |
| `VENDUA_SYNC_SECRET`       | — (idle without it)                          | sent as `x-vendua-sync`; Core's own secret        |
| `VENDUA_STORE_DOMAIN`      | `vendua.com.br`                              | it and its subdomains are never written           |
| `DOMAINS_SYNC_DENY`        | —                                            | comma-separated platform hosts (admin, CRM, site) |
| `DOMAINS_SYNC_OUT`         | `/traefik-dynamic/vendua-custom-domains.yml` | bind-mount Dokploy's `traefik/dynamic` there      |
| `DOMAINS_SYNC_INTERVAL_MS` | `30000`                                      |                                                   |
| `DOMAINS_SYNC_SERVICE`     | `vendua-edge@docker`                         | the edge's service as the file provider names it  |
| `DOMAINS_SYNC_MIDDLEWARE`  | `vendua-edge-https@docker`                   | redirect-to-HTTPS middleware of the edge's labels |
| `DOMAINS_SYNC_RESOLVER`    | `letsencrypt`                                | Dokploy's Traefik ACME resolver                   |

Logs are JSON lines on stdout. `bun test` uses a fake Core and a temp dir. Image:
`docker build -f packages/domains-sync/Dockerfile -t vendua-domains-sync .` from the repo root.
