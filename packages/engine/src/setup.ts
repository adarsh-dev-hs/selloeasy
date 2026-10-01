import { and, eq, getDb, signals, signalTemplates, type DbOrTx } from '@selloeasy/db';
import type { Industry } from '@selloeasy/shared';

/**
 * Clone the platform's industry signal templates into an org as editable, toggleable signals
 * (plan §10.2). Idempotent: templates already cloned for the org are skipped.
 */
export async function cloneTemplatesForOrg(db: DbOrTx, orgId: string, industry: Industry): Promise<number> {
  const templates = await db.select().from(signalTemplates).where(eq(signalTemplates.industry, industry));
  if (templates.length === 0) return 0;
  const existing = await db
    .select({ templateId: signals.templateId })
    .from(signals)
    .where(and(eq(signals.orgId, orgId), eq(signals.source, 'PREDEFINED')));
  const have = new Set(existing.map((e) => e.templateId));
  const toInsert = templates.filter((t) => !have.has(t.id));
  if (toInsert.length === 0) return 0;
  await db.insert(signals).values(
    toInsert.map((t) => ({
      orgId,
      templateId: t.id,
      name: t.name,
      description: t.description,
      matchInstructions: t.matchInstructions,
      keywords: t.defaultKeywords,
      negativeKeywords: [],
      weight: t.defaultWeight,
      source: 'PREDEFINED' as const,
      isActive: true,
    })),
  );
  return toInsert.length;
}

export async function orgHasSignals(orgId: string): Promise<boolean> {
  const rows = await getDb().select({ id: signals.id }).from(signals).where(eq(signals.orgId, orgId)).limit(1);
  return rows.length > 0;
}
