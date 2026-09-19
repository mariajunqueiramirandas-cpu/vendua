# Venduá — all static web images (every storefront AND the teaser site) from
# ONE shared build stage: a deploy runs a single `bun install` + one vite pass
# instead of repeating them per service. Build context is the REPO ROOT;
# compose services pick their stage via `target:`:
#
#   docker build -f storefronts/Dockerfile --target site -t vendua-site .
#   docker build -f storefronts/Dockerfile --target storefront \
#     --build-arg STOREFRONT=quero-pudim -t vendua-store-quero-pudim .
#
# New storefronts: the `./storefronts/*` glob builds them and
# `target: storefront` + `STOREFRONT` arg selects the dist — but its
# package.json still needs a COPY line in the manifest block below or
# --frozen-lockfile never installs its deps. See docs/deploy/dokploy.md.

########## build — shared by every web image ##########
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# Every workspace package.json must be present: --frozen-lockfile resolves
# the full workspace graph from bun.lock and fails on a pruned checkout
# missing one. The cache mount persists bun's package cache across builds.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/conformance/package.json packages/conformance/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY apps/control/package.json apps/control/package.json
COPY site/package.json site/package.json
# New storefronts go here — one COPY per workspace package.json.
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/brasa/package.json storefronts/brasa/package.json
COPY storefronts/forn/package.json storefronts/forn/package.json
COPY storefronts/_examples/quero-pudim/package.json storefronts/_examples/quero-pudim/package.json
COPY storefronts/_template/package.json storefronts/_template/package.json
RUN --mount=type=cache,id=vendua-bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY packages/kernel packages/kernel
COPY site site
COPY storefronts storefronts
RUN bun --filter @vendua/site build && bun --filter './storefronts/*' build

########## site — SvelteKit static output ##########
FROM nginx:1.28-alpine AS site
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site/build /usr/share/nginx/html
EXPOSE 80

########## storefront — one nginx service per tenant ##########
# SPA fallback + proxies /storefront/v1, /checkout/v1, /v1 to `core`
# forwarding Host (host-based tenant routing — the public domain must exist
# in the `domains` table).
FROM nginx:1.28-alpine AS storefront
ARG STOREFRONT
COPY storefronts/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/storefronts/${STOREFRONT}/dist /usr/share/nginx/html
EXPOSE 80
