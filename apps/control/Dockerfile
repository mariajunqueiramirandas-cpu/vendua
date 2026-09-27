# Bakes the nginx conf into the image — a bind mount wouldn't recreate the
# container on conf changes (nginx keeps serving the config it read at boot).
FROM nginx:1.28-alpine
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
