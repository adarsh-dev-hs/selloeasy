import { getQueue, QUEUES, type PipelineJob } from '@selloeasy/core';
import { and, eq, getDb, inArray, pipelineRuns } from '@selloeasy/db';
import type { PipelineTrigger } from '@selloeasy/shared';
import { conflict } from './errors';

/**
 * Queue a pipeline run. One run per org at a time (plan §11.3) — enforced here and by the
 * BullMQ job id; the worker also marks stale runs FAILED on startup.
 */
export async function enqueuePipelineRun(orgId: string, trigger: PipelineTrigger, userId: string | null) {
  const db = getDb();
  const [active] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.orgId, orgId), inArray(pipelineRuns.status, ['QUEUED', 'RUNNING'])))
    .limit(1);
  if (active) throw conflict('A pipeline run is already in progress for this organization', { runId: active.id });
  const [run] = await db.insert(pipelineRuns).values({ orgId, trigger, status: 'QUEUED', triggeredBy: userId }).returning();
  await getQueue<PipelineJob>(QUEUES.pipeline).add(
    'pipeline.run',
    { kind: 'pipeline.run', orgId, runId: run!.id, trigger },
    { jobId: `pipeline-${run!.id}`, attempts: 1 },
  );
  return run!;
}
