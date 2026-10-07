# syntax=docker/dockerfile:1
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS base
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS dependencies
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY containers ./containers
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod=false --store-dir=/pnpm/store

FROM dependencies AS web-build
RUN node containers/build-web.mjs

FROM base AS web
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --chown=node:node containers/probe.mjs ./containers/probe.mjs
ENV PORT=3000 HOSTNAME=0.0.0.0
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD ["node", "containers/probe.mjs", "live", "web"]
CMD ["node", "apps/web/server.js"]

FROM dependencies AS worker-build
RUN pnpm --filter @modular-crm/worker build \
    && pnpm --filter @modular-crm/worker deploy --prod --legacy /runtime/worker

FROM base AS worker-runtime
COPY --from=worker-build --chown=node:node /runtime/worker ./
COPY --chown=node:node containers/probe.mjs ./containers/probe.mjs
USER node

FROM worker-runtime AS migrate
# One-shot process: never invoked by web/worker startup and requires DATABASE_URL.
CMD ["node", "dist/migrate/index.js"]

FROM worker-runtime AS worker
ENV WORKER_HEALTH_PORT=3001
EXPOSE 3001
# Database failover affects readiness, not process liveness/restart.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD ["node", "containers/probe.mjs", "live", "worker"]
CMD ["node", "dist/index.js"]
