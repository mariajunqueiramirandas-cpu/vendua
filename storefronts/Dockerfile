# The site image and the storefront publisher (the legacy compose's one-shot; CI publishes since
# ADR 0041) from one shared install — context is the repo root.

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

FROM oven/bun:1.4.2 AS build
WORKDIR /app

COPY --from=manifests /out/ ./
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
# the site's sign-up links point at the merchant admin (site/README.md); unset = its default
ARG PUBLIC_ADMIN_URL
# Google Analytics (G-…) and Google Ads (AW-…) tag ids for the site (site/src/lib/gtag.ts); unset = no Google tag
ARG PUBLIC_GA_ID
ARG PUBLIC_GOOGLE_ADS_ID
RUN bun --filter @vendua/site build

FROM nginx:1.28-alpine AS site
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site/build /usr/share/nginx/html
EXPOSE 80

# One-shot on every deploy: each storefront's dist/ becomes an immutable, content-addressed
# release in the artifact store, registered with the Control Plane, which promotes it where
# the fleet policy says. Unchanged storefronts hash to the release they already have (no-op).
# Storefront sources only here, so a store's change never rebuilds the site image.
FROM build AS publish
COPY storefronts storefronts
RUN bun --filter './storefronts/*' build
ARG GIT_COMMIT
ENV GIT_COMMIT=${GIT_COMMIT}
CMD ["bun", "packages/cli/src/main.ts", "release", "publish", "--all", "--no-build"]
