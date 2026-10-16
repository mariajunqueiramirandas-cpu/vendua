# Build from repo root: docker build -f packages/core/Dockerfile -t vendua-core .
# Runtime: DATABASE_URL, MIGRATION_DATABASE_URL, SESSION_SECRET, VENDUA_APP_DB_PASSWORD.

# What `bun install` reads: the root files and every workspace's package.json, found from the
# root's `workspaces` globs (a new storefront needs no line here). The install layer below keys on
# these files' content, so it stays cached whatever else in the repo changed.
FROM oven/bun:1.4.2 AS manifests
WORKDIR /src
COPY . .
RUN bun -e "const { workspaces } = await Bun.file('package.json').json(); \
      for (const w of workspaces) for await (const f of new Bun.Glob(w + '/package.json').scan('.')) \
        await Bun.write('/out/' + f, Bun.file(f));" \
    && cp package.json bun.lock tsconfig.base.json /out/ \
    && cp -r patches /out/patches

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app

COPY --from=manifests /out/ ./
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

# Merchant admin SPA — Core serves apps/admin/dist at /admin/; and the iOS/Android app's
# over-the-air bundle from the same commit (ADR 0044 §2), served from apps/admin/bundles.
# the mascot art the admin imports from /brand (an empty glob would ship broken images)
COPY brand brand
COPY apps/admin apps/admin
# the website's x-vendua-client names its commit
ARG GIT_COMMIT=
RUN cd apps/admin && GIT_COMMIT=$GIT_COMMIT bun run build && bun run build:native

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
