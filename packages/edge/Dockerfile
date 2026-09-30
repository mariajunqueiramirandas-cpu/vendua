# Build from repo root: docker build -f packages/edge/Dockerfile -t vendua-edge .
# Runtime: VENDUA_CORE_URL, VENDUA_EDGE_SECRET, VENDUA_ARTIFACTS (+ S3_* for s3://) — see README.md.

FROM oven/bun:1.4.2
WORKDIR /app

# The edge has no dependencies (node: builtins + Bun APIs only), so the image is its sources:
# no workspace manifests, no lockfile, no bun install.
COPY packages/edge/package.json packages/edge/package.json
COPY packages/edge/src packages/edge/src
COPY packages/edge/pages packages/edge/pages

# route/state snapshot + verified release files; mount a volume here to keep them across deploys
RUN mkdir -p /var/cache/vendua-edge && chown bun:bun /var/cache/vendua-edge

ENV NODE_ENV=production \
    PORT=8080 \
    VENDUA_EDGE_CACHE_DIR=/var/cache/vendua-edge
WORKDIR /app/packages/edge
EXPOSE 8080
USER bun
CMD ["bun", "src/main.ts"]
