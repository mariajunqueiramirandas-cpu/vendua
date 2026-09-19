# @vendua/core — Bun + Hono API. Build context is the REPO ROOT
# (bun.lock + workspace manifests live there):
#   docker build -f packages/core/Dockerfile -t vendua-core .
#
# Runtime needs DATABASE_URL (app role), MIGRATION_DATABASE_URL (owner —
# migrations run on boot), SESSION_SECRET, VENDUA_APP_DB_PASSWORD.
# Dokploy compose: see deploy/dokploy.md.

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app

# Workspace manifests only — enough for bun install to resolve the graph.
# Every workspace package.json must be present: --frozen-lockfile resolves
# the full graph from bun.lock and fails on a pruned checkout missing one.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/conformance/package.json packages/conformance/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY apps/control/package.json apps/control/package.json
COPY site/package.json site/package.json
# New workspaces go here — one COPY per package.json or --frozen-lockfile
# fails on the missing workspace.
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/brasa/package.json storefronts/brasa/package.json
COPY storefronts/forn/package.json storefronts/forn/package.json
COPY storefronts/_examples/quero-pudim/package.json storefronts/_examples/quero-pudim/package.json
COPY storefronts/_template/package.json storefronts/_template/package.json
RUN --mount=type=cache,id=vendua-bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Control SPA — built in-image so Core can serve apps/control/dist at /control/.
COPY apps/control apps/control
RUN cd apps/control && bun run build

COPY packages/core packages/core

ENV NODE_ENV=production
WORKDIR /app/packages/core
EXPOSE 8787

# Boot runs migrations (owner DSN) then serves; seeding is opt-in via
# SEED_DEMO=1 — see docker-entrypoint.sh.
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
