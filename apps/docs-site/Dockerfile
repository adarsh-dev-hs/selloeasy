# syntax=docker/dockerfile:1.7
# SelloEasy docs-site image — standalone Fumadocs app rendering the repo-root docs/ folder.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@10.34.5 turbo@2.5.8
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @selloeasy/docs-site --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# The documentation source lives at the repo root — not part of any workspace package.
COPY docs ./docs
RUN pnpm --filter @selloeasy/docs-site build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/docs-site/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/docs-site/.next/static ./apps/docs-site/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/docs-site/server.js"]
