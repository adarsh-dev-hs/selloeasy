---
name: security-auditor
description: Runs an OWASP ASVS-lite security audit of SelloEasy — authN/authZ, tenant isolation, ADR-0010 boundary, input validation, uploads, crawler SSRF, secrets, PII in logs, LLM prompt injection and dependencies — and reports severity-ranked findings. Use before releases, and when asked to "security review", "audit auth", or when changing auth, uploads, the crawler, exports, or platform routes.
---

# security-auditor

Read-only unless asked to fix. Report findings in the code-reviewer format (blocker/major/minor/nit, `file:line`, fix).

## Checklist

**Authentication** — `apps/api/src/modules/auth.ts`, `apps/api/src/plugins/auth.ts`, `packages/core/src/password.ts`

- [ ] argon2id hashing; password policy in `packages/shared/src/dto.ts`
- [ ] Login rate limit + lockout; failures audited (`auth.login_failed`, `auth.login_locked`)
- [ ] Refresh rotation with reuse detection (`auth.refresh_reuse_detected` revokes the family)
- [ ] Cookies `httpOnly`, `sameSite: 'lax'`, `secure` from `COOKIE_SECURE`; refresh cookie path `/api/v1/auth`
- [ ] Invite/reset tokens stored hashed, single-use, expiring (`INVITE_TTL_HOURS`)
- [ ] Disabled users / suspended orgs lose access on next request (`resolveAuth`)

**Authorization & tenancy**

- [ ] `grep -nE "app\.(get|post|put|patch|delete)\(" apps/api/src/modules/*.ts` — every route has `preHandler` (default-deny)
- [ ] Every tenant query filters `orgId` from session; cross-tenant → 404
- [ ] Super admin: `requireOrg` rejects; `platform.ts` returns allow-list DTOs only (ADR-0010)
- [ ] SDR ownership (`assertLeadOwnership`) and lead visibility (`visibilityFilter`) enforced on list/detail/export

**Input & output**

- [ ] zod on params/query/body; body limit (1 MB in `server.ts`); helmet, CORS from `CORS_ORIGINS`, rate limit
- [ ] LIKE patterns escaped (`leadFilters`); no raw SQL string concatenation (`sql` template only)
- [ ] CSV export guarded against formula injection (`csvCell`) and audited (`lead.exported`)
- [ ] Errors are RFC 7807 without stack traces or internals

**Uploads & crawler** — `packages/engine/src/knowledge/{extract,crawl}.ts`, `packages/core/src/storage.ts`

- [ ] Presigned PUT with content-type + size conditions; magic-byte sniff (`sniffType`) before parsing
- [ ] Crawler: http(s) only, DNS-resolved IP checked against private/link-local/loopback ranges (incl. redirects), max bytes, timeouts

**Secrets, PII, logging**

- [ ] No secrets in repo: `git grep -nE "(sk-or-|AKIA|-----BEGIN|password\s*=\s*['\"])"`; `.env` git-ignored
- [ ] pino `REDACT_PATHS` covers auth headers, cookies, passwords, tokens, API keys; audit `REDACTED_KEYS` likewise
- [ ] Contact email/phone only in tenant DTOs, never platform DTOs or logs
- [ ] Env read only via `getConfig()`; AWS uses Secrets Manager (`SECRETS_SOURCE`)

**LLM**

- [ ] Untrusted text wrapped via `doc()`/`<event>` + `UNTRUSTED_DATA_RULE`; outputs zod-validated
- [ ] No tool/function execution from model output; outreach is human-in-the-loop
- [ ] No model name hard-coded; API key never logged

**Database**

- [ ] `audit_logs` append-only trigger intact (`packages/db/drizzle/0001_audit_append_only.sql`)
- [ ] Tenant FKs cascade correctly; no cross-tenant joins without org filter

**Dependencies & containers**

- [ ] `pnpm audit --prod` — triage high/critical
- [ ] Dockerfiles run as `USER node`; no `.env` copied into images (`.dockerignore`)

## Output

Severity-ranked findings + a short "release OK / release blocked by …" verdict. Significant accepted risks →
suggest an ADR and a line in `docs/(architecture)/architecture/security.mdx` / `docs/(project)/limitations.mdx`.
