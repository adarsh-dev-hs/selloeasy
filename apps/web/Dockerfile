# syntax=docker/dockerfile:1.7
# SelloEasy web image — Next.js 16 standalone output (product UI + /docs).
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@10.34.5 turbo@2.5.8
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @selloeasy/web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# The documentation source lives at the repo root (plan §20) — not part of any workspace package.
COPY docs ./docs
RUN pnpm --filter @selloeasy/web build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
