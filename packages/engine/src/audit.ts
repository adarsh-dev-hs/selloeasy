import { auditLogs, type DbOrTx } from '@selloeasy/db';
import type { AuditScope } from '@selloeasy/shared';

/** Fields never written to audit before/after payloads (plan §15). */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'tokenHash',
  'token_hash',
  'refreshToken',
  'apiKey',
  'secret',
]);

const IGNORED_KEYS = new Set(['updatedAt', 'updated_at', 'createdAt', 'created_at', 'version', 'tsv']);

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACTED_KEYS.has(k) ? '[redacted]' : normalise(x)]));
  }
  return v;
}

/** Redacts secrets and normalises dates for storage. */
export function redact(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  return normalise(obj) as Record<string, unknown>;
}

/**
 * Field-level diff: returns only the fields that changed (plan §15 "before/after are diffs").
 * Long text is truncated so audit rows stay small.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  if (!before) return { before: null, after: truncate(redact(after)) };
  if (!after) return { before: truncate(redact(before)), after: null };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (IGNORED_KEYS.has(k)) continue;
    if (!(k in after)) continue;
    const bv = normalise(before[k]);
    const av = normalise(after[k]);
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = REDACTED_KEYS.has(k) ? '[redacted]' : bv;
      a[k] = REDACTED_KEYS.has(k) ? '[redacted]' : av;
    }
  }
  return { before: truncate(b), after: truncate(a) };
}

function truncate(obj: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!obj) return null;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v]),
  );
}

export interface AuditEntryInput {
  scope: AuditScope;
  orgId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Append an audit entry. Pass the *same transaction* as the change it describes so the audit row
 * commits or rolls back with it (plan §15 "no lost audits").
 */
export async function writeAudit(db: DbOrTx, entry: AuditEntryInput): Promise<void> {
  const d = entry.before !== undefined || entry.after !== undefined ? diff(entry.before, entry.after) : { before: null, after: null };
  await db.insert(auditLogs).values({
    scope: entry.scope,
    orgId: entry.orgId ?? null,
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: d.before,
    after: d.after,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 300) ?? null,
    requestId: entry.requestId ?? null,
  });
}
