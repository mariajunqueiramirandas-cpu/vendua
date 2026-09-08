# Venduá — static site (SvelteKit + adapter-static)
# Build:  docker build -t vendua .
# Run:    docker run --rm -p 8080:80 vendua
# Health: curl http://localhost:8080/

########## build ##########
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# Dependency layer cached unless manifests change
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

########## runtime ##########
FROM nginx:1.27-alpine AS production

COPY --from=build /app/build /usr/share/nginx/html

# nginx.conf lives beside this Dockerfile so $uri survives (no shell expansion).
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
