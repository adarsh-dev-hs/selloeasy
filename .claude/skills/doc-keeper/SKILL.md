---
name: doc-keeper
description: Keeps docs/ in sync with code — maps changed paths to Fumadocs pages, writes/updates ADRs for trade-offs, updates the changelog, env var docs and README snippets, then runs pnpm docs:check. Use after any code change, or when asked to "update the docs", "write an ADR", "document this", or when the Stop hook reports code changed without docs.
---

# doc-keeper

Docs live in the root `docs/` folder (Fumadocs MDX, sidebar from `meta.json` files, rendered at `/docs` and by
`apps/docs-site`). The sidebar has a section dropdown built from `root: true` folders: `(guide)`, `(architecture)`,
`operations`, `decisions`, `(project)`. Folders in parentheses group pages **without** changing URLs
(`docs/(guide)/concepts/icps.mdx` → `/docs/concepts/icps`). Put a new page in the section a reader would look in,
and link to it by URL (`/docs/...`), never by file path.
Rule (plan §20.4): schema, endpoint, prompt, env or trade-off changes update docs **in the same change**.

## Step 1 — What changed?

```bash
git status --porcelain
git diff --name-only
```

## Step 2 — Map paths → pages

| Changed path                                                         | Update                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/env.ts`, `.env.example`                         | `docs/(guide)/getting-started/environment-variables.mdx` (every key documented), README env snippet → `pnpm docs:sync-readme`                        |
| `packages/db/src/schema/**`, `packages/db/drizzle/**`                | `docs/(architecture)/architecture/data-model.mdx`                                                                                                    |
| `apps/api/src/modules/**`                                            | `docs/(architecture)/api/reference.mdx` + the matching `docs/(guide)/modules/*.mdx`                                                                  |
| `packages/shared/src/rbac.ts`                                        | `docs/(guide)/concepts/roles-and-permissions.mdx`                                                                                                    |
| `apps/api/src/plugins/auth.ts`, tenancy helpers                      | `docs/(architecture)/architecture/multi-tenancy.mdx`, `docs/(architecture)/architecture/security.mdx`                                                |
| `packages/llm/src/prompts/**`                                        | `docs/(architecture)/pipeline/prompts.mdx` (id, version, schema, change note)                                                                        |
| `packages/llm/src/client.ts`, `packages/llm/src/providers/**`        | `docs/(architecture)/pipeline/llm-providers.mdx`                                                                                                     |
| `packages/pipeline/src/**`, `packages/engine/src/pipeline.ts`        | `docs/(architecture)/pipeline/stages.mdx`, `docs/(architecture)/pipeline/overview.mdx`; eval results → `docs/(architecture)/pipeline/evaluation.mdx` |
| `packages/pipeline/src/scoring.ts`, `packages/shared/src/scoring.ts` | `docs/(guide)/concepts/bant-scoring.mdx`                                                                                                             |
| `packages/dataset/**`, `packages/seed/**`                            | `docs/(guide)/getting-started/seed-data-and-accounts.mdx`                                                                                            |
| `apps/worker/**`, `packages/core/src/queues.ts`                      | `docs/(architecture)/architecture/overview.mdx`, `docs/operations/runbooks.mdx`                                                                      |
| `docker-compose.yml`, `apps/*/Dockerfile`                            | `docs/operations/docker.mdx`, `docs/(guide)/getting-started/quickstart.mdx`                                                                          |
| `infra/**`                                                           | `docs/operations/aws-deployment.mdx`                                                                                                                 |
| `apps/web/**` (user-visible feature)                                 | relevant `docs/(guide)/modules/*.mdx` / `docs/(guide)/concepts/*.mdx`                                                                                |
| Any optimization / trade-off / "we chose X over Y"                   | `docs/decisions/NNNN-<slug>.mdx` + row in `docs/decisions/index.mdx`                                                                                 |
| Known limitation introduced                                          | `docs/(project)/limitations.mdx`                                                                                                                     |
| **Always**                                                           | `docs/(project)/changelog.mdx`                                                                                                                       |

If a target page does not exist yet, create it and add it to the folder's `meta.json` `pages` array.

## Step 3 — ADR template (`docs/decisions/NNNN-kebab-title.mdx`)

Take the next free number (`ls docs/decisions`). Superseding an ADR: set the old one's status to
`Superseded by ADR-NNNN`; never delete ADRs.

```mdx
---
title: ADR-0013 — <Decision in a few words>
description: <one line>
status: Accepted
date: 2026-09-24
---

## Context

What problem/force made a decision necessary. Numbers if you have them.

## Decision

What we do, precisely (name files/flags/defaults).

## Consequences (trade-offs, perf/cost impact)

- Positive: …
- Negative (cost, latency, complexity, risk): …

## Alternatives considered

- <Option> — why not.

## Revisit when

Concrete trigger (e.g. "> 50k leads per org", "p95 list latency > 300 ms").
```

Add a row to `docs/decisions/index.mdx` (number, title link, status, date) and an in-code pointer next to the
non-obvious code: `// ADR-0013: <short> — see /docs/decisions/0013-<slug>`.

## Step 4 — Changelog entry (`docs/(project)/changelog.mdx`)

Newest first, grouped under an `## Unreleased` heading with `### Added / Changed / Fixed / Security` subsections.
One line per user- or developer-visible change, linking the docs page or ADR.

## Step 5 — Verify

```bash
pnpm docs:check          # changed-code-needs-docs, env vars documented, internal links
pnpm env:check           # when env changed
pnpm docs:sync-readme    # when README snippets (quickstart, env, model) are affected
```

## Rules

- Docs describe what the code does now — verify against the code, don't copy from plan.md blindly.
- Never include real secrets or a hard-coded model name; refer to `OPENROUTER_MODEL`.
- Keep pages Markdown-first (readable on GitHub); Mermaid for diagrams.

## Checklist

- [ ] Every changed path mapped and its page updated
- [ ] ADR added/updated for any trade-off; decisions index updated; in-code pointer added
- [ ] Env vars documented; README snippets synced
- [ ] `docs/(project)/changelog.mdx` updated
- [ ] `pnpm docs:check` passes
