# SelloEasy — Claude Code guide

Multi-tenant B2B sales-intelligence SaaS. Orgs onboard a knowledge profile, define ICPs and buying
signals; a pipeline matches market events to signals with an LLM (OpenRouter), turns them into
BANT+-scored leads, and sales teams work those leads (CRM stages, outreach, dashboards). Every
mutation is audited. The full design lives in `plan.md`; the published docs live in `docs/`
(rendered at `/docs` by Fumadocs).

## Architecture map

| Path                | What goes here                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`          | Fastify HTTP API. `src/modules/*.ts` (one plugin per module), `src/plugins/` (auth, audit, errors), `src/lib/` (errors, leads, stats…)                                                                                                                           |
| `apps/worker`       | BullMQ processors (queues in `packages/core/src/queues.ts`: profile, pipeline, outreach, maintenance)                                                                                                                                                            |
| `apps/web`          | Next.js 16 UI + Fumadocs at `/docs`. **Read `apps/web/AGENTS.md` first — Next 16 has breaking changes; check `node_modules/next/dist/docs/`.**                                                                                                                   |
| `apps/docs-site`    | Standalone Fumadocs site (port `DOCS_PORT`, 3001) rendering the same `docs/` folder (ADR-0019). Keep `components/mdx.tsx` in sync with web.                                                                                                                      |
| `packages/shared`   | zod DTOs (`dto.ts`), enums, RBAC matrix (`rbac.ts`), pagination, scoring types, **env schema (`env.ts`)**. Only runtime dep: `zod`.                                                                                                                              |
| `packages/core`     | Config (`getConfig`/`initConfig`), pino logger, redis, queues, storage, mail, crypto, password                                                                                                                                                                   |
| `packages/db`       | Drizzle schema (`src/schema/*.ts`), migrations (`drizzle/`), client (`getDb`, `DbOrTx`), migrate/reset                                                                                                                                                           |
| `packages/llm`      | OpenRouter client + versioned prompts (`src/prompts/*.ts`) with zod schema + deterministic `mock`                                                                                                                                                                |
| `packages/pipeline` | **Pure** stages + scoring math (prefilter, dedupe, BANT+). No DB/HTTP/env. Vitest unit tests in `test/`.                                                                                                                                                         |
| `packages/engine`   | I/O orchestration shared by api/worker/seed: `writeAudit`, `createLlm`, knowledge ingest, `runPipeline`, `scoreLead`                                                                                                                                             |
| `packages/dataset`  | Synthetic demo corpus (5 orgs, events, directory). `pnpm --filter @selloeasy/dataset validate`                                                                                                                                                                   |
| `packages/seed`     | Seed runner (`pnpm db:seed`)                                                                                                                                                                                                                                     |
| `docs/`             | Fumadocs MDX in five sidebar tabs (`root: true` folders): `(guide)`, `(architecture)`, `operations`, `decisions`, `(project)`. `(name)` folders don't change URLs. ADRs in `docs/decisions/NNNN-*.mdx` (+ `decisions/index.mdx`), `docs/(project)/changelog.mdx` |
| `infra/`            | AWS CDK app                                                                                                                                                                                                                                                      |

**Dependency rules**

- `apps/*` may import `packages/*`; **`packages/*` never import `apps/*`.**
- `packages/pipeline` is pure: inputs in, outputs out. The engine/worker wires I/O.
- **Only `packages/llm` talks to an LLM.** Everything else goes through `LlmClient.run(prompt, input)` (built by `createLlm` in engine).
- **Only `packages/core` reads env**, via `getConfig()` (validated by `packages/shared/src/env.ts`). Never `process.env.X` elsewhere.
- `packages/shared` depends only on `zod` — no node/DB imports.

## Commands

```bash
pnpm install                       # install workspace
docker compose up --build          # full local stack (postgres, redis, minio, mailpit, api, worker, web)
pnpm dev                           # web + api + worker + docs-site in watch mode (needs postgres/redis running)
pnpm dev:docs                      # docs site only → http://localhost:3001
pnpm test                          # vitest across packages (turbo)
pnpm test:report [--e2e]           # tests + Allure report served on :5252 (ALLURE_PORT)
pnpm typecheck                     # tsc across packages
pnpm db:generate                   # drizzle-kit generate after editing packages/db/src/schema
pnpm db:migrate | db:seed | db:reset
pnpm --filter @selloeasy/db exec drizzle-kit generate --custom --name <name>   # hand-written SQL migration
pnpm --filter @selloeasy/dataset validate
pnpm eval:pipeline                 # precision/recall eval of signal matching
pnpm env:check                     # env schema vs .env.example
pnpm docs:check                    # docs-sync CI check (must pass before you finish)
pnpm docs:sync-readme              # re-inject shared snippets into README
pnpm --filter @selloeasy/<pkg> test   # single package
```

## Conventions

- **TypeScript ESM**, strict. Prettier: single quotes, semicolons, width 110, trailing commas (a hook formats edited files).
- **Naming:** files kebab-case; DB tables/columns snake_case in SQL, camelCase in Drizzle; enums SCREAMING_CASE values defined once in `packages/shared/src/enums.ts` and reused by `pgEnum`; permissions `area:action` (e.g. `leads:update`); audit actions `entity.verb_past` (e.g. `icp.created`, `signal.disabled`).
- **IDs:** uuidv7 via the `id()` helper in `packages/db/src/schema/_helpers.ts`. Timestamps via `...timestamps` / `tsz()`.
- **DTOs:** request/response zod schemas and types live in `packages/shared/src/dto.ts`, shared by api and web. Routes pass them as `schema.body/querystring/params`.
- **Errors:** throw helpers from `apps/api/src/lib/errors.ts` (`badRequest`, `notFound`, `forbidden`, `conflict`, `unprocessable`…). The errors plugin renders RFC 7807 `application/problem+json`. Cross-tenant access → `notFound`, never `forbidden`.
- **Logging:** pino via `createLogger(service)` / `req.log`. Structured objects first: `log.warn({ err }, 'msg')`. Never log secrets/PII (see `REDACT_PATHS` in `packages/core/src/logger.ts`).
- **Pagination:** `pageQuerySchema` + `offsetOf` + `toPage` from `packages/shared/src/pagination.ts`; leads default to 6/page (ADR-0005).
- **In-code ADR pointers** for non-obvious choices: `// ADR-0005: offset pagination — see /docs/decisions/0005-…`.

## NON-NEGOTIABLES

1. **Tenant scoping on every tenant query.** `eq(table.orgId, orgIdOf(req))` in every select/update/delete; for leads use `loadLead(auth, id)` / `leadFilters` / `visibilityFilter` in `apps/api/src/lib/leads.ts`. The org id comes from the session (`req.auth.orgId`), **never** from body/query/params.
2. **RBAC preHandler on every route (default-deny).** Tenant routes: `preHandler: requireOrg('<permission>')`; platform routes: `requirePermission('platform:…')` (both in `apps/api/src/plugins/auth.ts`). New permissions go in `packages/shared/src/rbac.ts` (`PERMISSIONS` + `ROLE_PERMISSIONS`). SDR ownership: `assertLeadOwnership`.
3. **Audit every mutation in the same transaction.** `await req.audit({ action, entityType, entityId, before, after }, tx)` inside `getDb().transaction(async (tx) => …)` when the change spans more than one write. Worker/engine code uses `writeAudit(tx, …)`. `audit_logs` is append-only (DB trigger).
4. **Super Admin sees only public data** (ADR-0010): platform responses are built from explicit allow-list DTOs (`PlatformOrgPublicView`, aggregates). Never reuse tenant DTOs or spread DB rows into platform responses. `requireOrg` rejects super admins.
5. **LLM only through `packages/llm`**; the provider is `LLM_PROVIDER` (openrouter | openai | anthropic) and the model comes from that provider's env var (`OPENROUTER_MODEL` / `OPENAI_MODEL` / `ANTHROPIC_MODEL`) (ADR-0009, ADR-0017). Provider quirks live in `packages/llm/src/providers/`. **Never hard-code a model name** anywhere (code, tests, docs examples use `$OPENROUTER_MODEL` etc.).
6. **New env var** → `packages/shared/src/env.ts` + `.env.example` + `docs/(guide)/getting-started/environment-variables.mdx` (then `pnpm env:check`).
7. **Any optimization / trade-off** → new or updated ADR in `docs/decisions/` + row in `docs/decisions/index.mdx` + update the relevant docs page + `docs/(project)/changelog.mdx`, **in the same change**. Schema, endpoint, prompt, or env changes must touch `docs/` (enforced by `pnpm docs:check`).
8. **New/changed prompt** → bump `version`, zod `schema`, deterministic `mock` fixture (tests run with `LLM_MODE=mock`), update `docs/(architecture)/pipeline/prompts.mdx`.
9. **Tests alongside code.** Pipeline/shared logic: Vitest unit tests. **Every new endpoint: RBAC-per-role tests + a cross-tenant negative test** (org B cannot read/mutate org A's resource → 404).
10. Never edit an applied migration; never read or print `.env`; never commit secrets.

## Where new code goes

| You are adding…                  | Put it in                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Request/response shape           | `packages/shared/src/dto.ts` (zod schema + inferred type), exported from `src/index.ts`              |
| Enum / status value              | `packages/shared/src/enums.ts` (+ `pgEnum` in `packages/db/src/schema/_helpers.ts`)                  |
| Permission                       | `packages/shared/src/rbac.ts` + docs `concepts/roles-and-permissions.mdx`                            |
| Table / column / index           | `packages/db/src/schema/<area>.ts` → `pnpm db:generate` (see db-migration skill)                     |
| Route                            | `apps/api/src/modules/<module>.ts`, registered in `apps/api/src/server.ts`                           |
| Query helpers reused by routes   | `apps/api/src/lib/<area>.ts`                                                                         |
| Logic shared by api + worker     | `packages/engine/src/`                                                                               |
| Pure computation (scoring, etc.) | `packages/pipeline/src/` + `packages/pipeline/test/*.test.ts`                                        |
| Prompt                           | `packages/llm/src/prompts/<area>.ts`, re-exported from `prompts/index.ts`                            |
| Background job                   | job type + queue in `packages/core/src/queues.ts`, processor in `apps/worker/src/index.ts`           |
| Page / component                 | `apps/web/app/...` (client pages) + `apps/web/components/<feature>/`, primitives in `components/ui/` |

Roles: `SUPER_ADMIN` (platform only, no org membership) and org roles `ORG_ADMIN`, `SALES_MANAGER`,
`SDR`, `VIEWER`. The server is the only enforcement point; the web `<Can>` gate only hides controls.

## Definition of done (every change)

- [ ] `pnpm typecheck` and `pnpm test` pass (tests run with `LLM_MODE=mock`, no network).
- [ ] Non-negotiables above hold (tenant scope, RBAC, audit, ADR-0010 boundary, no model names, env via core).
- [ ] Docs updated per the doc-keeper mapping; `docs/(project)/changelog.mdx` has an entry; `pnpm docs:check` passes.
- [ ] Trade-offs recorded as an ADR; non-obvious code carries an `// ADR-NNNN` pointer.

## Skills (`.claude/skills/`)

| Skill                                                        | Use when                                           |
| ------------------------------------------------------------ | -------------------------------------------------- |
| [code-writer](.claude/skills/code-writer/SKILL.md)           | Implementing any feature end-to-end                |
| [api-endpoint](.claude/skills/api-endpoint/SKILL.md)         | Adding/changing a Fastify route                    |
| [db-migration](.claude/skills/db-migration/SKILL.md)         | Any Drizzle schema change or SQL migration         |
| [pipeline-prompt](.claude/skills/pipeline-prompt/SKILL.md)   | Adding/changing prompts or pipeline stages         |
| [frontend-feature](.claude/skills/frontend-feature/SKILL.md) | Building UI in `apps/web`                          |
| [tester](.claude/skills/tester/SKILL.md)                     | Writing or running tests                           |
| [code-reviewer](.claude/skills/code-reviewer/SKILL.md)       | Reviewing a diff/PR                                |
| [security-auditor](.claude/skills/security-auditor/SKILL.md) | Auth/upload/crawler changes, pre-release           |
| [doc-keeper](.claude/skills/doc-keeper/SKILL.md)             | After any code change — sync docs, ADRs, changelog |
| [release-docker](.claude/skills/release-docker/SKILL.md)     | Dockerfiles, compose, infra/CDK changes            |

Subagents in `.claude/agents/`: `reviewer` (read-only, code-reviewer skill), `test-runner` (runs and
triages tests), `docs-writer` (edits only `docs/**` and `README.md`). Typical flow:
code-writer → tester → doc-keeper → reviewer.
