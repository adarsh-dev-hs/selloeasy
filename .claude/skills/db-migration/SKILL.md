---
name: db-migration
description: Changes the Postgres schema safely via Drizzle (packages/db/src/schema) and drizzle-kit migrations, including custom SQL migrations, indexes, backfills and the data-model doc. Use when asked to "add a table/column/index", "change the schema", "write a migration", or "add a trigger/extension".
---

# db-migration

- Schema: `packages/db/src/schema/{identity,knowledge,intelligence,crm,audit}.ts`, barrel `index.ts`,
  helpers in `_helpers.ts` (`id()`, `timestamps`, `tsz()`, `tsvector`, all `pgEnum`s).
- Migrations: `packages/db/drizzle/NNNN_name.sql` + `meta/_journal.json` + snapshots. Applied by
  `pnpm db:migrate` (`packages/db/src/migrate.ts`). Config: `packages/db/drizzle.config.ts`.
- **Never edit a migration that has been applied/committed.** Fix forward with a new migration.

## Flow — schema change

1. Edit the Drizzle table in the right `schema/<area>.ts` file:
   - PK: `id: id()` (uuidv7). Timestamps: `...timestamps`; other times `tsz('col_name')`.
   - Tenant tables: `orgId: orgRef()` (FK to `organizations`, `onDelete: 'cascade'`) and an index that
     starts with `org_id`, e.g. `index('widgets_org_idx').on(t.orgId)` or a composite for the hot query.
   - Enums: values in `packages/shared/src/enums.ts`, `pgEnum` in `_helpers.ts`.
   - Column names snake_case in SQL: `text('hq_country')`; property camelCase.
2. Export the table from `schema/index.ts` if it's a new file.
3. Generate: `pnpm db:generate` (runs `drizzle-kit generate` in `packages/db`).
4. **Review the SQL** in `packages/db/drizzle/NNNN_*.sql`:
   - No accidental `DROP` / rename-as-drop-add (drizzle-kit may prompt for renames; answer carefully).
   - `NOT NULL` column on an existing table needs a `DEFAULT` or a backfill step.
   - Large tables: prefer `CREATE INDEX CONCURRENTLY` in a separate custom migration if needed.
5. Apply locally: `pnpm db:migrate` (or `pnpm db:reset` to rebuild + seed). Update `packages/seed` if seeded data needs the new column.
6. `pnpm typecheck` — fix DTO mappers (`toXxx`) in `apps/api/src/modules/*` and `packages/shared/src/dto.ts`.
7. Docs: `docs/(architecture)/architecture/data-model.mdx` (ERD/table list); ADR if you chose a trade-off (e.g. denormalised
   column, index strategy); `docs/(project)/changelog.mdx`. Run `pnpm docs:check`.

## Flow — custom SQL (triggers, extensions, functions, special indexes)

```bash
pnpm --filter @selloeasy/db exec drizzle-kit generate --custom --name audit_retention_job
# (equivalently: cd packages/db && npx drizzle-kit generate --custom --name ...)
```

Then fill the generated empty file. Separate statements with `--> statement-breakpoint` and make them
idempotent — see `packages/db/drizzle/0001_audit_append_only.sql`:

```sql
-- Custom migration (plan §15): <why>
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accounts_name_trgm_idx ON accounts USING gin (name gin_trgm_ops);
```

## Backfill plan (when changing existing data)

- Add nullable column → backfill in a custom migration (`UPDATE … WHERE … IS NULL`) → set `NOT NULL` in a
  later migration. Batch large updates.
- `audit_logs` is append-only (trigger `audit_logs_guard`); never UPDATE/DELETE it in migrations.

## Checklist

- [ ] uuidv7 `id()`, `timestamps`, snake_case columns
- [ ] Tenant table has `org_id` FK + leading `org_id` index; unique constraints include `org_id` where per-tenant
- [ ] Generated SQL reviewed; no destructive surprises; idempotent custom SQL
- [ ] No applied migration edited; journal/snapshots committed together
- [ ] `pnpm db:reset` works end-to-end (migrate + seed)
- [ ] `docs/(architecture)/architecture/data-model.mdx` + changelog updated (ADR if trade-off)
