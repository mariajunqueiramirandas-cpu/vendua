# Shared storefront image — one per tenant storefront. Build context is the
# REPO ROOT:
#   docker build -f storefronts/Dockerfile \
#     --build-arg STOREFRONT=quero-pudim \
#     --build-arg PKG=@vendua/storefront-quero-pudim \
#     -t vendua-store-quero-pudim .
#
# The vite build emits static files; nginx serves them with SPA fallback and
# proxies the reserved API prefixes (/storefront/v1, /checkout/v1, /v1) to the
# internal `core` service, forwarding Host so tenant resolution stays
# host-based — the public domain must exist in the `domains` table
# (see deploy/dokploy.md).

FROM oven/bun:1.4.2 AS build
ARG STOREFRONT
ARG PKG
WORKDIR /app

# Every workspace package.json must be present: --frozen-lockfile resolves
# the full workspace graph from bun.lock and fails on a pruned checkout
# missing one.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/conformance/package.json packages/conformance/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY apps/control/package.json apps/control/package.json
COPY site/package.json site/package.json
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/brasa/package.json storefronts/brasa/package.json
COPY storefronts/forn/package.json storefronts/forn/package.json
COPY storefronts/_examples/quero-pudim/package.json storefronts/_examples/quero-pudim/package.json
COPY storefronts/_template/package.json storefronts/_template/package.json
RUN bun install --frozen-lockfile

COPY packages/kernel packages/kernel
COPY storefronts/${STOREFRONT} storefronts/${STOREFRONT}
RUN bun --filter ${PKG} build

FROM nginx:1.28-alpine AS production
ARG STOREFRONT
COPY storefronts/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/storefronts/${STOREFRONT}/dist /usr/share/nginx/html
EXPOSE 80
