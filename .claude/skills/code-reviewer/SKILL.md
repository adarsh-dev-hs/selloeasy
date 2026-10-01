---
name: code-reviewer
description: Reviews a SelloEasy diff or PR against the repo's non-negotiables (tenant isolation, RBAC, same-transaction audit, ADR-0010 boundary, LLM/env rules, docs sync) and outputs severity-ranked findings (blocker/major/minor/nit) with file:line. Use when asked to "review", "check this diff/PR", "audit my changes", or after a feature is implemented.
---

# code-reviewer

Read-only. Do not edit files; report findings.

## Step 1 — Collect the change

```bash
git status --porcelain
git diff --stat            # or: git diff main...HEAD --stat
git diff -U5 -- apps packages docs .env.example
```

Read each changed file fully where context matters (e.g. the whole route handler, the helper it calls).

## Step 2 — Walk the checklist

**Tenant isolation (blocker if violated)**

- Every select/update/delete on a tenant table includes `eq(<table>.orgId, orgIdOf(req))` (or `loadLead`, `leadFilters`).
- Org id never taken from body/query/params. Referenced ids (owner, contact, icp, signal) verified in the same org.
- Cross-tenant miss returns `notFound`, not `forbidden`.

**RBAC (blocker)**

- Every route has `preHandler: requireOrg(perm)` or `requirePermission(perm)`; permission is least-privileged.
- New permissions added to `packages/shared/src/rbac.ts` for the right roles; SDR ownership via `assertLeadOwnership`.

**Audit (major; blocker if a sensitive mutation is unaudited)**

- Every mutation calls `req.audit(...)`; multi-write changes run in `getDb().transaction` with `req.audit(entry, tx)`.
- Engine/worker mutations use `writeAudit(tx, …)`. No secrets in `before`/`after`.

**Super admin boundary — ADR-0010 (blocker)**

- `apps/api/src/modules/platform.ts` responses built from allow-list DTOs; no spreading of DB rows, no tenant DTO reuse, no private docs/leads/contacts.

**Input validation & errors (major)**

- zod `schema` on params/query/body (from `@selloeasy/shared`); errors via `apps/api/src/lib/errors.ts` (RFC 7807).

**Data access (major/minor)**

- N+1 queries (loops with awaits on DB) → batch with `inArray`.
- Transaction boundaries correct; optimistic locking (`version`) respected where present.
- Lists paginated (`toPage`, leads default 6); `limit` on unbounded queries.
- Tenant tables have leading `org_id` indexes; migrations reviewed, no edits to applied migrations.

**LLM & env (blocker)**

- LLM calls only via `packages/llm` prompts; output validated by zod; untrusted text wrapped with `doc()` + `UNTRUSTED_DATA_RULE`.
- No hard-coded model names (grep: `grep -rnE "(gpt-|claude-|gemini-|llama|mistral)" apps packages --include=*.ts`).
- Prompt changed → version bumped + mock updated.
- No `process.env` outside `packages/core`; new env var in `env.ts` + `.env.example` + docs.

**Architecture (major)**

- `packages/*` do not import `apps/*`; `packages/pipeline` has no db/fetch/env/clock; `packages/shared` only imports `zod`.

**Security (major)**

- Secrets/PII not logged; CSV export formula-injection safe; upload/crawler SSRF rules intact (see security-auditor).

**Frontend (minor)**

- Loading/empty/error states; `<Can>` gating; accessible labels; Next 16 APIs per `apps/web/AGENTS.md`.

**Tests & docs (major)**

- Tests for new logic; new endpoints have per-role and cross-tenant negative tests.
- Docs updated per doc-keeper mapping; ADR for trade-offs; `docs/(project)/changelog.mdx` entry.

## Step 3 — Report format

```
## Review: <scope>

### Blocker
- apps/api/src/modules/widgets.ts:42 — UPDATE lacks `eq(widgets.orgId, orgId)`; any tenant can modify any widget by id. Fix: add org filter to the where clause.

### Major
- …

### Minor
- …

### Nit
- …

### Summary
<1–3 lines: merge-ready? what must change first?>
```

Severity guide: **blocker** = data leak, auth bypass, lost audit, secret exposure, broken build/migration;
**major** = missing tests/docs for new behaviour, N+1, wrong transaction boundary, missing validation;
**minor** = UX states, naming, small perf; **nit** = style/wording. Every finding cites `file:line` and a concrete fix.
If nothing is found in a category, omit it. Do not pad.
