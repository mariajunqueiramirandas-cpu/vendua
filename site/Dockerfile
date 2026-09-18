# Venduá — static site (SvelteKit + adapter-static)
# Build context is the REPO ROOT (bun.lock lives at the workspace root):
#   docker build -f site/Dockerfile -t vendua .
# Run:    docker run --rm -p 8080:80 vendua
# Health: curl http://localhost:8080/

########## build ##########
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# Dependency layer cached unless manifests change
COPY package.json bun.lock ./
COPY site/package.json site/package.json
RUN bun install --frozen-lockfile

COPY site/ site/
RUN bun --filter @vendua/site run build

########## runtime ##########
FROM nginx:1.28-alpine AS production

COPY --from=build /app/site/build /usr/share/nginx/html

# nginx.conf lives beside this Dockerfile so $uri survives (no shell expansion).
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
