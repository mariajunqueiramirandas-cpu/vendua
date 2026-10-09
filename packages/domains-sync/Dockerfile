# Build from repo root: docker build -f packages/domains-sync/Dockerfile -t vendua-domains-sync .
# Runtime: VENDUA_CORE_URL, VENDUA_SYNC_SECRET, VENDUA_STORE_DOMAIN, DOMAINS_SYNC_* — see README.md.

FROM oven/bun:1.4.2
WORKDIR /app

# No dependencies (node: builtins + Bun APIs only), so the image is its sources:
# no workspace manifests, no lockfile, no bun install.
COPY packages/domains-sync/package.json packages/domains-sync/package.json
COPY packages/domains-sync/src packages/domains-sync/src

ENV NODE_ENV=production
WORKDIR /app/packages/domains-sync
# Stays root: the bind-mounted Traefik dynamic directory on the host (/etc/dokploy/traefik/dynamic)
# is root-owned. The container has no inbound route and only reaches Core.
CMD ["bun", "src/main.ts"]
