# syntax=docker/dockerfile:1.7
# SelloEasy worker image — BullMQ processors (profile, pipeline, outreach, maintenance).
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm i -g pnpm@10.34.5 turbo@2.5.8 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @selloeasy/worker --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .

FROM base AS runner
ENV NODE_ENV=production
RUN mkdir -p /app/certs && (curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem || echo "RDS bundle download skipped")
COPY --from=installer --chown=node:node /app /app
USER node
CMD ["pnpm", "--filter", "@selloeasy/worker", "start"]
