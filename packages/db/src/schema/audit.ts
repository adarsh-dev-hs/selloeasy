import { bigserial, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditScopeEnum, tsz } from './_helpers';

/**
 * Append-only audit trail (plan §15).
 * - No FKs on purpose: audit rows must outlive the records they describe.
 * - UPDATE/DELETE are blocked by a trigger created in the migrations.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: tsz('occurred_at').defaultNow().notNull(),
    scope: auditScopeEnum('scope').notNull(),
    orgId: uuid('org_id'),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_logs_org_time_idx').on(t.orgId, t.occurredAt.desc()),
    index('audit_logs_scope_time_idx').on(t.scope, t.occurredAt.desc()),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorUserId),
  ],
);
