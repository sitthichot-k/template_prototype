# =============================================================================
#  Backend image - multi-stage, non-root, distroless-adjacent.
#
#  Targets:
#    development  bind-mounted source + nodemon      (docker-compose.local.yml)
#    production   pruned deps, read-only friendly    (preproduction/production)
# =============================================================================

ARG NODE_VERSION=20.18-alpine

# --- Stage: base -------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
# dumb-init reaps zombies and forwards signals, so SIGTERM actually reaches
# Node and the graceful shutdown in server.js runs.
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# --- Stage: dependencies -----------------------------------------------------
# Separated so a source-only change does not invalidate the npm cache layer.
FROM base AS dependencies
COPY package*.json ./
RUN npm ci --include=dev

# --- Stage: development ------------------------------------------------------
FROM base AS development
ENV NODE_ENV=development
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# A named volume mounted at /app/node_modules inherits its ownership from the
# image, so it must be writable by the unprivileged user before the volume is
# created - otherwise anything that writes into node_modules at runtime fails
# with EACCES.
RUN chown -R node:node /app
EXPOSE 8080 9229
USER node
CMD ["dumb-init", "npm", "run", "start:dev"]

# --- Stage: build ------------------------------------------------------------
# Prunes dev dependencies. There is no transpile step - the backend is plain
# CommonJS by design, which keeps the production image close to the source
# that was reviewed.
FROM dependencies AS build
COPY . .
RUN npm prune --omit=dev && npm cache clean --force

# --- Stage: production -------------------------------------------------------
FROM base AS production

# Drop the shell-capable default user; run as an unprivileged account that
# owns nothing writable in the image.
RUN addgroup -g 10001 -S app && adduser -u 10001 -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/config       ./config
COPY --from=build --chown=app:app /app/middleware   ./middleware
COPY --from=build --chown=app:app /app/server       ./server
COPY --from=build --chown=app:app /app/scripts      ./scripts
# Migrations must ship with the image: production runs `npm run migrate` inside
# the container, and anything outside the build context is simply not there.
COPY --from=build --chown=app:app /app/database     ./database
COPY --from=build --chown=app:app /app/server.js    ./server.js
COPY --from=build --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 8080

# Matches the compose healthcheck so `docker run` alone still reports health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
