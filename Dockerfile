# Day Planner: one image that serves the web app and its API on one address.
# Railway builds this automatically; it also runs on Fly.io, Render or any Docker host.

# ---- Build: install everything and build the web app ----
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Manifests first, so dependency installs are cached between deploys.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter web... --filter api...

COPY . .
RUN pnpm --filter web build

# ---- Run: only what the server needs ----
FROM node:22-slim
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --prod --filter api...

COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist

# Tasks and encrypted keys live on a volume mounted at /data (see README).
ENV WEB_DIST=/app/apps/web/dist \
    DATA_FILE=/data/store.json \
    PORT=8787
EXPOSE 8787

WORKDIR /app/apps/api
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
