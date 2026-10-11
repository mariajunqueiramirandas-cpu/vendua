# Deploys without downtime

How a merge reaches production without taking anything offline ([ADR 0041](../adr/0041-zero-downtime-deploys.md)),
and the one-time setup that turns it on. The plain compose install in [dokploy.md](dokploy.md) still
works and stays the fallback.

## How it works

```
merge to main → ci (green) → deploy workflow (.github/workflows/deploy.yml)
  images       8 images built on GitHub, pushed to ghcr.io/<owner>/vendua-<service>:{<sha>,main}
  platform     Dokploy API → docker stack deploy docker-stack.yml
                 a service whose image changed: new task → healthy → old task out of the VIP → stopped
                 an unchanged service: untouched
  storefronts  vendua release publish --all → R2 + POST /control/v1/fleet/releases (VENDUA_PUBLISH_SECRET)
                 an unchanged store: same release id, nothing happens
                 a changed one: Core flips the store's pointer, the edge follows within 30 s
```

Each job runs only when its repository variable is `on` (`DEPLOY_IMAGES`, `DEPLOY_DOKPLOY`,
`DEPLOY_STOREFRONTS`), and only for the newest green `main` (an older run that finishes late
skips). `workflow_dispatch` runs it by hand. After the stack deploy the workflow waits for
Dokploy to report it done, plus 90 s for Swarm's swaps, before publishing storefronts (a store
built on a new Kernel may call the new Core). A stack whose update Swarm rolls back still counts
as deployed: check `docker service ps` when a deploy changed Core. Nothing restarts for a storefront merge, unless it changes `bun.lock` (a new store's first PR): then Core and the wa-gateway swap, start-first, like a platform merge. A
platform merge swaps the changed services one by one, `start-first`, except Postgres, stt,
ig-sidecar and domains-sync, which are `stop-first` (their gaps are internal).

**Migrations** run when the new Core boots, while the old one still serves: a migration must keep
the previous Core working (add a column now, drop the old one in a later PR). The wa-gateway waits
at boot until Core has applied the migrations it ships with.

## Setup

Do it in two phases. Phase A alone already makes storefront merges free of downtime. Phase B
needs a short maintenance window.

### Phase A: storefronts from CI (the compose install stays)

1. **R2.** Create a bucket (e.g. `vendua-artifacts`) and an R2 API token with Object Read & Write
   on it. Note the access key id, the secret and the S3 endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.
2. **Copy the existing releases into it** before the edge switches (pinned stores and rollback
   targets point at older releases). On the VPS, with the compose's artifacts volume
   (`docker volume ls | grep artifacts`):

   ```sh
   docker run --rm -v <project>_artifacts:/data:ro \
     -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
     -e RCLONE_CONFIG_R2_ACCESS_KEY_ID=<key-id> -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<secret> \
     -e RCLONE_CONFIG_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
     rclone/rclone:1.68 copy /data r2:<bucket> --checksum --progress
   ```

   The key layout is the same in both stores (`storefronts/<bundle>/<release>/…`), so the volume
   root maps to the bucket root. Check: `rclone size` on both sides shows the same object count.

3. **Dokploy environment** (the compose): `VENDUA_ARTIFACTS=s3://<bucket>`, `S3_ENDPOINT`,
   `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and
   `VENDUA_PUBLISH_SECRET=$(openssl rand -hex 32)`. Deploy once. The `publish` one-shot
   re-registers each current release at its `s3://` address. Check that a few stores load and
   that `vendua fleet status` shows them `live`.
4. **GitHub.** Settings → Environments → new environment `production`, deployment branches
   limited to `main`: the jobs holding secrets run in it, so a branch (the site routine's
   included) can't read them by editing the workflow.
   - Secrets **of the `production` environment** (not the repository's): `VENDUA_PUBLISH_SECRET`
     (same value as Core's), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
   - Repository variables (Settings → Secrets and variables → Actions → Variables):
     `VENDUA_CORE_ORIGIN=https://<crm-domain>` (the CRM proxies `/control` to Core),
     `VENDUA_ARTIFACTS=s3://<bucket>`, `S3_ENDPOINT`, `S3_REGION=auto`, `DEPLOY_STOREFRONTS=on`.
   - Actions → deploy → Run workflow. The `storefronts` job ends with a table of every bundle as
     `existing`.
5. **Until phase B:** Dokploy still rebuilds the compose on every push. Set the compose's watch
   paths to the platform's (`packages/**`, `apps/**`, `services/**`, `site/**`, `patches/**`,
   `package.json`, `docker-compose.yml`) so a storefront-only merge stops redeploying.

### Phase B: the platform as a stack

1. **Image variables** on GitHub: `PUBLIC_ADMIN_URL`, `PUBLIC_GA_ID`, `PUBLIC_GOOGLE_ADS_ID` (the
   values Dokploy has now), `STT_MODEL` if not the default, and `STT_REDUCE_RANGE`: `0` when
   `grep -m1 -o -E 'avx512_vnni|avx_vnni' /proc/cpuinfo` prints something on the VPS, else `1`.
   Then `DEPLOY_IMAGES=on` and run the workflow: eight `vendua-*` packages appear in GHCR.
2. **GHCR pull access:** Dokploy → Settings → Registry → add `ghcr.io` with a GitHub user and a
   classic token with `read:packages`. Check `docker pull ghcr.io/<owner>/vendua-core:main` works
   on the VPS.
3. **Traefik:** Dokploy's `traefik.yml` (`/etc/dokploy/traefik/traefik.yml`) needs a `swarm`
   provider beside `docker` (Traefik v3: `providers.swarm.exposedByDefault: false`). Add it if
   missing and restart Traefik.
4. **Venduá's own WhatsApp on the wa-gateway:** two Cores at once would hold its session. Follow
   [dua-no-whatsapp.md §4.4](../features/dua-no-whatsapp.md) (`cutover-cli.ts`, then
   `WA_PLATFORM_TRANSPORT=gateway`).
5. **Before the window:** `docker volume ls` and note the Postgres volume's full name (the
   compose's `<project>_pgdata`). Back up: `docker exec <db> pg_dump -U vendua vendua | gzip >
/root/vendua-before-stack.sql.gz`. Check `free -h`: a swap runs two copies of a service.
6. **The window (a few minutes):**
   - New Dokploy environment values: `WA_PLATFORM_TRANSPORT=gateway` (step 4; the stack refuses
     to deploy without it), `VENDUA_PGDATA_VOLUME=<that name>`,
     `VENDUA_CRM_HOST`, `VENDUA_SITE_HOST` (and `VENDUA_ADMIN_HOST`, already set). The stack routes
     these hosts itself, so remove them from the Domains tab.
   - Stop the compose (never with volumes), switch its type to **Stack** and its file to
     `docker-stack.yml`, and deploy. If Dokploy can't change the type, create a Stack service with
     the same environment instead; the volume name pins Postgres either way.
   - Check `docker service ls` (every service `n/n`), then a store, the admin, the CRM and the site
     over HTTPS, and a test order.
7. **Hand deploys to the workflow:** Dokploy → Settings → API key, then the `production`
   environment's secret `DOKPLOY_API_KEY`, repository variables `DOKPLOY_URL` (the panel's URL) and `DOKPLOY_COMPOSE_ID` (from the
   service's URL), then `DEPLOY_DOKPLOY=on`. Turn Dokploy's auto-deploy off and clear the watch
   paths. Run the workflow: the stack deploy changes nothing.

**Rolling back the stack:** set `VENDUA_IMAGE_TAG=<an earlier commit>` in Dokploy and deploy (back
to `main` after). **Leaving the stack:** stop it, switch the service back to Compose and
`docker-compose.yml`, and deploy: Postgres is the same `<project>_pgdata` volume.

## Checking a deploy

```sh
# from anywhere, during a deploy: any non-2xx/3xx/404 line is a gap
while true; do curl -s -o /dev/null -w "%{http_code}\n" https://<store-host>/; sleep 0.2; done
# on the VPS
docker service ps <stack>_core      # the old task Shutdown only after the new one Running
```
