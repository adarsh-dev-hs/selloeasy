---
name: code-writer
description: Implements a SelloEasy feature end-to-end across shared DTOs, db schema, engine, api routes, worker and web, following the repo's tenant/RBAC/audit/LLM rules and writing tests alongside. Use when asked to "implement", "add a feature", "build", "wire up", or "change behaviour of" anything in apps/ or packages/.
---

# code-writer

Implement features the SelloEasy way. Read `CLAUDE.md` (non-negotiables) before starting.

## Step 1 — Plan the slice

Decide which layers the feature touches, top to bottom, and keep dependencies pointing inward:

```
packages/shared (DTO, enum, permission)  ← used by everyone
packages/db     (schema + migration)     ← db-migration skill
packages/llm    (prompt)                 ← pipeline-prompt skill
packages/pipeline (pure logic)           ← no DB/HTTP/env
packages/engine (I/O orchestration, writeAudit, createLlm)
apps/api        (route)                  ← api-endpoint skill
apps/worker     (BullMQ processor)
apps/web        (UI)                     ← frontend-feature skill
```

Rules: `packages/*` never import `apps/*`; `packages/pipeline` stays pure; only `packages/llm` calls an
LLM; only `packages/core` reads env (`getConfig()`); `packages/shared` imports nothing but `zod`.

## Step 2 — Contracts first (`packages/shared`)

- Add zod schemas + `z.infer` types to `packages/shared/src/dto.ts` (request bodies `xxxSchema`,
  response interfaces like `LeadDetail`). Reuse `idParamSchema`, `pageQuerySchema`.
- New enum values → `packages/shared/src/enums.ts` (as `const` arrays) and, if persisted, a `pgEnum` in
  `packages/db/src/schema/_helpers.ts`.
- New permission → `PERMISSIONS` and `ROLE_PERMISSIONS` in `packages/shared/src/rbac.ts`. Super Admin gets
  only `platform:*` permissions (ADR-0010).
- New env var → `runtimeEnvShape` in `packages/shared/src/env.ts` + `.env.example` + docs env page.

## Step 3 — Data (`packages/db`)

Follow the **db-migration** skill. Every tenant table has `orgId: orgRef()` and an index starting with `org_id`.

## Step 4 — Logic

- Pure computations → `packages/pipeline/src/*.ts` with unit tests in `packages/pipeline/test/`.
- Anything needing DB/LLM/queues shared by api and worker → `packages/engine/src/`.
- LLM usage → a `PromptDefinition` in `packages/llm/src/prompts/` (see **pipeline-prompt**), executed with
  `llm.run(prompt, input, { orgId })`. Never hard-code a model name; the model is `OPENROUTER_MODEL`.
- Background work → add a job type to `packages/core/src/queues.ts` and handle it in `apps/worker/src/index.ts`.

## Step 5 — API

Follow the **api-endpoint** skill. Minimum per route:
`schema` (zod from shared) + `preHandler: requireOrg(perm)` / `requirePermission(perm)` + tenant filter via
`orgIdOf(req)` / `loadLead` + `req.audit(entry, tx)` for mutations + errors from `apps/api/src/lib/errors.ts`.

## Step 6 — UI

Follow the **frontend-feature** skill (TanStack Query + `@/lib/api` + `components/ui`, `<Can>` gating,
loading/empty/error states). Read `apps/web/AGENTS.md` — Next.js 16 differs from older versions.

## Step 7 — Tests (same change)

Follow the **tester** skill: unit tests for pure logic, and for every new endpoint RBAC-per-role +
cross-tenant negative tests. Run:

```bash
pnpm typecheck
pnpm --filter @selloeasy/<pkg> test   # then pnpm test
```

## Step 8 — Docs (same change)

Invoke the **doc-keeper** skill: update mapped docs pages, ADR for any trade-off, `docs/(project)/changelog.mdx`,
then `pnpm docs:check`.

## Checklist before handing off

- [ ] Every tenant query filters by `orgId` from the session (never from input)
- [ ] Every route has a `preHandler` guard and a zod `schema`
- [ ] Every mutation calls `req.audit(...)` (pass `tx` when inside a transaction) / `writeAudit(tx, ...)` in engine
- [ ] Platform (super admin) responses use allow-list DTOs only
- [ ] No `process.env` outside `packages/core`; no model names; no `console.log` (use pino)
- [ ] IDs via `id()` (uuidv7); timestamps via `...timestamps`
- [ ] Tests written and passing; `pnpm typecheck` clean
- [ ] Docs + changelog (+ ADR if trade-off) updated; `pnpm docs:check` passes
