# syntax=docker/dockerfile:1
# Multi-stage build for the SettleKit background worker (@settlekit/worker).
# Build context is the monorepo root: `docker build -f apps/worker/Dockerfile .`

# ---- Base: Node 20 + pnpm via Corepack -------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- Dependencies: install the full workspace (frozen) ---------------------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

# ---- Build: compile package deps + the worker via tsc project references ---
FROM deps AS build
# `tsc -b` on the worker walks its referenced packages and builds them in order.
RUN pnpm --filter @settlekit/worker... build

# ---- Production deps: prune dev dependencies -------------------------------
FROM build AS prod-deps
RUN pnpm --filter @settlekit/worker... install --prod --frozen-lockfile

# ---- Runtime: ship dist + production node_modules --------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Workspace metadata so pnpm can resolve the workspace symlinks at runtime.
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules

# Built output + production deps for every package the worker depends on.
COPY --from=build /app/packages ./packages
COPY --from=prod-deps /app/packages ./packages
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules

WORKDIR /app/apps/worker
CMD ["node", "./dist/index.js"]
