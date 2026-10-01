---
name: tester
description: Writes and runs SelloEasy tests with Vitest — pure unit tests for packages/pipeline, shared and llm mocks, and Fastify inject integration tests for apps/api including mandatory RBAC-per-role and cross-tenant negative tests. Use when asked to "write tests", "add coverage", "run the tests", "fix failing tests", or after implementing any endpoint or pipeline change.
---

# tester

## Test pyramid (plan §25)

| Level       | Where                                                        | Notes                                                                            |
| ----------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Unit        | `packages/{pipeline,shared,llm,engine}/test/*.test.ts`       | Pure, fast, no DB/network. Target ≥ 85% lines on packages.                       |
| Integration | `apps/api/test/*.test.ts`                                    | `buildServer()` + `app.inject`, real Postgres/Redis (compose or Testcontainers). |
| Pipeline    | `packages/pipeline` / `packages/engine` with `LLM_MODE=mock` | Deterministic end-to-end over dataset fixtures.                                  |
| LLM eval    | `pnpm eval:pipeline`                                         | Live/manual; results into `docs/(architecture)/pipeline/evaluation.mdx`.                        |
| E2E         | Playwright (happy flow, plan §25)                            | Against `docker compose up`; Mailpit API for invite emails.                      |

Tests sit next to code in a `test/` folder per package, named `<unit>.test.ts`. Import from `../src`.

## Commands

```bash
pnpm test                                        # all (turbo)
pnpm --filter @selloeasy/pipeline test           # one package
pnpm --filter @selloeasy/pipeline exec vitest run test/scoring.test.ts -t "authority"
pnpm typecheck
docker compose up -d postgres redis && pnpm db:reset   # before API integration tests
```

Always run with `LLM_MODE=mock` (default when `OPENROUTER_API_KEY` is empty). Never call the network in tests.
Never hard-code a model name in tests.

## Unit test skeleton (pure)

```ts
import { describe, expect, it } from 'vitest';
import { combineScore } from '../src';

const now = new Date('2026-09-24T00:00:00Z'); // fixed clock — pass `now` in, never Date.now()

describe('combineScore', () => {
  it('clamps to 0..100 and bands correctly', () => {
    const r = combineScore({/* … */});
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.band).toBe('HOT');
  });
});
```

For prompts: assert `prompt.schema.parse(prompt.mock(input))` succeeds and the mock is deterministic
(`expect(prompt.mock(x)).toEqual(prompt.mock(x))`).

## API integration skeleton (RBAC + cross-tenant are mandatory for new endpoints)

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initConfig } from '@selloeasy/core';
import { buildServer } from '../src/server';

let app: Awaited<ReturnType<typeof buildServer>>;
async function login(email: string, password = 'Password@123') {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return { cookie: res.headers['set-cookie'] as string | string[] };
}

beforeAll(async () => {
  await initConfig();
  app = await buildServer({ logger: false });
  await app.ready();
});
afterAll(() => app.close());

describe('PATCH /widgets/:id', () => {
  it("404s for another tenant's widget (no existence leak)", async () => {
    const orgB = await login('admin@<other-org>.local');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/widgets/${orgAWidgetId}`,
      headers: orgB,
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it.each([
    ['ORG_ADMIN', 200],
    ['SALES_MANAGER', 200],
    ['SDR', 403],
    ['VIEWER', 403],
  ])('%s → %i', async (role, status) => {
    /* login as a seeded user with that role */
  });

  it('super admin gets 403 on tenant routes (ADR-0010)', async () => {
    /* … */
  });
  it('writes an audit row in the same transaction', async () => {
    /* query audit_logs by requestId/entityId */
  });
  it('rejects invalid body with 400 validation_error', async () => {
    /* … */
  });
});
```

Seeded accounts use `DEMO_PASSWORD` from `packages/seed/src/seed.ts`; see
`docs/(guide)/getting-started/seed-data-and-accounts.mdx`. Prefer creating fixtures via factories/API over relying on
seed row ids.

## Triage when tests fail

1. Re-run the single failing file with `-t` to isolate.
2. Classify: product bug vs. test bug vs. environment (DB not migrated, Redis down, missing env).
3. Environment → `pnpm db:reset`, `docker compose ps`, `pnpm env:check`.
4. Fix the root cause; never weaken assertions or `skip` a cross-tenant/RBAC test to get green.

## Checklist

- [ ] New pure logic has unit tests with a fixed clock
- [ ] New/changed prompt: schema-valid deterministic mock test
- [ ] Every new endpoint: happy path, 400 validation, 403 per disallowed role, super-admin 403 (tenant routes), **cross-tenant 404**, audit row
- [ ] No network, no model names, no reliance on test order
- [ ] `pnpm test` and `pnpm typecheck` pass
