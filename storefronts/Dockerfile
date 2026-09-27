# all static web images from one shared build stage — build context is the repo root
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# every workspace package.json required — --frozen-lockfile resolves the full workspace graph
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/codemods/package.json packages/codemods/package.json
COPY packages/conformance/package.json packages/conformance/package.json
COPY packages/conformance/fixtures/override-crash/package.json packages/conformance/fixtures/override-crash/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/loader/package.json packages/loader/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/ui-defaults/package.json packages/ui-defaults/package.json
COPY apps/control/package.json apps/control/package.json
COPY site/package.json site/package.json
# New storefronts go here — one COPY per workspace package.json.
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/_examples/quero-pudim/package.json storefronts/_examples/quero-pudim/package.json
COPY storefronts/_template/package.json storefronts/_template/package.json
RUN --mount=type=cache,id=vendua-bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY packages/kernel packages/kernel
COPY packages/ui-defaults packages/ui-defaults
COPY packages/templates packages/templates
COPY site site
COPY storefronts storefronts
RUN bun --filter @vendua/site build && bun --filter './storefronts/*' build

FROM nginx:1.28-alpine AS site
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site/build /usr/share/nginx/html
EXPOSE 80

# SPA fallback + proxies reserved API prefixes to `core` forwarding Host (tenant routing)
FROM nginx:1.28-alpine AS storefront
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
ARG STOREFRONT
COPY storefronts/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/storefronts/${STOREFRONT}/dist /usr/share/nginx/html
EXPOSE 80
