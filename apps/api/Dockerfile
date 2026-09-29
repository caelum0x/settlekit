# syntax=docker/dockerfile:1
# Multi-stage build for the SettleKit API (@settlekit/api).
# Build context is the monorepo root: `docker build -f apps/api/Dockerfile .`

# ---- Base: Node 22 + pnpm via Corepack -------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- Dependencies: install only the api and its workspace deps (frozen) ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter settlekit --filter "@settlekit/api..."

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
# Apply pending migrations (idempotent), then serve. Render's preDeployCommand
# is paid-plan only, so the free API migrates on boot.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then node /app/packages/database/dist/cli.js; fi && exec node dist/server.js"]
