# =============================================================================
#  Frontend image - builds the SPA, serves it from nginx as a non-root user.
#
#  Targets:
#    development  vite dev server              (docker-compose.local.yml)
#    production   static build behind nginx    (preproduction/production)
# =============================================================================

ARG NODE_VERSION=20.18-alpine
ARG NGINX_VERSION=1.27-alpine

# --- Stage: dependencies -----------------------------------------------------
FROM node:${NODE_VERSION} AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Stage: development ------------------------------------------------------
FROM node:${NODE_VERSION} AS development
WORKDIR /app
ENV NODE_ENV=development
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# A named volume mounted at /app/node_modules inherits its ownership from the
# image. Without this chown the directory arrives root-owned, and Vite - which
# runs as `node` and writes /app/node_modules/.vite-temp while loading the
# config - fails with EACCES before the dev server ever starts.
RUN chown -R node:node /app
EXPOSE 8080
USER node
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

# --- Stage: build ------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
# APP_ENV selects which .env.<tier> Vite reads, so one Dockerfile produces the
# correct bundle for every tier.
ARG APP_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build -- --mode "${APP_ENV}"

# --- Stage: production -------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS production

# Content-Security-Policy extension points, resolved here rather than at
# container start: nginx's own /etc/nginx/templates mechanism writes into
# /etc/nginx/conf.d when the container boots, and the production overlay runs
# this image read-only, as a non-root user, with cap_drop ALL. Baking the
# policy into the image also means the running container cannot be talked into
# a weaker one.
#
# Empty by default, so an image built without them carries the same policy the
# template has always shipped. Set them per tier in the env file.
ARG CSP_IMG_SRC_EXTRA=""
ARG CSP_CONNECT_SRC_EXTRA=""
ARG CSP_FONT_SRC_EXTRA=""

COPY --from=build /app/dist /usr/share/nginx/html
# Must live inside the build context - `infra/nginx/default.conf` at the repo
# root is the source of truth and is copied here by the generator.
COPY nginx/default.conf /tmp/default.conf.template

# The explicit variable list matters: without it envsubst would also expand
# nginx's own runtime variables - $host, $remote_addr, $uri - into empty
# strings, and the API proxy would silently stop forwarding headers.
RUN envsubst '${CSP_IMG_SRC_EXTRA} ${CSP_CONNECT_SRC_EXTRA} ${CSP_FONT_SRC_EXTRA}' \
      < /tmp/default.conf.template > /etc/nginx/conf.d/default.conf \
    && rm /tmp/default.conf.template \
    && grep -q 'Content-Security-Policy' /etc/nginx/conf.d/default.conf \
    && ! grep -q '[$]{CSP_' /etc/nginx/conf.d/default.conf

# nginx must be able to write its pid and caches while the root filesystem is
# read-only; the compose overlay mounts tmpfs at these paths.
RUN sed -i 's,/var/run/nginx.pid,/var/run/nginx/nginx.pid,' /etc/nginx/nginx.conf \
    && sed -i '/user  nginx;/d' /etc/nginx/nginx.conf \
    && mkdir -p /var/run/nginx \
    && chown -R nginx:nginx /var/cache/nginx /var/run/nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
