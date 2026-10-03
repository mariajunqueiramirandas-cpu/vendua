# the site image and the storefront publisher from one shared build stage — context is the repo root
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# every workspace package.json required — --frozen-lockfile resolves the full workspace graph
COPY package.json bun.lock tsconfig.base.json ./
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
# New storefronts go here — one COPY per workspace package.json.
COPY storefronts/quero-pudim/package.json storefronts/quero-pudim/package.json
COPY storefronts/_template/package.json storefronts/_template/package.json
RUN --mount=type=cache,id=vendua-bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY packages/kernel packages/kernel
COPY packages/ui-defaults packages/ui-defaults
COPY packages/templates packages/templates
# `vendua release publish` (the publish target) and the artifact store it writes to
COPY packages/cli packages/cli
COPY packages/codemods packages/codemods
COPY packages/edge packages/edge
# site/scripts/validate.ts checks the site palette against the admin's tokens
COPY apps/admin/src/ui/theme.css apps/admin/src/ui/theme.css
COPY site site
COPY storefronts storefronts
# the site's sign-up links point at the merchant admin (site/README.md); unset = its default
ARG PUBLIC_ADMIN_URL
RUN bun --filter @vendua/site build \
    && bun --filter './storefronts/*' build

FROM nginx:1.28-alpine AS site
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site/build /usr/share/nginx/html
EXPOSE 80

# One-shot on every deploy: each storefront's dist/ becomes an immutable, content-addressed
# release in the artifact store, registered with the Control Plane, which promotes it where
# the fleet policy says. Unchanged storefronts hash to the release they already have (no-op).
FROM build AS publish
ARG GIT_COMMIT
ENV GIT_COMMIT=${GIT_COMMIT}
CMD ["bun", "packages/cli/src/main.ts", "release", "publish", "--all", "--no-build"]
