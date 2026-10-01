---
name: api-endpoint
description: Scaffolds or modifies a Fastify route in apps/api with zod schema, OpenAPI tags, RBAC preHandler, tenant scoping, same-transaction audit, RFC 7807 errors, tests and docs. Use when asked to "add an endpoint", "add a route", "expose X via the API", or change request/response shapes of an existing route.
---

# api-endpoint

Routes live in `apps/api/src/modules/<module>.ts` as a `FastifyPluginAsyncZod` and are registered under
`/api/v1` in `apps/api/src/server.ts` (`v1.register(xxxRoutes)`).

## Steps

1. **DTOs** — add request schema (`fooSchema`, `fooListQuerySchema`) and response type to
   `packages/shared/src/dto.ts`; export from `packages/shared/src/index.ts`. Use `idParamSchema` for `:id`,
   `pageQuerySchema`/`offsetOf`/`toPage` for lists.
2. **Permission** — pick an existing permission in `packages/shared/src/rbac.ts` or add one to `PERMISSIONS`
   and `ROLE_PERMISSIONS` (and to `docs/(guide)/concepts/roles-and-permissions.mdx`).
3. **Guard** — tenant route: `preHandler: requireOrg('perm')` (rejects super admins). Platform route:
   `preHandler: requirePermission('platform:…')`. Public route (rare: auth only): document why. No guard = bug.
4. **Tenant scoping** — `const orgId = orgIdOf(req)` and `eq(table.orgId, orgId)` in every query, including
   the `where` of updates/deletes. Leads: `loadLead(authOf(req), id)` (applies org + visibility). Foreign ids in
   the body (ownerUserId, contactId, icpId…) must be verified to belong to the same org.
5. **Not found vs forbidden** — missing or other-tenant row → `throw notFound('Thing')` (never reveal existence).
   Permission present but action disallowed (e.g. SDR on others' lead) → `forbidden(...)` / `assertLeadOwnership`.
6. **Mutation + audit** — single write: `req.audit({...})` right after. Multiple writes: wrap in
   `getDb().transaction(async (tx) => { …; await req.audit({...}, tx); })`. Pass `before`/`after` rows; the
   engine diffs and redacts. Action naming: `entity.verb_past` (`icp.updated`).
7. **Errors** — only helpers from `apps/api/src/lib/errors.ts`; the errors plugin emits problem+json.
   Optimistic locking → `conflict(msg, { currentVersion })`.
8. **Status codes** — `reply.code(201)` on create; return `{ ok: true }` for deletes (existing convention).
9. **Platform (super admin) routes** — build responses field-by-field into allow-list DTOs
   (e.g. `PlatformOrgPublicView`). Never return tenant rows/DTOs (ADR-0010).
10. **Tests** — see **tester**: happy path, validation 400, each role's 403, cross-tenant 404, audit row written.
11. **Docs** — `docs/(architecture)/api/reference.mdx` (endpoint list/OpenAPI) + the matching `docs/(guide)/modules/*.mdx`, changelog.
    Run `pnpm docs:check`.

## Skeleton

```ts
import { and, eq, getDb, widgets } from '@selloeasy/db';
import { idParamSchema, updateWidgetSchema, widgetSchema, type Widget } from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { notFound } from '../lib/errors';
import { orgIdOf, requireOrg } from '../plugins/auth';

export const widgetRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['widgets'];

  app.get(
    '/widgets/:id',
    {
      schema: { tags, summary: 'Widget detail', params: idParamSchema },
      preHandler: requireOrg('widgets:read'),
    },
    async (req): Promise<Widget> => {
      const [row] = await getDb()
        .select()
        .from(widgets)
        .where(and(eq(widgets.id, req.params.id), eq(widgets.orgId, orgIdOf(req))));
      if (!row) throw notFound('Widget');
      return toWidget(row);
    },
  );

  app.patch(
    '/widgets/:id',
    {
      schema: { tags, summary: 'Update a widget', params: idParamSchema, body: updateWidgetSchema },
      preHandler: requireOrg('widgets:write'),
    },
    async (req) => {
      const orgId = orgIdOf(req);
      return getDb().transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(widgets)
          .where(and(eq(widgets.id, req.params.id), eq(widgets.orgId, orgId)));
        if (!before) throw notFound('Widget');
        const [after] = await tx
          .update(widgets)
          .set(req.body)
          .where(and(eq(widgets.id, before.id), eq(widgets.orgId, orgId)))
          .returning();
        await req.audit(
          { action: 'widget.updated', entityType: 'widget', entityId: before.id, before, after } as never,
          tx,
        );
        return toWidget(after!);
      });
    },
  );
};
```

## Checklist

- [ ] `schema` has `tags`, `summary`, and zod `params`/`querystring`/`body` from `@selloeasy/shared`
- [ ] `preHandler` guard present with the least-privileged permission
- [ ] `orgId` from `orgIdOf(req)` in every where clause (select, update, delete, joins)
- [ ] Referenced ids from input verified to be in the same org
- [ ] Mutation audited, in the same `tx` when multi-write; no secrets in `before`/`after`
- [ ] Lists paginated (`toPage`), sensible max `pageSize`, no N+1 (batch-load with `inArray`)
- [ ] Registered in `server.ts`; OpenAPI shows it at `/api/docs`
- [ ] Tests incl. cross-tenant 404 + per-role 403; docs + changelog updated
