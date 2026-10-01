import { APPROACHED_STAGES } from '@selloeasy/shared';
import { getDb, inArray, leads, llmCalls, pipelineRuns, sql } from '@selloeasy/db';

export interface OrgCounts {
  leads: number;
  approached: number;
  meetings: number;
  converted: number;
}

/** Aggregate counts per org — numbers only, never records (safe for Super Admin, ADR-0010). */
export async function countsByOrg(orgIds: string[]): Promise<Map<string, OrgCounts>> {
  const out = new Map<string, OrgCounts>();
  if (orgIds.length === 0) return out;
  const approached = sql.join(APPROACHED_STAGES.map((s) => sql`${s}`), sql`, `);
  const rows = await getDb()
    .select({
      orgId: leads.orgId,
      leads: sql<number>`count(*)::int`,
      approached: sql<number>`count(*) filter (where ${leads.stage}::text in (${approached}))::int`,
      meetings: sql<number>`count(*) filter (where ${leads.stage} in ('MEETING_SCHEDULED','QUALIFIED','PROPOSAL','WON'))::int`,
      converted: sql<number>`count(*) filter (where ${leads.stage} = 'WON')::int`,
    })
    .from(leads)
    .where(inArray(leads.orgId, orgIds))
    .groupBy(leads.orgId);
  for (const r of rows) out.set(r.orgId, { leads: r.leads, approached: r.approached, meetings: r.meetings, converted: r.converted });
  return out;
}

export async function llmUsageByOrg(orgIds: string[]) {
  const out = new Map<string, { cost: number; calls: number }>();
  if (orgIds.length === 0) return out;
  const rows = await getDb()
    .select({
      orgId: llmCalls.orgId,
      cost: sql<number>`coalesce(sum(${llmCalls.costUsd}),0)::float`,
      calls: sql<number>`count(*) filter (where not ${llmCalls.cached})::int`,
    })
    .from(llmCalls)
    .where(sql`${llmCalls.orgId} in (${sql.join(orgIds.map((i) => sql`${i}::uuid`), sql`, `)}) and ${llmCalls.createdAt} > now() - interval '30 days'`)
    .groupBy(llmCalls.orgId);
  for (const r of rows) if (r.orgId) out.set(r.orgId, { cost: Math.round(r.cost * 10000) / 10000, calls: r.calls });
  return out;
}

export async function lastRunByOrg(orgIds: string[]) {
  const out = new Map<string, { status: typeof pipelineRuns.$inferSelect.status; finishedAt: Date | null; error: string | null }>();
  if (orgIds.length === 0) return out;
  const rows = await getDb()
    .selectDistinctOn([pipelineRuns.orgId], { orgId: pipelineRuns.orgId, status: pipelineRuns.status, finishedAt: pipelineRuns.finishedAt, error: pipelineRuns.error })
    .from(pipelineRuns)
    .where(inArray(pipelineRuns.orgId, orgIds))
    .orderBy(pipelineRuns.orgId, sql`${pipelineRuns.createdAt} desc`);
  for (const r of rows) out.set(r.orgId, { status: r.status, finishedAt: r.finishedAt, error: r.error });
  return out;
}

export const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
