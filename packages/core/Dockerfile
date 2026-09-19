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
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/brasa/package.json storefronts/brasa/package.json
COPY storefronts/forn/package.json storefronts/forn/package.json
COPY storefronts/_examples/quero-pudim/package.json storefronts/_examples/quero-pudim/package.json
COPY site/package.json site/package.json
RUN bun install --frozen-lockfile

COPY packages/core packages/core

ENV NODE_ENV=production
WORKDIR /app/packages/core
EXPOSE 8787

# Boot runs migrations (owner DSN) then serves; seeding is opt-in via
# SEED_DEMO=1 — see docker-entrypoint.sh.
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
