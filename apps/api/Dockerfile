# syntax=docker/dockerfile:1.7
# SelloEasy API image — also used by the one-shot `migrate` service / ECS migrate task
# (it contains @selloeasy/db migrations and the @selloeasy/seed runner).
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm i -g pnpm@10.34.5 turbo@2.5.8 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @selloeasy/api @selloeasy/seed --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .

FROM base AS runner
ENV NODE_ENV=production
# AWS RDS CA bundle for DATABASE_SSL=true (ADR-0012).
RUN mkdir -p /app/certs && (curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem || echo "RDS bundle download skipped")
COPY --from=installer --chown=node:node /app /app
USER node
EXPOSE 4000
# tsx runs the TypeScript sources directly (no bundling step — see ADR in /docs/decisions).
CMD ["pnpm", "--filter", "@selloeasy/api", "start"]
