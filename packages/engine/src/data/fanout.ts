import { getQueue, QUEUES, type PipelineJob } from '@selloeasy/core';
import { and, eq, getDb, icps, inArray, organizations, orgProfiles, pipelineRuns } from '@selloeasy/db';
import type { PipelineRun, PipelineTrigger } from '@selloeasy/shared';

type RunRow = typeof pipelineRuns.$inferSelect;

/**
 * Queue a pipeline run for an org unless one is already QUEUED/RUNNING (one run per org, plan §11.3).
 * Returns null when the org is busy.
 */
export async function enqueueOrgPipelineRun(
  orgId: string,
  trigger: PipelineTrigger,
  userId: string | null,
): Promise<RunRow | null> {
  const db = getDb();
  const [active] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.orgId, orgId), inArray(pipelineRuns.status, ['QUEUED', 'RUNNING'])))
    .limit(1);
  if (active) return null;
  const [run] = await db
    .insert(pipelineRuns)
    .values({ orgId, trigger, status: 'QUEUED', triggeredBy: userId })
    .returning();
  await getQueue<PipelineJob>(QUEUES.pipeline).add(
    'pipeline.run',
    { kind: 'pipeline.run', orgId, runId: run!.id, trigger },
    { jobId: `pipeline-${run!.id}`, attempts: 1 },
  );
  return run!;
}

/**
 * Fan-out after new platform data (plan2 §6.2): enqueue DATA_REFRESH runs for ACTIVE orgs whose target
 * industries (profile + active ICPs) overlap the new events' tags. Busy orgs are skipped — their next run
 * (manual or scheduled) will pick the events up anyway.
 */
export async function fanOutToOrgs(tags: string[], userId: string | null): Promise<{ orgIds: string[] }> {
  const want = new Set(tags.map((t) => t.toLowerCase()));
  if (want.size === 0) return { orgIds: [] };
  const db = getDb();
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.status, 'ACTIVE'));
  if (orgs.length === 0) return { orgIds: [] };
  const ids = orgs.map((o) => o.id);
  const profiles = await db
    .select({ orgId: orgProfiles.orgId, t: orgProfiles.targetIndustries })
    .from(orgProfiles)
    .where(inArray(orgProfiles.orgId, ids));
  const icpRows = await db
    .select({ orgId: icps.orgId, c: icps.criteria })
    .from(icps)
    .where(and(inArray(icps.orgId, ids), eq(icps.isActive, true)));
  const targets = new Map<string, Set<string>>();
  const add = (orgId: string, list: string[]) => {
    const s = targets.get(orgId) ?? new Set<string>();
    for (const t of list) s.add(t.toLowerCase());
    targets.set(orgId, s);
  };
  for (const p of profiles) add(p.orgId, p.t);
  for (const i of icpRows) add(i.orgId, i.c.industries);
  const queued: string[] = [];
  for (const id of ids) {
    const t = targets.get(id);
    if (!t || ![...t].some((x) => want.has(x))) continue;
    if (await enqueueOrgPipelineRun(id, 'DATA_REFRESH', userId)) queued.push(id);
  }
  return { orgIds: queued };
}

export type { PipelineRun };
