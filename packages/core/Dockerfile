# Build from repo root: docker build -f packages/core/Dockerfile -t vendua-core .
# Runtime: DATABASE_URL, MIGRATION_DATABASE_URL, SESSION_SECRET, VENDUA_APP_DB_PASSWORD.

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app

# All workspace manifests must be present or --frozen-lockfile fails.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/conformance/package.json packages/conformance/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY apps/control/package.json apps/control/package.json
COPY site/package.json site/package.json
# New workspaces go here.
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

# Boot runs migrations then serves; seeding is opt-in via SEED_DEMO=1.
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
