# SelloEasy — Marketing Intelligence Platform
## Implementation Plan (v0.1 — for review)

> **Status:** v1.1 — **Implemented** (P0–P8). See §31 for implementation notes and deviations.
> **Owner:** mahalingam@hiresense.ai
> **Last updated:** 2026-09-24
>
> Items marked **🔶 DECISION** are recommended defaults. Items marked **✅ CONFIRMED** were decided in review.
> All review decisions are logged in §29.1–29.2. No open questions remain.

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [Personas & Roles](#2-personas--roles)
3. [Happy Flow (End-to-End)](#3-happy-flow-end-to-end)
4. [Tech Stack & Rationale](#4-tech-stack--rationale)
5. [Monorepo Structure](#5-monorepo-structure)
6. [System Architecture](#6-system-architecture)
7. [Data Model](#7-data-model)
8. [Multi-Tenancy & RBAC](#8-multi-tenancy--rbac)
9. [Org Onboarding & Knowledge Profile](#9-org-onboarding--knowledge-profile)
10. [ICPs & Signals](#10-icps--signals)
11. [Intelligence Pipeline](#11-intelligence-pipeline)
12. [Lead Scoring (BANT+)](#12-lead-scoring-bant)
13. [Leads, CRM & Outreach](#13-leads-crm--outreach)
14. [Dashboards & Analytics](#14-dashboards--analytics)
15. [Audit Trail](#15-audit-trail)
16. [LLM Layer (OpenRouter)](#16-llm-layer-openrouter)
17. [Seed Dataset — 5 Industries / 5 Orgs](#17-seed-dataset--5-industries--5-orgs)
18. [API Surface](#18-api-surface)
19. [Frontend Routes & UX](#19-frontend-routes--ux)
20. [Documentation Site (`/docs`)](#20-documentation-site-docs)
21. [Claude Code Setup (Skills, Agents, Hooks)](#21-claude-code-setup-skills-agents-hooks)
22. [Local Dev & Docker Compose](#22-local-dev--docker-compose)
23. [AWS Deployment](#23-aws-deployment)
24. [Security](#24-security)
25. [Testing Strategy](#25-testing-strategy)
26. [Observability](#26-observability)
27. [Delivery Phases & Milestones](#27-delivery-phases--milestones)
28. [Assumptions, Limitations & Trade-offs](#28-assumptions-limitations--trade-offs)
29. [Open Questions for Review](#29-open-questions-for-review)
30. [Definition of Done](#30-definition-of-done)

---

## 1. Product Summary

SelloEasy is a **multi-tenant Marketing Intelligence platform**. Each tenant (organization) builds a rich
knowledge profile of itself (website, PDFs, policies, plans, products). The platform derives **Ideal
Customer Profiles (ICPs)** and **buying signals** from that profile, runs an **AI pipeline** over a
market-events corpus to detect companies exhibiting those signals, turns them into **scored leads
(BANT)**, and gives sales teams a lightweight **CRM** to approach, track and convert them — via
email, WhatsApp, voice call, or a scheduled meeting.

**Example:** A tyre manufacturer (think MRF) defines the signal *"OEM announces a new vehicle launch in
India"*. When the pipeline sees *"Automaker X to launch new compact SUV in Q1 from its Pune plant"*,
it creates a lead for Automaker X, attaches the evidence, identifies a likely buyer persona
(Head of Procurement), scores it on BANT, and surfaces it on the org's Leads page.

### Core capabilities

| # | Capability | Who |
|---|---|---|
| C1 | Onboard organizations via invite link | Super Admin |
| C2 | Build org knowledge profile (website, docs, products, plans, policies) | Org Admin |
| C3 | Invite team members with roles (RBAC) | Org Admin |
| C4 | AI-suggested + custom ICPs | Org Admin / Manager |
| C5 | Predefined (industry templates) + custom signals | Org Admin / Manager |
| C6 | Pipeline: events → signal match → lead → BANT score | System (worker) |
| C7 | Paginated leads view (6 / page), filters, lead detail w/ evidence | All org users |
| C8 | Outreach: email, WhatsApp, voice call, schedule meeting (Calendly) | SDR / Manager |
| C9 | CRM: stages, owner, notes, tasks, activity timeline | SDR / Manager |
| C10 | Dashboards: leads, approached, converted — org & platform level | Org Admin / Super Admin |
| C11 | Audit trail of every mutating action | Org Admin (own org) / Super Admin (all) |
| C12 | `/docs` documentation site kept in sync with code & trade-offs | Everyone |

---

## 2. Personas & Roles

| Role | Scope | Summary |
|---|---|---|
| **SUPER_ADMIN** | Platform | Creates orgs, sends/revokes org-admin invites, suspends orgs, sees cross-org **aggregate** dashboards & platform audit log, manages industry signal templates. **Sees only an org's public-level data** (§8.3). No access to leads, contacts, CRM activity, outreach content, internal documents or ICP/signal definitions. |
| **ORG_ADMIN** | One org | Owns org profile, manages users & roles, ICPs, signals, integrations (Calendly link, sender email), sees org dashboard & org audit log. |
| **SALES_MANAGER** | One org | Manages ICPs/signals, assigns leads, sees team dashboard, all CRM actions. |
| **SDR** | One org | Works leads: claim, contact, log activities, move stages, book meetings. |
| **VIEWER** | One org | Read-only access to leads and dashboards (e.g., marketing analyst, leadership). |

> 🔶 DECISION: One user belongs to exactly one org (except SUPER_ADMIN, which belongs to none).
> Multi-org membership is modeled in the schema (`memberships` table) so it can be enabled later
> without migration pain, but the UI assumes one.

---

## 3. Happy Flow (End-to-End)

```mermaid
sequenceDiagram
  autonumber
  actor SA as Super Admin
  actor OA as Org Admin
  actor SDR
  participant API
  participant W as Worker (Pipeline)
  participant LLM as OpenRouter

  SA->>API: Create org "Roadgrip Tyres" (industry=Automotive)
  API-->>OA: Invite email with magic link (72h, single use)
  OA->>API: Accept invite, set password
  OA->>API: Onboarding wizard: website URL, PDFs, products, plans, policies
  API->>W: enqueue profile.ingest
  W->>LLM: Summarize sources → structured Org Knowledge Profile
  W->>LLM: Suggest ICPs + map industry signal templates
  OA->>API: Review/edit ICPs & signals, add custom signal, Activate
  OA->>API: Invite SDRs / Managers
  API->>W: enqueue pipeline.run(org)
  W->>W: Load events corpus → prefilter by keywords/industry
  W->>LLM: Match event ↔ signals (structured JSON)
  W->>LLM: Extract account + persona, score BANT
  W->>API: Persist leads (dedupe per account+signal)
  SDR->>API: GET leads?page=1&pageSize=6
  SDR->>API: Draft email (LLM) → send / WhatsApp / call / Calendly
  API->>API: Log activity, stage → CONTACTED, audit log
  SDR->>API: Move stage → MEETING → WON
  OA->>API: Dashboard: leads / approached / converted
  SA->>API: Platform dashboard across 5 orgs
```

---

## 4. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere (Node 22 LTS) | One language, shared types/validation across web, API, worker. |
| Monorepo | **pnpm workspaces + Turborepo** | Fast installs, strict deps, cached task graph (`build`, `lint`, `test`, `typecheck`). |
| Frontend | **Next.js 15 (App Router)** ✅ | Chosen over Vite because **Fumadocs is Next.js-native**, and `/docs` must live inside the frontend. App Router also gives us layouts & RSC for the docs. The product app itself is mostly client components talking to Fastify. |
| UI | **Tailwind CSS v4 + shadcn/ui + Radix**, **lucide-react** icons | Accessible primitives, fast to build, consistent design. |
| Data fetching | **TanStack Query** + typed API client | Caching, pagination, optimistic updates. |
| Forms | **react-hook-form + zod** | Same zod schemas as the API (`packages/shared`). |
| Tables / charts | **TanStack Table**, **Recharts** | Leads table, dashboards. |
| Docs | **Fumadocs** (MDX) at `/docs` | Standard, searchable, sidebar, versionable docs from Markdown. |
| API | **Fastify 5** + `fastify-type-provider-zod` + `@fastify/swagger` | Fast, schema-first, auto OpenAPI at `/api/docs`. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** 🔶 | SQL-first, lightweight, excellent TS inference, plain SQL migrations reviewable in PRs. (Alt: Prisma — heavier runtime, weaker for raw SQL analytics.) |
| Database | **PostgreSQL 16** (+ `pg_trgm`, full-text search) | Relational core, JSONB for evidence/LLM payloads, FTS for retrieval. |
| Queue / jobs | **BullMQ + Redis 7** | Retries, backoff, concurrency, repeatable jobs (scheduled pipeline runs), progress events. |
| Object storage | **S3** (MinIO locally) | Uploaded PDFs/docs, crawled page snapshots. |
| Email | **Nodemailer** → **Mailpit** locally, **AWS SES** in prod | Real SMTP flow locally, inspectable in browser UI. |
| Auth | Custom: **argon2** password hashing, **JWT access (15m) + rotating refresh token (httpOnly cookie)** via `@fastify/jwt`, `@fastify/cookie` | Full control over invite flows & RBAC claims; no external IdP required for evaluation. |
| LLM | **OpenRouter** (OpenAI-compatible API) using the `openai` SDK with `baseURL` | Required. Model from `OPENROUTER_MODEL`. |
| PDF parsing | **unpdf** (pdf.js) | Pure JS, works in containers. |
| Website crawl | **undici fetch + cheerio**, depth-limited, robots.txt respected | Simple, no headless browser needed for v1. |
| Logging | **pino** (Fastify native) with request IDs | Structured JSON logs → CloudWatch. |
| Testing | **Vitest**, Fastify `inject`, **Testcontainers** (Postgres/Redis), **Playwright** | Unit → integration → E2E happy flow. |
| Lint/format | **ESLint (flat config) + Prettier**, **lefthook** pre-commit | Consistency. |
| Containers | **Docker** multi-stage builds, **docker compose** | `docker compose up --build` one-command run. |
| Cloud | **AWS**: ECS Fargate, RDS Postgres, ElastiCache Redis, S3, SES, ALB, CloudFront, Secrets Manager, CloudWatch; IaC with **AWS CDK (TS)** | Managed, container-native, TS IaC in the same monorepo. |
| CI | **GitHub Actions** | Lint, typecheck, test, build images, docs-sync check. |

---

## 5. Monorepo Structure

```
selloeasy/
├── apps/
│   ├── web/                     # Next.js 15 – product UI + Fumadocs at /docs
│   │   ├── app/
│   │   │   ├── (auth)/          # login, accept-invite, forgot-password
│   │   │   ├── (platform)/      # super-admin area  → /platform/*
│   │   │   ├── (org)/           # org area          → /app/*
│   │   │   └── docs/            # Fumadocs route    → /docs/*
│   │   ├── components/          # shadcn/ui + feature components
│   │   ├── lib/                 # api client, auth, rbac hooks
│   │   └── source.config.ts     # Fumadocs source → ../../docs
│   ├── api/                     # Fastify HTTP API
│   │   └── src/
│   │       ├── modules/         # auth, orgs, users, profile, icps, signals, leads,
│   │       │                    # crm, outreach, dashboards, audit, pipeline, uploads
│   │       ├── plugins/         # db, redis, auth, rbac, tenant, audit, rate-limit, swagger
│   │       └── server.ts
│   └── worker/                  # BullMQ processors
│       └── src/
│           ├── queues/          # profile.ingest, pipeline.run, lead.score, outreach.send
│           └── index.ts
├── packages/
│   ├── db/                      # Drizzle schema, migrations, seed runner
│   ├── shared/                  # zod DTOs, enums, RBAC permission matrix, pagination utils
│   ├── llm/                     # OpenRouter client, prompt templates, output schemas, mock mode
│   ├── pipeline/                # pure pipeline stages (prefilter, match, extract, dedupe, score)
│   ├── dataset/                 # synthetic events corpus + 5 org fixtures (JSON/MD/PDF)
│   ├── ui/ (optional)           # shared React components if web grows
│   └── config/                  # tsconfig, eslint, prettier presets
├── docs/                        # ⭐ Source of truth for /docs (MDX). See §20
│   ├── index.mdx
│   ├── getting-started/
│   ├── architecture/
│   ├── modules/
│   ├── pipeline/
│   ├── api/
│   ├── operations/
│   └── decisions/               # ADRs — every trade-off/optimization lands here
├── infra/                       # AWS CDK app
├── .claude/                     # Claude Code skills, agents, hooks, settings (§21)
├── .github/workflows/           # CI
├── docker-compose.yml
├── .env.example
├── CLAUDE.md
├── README.md
├── plan.md                      # this file
├── turbo.json
└── pnpm-workspace.yaml
```

**Dependency rules** (enforced with ESLint `import/no-restricted-paths` / Turbo boundaries):
- `apps/*` may import `packages/*`; `packages/*` never import `apps/*`.
- `packages/pipeline` is pure (no DB/HTTP) — takes inputs, returns outputs; the worker wires I/O. This makes it trivially unit-testable with mocked LLM.
- `packages/shared` has zero runtime deps beyond `zod`.

---

## 6. System Architecture

```mermaid
flowchart LR
  subgraph Client
    B[Browser]
  end
  subgraph Web["apps/web (Next.js)"]
    UI[Product UI]
    DOCS[/docs Fumadocs/]
  end
  subgraph API["apps/api (Fastify)"]
    AUTH[Auth + RBAC + Tenant guard]
    MOD[Domain modules]
    AUD[Audit hook]
  end
  subgraph Worker["apps/worker (BullMQ)"]
    ING[profile.ingest]
    PIPE[pipeline.run]
    SCORE[lead.score]
    OUT[outreach.send]
  end
  PG[(PostgreSQL)]
  RD[(Redis)]
  S3[(S3 / MinIO)]
  OR[[OpenRouter]]
  MAIL[[SES / Mailpit]]
  CAL[[Calendly link]]
  WA[[wa.me deep link / Twilio*]]

  B --> UI
  B --> DOCS
  UI -- "/api/* (rewrite, same-origin)" --> AUTH --> MOD
  MOD --> PG
  MOD --> AUD --> PG
  MOD -- enqueue --> RD
  RD --> ING & PIPE & SCORE & OUT
  ING --> S3
  ING & PIPE & SCORE --> OR
  ING & PIPE & SCORE & OUT --> PG
  OUT --> MAIL
  UI --> CAL
  UI --> WA
```

**Key architectural decisions**

1. **Same-origin API via Next.js rewrites** (`/api/*` → `api:4000`). Avoids CORS and lets auth cookies be `SameSite=Lax; HttpOnly`. In AWS, the ALB/CloudFront routes `/api/*` to the API service directly.
2. **API never calls the LLM synchronously for long tasks.** Profile ingestion, pipeline runs and bulk scoring are queued. Only short, user-initiated generations (e.g., "Draft email") are synchronous with a 30s timeout.
3. **Pipeline progress** is streamed to the UI via **Server-Sent Events** (`GET /api/pipeline/runs/:id/events`) backed by BullMQ progress events.
4. **Modular monolith API**: each module = `routes.ts`, `service.ts`, `repo.ts`, `schemas.ts`. Easy to split later.

---

## 7. Data Model

All tenant tables carry `org_id` (FK, indexed). All tables have `id uuid pk (uuidv7)`, `created_at`, `updated_at`. Soft delete (`deleted_at`) where business-relevant.

### 7.1 Identity & tenancy

| Table | Key columns |
|---|---|
| `organizations` | name, slug, industry (enum), status (`INVITED`, `ONBOARDING`, `ACTIVE`, `SUSPENDED`), website_url, logo_key, settings jsonb (calendly_url default, sender_name, timezone, `leadVisibility`) |
| `users` | email (unique, citext), name, password_hash, is_super_admin, status, last_login_at, calendly_url, phone |
| `memberships` | user_id, org_id, role (`ORG_ADMIN`,`SALES_MANAGER`,`SDR`,`VIEWER`), status |
| `invitations` | org_id, email, role, token_hash, expires_at, accepted_at, invited_by |
| `refresh_tokens` | user_id, token_hash, family_id, expires_at, revoked_at, user_agent, ip |

### 7.2 Org knowledge

| Table | Key columns |
|---|---|
| `org_sources` | org_id, type (`WEBSITE`,`PDF`,`DOC`,`TEXT`), title, url/s3_key, **visibility (`PUBLIC`,`INTERNAL`; default `INTERNAL`)**, status (`PENDING`,`PROCESSING`,`READY`,`FAILED`), error, bytes, checksum |
| `org_source_chunks` | org_id, source_id, ordinal, content text, tsv tsvector (GIN), token_count |
| `products` | org_id, name, category, description, target_segments text[], price_notes, visibility |
| `plans` | org_id, name, pricing jsonb, features text[], visibility |
| `policies` | org_id, title, type (warranty, compliance, SLA…), body, visibility |
| `org_profiles` | org_id (1:1), summary, value_props jsonb, differentiators jsonb, target_industries text[], geographies text[], personas jsonb, generated_by_model, version |

### 7.3 ICPs & signals

| Table | Key columns |
|---|---|
| `icps` | org_id, name, description, source (`AI_SUGGESTED`,`CUSTOM`), criteria jsonb (industries, company_size, revenue_band, geographies, tech/keywords, personas), is_active |
| `signal_templates` | industry, key, name, description, default_keywords text[], default_weight — **platform-wide, managed by Super Admin** |
| `signals` | org_id, template_id (nullable), icp_id (nullable), name, description, match_instructions (natural language for LLM), keywords text[], negative_keywords text[], weight (0.5–2.0), source (`PREDEFINED`,`CUSTOM`), is_active |

### 7.4 Market events & pipeline

| Table | Key columns |
|---|---|
| `market_events` | **global** (not tenant): source, url, title, body, published_at, industry_tags text[], entities jsonb, region, amount, currency, hash (unique), tsv |
| `pipeline_runs` | org_id, trigger (`MANUAL`,`SCHEDULED`,`ONBOARDING`), status, started_at, finished_at, stats jsonb (events_scanned, prefiltered, matched, leads_created, leads_updated, llm_calls, cost_usd), error |
| `signal_matches` | org_id, run_id, event_id, signal_id, confidence, rationale, extracted jsonb |
| `llm_calls` | org_id (nullable), purpose, model, prompt_hash, input_tokens, output_tokens, cost_usd, latency_ms, status, cached bool |

### 7.5 CRM

| Table | Key columns |
|---|---|
| `accounts` | org_id, name, domain, industry, hq_country, size_band, description — the *target* companies |
| `contacts` | org_id, account_id, name, title, persona, email, phone, whatsapp, linkedin_url, source (`SYNTHETIC`,`MANUAL`,`ENRICHED`) |
| `leads` | org_id, account_id, primary_contact_id, owner_user_id (nullable), stage (see §13), score_total, score_band (`HOT`,`WARM`,`COLD`), bant jsonb, fit_score, signal_strength, recency_score, first_signal_at, last_signal_at, lost_reason, won_value, dedupe_key (unique per org) |
| `lead_signals` | lead_id, signal_match_id — many signals can support one lead (evidence) |
| `activities` | org_id, lead_id, actor_user_id, type (`EMAIL`,`WHATSAPP`,`CALL`,`MEETING`,`NOTE`,`STAGE_CHANGE`,`ASSIGNMENT`,`TASK`), direction, subject, body, metadata jsonb (outcome, duration, meeting_at, calendly_url), occurred_at |
| `tasks` | org_id, lead_id, assignee_user_id, title, due_at, completed_at |
| `outreach_messages` | org_id, lead_id, channel, to, subject, body, status (`DRAFT`,`SENT`,`FAILED`), provider_message_id, sent_by |

### 7.6 Audit

| Table | Key columns |
|---|---|
| `audit_logs` | id (bigserial), occurred_at, scope (`PLATFORM`,`ORG`), org_id (nullable), actor_user_id (nullable = system), actor_role, action (e.g., `lead.stage_changed`), entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, request_id — **append-only** (see §15) |

### 7.7 Indexes (initial)

- `leads (org_id, stage, score_total desc, id)` — leads page default sort & keyset fallback.
- `leads (org_id, owner_user_id)`, `leads (org_id, last_signal_at desc)`.
- `activities (org_id, lead_id, occurred_at desc)`.
- `market_events USING gin(tsv)`, `market_events (published_at desc)`, GIN on `industry_tags`.
- `org_source_chunks USING gin(tsv)`.
- `audit_logs (org_id, occurred_at desc)`, `(entity_type, entity_id)`.

> ERD will be generated from Drizzle schema into `docs/architecture/data-model.mdx` (mermaid `erDiagram`).

---

## 8. Multi-Tenancy & RBAC

### 8.1 Tenant isolation
- **Shared DB, shared schema, `org_id` column** on every tenant table.
- API `tenant` plugin resolves `request.orgId` from the JWT membership (never from the request body). ✅ CONFIRMED: Super Admin has **no membership** in any org and therefore **cannot call tenant (`/org`, `/leads`, …) endpoints at all**. There is no `x-org-id` override and no impersonation. Super Admin reads org data only through `/platform/*` endpoints, which return public-level fields and aggregates (§8.3).
- All tenant repositories go through a `tenantScoped(db, orgId)` helper that injects `where org_id = $1` — raw queries without it are lint-flagged.
- 🔶 DECISION: **Postgres Row-Level Security** as defense-in-depth in Phase 6 (hardening), using `SET LOCAL app.org_id`. Not in v1 to keep the query layer simple — documented as ADR.
- Integration tests assert cross-tenant access returns **404** (not 403, to avoid leaking existence).

### 8.2 Permission matrix (`packages/shared/rbac.ts`)

| Permission | SUPER_ADMIN | ORG_ADMIN | SALES_MANAGER | SDR | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| `platform:orgs:manage` | ✅ | | | | |
| `platform:dashboard:read` | ✅ | | | | |
| `platform:signal_templates:manage` | ✅ | | | | |
| `platform:orgs:public:read` (public-level fields only, §8.3) | ✅ | | | | |
| `platform:orgs:aggregates:read` (counts only) | ✅ | | | | |
| `platform:audit:read` (platform-scope events) | ✅ | | | | |
| `org:profile:read` (full, incl. internal) | | ✅ | ✅ | ✅ | ✅ |
| `org:profile:write` | | ✅ | | | |
| `org:users:manage` | | ✅ | | | |
| `icps:write` / `signals:write` | | ✅ | ✅ | | |
| `pipeline:run` | | ✅ | ✅ | | |
| `leads:read` | | ✅ | ✅ | ✅ (all org leads, v1 — see §8.4) | ✅ |
| `leads:assign` | | ✅ | ✅ | self-claim | |
| `leads:update` (stage, notes) | | ✅ | ✅ | own/assigned | |
| `outreach:send` | | ✅ | ✅ | own/assigned | |
| `dashboard:org:read` | | ✅ | ✅ | own stats | ✅ |
| `audit:org:read` | | ✅ | | | |

- Checked server-side by a `requirePermission('leads:update', { ownership: 'assigned' })` preHandler.
- Mirrored client-side with `<Can permission="…">` for UI hiding only (never trusted).

### 8.3 Super Admin data boundary — public vs internal ✅ CONFIRMED

Super Admin sees **only public-level data that the org entered about itself**. Internal data is never exposed.

Every org-owned field and record gets a classification:

| Classification | Examples | Visible to Super Admin |
|---|---|---|
| **PUBLIC** | Org name, slug, industry, logo, website URL, HQ/regions, company size, public profile summary & value props, products/plans marked public, **documents marked `PUBLIC`** by the org admin (e.g. public brochure) | ✅ read-only |
| **ADMIN-OPERATIONAL** | Org status, created/activated dates, user count per role, users' names & emails & roles (needed to manage invites/support), pipeline run status/errors, LLM usage & cost | ✅ read-only |
| **AGGREGATE** | Counts: leads captured, approached, meetings, converted, conversion %, by week | ✅ numbers only, no drill-down to records |
| **INTERNAL** | Leads, accounts, contacts, activities, notes, tasks, outreach messages, ICPs, signals (custom), scoring rationale, internal documents/policies/pricing, org audit log entries & diffs | ❌ never |

Implementation:
- `org_sources.visibility`, `products.visibility`, `plans.visibility`, `policies.visibility`: `PUBLIC | INTERNAL`, **default `INTERNAL`**. The onboarding wizard shows a clear "Visible to platform admins" toggle.
- `/platform/*` endpoints use dedicated **allow-list DTOs** (`PlatformOrgPublicView`, `PlatformOrgStats`). They never reuse the tenant DTOs, so a new internal column can't leak by accident.
- Aggregates are computed by SQL `count()` queries that return numbers, not rows.
- The platform audit view lists only platform-scope events (org created/suspended, invites, super-admin logins, template changes). Org-internal audit entries are excluded.
- Integration tests assert that each `/platform/*` response contains **no internal fields** (a schema snapshot test) and that a super-admin token gets **403** on every tenant route.
- ADR-0010 records this decision.

### 8.4 Lead visibility for SDRs ✅ CONFIRMED (v1: all, later: assigned only)
- v1: SDRs can **read all org leads**. Mutations (stage, outreach, notes) are still limited to leads they own or have claimed.
- Future: switch to assigned-only **without a code change** through an org setting `organizations.settings.leadVisibility = "ALL" | "ASSIGNED_ONLY"` (default `ALL`). It is enforced in one place (`leadsRepo.visibilityFilter(user)`), and applied to list, detail, export and dashboard "my stats" queries.
- The setting is built and tested for both values in v1. Only the org admin UI toggle is hidden until the switch is enabled (feature flag `FEATURE_LEAD_VISIBILITY_TOGGLE=false`).

---

## 9. Org Onboarding & Knowledge Profile

### 9.1 Invite flow
1. Super Admin → **Create Org** (name, industry, admin email). Org status `INVITED`.
2. Invitation token = 32 random bytes, stored as SHA-256 hash, **72h expiry, single use**. Email sent (Mailpit locally) with link `/{WEB_URL}/accept-invite?token=…`.
3. Org Admin sets name + password → membership created → org status `ONBOARDING`.
4. Super Admin can **resend / revoke** invites; all audited.

The same invite mechanism is reused by Org Admins to invite SDRs/Managers/Viewers.

### 9.2 Onboarding wizard (Org Admin)
| Step | Inputs | Processing |
|---|---|---|
| 1. Basics | Legal name, logo, HQ, regions served, company size | — |
| 2. Website | Root URL | Crawl up to **N=25 pages, depth 2**, same domain, robots.txt respected, strip boilerplate → chunks |
| 3. Documents | PDFs/DOCX/MD (≤ 20 MB each, ≤ 20 files): brochures, policies, plans, case studies. Each file has a **Public / Internal** toggle (default Internal, §8.3) | Upload to S3 via presigned URL → parse → chunk (~800 tokens, 100 overlap) → FTS index |
| 4. Products & Plans | Structured forms (name, category, description, target segment, pricing notes) | Stored as rows; also chunked into knowledge |
| 5. Policies | Warranty, compliance, SLAs, certifications | Stored; used for outreach grounding |
| 6. AI Profile | "Generate profile" | Worker: map-reduce summarization over chunks → `org_profiles` (summary, value props, differentiators, target industries, personas) — **editable** |
| 7. ICPs & Signals | Review AI-suggested ICPs; toggle predefined industry signals; add custom | See §10 |
| 8. Activate | — | Org → `ACTIVE`; enqueue first `pipeline.run` |

Each step saves independently; the wizard is resumable. Sources show live status (`PROCESSING → READY/FAILED`) via polling/SSE.

### 9.3 Retrieval (grounding for LLM)
- 🔶 DECISION: **Postgres full-text search** (`tsvector` + `ts_rank_cd`) over `org_source_chunks` for v1, instead of vector embeddings.
  - Why: keeps *all* model calls on OpenRouter (single key), zero extra infra, deterministic and debuggable. The corpus per org is small (tens–hundreds of chunks).
  - Upgrade path: `pgvector` + an embeddings model (documented ADR-0004). Retrieval is behind a `Retriever` interface so the swap is local.

---

## 10. ICPs & Signals

### 10.1 ICP
```ts
ICP = {
  name: "Indian passenger-vehicle OEMs",
  industries: ["Automotive OEM"],
  companySize: { minEmployees: 1000 },
  revenueBand: ">$500M",
  geographies: ["IN"],
  personas: ["VP Procurement", "Head of Vehicle Platform", "Supply Chain Director"],
  painPoints: ["tyre cost per km", "EV-specific tyres", "localization"],
  keywords: ["OEM", "vehicle launch", "new plant", "EV platform"]
}
```
- **AI-suggested:** LLM reads `org_profile` + products → proposes 2–4 ICPs with justification.
- **Custom:** form builder with the same schema.

### 10.2 Signals
A signal is *an observable market event that indicates buying intent for this org*.

- **Predefined** — from `signal_templates` per industry (Super Admin-managed). On onboarding, templates for the org's industry are cloned into `signals` (editable, toggleable).
- **Custom** — org defines name, description, **natural-language match instructions**, keywords, negative keywords, weight, optional linked ICP.

Example templates:

| Industry (seller) | Predefined signals |
|---|---|
| Automotive (tyres) | New vehicle launch · OEM capacity expansion / new plant · Foreign OEM investment in India · EV platform announcement · Fleet operator large order · Govt. EV subsidy / policy change |
| Healthcare (diagnostics) | New hospital / wing opening · Hospital chain funding / M&A · Accreditation (NABH/JCI) drive · Govt health scheme tender · New oncology/cardiac center · Leadership hire (CMO/Head of Lab) |
| Semiconductors (fab equipment / chips) | New fab / OSAT announcement · Govt. semicon incentive approval · Design center opening · Supply-chain localization deal · Large funding round for chip startup · EV/5G OEM sourcing announcement |
| Renewable Energy (solar inverters/storage) | Utility-scale tender won · Rooftop solar mandate · Industrial decarbonization pledge · Data-center build-out · Green hydrogen project · PPA signed |
| Logistics (warehousing / 3PL tech) | New warehouse/fulfillment center · D2C brand funding · Port/rail corridor project · Cold-chain expansion · E-commerce festive capacity ramp · Cross-border trade agreement |

---

## 11. Intelligence Pipeline

### 11.1 Stages (`packages/pipeline`, orchestrated by `apps/worker`)

```mermaid
flowchart LR
  A[Ingest events] --> B[Normalize & dedupe]
  B --> C[Prefilter per org\nindustry tags + FTS keywords\n+ recency window]
  C --> D[LLM Signal Match\nbatch of events × org signals]
  D --> E[Entity & Persona Extraction]
  E --> F[Account/Lead Upsert\ndedupe_key]
  F --> G[BANT+ Scoring]
  G --> H[Persist + notify SSE]
```

| Stage | Detail |
|---|---|
| **1. Ingest** | `EventSource` adapters. v1: `DatasetSource` (reads `packages/dataset/events/*.json`). Designed for later `RssSource`, `NewsApiSource`, `WebhookSource`. Events stored globally in `market_events` (shared across orgs — ingest once, match many). |
| **2. Normalize & dedupe** | Canonicalize URL/title, SHA-256 `hash` → unique constraint. |
| **3. Prefilter** (no LLM) | For org O: events where `industry_tags ∩ O.target_industries ≠ ∅` OR FTS match on any active signal's keywords; exclude negative keywords; `published_at` within window (default 180 days). **Cuts LLM calls by ~80–90%.** |
| **4. Signal match** (LLM) | Batch ≤ 8 events per call. Input: org profile summary, active signals (id, name, instructions), events. Output (zod-validated JSON): `[{eventId, matches:[{signalId, confidence 0–1, rationale}]}]`. Threshold `confidence ≥ 0.6` (configurable). |
| **5. Extraction** (LLM, same call where possible) | Target account (name, domain, industry, country), deal hints (amount, timeline), suggested personas to approach. Contacts: from dataset (synthetic) — v1 does not scrape real people. |
| **6. Upsert** | `dedupe_key = org_id + normalized_account_domain_or_name`. Existing lead ⇒ attach new `lead_signals`, bump `last_signal_at`, re-score. New ⇒ create lead in stage `NEW`. |
| **7. Score** | §12. |
| **8. Persist & notify** | Update `pipeline_runs.stats`, emit SSE "N new leads". |

### 11.2 Paginated delivery
- "Push paginated data" is satisfied two ways:
  1. **Pipeline writes in batches** (per LLM batch), so leads appear progressively during a run.
  2. **Leads API is paginated**: `GET /api/leads?page=1&pageSize=6` (default **6**, max 50), returns `{ items, page, pageSize, total, totalPages }`.
- 🔶 DECISION: **Offset pagination** for the Leads UI (users need "page 3 of 12" and jump-to-page). Stable ordering `score_total desc, id desc`. Keyset pagination is used internally by the pipeline & exports. Trade-off documented in ADR.

### 11.3 Scheduling & runs
- Trigger: on activation, manual "Run pipeline" button, and a **repeatable BullMQ job** (default every 6h, configurable per org).
- **Idempotent** per `(org, event, signal)` via unique index on `signal_matches`.
- **Concurrency:** 1 run per org at a time (BullMQ job id = `pipeline:{orgId}`), global LLM concurrency limit (e.g., 4) + OpenRouter rate-limit handling (429 → exponential backoff with jitter).
- **Budget guard:** `PIPELINE_MAX_LLM_CALLS_PER_RUN` (default 60) — run stops gracefully and reports partial.

### 11.4 Evaluation
- `packages/pipeline/eval/` — a labeled gold set (~50 event↔signal pairs across industries). `pnpm eval:pipeline` reports precision/recall of signal matching for the configured model. Numbers get published to `docs/pipeline/evaluation.mdx`.

---

## 12. Lead Scoring (BANT+)

Each lead gets an explainable score (0–100) stored with per-dimension rationale.

| Dimension | Weight | How it's scored |
|---|---|---|
| **B**udget | 20 | LLM: evidence of capital (funding round, investment amount, capex announcement, company size). Deterministic boost if `amount` present in event. |
| **A**uthority | 15 | Do we have a contact whose title maps to a decision-maker persona in the ICP? (rule-based title → seniority map + LLM fallback) |
| **N**eed | 25 | LLM: how directly the signal implies need for the org's products (grounded on product catalog). |
| **T**imeline | 15 | LLM + rules: explicit dates ("launch in Q1"), recency of the event. |
| ICP Fit | 15 | Deterministic: industry/geo/size overlap with best-matching ICP. |
| Signal Strength | 10 | Σ(signal weight × confidence) over supporting signals, capped; decays with age (half-life 30 days). |

- `score_total = Σ weighted`, band: **HOT ≥ 75, WARM 50–74, COLD < 50**.
- LLM returns `{budget:{score:0-10, rationale}, authority:…, need:…, timeline:…}`; normalized server-side. Deterministic parts are computed in code (cheaper, testable).
- Re-scored when new signals attach or contact changes. Score history kept in `activities` (`SCORE_CHANGED`) for transparency.
- The lead detail page shows a **"Why this score?"** panel with each dimension's rationale + source evidence links.

---

## 13. Leads, CRM & Outreach

### 13.1 Lead stages
```
NEW → CONTACTED → ENGAGED → MEETING_SCHEDULED → QUALIFIED → PROPOSAL → WON
                                                                     ↘ LOST (reason required)
```
- **Approached** = lead has ≥ 1 outbound activity (EMAIL/WHATSAPP/CALL/MEETING) — auto-moves `NEW → CONTACTED`.
- **Converted** = stage `WON`.
- Stage changes are manual except the auto-transition above; every change creates an `activities` row + audit log.

### 13.2 Leads page (`/app/leads`)
- Card grid **6 per page** (toggle to table view), pagination controls.
- Filters: signal, ICP, stage, score band, owner (me / unassigned / anyone), date range, search by account.
- Card: account, headline signal + date, score badge (HOT/WARM/COLD), BANT mini-bars, owner, stage, quick actions (✉️ 💬 📞 📅).
- Bulk: assign, change stage, export CSV.

### 13.3 Lead detail (`/app/leads/[id]`)
- Header: account, stage selector, owner, score.
- Tabs: **Overview** (evidence timeline of signals with source links, BANT rationale), **Contacts**, **Activity** (timeline), **Tasks**, **Notes**.

### 13.4 Outreach channels

| Channel | v1 implementation | Upgrade path |
|---|---|---|
| **Email** | "Draft with AI" → LLM writes personalized email grounded on org profile + products + lead evidence (editable) → sent via SMTP (Mailpit local / SES prod) from worker queue `outreach.send`. Logged as activity. | Open/click tracking, sequences, reply ingestion. |
| **WhatsApp** | AI-drafted message → opens `https://wa.me/<number>?text=<encoded>` (click-to-chat). User confirms "Sent" → activity logged. | WhatsApp Business Cloud API / Twilio adapter (interface stubbed: `WhatsAppProvider`). |
| **Voice call** | `tel:` link + AI-generated **call script** & objection handling; "Log call" form (outcome, duration, notes). | Twilio Voice click-to-call + recording/transcription. |
| **Meeting** | User's **Calendly** link (profile setting, fallback to org default) opened with prefilled name/email query params; "Log meeting" with date/time → stage `MEETING_SCHEDULED`. | Calendly webhooks (`invitee.created`) to auto-log; Cal.com alternative. |

> 🔶 DECISION: For evaluation, only email is truly "sent" (to Mailpit). WhatsApp/voice/Calendly use deep links + manual logging because real providers need paid accounts & verified numbers. All four go through a `OutreachProvider` interface so real integrations are drop-in.

### 13.5 CRM extras
- Tasks with due dates ("Follow up in 3 days") + "My tasks today" widget.
- Lead assignment (manager) and **self-claim** (SDR) with conflict protection (optimistic lock on `owner_user_id`).
- Notes with @mentions (v2).

---

## 14. Dashboards & Analytics

### 14.1 Org dashboard (`/app/dashboard`) — ORG_ADMIN, SALES_MANAGER, VIEWER (SDR sees "My stats")
- KPI tiles: **Leads captured**, **Approached**, **Meetings**, **Converted (WON)**, **Conversion rate** (WON / approached), **Avg. time to first touch**.
- Funnel chart by stage.
- Leads over time (by week), stacked by score band.
- Leads by signal (bar) — which signals produce the most / best-converting leads.
- SDR leaderboard: touches, meetings, wins.
- Channel effectiveness: approached vs. engaged per channel.
- Date range filter; all numbers link to the filtered leads list.

### 14.2 Platform dashboard (`/platform/dashboard`) — SUPER_ADMIN
- **Aggregates only.** No drill-down into lead or CRM records (§8.3).
- Per-org table: status, users, leads, approached, converted, conversion %, last pipeline run, LLM cost (30d).
- Totals & trends across orgs; industry comparison.
- Pipeline health: runs, failures, avg duration, LLM tokens/cost.

### 14.3 Implementation
- SQL aggregate queries in `dashboards` module (CTEs over `leads`/`activities`); cached in Redis for 60s keyed by `(org, range)`.
- 🔶 DECISION: No separate warehouse/materialized views in v1; add materialized views if queries exceed 300ms p95 (ADR).

---

## 15. Audit Trail

**Goal:** answer "who did what, when, to which record, from where" for every mutating action.

- **What's logged:** every POST/PUT/PATCH/DELETE; auth events (login success/failure, logout, password reset, invite sent/accepted/revoked); role changes; pipeline runs (actor = system or user); exports; Super Admin views of org public profiles and stats (PLATFORM scope).
- **How:**
  - Services call `audit.record({ action, entityType, entityId, before, after })` explicitly for domain semantics (e.g., `lead.stage_changed` with before/after stage).
  - A Fastify `onResponse` safety-net hook logs any mutating request that didn't record an explicit audit entry (`http.mutation`).
  - `before/after` are **diffs** of changed fields only; secrets/PII fields (password_hash, tokens) are redacted by a denylist.
- **Integrity:** `audit_logs` is **append-only** — DB trigger raises on `UPDATE`/`DELETE`; app DB role has only `INSERT, SELECT` on it.
- **Writes are in the same transaction** as the change they describe (no lost audits).
- **Scope:** each entry has `scope = PLATFORM | ORG`. Platform-scope entries include org created, suspended or activated, invites, super-admin logins and template changes. Org-scope entries are everything inside a tenant.
- **UI:** `/app/settings/audit` (org admin: ORG-scope entries for their org, with diffs) and `/platform/audit` (super admin: **PLATFORM-scope entries only**, per §8.3). Filter by actor, action, entity and date. A row expands to show the diff. CSV export.
- **Retention:** 1 year default (`AUDIT_RETENTION_DAYS`), partitioning by month in Phase 6 if volume demands.

---

## 16. LLM Layer (OpenRouter)

### 16.1 Configuration
```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
LLM_MODE=live            # live | mock  (mock = deterministic fixtures, no key needed)
LLM_TIMEOUT_MS=30000
LLM_MAX_CONCURRENCY=4
```
- ✅ CONFIRMED: **The model is whatever `OPENROUTER_MODEL` holds.** Source code contains no model name, and there is no fallback default in code.
  - The env schema (zod) makes `OPENROUTER_MODEL` **required** when `LLM_MODE=live`. The app fails fast at boot with a clear message if it is missing.
  - `.env.example` ships a filled-in value (currently `google/gemini-2.5-flash`), because the submission must state the exact model. Changing the model is a one-line env edit with no code change or rebuild.
  - The active model is logged at startup, stored on every `llm_calls` row, and shown on `/platform/dashboard` and in `/docs/pipeline/llm-openrouter`.
  - The README "Model" section is generated from `.env.example` by `pnpm docs:sync-readme`, so it can't drift.
  - Prompts stay model-agnostic (JSON schema plus zod validation plus a repair retry), so any OpenRouter model with JSON output works.
- All calls go through `packages/llm` → `openai` SDK with `baseURL=OPENROUTER_BASE_URL`, headers `HTTP-Referer` and `X-Title: SelloEasy`.

### 16.2 Design
- **Prompt registry:** each prompt is a versioned module (`prompts/signal-match.v1.ts`) exporting `system`, `buildUser(input)`, and a **zod output schema**. We request `response_format: { type: "json_schema" }` where supported, and always validate with zod; on validation failure → one repair retry with the error message, then fail the item (not the run).
- **Prompts:**
  1. `org-profile.summarize` (map-reduce over chunks)
  2. `icp.suggest`
  3. `signal.match` (batched)
  4. `lead.extract`
  5. `lead.score-bant`
  6. `outreach.draft-email` / `draft-whatsapp` / `call-script`
- **Caching:** response cache in Redis keyed by `sha256(model + prompt_version + input)`, TTL 7 days — re-running the pipeline over the same events costs ~nothing.
- **Cost & telemetry:** every call recorded in `llm_calls` (tokens, cost from OpenRouter `usage`, latency, cache hit).
- **Safety:** uploaded docs and events are wrapped in delimited `<document>` blocks with instructions to treat them as data (prompt-injection mitigation); outputs never executed; outreach drafts always require human send.
- **Mock mode:** `LLM_MODE=mock` returns deterministic fixtures so tests, CI and a key-less demo work. Seed data ships **pre-scored**, so the app is fully usable before any live call.

---

## 17. Seed Dataset — 5 Industries / 5 Orgs

All seed data is **synthetic and clearly labeled** (`synthetic: true`). ✅ CONFIRMED: Org names, target companies, people, emails (`@example.com`-style domains) and phone numbers are **fictional**, so we don't fabricate news about real companies or expose real people's contact data.

✅ CONFIRMED industries: Healthcare, Automotive, Semiconductors, Renewable Energy, Logistics.

### 17.1 Orgs (tenants)

| # | Org (fictional) | Industry | Sells | Seed users |
|---|---|---|---|---|
| 1 | **Roadgrip Tyres Ltd.** | Automotive | Passenger/commercial/EV tyres to OEMs & fleets | admin, manager, 2 SDRs |
| 2 | **MediSphere Diagnostics** | Healthcare | Lab analyzers, diagnostic kits, LIS software to hospitals | admin, 2 SDRs |
| 3 | **Nanoforge Semiconductor** | Semiconductors | Power ICs, fab metrology equipment | admin, manager, SDR |
| 4 | **Suncrest Energy Systems** | Renewable Energy | Solar inverters & battery storage for C&I / utilities | admin, SDR |
| 5 | **Cargolane Logistics Tech** | Logistics | Warehouse automation & 3PL SaaS | admin, manager, SDR |

Per org fixture (`packages/dataset/orgs/<slug>/`):
- `profile.md` (about, value props), `products.json`, `plans.json`, `policies.md`
- 1–2 small PDFs (brochure, warranty/policy) to exercise the upload/parse path
- `icps.json` (2–3), custom `signals.json` (1–2 on top of the industry templates)

### 17.2 Market events corpus (`packages/dataset/events/`)
- **~60 events per industry (~300 total)**, news-style: title, body (80–200 words), published_at (last 6 months relative to seed time), source name, url (fictional), region, amount, industry_tags, mentioned companies.
- Deliberately includes: strong matches, weak/ambiguous matches, **negatives** (irrelevant news) and **cross-industry** events (e.g., an EV plant announcement relevant to both Roadgrip Tyres and Nanoforge) to demonstrate per-org signal filtering.
- ~120 target **accounts** with 1–3 synthetic **contacts** each (name, title, email, phone, WhatsApp).

### 17.3 Seeding
- `pnpm db:seed` (run automatically by the `migrate` service in compose):
  1. Super Admin from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (defaults `superadmin@selloeasy.local` / `Admin@123`, dev-only). In AWS the password comes from Secrets Manager.
  2. 5 orgs as `ACTIVE`, users per table above (`<role>@<slug>.local` / `Password@123`).
  3. Profiles, ICPs, signals, events, accounts, contacts.
  4. **Precomputed leads** (from a recorded pipeline run) with BANT scores and a realistic spread of stages & activities so dashboards look alive (~25–40 leads per org → 5–7 pages at 6/page).
  5. One extra org in `INVITED` state to demo the onboarding flow end-to-end.
- `pnpm db:reset` drops & reseeds.

---

## 18. API Surface

Base: `/api/v1`. JSON. Errors follow **RFC 7807** (`application/problem+json`). OpenAPI at `/api/docs`.

**Auth**
```
POST /auth/login                 POST /auth/refresh            POST /auth/logout
POST /auth/accept-invite         POST /auth/forgot-password    POST /auth/reset-password
GET  /auth/me
```
**Platform (Super Admin)**
```
# All /platform responses use allow-list DTOs: public-level fields + aggregates only (§8.3)
GET/POST        /platform/orgs              GET/PATCH /platform/orgs/:id   (PlatformOrgPublicView)
GET             /platform/orgs/:id/stats    (PlatformOrgStats — counts only)
GET             /platform/orgs/:id/users    (name, email, role, status — for invite/support)
POST            /platform/orgs/:id/invites  DELETE /platform/invites/:id   (revoke)
POST            /platform/orgs/:id/suspend
GET             /platform/dashboard         GET /platform/audit
GET/POST/PATCH  /platform/signal-templates
```
**Org**
```
GET/PATCH  /org                     GET/POST /org/users     PATCH/DELETE /org/users/:id
POST       /org/invites             DELETE /org/invites/:id
GET/POST   /org/sources             POST /org/sources/upload-url     DELETE /org/sources/:id
POST       /org/sources/website     (crawl)
CRUD       /org/products  /org/plans  /org/policies
GET/PATCH  /org/profile             POST /org/profile/generate
POST       /org/activate
```
**ICPs & Signals**
```
CRUD /icps          POST /icps/suggest
CRUD /signals       GET /signal-templates
```
**Pipeline**
```
POST /pipeline/runs            GET /pipeline/runs      GET /pipeline/runs/:id
GET  /pipeline/runs/:id/events (SSE)
```
**Leads & CRM**
```
GET   /leads?page&pageSize=6&stage&band&signalId&icpId&owner&q&from&to&sort
GET   /leads/:id               PATCH /leads/:id (stage, owner, lost_reason, won_value)
POST  /leads/:id/claim         POST /leads/bulk (assign/stage)    GET /leads/export.csv
GET/POST /leads/:id/activities   CRUD /leads/:id/tasks   CRUD /leads/:id/contacts
POST  /leads/:id/outreach/draft   {channel: email|whatsapp|call}
POST  /leads/:id/outreach/send    {channel: email, to, subject, body}
POST  /leads/:id/outreach/log     {channel: whatsapp|call|meeting, …}
POST  /leads/:id/rescore
```
**Dashboards & Audit**
```
GET /dashboard/summary?from&to     GET /dashboard/funnel    GET /dashboard/by-signal
GET /dashboard/team                GET /audit?actor&action&entity&from&to&page
```
**Ops**
```
GET /health (liveness)   GET /ready (db+redis)
```

---

## 19. Frontend Routes & UX

| Route | Who | Purpose |
|---|---|---|
| `/login`, `/accept-invite`, `/forgot-password` | public | Auth |
| `/platform/orgs` | SA | Org list, create org, invite admin, suspend |
| `/platform/orgs/[id]` | SA | Org public profile, public docs/products, users & roles, pipeline run status, aggregate metrics (no lead/CRM data) |
| `/platform/dashboard` | SA | Cross-org analytics |
| `/platform/signal-templates` | SA | Manage industry signal templates |
| `/platform/audit` | SA | Global audit log |
| `/app/onboarding` | OA | Multi-step wizard (§9.2) |
| `/app/dashboard` | org | Org dashboard |
| `/app/leads` | org | 6-per-page leads grid |
| `/app/leads/[id]` | org | Lead detail + outreach + CRM |
| `/app/tasks` | org | My tasks |
| `/app/icps`, `/app/signals` | OA/SM | Manage ICPs & signals |
| `/app/pipeline` | OA/SM | Runs history, trigger run, live progress |
| `/app/profile` | OA | Org knowledge profile & sources |
| `/app/settings/team` | OA | Users, roles, invites |
| `/app/settings/integrations` | OA | Calendly default, sender email |
| `/app/settings/audit` | OA | Org audit log |
| `/app/me` | all | Personal settings, Calendly link |
| `/docs/**` | public | Documentation (§20) |

UX principles: dark/light theme, responsive (usable on tablet), skeleton loading, empty states that guide next action ("No leads yet — run the pipeline"), toast feedback, keyboard shortcuts on leads (`j/k`, `e` email, `c` call).

---

## 20. Documentation Site (`/docs`)

### 20.1 Setup
- **Fumadocs** (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`) mounted at `apps/web/app/docs/[[...slug]]`.
- **Content lives in the root `docs/` folder** as `.md`/`.mdx` (Markdown-first, readable on GitHub too) — `source.config.ts` points to `../../docs`.
- Built-in search (Orama), sidebar from `meta.json`, TOC, code highlighting (Shiki), Mermaid diagrams, callouts, tabs.
- `README.md` stays concise and links into `/docs`; key sections (Quickstart, Env vars, Model) are **shared snippets** so README and docs don't drift (a script `pnpm docs:sync-readme` injects them between `<!-- docs:start:x -->` markers).

### 20.2 Information architecture
```
docs/
├── index.mdx                       # What is SelloEasy
├── getting-started/
│   ├── quickstart.mdx              # docker compose up --build
│   ├── environment-variables.mdx
│   ├── seed-data-and-accounts.mdx
│   └── local-development.mdx
├── concepts/
│   ├── organizations-and-tenancy.mdx
│   ├── roles-and-permissions.mdx
│   ├── icps.mdx
│   ├── signals.mdx
│   ├── leads-and-stages.mdx
│   └── bant-scoring.mdx
├── architecture/
│   ├── overview.mdx                # diagrams from §6
│   ├── monorepo.mdx
│   ├── data-model.mdx              # ERD
│   ├── multi-tenancy.mdx
│   └── security.mdx
├── pipeline/
│   ├── overview.mdx
│   ├── stages.mdx
│   ├── prompts.mdx                 # every prompt, version, schema
│   ├── llm-openrouter.mdx          # model, costs, caching, mock mode
│   └── evaluation.mdx              # precision/recall results
├── modules/                        # one page per API module / feature
│   ├── onboarding.mdx  crm.mdx  outreach.mdx  dashboards.mdx  audit-trail.mdx
├── api/
│   └── reference.mdx               # generated from OpenAPI (fumadocs-openapi)
├── operations/
│   ├── docker.mdx  aws-deployment.mdx  observability.mdx  runbooks.mdx
├── decisions/                      # ⭐ ADRs
│   ├── index.mdx                   # table of all ADRs
│   ├── 0001-nextjs-over-vite.mdx
│   ├── 0002-drizzle-orm.mdx
│   ├── 0003-bullmq-for-pipeline.mdx
│   ├── 0004-fts-over-vector-retrieval.mdx
│   ├── 0005-offset-pagination-for-leads.mdx
│   ├── 0006-deep-links-for-whatsapp-voice-calendly.mdx
│   ├── 0007-app-level-tenancy-before-rls.mdx
│   ├── 0008-synthetic-dataset.mdx
│   ├── 0009-openrouter-model-from-env.mdx
│   ├── 0010-superadmin-public-data-boundary.mdx
│   ├── 0011-lead-visibility-setting.mdx
│   └── 0012-env-driven-drivers-for-aws-readiness.mdx
├── limitations.mdx
└── changelog.mdx
```

### 20.3 ADR format (Architecture Decision Record)
```md
---
title: ADR-0004 — Postgres FTS instead of vector retrieval (v1)
status: Accepted | Superseded by ADR-00xx
date: 2026-09-24
---
## Context
## Decision
## Consequences (trade-offs, perf/cost impact)
## Alternatives considered
## Revisit when
```

### 20.4 "Docs must reflect code" — enforcement
1. **Rule in `CLAUDE.md`:** any optimization, trade-off, new env var, new endpoint, schema change, or prompt change must update the relevant doc page and, for trade-offs, add/modify an ADR in the same change.
2. **`doc-keeper` Claude skill** (§21) runs after feature work to update docs.
3. **CI check `docs:check`:**
   - Fails if `packages/db/src/schema/**`, `apps/api/src/modules/**/routes.ts`, `packages/llm/src/prompts/**` or `.env.example` changed but no file under `docs/` changed (overridable with a `[skip-docs]` justification in the PR body).
   - Validates every env var in `.env.example` is documented in `environment-variables.mdx`.
   - Validates all internal doc links & builds the docs.
4. **In-code pointers:** non-obvious optimizations carry a comment `// ADR-0005: offset pagination — see /docs/decisions/0005…`.

---

## 21. Claude Code Setup (Skills, Agents, Hooks)

### 21.1 Layout
```
.claude/
├── settings.json               # permissions allowlist, hooks
├── skills/
│   ├── code-writer/SKILL.md
│   ├── code-reviewer/SKILL.md
│   ├── tester/SKILL.md
│   ├── doc-keeper/SKILL.md
│   ├── api-endpoint/SKILL.md
│   ├── db-migration/SKILL.md
│   ├── pipeline-prompt/SKILL.md
│   ├── frontend-feature/SKILL.md
│   ├── security-auditor/SKILL.md
│   └── release-docker/SKILL.md
└── agents/
    ├── reviewer.md             # read-only reviewer subagent
    ├── test-runner.md          # runs & triages tests
    └── docs-writer.md          # focused on /docs + ADRs
CLAUDE.md                       # project rules, commands, conventions
```

### 21.2 Skills (each `SKILL.md` has `name`, `description` frontmatter + step-by-step instructions + checklists)

| Skill | Triggers when | What it enforces |
|---|---|---|
| **code-writer** | Implementing any feature | Module layout (routes/service/repo/schemas), shared zod DTOs, tenant scoping, RBAC preHandler, audit calls, error format, no hard-coded model names, writes tests alongside, then invokes doc-keeper. |
| **code-reviewer** | Reviewing a diff/PR | Checklist: tenant isolation, RBAC, audit coverage, input validation, N+1 queries, transaction boundaries, secrets, LLM output validation, pagination defaults (6), accessibility, docs/ADR updated. Output: severity-ranked findings. |
| **tester** | Writing/running tests | Test pyramid rules, Testcontainers usage, LLM mock mode, factories, cross-tenant negative tests mandatory for new endpoints, Playwright happy-flow maintenance, coverage thresholds. |
| **doc-keeper** | After any code change | Maps changed files → doc pages; updates docs; creates ADRs for trade-offs; updates `changelog.mdx`, env var docs, README snippets; runs `pnpm docs:check`. |
| **api-endpoint** | Adding an endpoint | Scaffold route + zod schema + OpenAPI tags + permission + audit + tests + docs page entry. |
| **db-migration** | Schema changes | Drizzle schema edit → `drizzle-kit generate` → review SQL → backfill plan → indexes → update ERD doc. Never edit applied migrations. |
| **pipeline-prompt** | Changing prompts / pipeline | Version bump (`.v2`), zod schema, mock fixture update, run `pnpm eval:pipeline`, record results in `docs/pipeline/evaluation.mdx`. |
| **frontend-feature** | Building UI | shadcn components, TanStack Query patterns, `<Can>` gating, loading/empty/error states, responsive check. |
| **security-auditor** | Before releases / auth changes | OWASP ASVS-lite checklist, dependency audit, secrets scan, upload validation, SSRF protections on crawler. |
| **release-docker** | Container/infra changes | Multi-stage Dockerfiles, compose health checks, image size, CDK diff review, README run steps verified. |

### 21.3 Subagents
- **reviewer** — read-only tools, uses `code-reviewer` skill; spawned after each feature.
- **test-runner** — runs `pnpm test`, summarizes failures, proposes fixes.
- **docs-writer** — edits only `docs/**`, `README.md`.

### 21.4 Hooks & settings (`.claude/settings.json`)
- `PostToolUse` on Edit/Write → `pnpm prettier --write <file>` + `eslint --fix` for TS files.
- `Stop` hook → `pnpm docs:check --changed` warning if code changed without docs.
- Permissions allowlist for `pnpm *`, `docker compose *`, `git status/diff/log`; deny `rm -rf`, reading `.env`.

### 21.5 `CLAUDE.md` contents
Project overview, commands (`pnpm dev`, `pnpm test`, `pnpm db:*`, `docker compose up --build`), architecture map, conventions (naming, errors, logging), non-negotiables (tenant scoping, RBAC, audit, docs sync, OpenRouter only via `packages/llm`, model from env), and links to skills.

---

## 22. Local Dev & Docker Compose

### 22.1 One-command run
```bash
cp .env.example .env        # add OPENROUTER_API_KEY
docker compose up --build
# Web:      http://localhost:3000        (docs at /docs)
# API:      http://localhost:4000/api/docs (OpenAPI)
# Mailpit:  http://localhost:8025        (outgoing emails & invites)
# MinIO:    http://localhost:9001
```

### 22.2 Services
| Service | Image | Notes |
|---|---|---|
| `postgres` | postgres:16-alpine | volume, healthcheck `pg_isready` |
| `redis` | redis:7-alpine | healthcheck |
| `minio` + `minio-init` | minio/minio, minio/mc | creates `selloeasy-uploads` bucket |
| `mailpit` | axllent/mailpit | SMTP :1025, UI :8025 |
| `migrate` | built from repo (`api` target) | runs migrations + seed once, `restart: "no"`; others `depends_on: condition: service_completed_successfully` |
| `api` | `apps/api/Dockerfile` | :4000, depends on postgres/redis/minio healthy |
| `worker` | `apps/worker/Dockerfile` | BullMQ processors |
| `web` | `apps/web/Dockerfile` (Next standalone output) | :3000, rewrites `/api` → `http://api:4000` |

- Dockerfiles: multi-stage using `turbo prune --docker` for minimal build contexts, `node:22-alpine`, non-root user, `pnpm deploy` for prod deps only.
- **Works without a key:** if `OPENROUTER_API_KEY` is empty, services start with `LLM_MODE=mock` and log a clear warning; seeded data is fully browsable.

### 22.3 `.env.example` — single source of every key (local + AWS) ✅ CONFIRMED

Principles:
- **One `.env.example`** lists every key the platform will ever read: local, AWS runtime and AWS deploy. Local values work as-is. AWS keys are present but blank, grouped under clear headers.
- **All config goes through one validated module** (`packages/shared/config.ts`, zod). Every app imports it. `process.env` is not read anywhere else (lint rule). Validation is **conditional on drivers**: for example, `MAIL_DRIVER=ses` requires `SES_REGION`. A missing or invalid key fails at boot with an exact error listing the variable names.
- **Driver switches instead of code branches.** Local and AWS run the *same images*. Only env values differ:
  - `STORAGE_DRIVER=minio|s3`
  - `MAIL_DRIVER=smtp|ses`
  - `SECRETS_SOURCE=env|aws-secrets-manager`
  - `DATABASE_SSL`
  - `REDIS_TLS`
- `pnpm env:check` validates a `.env` file against the schema before a deploy. `docs:check` fails if a key exists in the schema but not in `.env.example` or `/docs/getting-started/environment-variables`.

```dotenv
############################################
# 1. LLM — OpenRouter (required)
############################################
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-2.5-flash      # the app uses exactly this value; no default in code
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
LLM_MODE=live                                 # live | mock
LLM_MAX_CONCURRENCY=4
LLM_TIMEOUT_MS=30000
LLM_CACHE_TTL_SECONDS=604800

############################################
# 2. App runtime
############################################
NODE_ENV=development                          # development | production
APP_ENV=local                                 # local | staging | production
LOG_LEVEL=info
WEB_URL=http://localhost:3000                 # public URL of the web app (used in invite links)
API_INTERNAL_URL=http://api:4000              # Next.js rewrite target
API_PORT=4000
WEB_PORT=3000
CORS_ORIGINS=http://localhost:3000
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false                           # true behind HTTPS (AWS)
TRUST_PROXY=false                             # true behind ALB/CloudFront

############################################
# 3. Auth & security
############################################
JWT_ACCESS_SECRET=change-me-min-32-chars
JWT_REFRESH_SECRET=change-me-too-min-32-chars
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
INVITE_TTL_HOURS=72
RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW=1m
SUPERADMIN_EMAIL=superadmin@selloeasy.local   # bootstrap super admin (created if missing)
SUPERADMIN_PASSWORD=Admin@123                 # change / move to Secrets Manager in AWS

############################################
# 4. Database — Postgres (local container | RDS)
############################################
DATABASE_URL=postgres://selloeasy:selloeasy@postgres:5432/selloeasy
DATABASE_SSL=false                            # true for RDS
DATABASE_POOL_MAX=10
POSTGRES_USER=selloeasy                       # used by local postgres container only
POSTGRES_PASSWORD=selloeasy
POSTGRES_DB=selloeasy

############################################
# 5. Redis — (local container | ElastiCache)
############################################
REDIS_URL=redis://redis:6379                  # rediss://… for ElastiCache in-transit encryption
REDIS_TLS=false

############################################
# 6. Object storage — (MinIO | S3)
############################################
STORAGE_DRIVER=minio                          # minio | s3
S3_BUCKET=selloeasy-uploads
S3_REGION=us-east-1
S3_ENDPOINT=http://minio:9000                 # leave EMPTY for AWS S3
S3_PUBLIC_ENDPOINT=http://localhost:9000      # browser-reachable endpoint for presigned URLs (local)
S3_FORCE_PATH_STYLE=true                      # false for AWS S3
S3_ACCESS_KEY_ID=minioadmin                   # leave EMPTY on AWS (ECS task role is used)
S3_SECRET_ACCESS_KEY=minioadmin
UPLOAD_MAX_MB=20

############################################
# 7. Email — (SMTP/Mailpit | SES)
############################################
MAIL_DRIVER=smtp                              # smtp | ses
MAIL_FROM="SelloEasy <no-reply@selloeasy.local>"
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
SES_REGION=ap-south-1                         # required when MAIL_DRIVER=ses
SES_CONFIGURATION_SET=

############################################
# 8. Pipeline & product defaults
############################################
PIPELINE_SCHEDULE_CRON=0 */6 * * *
PIPELINE_MATCH_THRESHOLD=0.6
PIPELINE_MAX_LLM_CALLS_PER_RUN=60
PIPELINE_EVENT_WINDOW_DAYS=180
PIPELINE_BATCH_SIZE=8
LEADS_PAGE_SIZE_DEFAULT=6
CRAWL_MAX_PAGES=25
CRAWL_MAX_DEPTH=2
FEATURE_LEAD_VISIBILITY_TOGGLE=false
AUDIT_RETENTION_DAYS=365

############################################
# 9. Seed / demo
############################################
SEED_ON_START=true                            # false in AWS staging/prod
SEED_DEMO_DATA=true                           # 5 synthetic orgs + events

############################################
# 10. Observability
############################################
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_SERVICE_NAMESPACE=selloeasy

############################################
# 11. Secrets source
############################################
SECRETS_SOURCE=env                            # env | aws-secrets-manager
AWS_SECRETS_ID=                               # e.g. selloeasy/prod/app (JSON secret) — loaded at boot, overrides env

############################################
# 12. AWS deployment (read by infra/ CDK + deploy scripts; leave empty for local)
############################################
AWS_ACCOUNT_ID=
AWS_REGION=ap-south-1                         # Mumbai (confirmed)
AWS_PROFILE=                                  # local CLI profile used by `pnpm deploy:aws` (or use CI OIDC)
DEPLOY_ENV=staging                            # staging | production — prefixes all stack/resource names
DOMAIN_NAME=                                  # e.g. app.selloeasy.com
HOSTED_ZONE_ID=                               # Route53 zone for DOMAIN_NAME
ACM_CERTIFICATE_ARN=                          # optional; CDK creates one via DNS validation if empty
ECR_REPOSITORY_PREFIX=selloeasy
IMAGE_TAG=latest                              # CI sets git SHA
VPC_ID=                                       # optional; empty = CDK creates a new VPC
NAT_GATEWAYS=1
RDS_INSTANCE_CLASS=t4g.micro
RDS_ALLOCATED_STORAGE_GB=20
RDS_MULTI_AZ=false
RDS_BACKUP_RETENTION_DAYS=7
REDIS_NODE_TYPE=cache.t4g.micro
ECS_API_CPU=512
ECS_API_MEMORY=1024
ECS_API_DESIRED_COUNT=1
ECS_WORKER_CPU=512
ECS_WORKER_MEMORY=1024
ECS_WORKER_DESIRED_COUNT=1
ECS_WEB_CPU=256
ECS_WEB_MEMORY=512
ECS_WEB_DESIRED_COUNT=1
ALARM_EMAIL=                                  # SNS subscription for CloudWatch alarms
GITHUB_OIDC_ROLE_ARN=                         # CI deploy role (created by the bootstrap stack)
```

### 22.4 Non-Docker dev
`pnpm i && docker compose up postgres redis minio mailpit -d && pnpm db:migrate && pnpm db:seed && pnpm dev` (Turbo runs web/api/worker in watch mode).

---

## 23. AWS Deployment

```mermaid
flowchart TB
  U[Users] --> CF[CloudFront]
  CF --> ALB[Application Load Balancer]
  ALB -- "/api/*" --> APIS[ECS Fargate: api]
  ALB -- "/*" --> WEBS[ECS Fargate: web]
  WK[ECS Fargate: worker] --> REDIS[(ElastiCache Redis)]
  APIS --> REDIS
  APIS --> RDS[(RDS PostgreSQL 16, Multi-AZ)]
  WK --> RDS
  APIS & WK --> S3[(S3 uploads, SSE-KMS)]
  WK --> SES[SES]
  APIS & WK --> SM[Secrets Manager]
  APIS & WK & WEBS --> CW[CloudWatch Logs/Metrics/Alarms]
  WK --> OR[[OpenRouter]]
```
✅ CONFIRMED goal: **deploy-ready, not deployed.** Everything is coded, synthesized and validated in CI. Actually going live later should take only filling the AWS keys in `.env` (§22.3 group 12) and running one command.

### 23.1 Infrastructure as code
- **AWS CDK (TypeScript)** in `infra/`. It reads its config from the same env schema (`infra/config.ts` imports the shared config module and validates group 12 keys).
- Stacks (names prefixed with `DEPLOY_ENV`):
  - `Bootstrap` — ECR repos, GitHub OIDC deploy role.
  - `Network` — VPC in 2 AZs with public and private subnets, `NAT_GATEWAYS`, and VPC endpoints for S3, ECR and Secrets Manager.
  - `Data` — RDS Postgres 16 (encrypted, `DATABASE_SSL=true`), ElastiCache Redis (TLS), S3 uploads bucket (SSE-KMS, block public access, CORS for presigned PUT).
  - `Secrets` — Secrets Manager JSON secret `selloeasy/<env>/app` holding `OPENROUTER_API_KEY`, JWT secrets and super-admin bootstrap password. The RDS master secret is generated by CDK.
  - `App` — ECS Fargate cluster; services `api`, `worker`, `web`; a one-off `migrate` task definition; ALB with path routing (`/api/*` → api, `/*` → web); autoscaling.
  - `Edge` — ACM certificate (DNS-validated in `HOSTED_ZONE_ID`), CloudFront in front of the ALB, Route53 alias for `DOMAIN_NAME`.
  - `Mail` — SES domain identity + DKIM records in Route53, configuration set.
  - `Observability` — log groups (30-day retention), CloudWatch dashboard, alarms (5xx rate, p95 latency, queue depth, RDS CPU/storage, job failures) → SNS → `ALARM_EMAIL`.
- **IAM:** each ECS task role gets least privilege: S3 bucket prefix access, `ses:SendEmail`, and read on its own secret. No static AWS keys in containers; the S3/SES SDK clients use the default credential chain.
- **Runtime env in ECS:** non-secret values are set as task env vars from config. Secrets are injected through ECS `secrets` from Secrets Manager. `DATABASE_URL` and `REDIS_URL` are assembled by CDK from the created resources, so they're never typed in by hand.

### 23.2 Code-level AWS readiness (built in v1, exercised locally)
| Concern | Local | AWS | Code |
|---|---|---|---|
| Object storage | MinIO | S3 + task role | `StorageProvider` (`minio`/`s3` drivers, same AWS SDK v3 client, endpoint/path-style from env) |
| Email | Mailpit (SMTP) | SES | `MailProvider` (`smtp`/`ses` drivers) |
| Secrets | `.env` | Secrets Manager | `loadSecrets()` at boot when `SECRETS_SOURCE=aws-secrets-manager` |
| DB TLS | off | RDS CA bundle | `DATABASE_SSL=true` → pg ssl config with bundled `rds-global-bundle.pem` |
| Redis TLS | off | ElastiCache TLS | `rediss://` + `REDIS_TLS` |
| Proxy headers | none | ALB/CloudFront | `TRUST_PROXY=true`, secure cookies, correct client IP in audit logs |
| Health | compose healthchecks | ALB target groups | `/health`, `/ready` |
| Migrations | `migrate` compose service | ECS one-off task | same `pnpm db:migrate` entrypoint & image |
| Logs | stdout (pretty) | stdout JSON → CloudWatch | pino, `LOG_LEVEL` |
| Graceful shutdown | — | ECS SIGTERM draining | Fastify `close`, BullMQ worker `close()` |

### 23.3 Deploy commands (scripted, not run in v1)
```bash
cp .env.example .env.aws && $EDITOR .env.aws        # fill group 12 + secrets
pnpm env:check --file .env.aws --target aws          # validates every required AWS key
pnpm deploy:aws --env-file .env.aws                  # cdk bootstrap (first time) → build & push images
                                                     # → cdk deploy all stacks → run migrate task → wait healthy
pnpm deploy:aws:seed-demo --env-file .env.aws        # optional: load synthetic demo data into staging
```
- **CI/CD (GitHub Actions)** is included but **disabled until secrets are set**. `deploy.yml` runs on tags with `if: vars.AWS_DEPLOY_ENABLED == 'true'`, uses OIDC (`GITHUB_OIDC_ROLE_ARN`), pushes to ECR, runs `cdk deploy`, runs the migrate task, then does a smoke test against `/ready`.
- **Verified in CI without an AWS account:** `cdk synth` for staging and production with dummy values, `cdk-nag` security checks, `pnpm env:check --target aws` against a fixture, and all images building. That's as close to deployed as we can get without credentials.
- **Runbook:** `/docs/operations/aws-deployment.mdx` covers first deploy, rollback (redeploy the previous `IMAGE_TAG`), rotating secrets, and restoring RDS from snapshot.

### 23.4 Scaling & cost
- **Scaling:** api scales on CPU/RPS; worker scales on BullMQ queue depth (custom CloudWatch metric published by the worker).
- **Cost note:** a minimal staging env is roughly RDS t4g.micro + cache.t4g.micro + 3 small Fargate tasks + 1 NAT. NAT is the biggest fixed cost, which is why `NAT_GATEWAYS=1` plus VPC endpoints is the default for staging.

---

## 24. Security

- **Auth:** argon2id, login rate limit (5/min/IP+email), account lockout after 10 failures, refresh-token rotation with reuse detection (revoke family), password policy.
- **AuthZ:** server-side RBAC + tenant guard on every route (default-deny: routes must declare a permission or `public: true`).
- **Input:** zod on every request; `@fastify/helmet`, `@fastify/rate-limit`, strict CORS (same-origin), body size limits.
- **Uploads:** presigned PUT with content-type & size conditions, magic-byte check before parsing, AV scan hook (stub in v1).
- **Crawler SSRF protection:** block private/link-local IP ranges after DNS resolution, http(s) only, max bytes, timeouts.
- **Secrets:** env only, Secrets Manager in AWS; `.env` git-ignored; gitleaks in CI.
- **PII:** contacts' email/phone only visible to org members; export action audited; logs redact PII.
- **LLM:** prompt-injection-aware prompting, no tool/function execution from model output, human-in-the-loop for all outreach.
- **Dependencies:** `pnpm audit` + Renovate.

---

## 25. Testing Strategy

| Level | Tool | Scope | Target |
|---|---|---|---|
| Unit | Vitest | `packages/pipeline` stages, scoring math, RBAC matrix, pagination, audit diff/redaction | ≥ 85% lines on packages |
| Integration | Vitest + Fastify `inject` + Testcontainers | Every API module incl. **cross-tenant negative tests** and **RBAC per role** | Every endpoint covered |
| Pipeline | Vitest with `LLM_MODE=mock` + gold set | End-to-end pipeline run over fixture events → expected leads | Deterministic |
| LLM eval | `pnpm eval:pipeline` (live, manual/nightly) | Precision/recall of signal matching | Reported in docs |
| E2E | Playwright | Happy flow: SA creates org → invite (read from Mailpit API) → onboarding → ICP/signal → pipeline run → leads page (6/page) → email outreach → stage WON → dashboards reflect → audit log shows actions | Runs in CI against compose |
| Contract | OpenAPI snapshot | Detect breaking API changes | CI |

---

## 26. Observability

- **Logs:** pino JSON with `requestId`, `orgId`, `userId`; pretty in dev.
- **Metrics:** request latency/error rate, queue depth, job durations, LLM tokens/cost/latency, pipeline match rate.
- **Tracing:** OpenTelemetry SDK (optional exporter; off by default locally).
- **Health:** `/health` & `/ready`; compose healthchecks; ALB target group checks.
- **Admin visibility:** pipeline runs page + LLM cost on platform dashboard.

---

## 27. Delivery Phases & Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Foundation** (≈2 days) | Monorepo scaffold (pnpm, Turbo, TS configs, ESLint/Prettier), `.claude/` skills/agents/hooks, `CLAUDE.md`, **validated config module + full `.env.example` (all local + AWS keys) + `env:check`**, `StorageProvider`/`MailProvider` driver interfaces, docker compose (infra services), Dockerfiles, Fumadocs `/docs` skeleton with IA + first ADRs, CI (lint/typecheck/test/docs:check) | `docker compose up --build` shows web + `/docs` + API `/health`; CI green |
| **P1 — Identity, Tenancy, RBAC, Audit** (≈3 days) | DB schema (identity, audit), auth (login/refresh/logout), invites + Mailpit, Super Admin org CRUD, org user management, RBAC plugin, tenant guard, **super-admin public-data boundary (allow-list DTOs)**, **lead visibility setting**, audit plugin (PLATFORM/ORG scope) + UI | SA creates org, invite email arrives, admin accepts, invites SDR; audit shows all; cross-tenant tests and SA-boundary tests (403 on tenant routes, no internal fields in platform DTOs) pass |
| **P2 — Onboarding & Knowledge** (≈3 days) | Uploads (MinIO), PDF parsing, website crawler, products/plans/policies, FTS chunks, LLM layer (`packages/llm`, mock mode, caching, telemetry), profile generation, onboarding wizard | Org admin completes wizard; AI profile generated (live & mock) |
| **P3 — ICPs, Signals, Dataset** (≈2 days) | Signal templates, ICP suggest/custom, signals CRUD, synthetic dataset (5 orgs, ~300 events, accounts/contacts), seed script | 5 orgs seeded with ICPs & signals |
| **P4 — Pipeline & Scoring** (≈4 days) | Worker, prefilter, LLM match/extract, dedupe/upsert, BANT+ scoring, runs page + SSE, schedule, budget guard, eval harness | Pipeline run produces explainable leads; eval numbers in docs |
| **P5 — Leads, CRM, Outreach** (≈4 days) | Leads grid (6/page) + filters, lead detail, stages, assignment/claim, activities, tasks, email draft/send, WhatsApp/call/Calendly deep links + logging | SDR completes full outreach loop; activities & audit recorded |
| **P6 — Dashboards** (≈2 days) | Org dashboard, platform dashboard, caching | KPIs match seeded data; drill-down links work |
| **P7 — Hardening & Docs** (≈3 days) | Playwright E2E, security pass, RLS (optional), perf pass on leads/dashboards queries, full docs review, README, limitations | E2E green, docs complete, README verified from clean clone |
| **P8 — AWS deploy-ready** (≈3 days) | CDK stacks (§23.1), SES/S3/Secrets Manager drivers exercised, RDS/ElastiCache TLS support, `deploy:aws` script, disabled-by-default `deploy.yml`, `cdk synth` + `cdk-nag` in CI, AWS runbook docs | `cdk synth` passes for staging and prod; `env:check --target aws` passes on the fixture; runbook complete. **Actual deploy (later):** fill in `.env.aws`, run `pnpm deploy:aws`, and the environment comes up healthy |

Rough total: **~25 working days** for one engineer with Claude Code assistance; phases P2/P3 and P5/P6 can parallelize.

---

## 28. Assumptions, Limitations & Trade-offs

**Assumptions**
- Evaluation happens locally via Docker; AWS is the target production platform but not required to evaluate.
- Market events come from a **synthetic dataset**, not live news feeds, in v1.
- Contacts are synthetic; no scraping of personal data from LinkedIn or elsewhere.
- One org per user; English-only content; INR/USD amounts.
- Email is the only channel actually sent; others are deep-link + manual log.

**Known limitations (v1)**
- No real-time news ingestion (adapter interface ready).
- Retrieval uses keyword FTS, not semantic embeddings.
- No email reply ingestion / open tracking.
- WhatsApp/voice/Calendly are not API-integrated.
- LLM scoring quality depends on the chosen model; mitigated via eval harness + editable scores (manual override with reason, audited).

**Trade-offs (each becomes an ADR in `/docs/decisions`)**
| # | Trade-off | Chosen | Cost of choice |
|---|---|---|---|
| 1 | Next.js vs Vite | Next.js (Fumadocs) | Heavier framework for a mostly client app |
| 2 | Drizzle vs Prisma | Drizzle | Smaller ecosystem |
| 3 | BullMQ/Redis vs SQS | BullMQ | Redis to operate (ElastiCache) |
| 4 | FTS vs pgvector | FTS | Weaker semantic recall |
| 5 | Offset vs keyset pagination | Offset (UI) | Slower deep pages (fine at our scale) |
| 6 | Deep links vs provider APIs | Deep links | Manual logging for WA/voice/meetings |
| 7 | App-level tenancy vs RLS | App-level first | Relies on code discipline until RLS |
| 8 | Synthetic vs real data | Synthetic | Less realism, but safe & reproducible |
| 9 | Global events table vs per-org | Global | Must never leak per-org match data (matches are tenant-scoped) |
| 10 | Pre-scored seed leads | Yes | Demo works without key; live run needed to see pipeline in action |
| 11 | Model hard-coded vs env | Env only (`OPENROUTER_MODEL`) | Prompts must stay model-agnostic; quality varies by model |
| 12 | Super Admin full access vs public-only | Public-only + aggregates | Super admin can't debug org-internal data issues directly; support needs an org admin |
| 13 | SDR sees all vs assigned leads | All (v1), setting-driven | Less data isolation between SDRs until switched |
| 14 | Env-driven drivers vs separate AWS code paths | Drivers | Slightly more abstraction; the same image runs everywhere |

---

## 29. Open Questions for Review

### 29.1 Decision log (review round 1 — 2026-09-24)

| # | Question | Decision | Where applied |
|---|---|---|---|
| D1 | OpenRouter model | **Whatever `OPENROUTER_MODEL` says.** No model name in code; required env var; `.env.example` ships the submission value | §16.1, §22.3, ADR-0009 |
| D2 | Industries | **Healthcare, Automotive, Semiconductors, Renewable Energy, Logistics** | §17 |
| D3 | SDR lead visibility | **All org leads for now.** Assigned-only later through the `leadVisibility` org setting (already built and tested) | §8.4, ADR-0011 |
| D4 | Company names in dataset | **Fictional** | §17 |
| D5 | Super Admin data access | **Only public-level data entered by the org, plus aggregates.** No internal data | §2, §8.1, §8.3, §14.2, §15, §18, ADR-0010 |
| D6 | AWS | **Deploy-ready, deploy later.** Every key is in `.env.example`; env-driven drivers; CDK + `deploy:aws` script; fill in keys → deploy → working | §22.3, §23, P8, ADR-0012 |

### 29.2 Decision log (review round 2 — 2026-09-24)

| # | Question | Decision | Where applied |
|---|---|---|---|
| D7 | Frontend framework | **Next.js 15** (required for Fumadocs) | §4, ADR-0001 |
| D8 | Pipeline cost ceiling | **`PIPELINE_MAX_LLM_CALLS_PER_RUN=60`** default | §11.3, §22.3 |
| D9 | Outreach channels in v1 | **Email is sent for real. WhatsApp, voice and Calendly open a deep link and the user logs the contact by hand** | §13.4, ADR-0006 |
| D10 | Product name | **SelloEasy** | — |
| D11 | Leads page layout | **Card grid with 6 per page by default; table view as the alternative** | §13.2 |
| D12 | AWS region | **`ap-south-1` (Mumbai)**, the default for `AWS_REGION` and `SES_REGION` | §22.3, §23 |

### 29.3 Still open

None. The plan is approved for implementation, starting at P0.

---

## 30. Definition of Done

A feature is done when:
- [ ] Code follows module conventions; types shared via `packages/shared`.
- [ ] Every new endpoint: zod-validated, permission-guarded, tenant-scoped, audited.
- [ ] Unit + integration tests (incl. cross-tenant & RBAC negatives) pass; E2E updated if the happy flow changed.
- [ ] `/docs` updated; ADR added for any trade-off/optimization; env vars documented; changelog entry.
- [ ] Reviewed by `reviewer` subagent (code-reviewer skill) with no high-severity findings open.
- [ ] Works via `docker compose up --build` from a clean clone.
- [ ] README reflects run steps, env vars, exact OpenRouter model, architecture, assumptions & limitations.


---

## 31. Implementation Status (2026-09-24)

All phases P0–P8 are implemented. Verified by 54 unit/integration tests, a Playwright happy-flow E2E, `docs:check`, `cdk synth` + cdk-nag for staging and production, and `docker compose up --build` from a clean state.

**Deviations from the plan (each recorded in `/docs`):**

| Plan | Implemented | Why |
|---|---|---|
| Next.js 15 | **Next.js 16** (App Router, `proxy.ts`) | Latest stable at build time; required by Fumadocs 16 |
| `openai` SDK for OpenRouter | Thin `fetch` client in `packages/llm` (ADR-0014) | Fewer version risks; OpenRouter `usage.cost` support |
| Bundled Node images | API/worker run TypeScript via `tsx` (ADR-0013) | BullMQ Lua scripts and pino transports break when bundled |
| Seed from a recorded pipeline run | Seed runs the **real pipeline in mock-LLM mode** + simulated CRM history | Deterministic, free, exercises the real code path |
| Config in `packages/shared` only | Env **schema** in `packages/shared`, loader (+ Secrets Manager) in new `packages/core` | Keeps the browser bundle free of server deps |
| Single `App` CDK stack | `appbase` + `app` stacks (+ `edge-cert` in us-east-1) | Migrations run with the new image before services roll |
| MinIO `minio/minio` image | `quay.io/minio/minio` | Docker Hub image is no longer published |
| — | `packages/engine` (I/O orchestration) and `packages/seed` added | Share pipeline/scoring/ingestion between API, worker and seed without cycles |
| — | `org_event_evaluations` table | Idempotent re-runs without repeated LLM spend (signals-hash keyed) |
