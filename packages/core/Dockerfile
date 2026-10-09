# Build from repo root: docker build -f packages/core/Dockerfile -t vendua-core .
# Runtime: DATABASE_URL, MIGRATION_DATABASE_URL, SESSION_SECRET, VENDUA_APP_DB_PASSWORD.

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app

# All workspace manifests must be present or --frozen-lockfile fails.
COPY package.json bun.lock tsconfig.base.json ./
# patchedDependencies (package.json) are applied at install
COPY patches patches
COPY packages/agent-runtime/package.json packages/agent-runtime/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/codemods/package.json packages/codemods/package.json
COPY packages/conformance/package.json packages/conformance/package.json
COPY packages/conformance/fixtures/override-crash/package.json packages/conformance/fixtures/override-crash/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/edge/package.json packages/edge/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/loader/package.json packages/loader/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/ui-defaults/package.json packages/ui-defaults/package.json
COPY apps/control/package.json apps/control/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY site/package.json site/package.json
# New workspaces go here.
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/_template/package.json storefronts/_template/package.json
RUN --mount=type=cache,id=vendua-bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Core runs @vendua/templates (template model, migrations) and serves @vendua/loader (v.js);
# the merchant admin reads the Kernel's section catalog (pure data) at build time.
COPY packages/templates packages/templates
COPY packages/loader packages/loader
COPY packages/kernel packages/kernel
# Core imports the Agent Runtime v3 sources (ADR 0030)
COPY packages/agent-runtime packages/agent-runtime

# Control SPA — built in-image so Core can serve apps/control/dist at /control/.
COPY apps/control apps/control
RUN cd apps/control && bun run build

# Merchant admin SPA — Core serves apps/admin/dist at /admin/.
# the mascot art the admin imports from /brand (an empty glob would ship broken images)
COPY brand brand
COPY apps/admin apps/admin
RUN cd apps/admin && bun run build

COPY packages/core packages/core

ENV NODE_ENV=production
WORKDIR /app/packages/core
EXPOSE 8787
# The image's non-root user. /app stays root-owned and read-only to it: Core writes nothing
# to disk (Baileys auth, media and sessions live in Postgres) and the core service mounts no volume.
USER bun

# Boot runs migrations then serves; seeding is opt-in via SEED_DEMO=1.
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
