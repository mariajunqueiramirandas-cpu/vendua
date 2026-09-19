# Venduá — static site (SvelteKit + adapter-static)
# Build context is the REPO ROOT (bun.lock lives at the workspace root):
#   docker build -f site/Dockerfile -t vendua .
# Run:    docker run --rm -p 8080:80 vendua
# Health: curl http://localhost:8080/

########## build ##########
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# Dependency layer cached unless manifests change. Every workspace
# package.json must be present: --frozen-lockfile resolves the full
# workspace graph from bun.lock and fails on a pruned checkout missing one.
COPY package.json bun.lock ./
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

COPY site/ site/
RUN bun --filter @vendua/site build

########## runtime ##########
FROM nginx:1.28-alpine AS production

COPY --from=build /app/site/build /usr/share/nginx/html

# nginx.conf lives beside this Dockerfile so $uri survives (no shell expansion).
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
