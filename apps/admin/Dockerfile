# The merchant admin's own domain (docs/deploy/dokploy.md). Core builds and serves the
# app; this proxy only exposes /admin and the media it shows. The conf is baked in —
# a bind mount wouldn't recreate the container on conf changes.
FROM nginx:1.28-alpine
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
