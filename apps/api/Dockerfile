# syntax=docker/dockerfile:1
# Multi-stage build for the SettleKit API (@settlekit/api).
# Build context is the monorepo root: `docker build -f apps/api/Dockerfile .`

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

# ---- Build: compile package deps + the api via tsc project references ------
FROM deps AS build
# `tsc -b` on the api walks its referenced packages and builds them in order.
RUN pnpm --filter @settlekit/api... build

# ---- Production deps: prune dev dependencies -------------------------------
FROM build AS prod-deps
RUN pnpm --filter @settlekit/api... install --prod --frozen-lockfile

# ---- Runtime: ship dist + production node_modules --------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app

# Workspace metadata so pnpm can resolve the workspace symlinks at runtime.
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules

# Built output + production deps for every package the api depends on.
COPY --from=build /app/packages ./packages
COPY --from=prod-deps /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules

WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "dist/server.js"]
