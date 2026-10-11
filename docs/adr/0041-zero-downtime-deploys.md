# ADR 0041: Deploys without downtime: storefronts from CI, the platform as a start-first stack

- Status: Accepted (built 2026-10-11: `.github/workflows/deploy.yml`, `docker-stack.yml`,
  `VENDUA_PUBLISH_SECRET`, the wa-gateway's migration wait). Live once the
  [setup](../deploy/zero-downtime.md) is done.
- Date: 2026-10-11
- Amends: [ADR 0022](0022-control-plane-v0-and-edge.md) (who publishes) and
  [ADR 0039](0039-site-builder-on-claude-code.md) (auto-deploy on `main`)

## Context

Every merge to `main` made Dokploy redeploy the whole `docker-compose.yml` on the VPS. It
rebuilt every image there (one `bun install`, the site, every storefront, Core with the CRM and
the admin inside), on the CPUs and memory Postgres, Core and the edge were serving from, and
then `compose up` stopped each changed container before starting its replacement. A site sob
medida PR was the worst case: its `bun.lock` entry invalidated Core's install layer, so a
storefront-only merge rebuilt and restarted Core. Checkout, the admin and the CRM went down for
the build and the restart.

Storefronts never needed a restart: a release is immutable and content-addressed, and Core
promotes it with a pointer flip the edge follows (ADR 0022). Only the build ran in the wrong
place.

## Decision

- **CI publishes storefronts.** After CI passes on `main`, the deploy workflow runs
  `vendua release publish --all` on a GitHub runner, uploading to the R2 bucket the edge reads and
  registering with Core over HTTPS. An unchanged store hashes to the release it already has. The
  key is `VENDUA_PUBLISH_SECRET`, which Core accepts on `POST /control/v1/fleet/releases` and
  nothing else, so the repo's secrets never hold the staff key.
- **CI builds the platform's images** and pushes them to GHCR, tagged with the commit and `main`.
  The VPS only pulls.
- **The platform runs as a Swarm stack** (`docker-stack.yml`, Dokploy's "Stack" type), each
  service updated `start-first`: the new task passes its healthcheck, Swarm takes the old one out
  of the service's virtual IP, then stops it. Traefik routes through that virtual IP
  (`traefik.swarm.lbswarm`), and the edge keeps answering for 20 s after SIGTERM in case a proxy
  still sends to the old task. Postgres, stt, ig-sidecar and domains-sync stay `stop-first`
  (one data directory, twice the RAM, one Instagram login, one writer of Traefik's file).
- **The workflow triggers the Dokploy deploy** through Dokploy's API, after the images, and
  publishes storefronts after that. Dokploy's own auto-deploy is off, so a red `main` never ships.
- **Dockerfiles find workspace manifests from the root's `workspaces` globs**, so a new store needs
  no Dockerfile line, and a storefront change leaves Core's image byte-identical.
- **Migrations keep the previous Core working** (CLAUDE.md invariant): for a few seconds two Cores
  run against one schema. The wa-gateway, which has no `depends_on` in a stack, waits at boot until
  the migrations it ships with are applied.

`docker-compose.yml` stays as the single-command install and the fallback; it keeps the
`publish` one-shot.

## Consequences

- A storefront merge touches no container. A platform merge swaps only the services whose image
  changed, each without a gap. Tested on a local Swarm: no failed request across edge, Core and
  wa-gateway swaps under constant load, and a no-op redeploy replaced no container.
- Setup is manual and one-time: an R2 bucket and the existing releases copied into it, GitHub
  secrets and variables, GHCR pull access on the VPS, a maintenance window to move from compose to
  the stack (Postgres keeps its volume by name), and Venduá's own WhatsApp number moved to the
  wa-gateway first (two Cores would otherwise hold its session at once).
- A start-first swap briefly runs two copies of Core, the edge, the CRM, the admin, the site and
  the wa-gateway: the VPS needs that much free memory for the swap.
- Rollback is a Dokploy variable (`VENDUA_IMAGE_TAG=<commit>`) and a redeploy. Storefronts keep the
  fleet's own rollback.

## Alternatives considered

- **A separate repository for storefronts:** the same deploy result, but the Kernel, ui-defaults,
  templates, CLI and conformance would become published, versioned packages, a Kernel change
  could no longer be checked against every store in one PR, and fleet codemods would span two
  repos (ADR 0001).
- **Dokploy watch paths alone:** stops storefront merges from redeploying, but nothing would
  publish them, and platform deploys keep their build load and restart gap.
- **`docker rollout` on the compose file:** start-first without Swarm, but it needs a custom
  deploy command outside Dokploy's flow.
