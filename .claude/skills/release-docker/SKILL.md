---
name: release-docker
description: Maintains SelloEasy containers and infra — multi-stage Dockerfiles (turbo prune), docker-compose health checks and env overrides, image size, AWS CDK diffs — and verifies the README/quickstart run steps. Use when changing Dockerfiles, docker-compose.yml, .dockerignore, infra/, or when asked to "release", "fix the docker build", "add a service", or "deploy to AWS".
---

# release-docker

## Files

- `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile` — multi-stage: `base` (node 22 slim + pnpm/turbo) →
  `pruner` (`turbo prune <pkg> --docker`) → `installer` (`pnpm install --frozen-lockfile` with cache mount) → `runner` (`USER node`).
  The API image also carries migrations + seed (used by the one-shot `migrate` service / ECS task).
- `docker-compose.yml` — postgres, redis, minio, mailpit + app services sharing the `x-app-env` anchor
  (container-network overrides win over `.env`). Same images run on ECS; only env differs (ADR-0012).
- `.dockerignore` — must exclude `.env`, `node_modules`, `.next`, `dist`, `.turbo`.
- `infra/` — AWS CDK app; `pnpm deploy:aws`, `pnpm deploy:aws:seed-demo`.

## Steps

1. Make the change. Keep: pinned `NODE_VERSION`, pnpm version matching `packageManager` in root `package.json`,
   `--frozen-lockfile`, cache mounts, non-root `USER node`, no secrets in `ARG`/`ENV`.
2. New service/env: add to `x-app-env` or the service, with `healthcheck` + `depends_on: { condition: service_healthy }`.
   New env var → also `packages/shared/src/env.ts`, `.env.example`, env docs (doc-keeper).
3. Build and run:
   ```bash
   docker compose build
   docker compose up --build -d
   docker compose ps                # all healthy
   docker compose logs -f api worker
   ```
4. Smoke test: web http://localhost:3000, API health, `/api/docs`, Mailpit http://localhost:8025, MinIO console :9001;
   log in with seeded accounts; run a pipeline in mock mode (empty `OPENROUTER_API_KEY`).
5. Image size: `docker images | grep selloeasy` — investigate regressions > 10%.
6. Infra: `cd infra && npx cdk diff` — review IAM, security groups, public exposure, RDS/ElastiCache settings before deploy.
7. Docs: `docs/operations/docker.mdx`, `docs/(guide)/getting-started/quickstart.mdx`, `docs/operations/aws-deployment.mdx`,
   changelog; ADR for trade-offs (e.g. running TS via tsx instead of bundling). `pnpm docs:sync-readme`, `pnpm docs:check`.

## Checklist

- [ ] Multi-stage, pruned, frozen lockfile, non-root, no `.env` in image
- [ ] Compose healthchecks + `service_healthy` dependencies; migrate runs before api/worker
- [ ] `docker compose up --build` from a clean clone works with only `cp .env.example .env`
- [ ] README quickstart steps verified verbatim
- [ ] CDK diff reviewed; no widened public access
- [ ] Docs + changelog updated
