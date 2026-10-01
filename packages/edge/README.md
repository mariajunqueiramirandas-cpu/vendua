# @vendua/edge

The shared storefront edge. One Bun process serves every store host from immutable,
content-addressed release artifacts (docs/architecture/07-deployment-and-hosting.md):

- `Host` → Core `GET /edge/v1/resolve` (cached, stale-while-revalidate, served stale for as
  long as Core is down; unknown hosts negative-cached 10 s) → the store's release.
- Release files come from the artifact store (`storefronts/<bundle>/<release>/…`), are checked
  against the sha256 in `storefront.manifest.json` and cached on disk. `/assets/*` is immutable,
  everything else `no-cache`; ETag/304 and gzip for text.
- HTML gets `<script id="vendua-state">window.__VENDUA_STATE__=…</script>` before `</head>`
  (Core `GET /storefront/v1/surfaces` for that host, cached per host).
- The entry HTML's head gets the page's `<title>`, description, Open Graph, Twitter card and
  canonical link (`src/meta.ts`) from that envelope's `meta` — link previews (WhatsApp,
  Instagram) don't run JS. A product route (`/produto/:slug`) adds Core's
  `GET /storefront/v1/products/:slug` (cached per host + slug). Both wait at most
  `stateWaitMs`; a late or failed product falls back to the store's head, no `meta` (older
  Core) leaves the head as built.
- `/checkout/v1`, `/storefront/v1` and `/v1` proxy to Core (streamed, SSE included). The last
  good `/storefront/v1/state`, `/storefront/v1/surfaces` and `/v1/v.js` are served with
  `x-vendua-edge-stale: 1` while Core errors.
- Routes, states and those API bodies are snapshotted to `<cacheDir>/snapshot.json`, so a
  restart during a Core outage keeps serving.
- `GET /_edge/healthz` → `{ ok, routes, core: 'ok' | 'down' }`.

Releases are made by `vendua release build|publish` (packages/cli); the manifest format and
hashing live in `src/manifest.ts` (`@vendua/edge/manifest`), the store in `src/artifacts.ts`
(`@vendua/edge/artifacts`).

## Environment

| Variable                                                               | Default                  |                                                       |
| ---------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `PORT`                                                                 | `8080`                   |                                                       |
| `VENDUA_CORE_URL`                                                      | `http://core:8787`       |                                                       |
| `VENDUA_EDGE_SECRET`                                                   | —                        | sent as `x-vendua-edge`; Core refuses without it      |
| `VENDUA_ARTIFACTS`                                                     | — (required)             | `file:///abs/dir`, `/abs/dir` or `s3://bucket/prefix` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | —                        | for `s3://` (R2, MinIO; path-style)                   |
| `VENDUA_EDGE_CACHE_DIR`                                                | `/var/cache/vendua-edge` | snapshot + verified release files                     |
| `VENDUA_EDGE_ROUTE_TTL_MS`                                             | `30000`                  |                                                       |
| `VENDUA_EDGE_STATE_TTL_MS`                                             | `30000`                  |                                                       |

Logs are JSON lines on stdout, warnings and errors only.

## Local run

```sh
cd storefronts/_template && bun run build && cd ../..
bun packages/cli/src/main.ts release publish _template --no-register --artifacts file:///tmp/vendua-artifacts
cd packages/edge
VENDUA_ARTIFACTS=file:///tmp/vendua-artifacts VENDUA_CORE_URL=http://localhost:8787 \
  VENDUA_EDGE_SECRET=… VENDUA_EDGE_CACHE_DIR=/tmp/vendua-edge bun src/main.ts
curl -H 'Host: loja-modelo.localhost' localhost:8080/
```

`bun test` runs against a fake Core and a temp-dir store (no Postgres). Image:
`docker build -f packages/edge/Dockerfile -t vendua-edge .` from the repo root.
