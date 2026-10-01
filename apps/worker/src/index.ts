import {
  bullConnection,
  closeQueues,
  createLogger,
  createRedis,
  getConfig,
  getMail,
  getQueue,
  getStorage,
  initConfig,
  pipelineProgressChannel,
  QUEUES,
  textToHtml,
  ingestionProgressChannel,
  type IngestionJob,
  type MaintenanceJob,
  type OutreachJob,
  type PipelineJob,
  type ProfileJob,
} from '@selloeasy/core';
import { activities, and, closeDb, dataBatches, dataConnectors, eq, getDb, inArray, ingestionRuns, organizations, outreachMessages, pipelineRuns, sql, users } from '@selloeasy/db';
import { commitBatch, createLlm, failStaleRuns, generateProfile, processSource, purgeStagingRows, runIngestion, runPipeline, validateBatch, writeAudit } from '@selloeasy/engine';
import { Worker, type Job } from 'bullmq';
import { inviteEmail, passwordResetEmail } from './emails';

/**
 * Background worker (plan §6): profile ingestion, pipeline runs, outreach email, maintenance.
 * Same image/command locally (compose) and on ECS.
 */
await initConfig();
const cfg = getConfig();
const log = createLogger('worker');
const redis = createRedis();
const publisher = createRedis();
const llm = createLlm({ redis });
const connection = bullConnection();

if (cfg.llmAutoMocked) log.warn({ provider: cfg.LLM_PROVIDER }, 'No API key for the selected LLM provider — LLM_MODE=mock (deterministic fixtures).');
else log.info({ mode: cfg.LLM_MODE, provider: llm.providerId, model: llm.model }, 'LLM configured');

await getStorage()
  .ensureBucket()
  .catch((err) => log.warn({ err: err.message }, 'Could not ensure bucket'));
const stale = await failStaleRuns(30);
if (stale) log.warn({ count: stale }, 'Marked stale pipeline runs as FAILED');

// ── profile: source processing & profile generation ──────────────────────────
const profileWorker = new Worker<ProfileJob>(
  QUEUES.profile,
  async (job: Job<ProfileJob>) => {
    const d = job.data;
    if (d.kind === 'source.process') {
      const r = await processSource(d.sourceId);
      log.info({ sourceId: d.sourceId, chunks: r.chunks }, 'Source processed');
      return r;
    }
    const profile = await generateProfile(llm, d.orgId);
    await writeAudit(getDb(), { scope: 'ORG', orgId: d.orgId, actorUserId: d.requestedBy, action: 'profile.generated', entityType: 'org_profile', entityId: d.orgId, after: { model: llm.model, targetIndustries: profile.targetIndustries } });
    log.info({ orgId: d.orgId }, 'Profile generated');
    return { ok: true };
  },
  { connection, concurrency: 2 },
);

// ── pipeline: runs + scheduler tick ──────────────────────────────────────────
const pipelineWorker = new Worker<PipelineJob>(
  QUEUES.pipeline,
  async (job: Job<PipelineJob>) => {
    const d = job.data;
    if (d.kind === 'pipeline.schedule-tick') {
      const db = getDb();
      const active = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.status, 'ACTIVE'));
      const busy = await db
        .select({ orgId: pipelineRuns.orgId })
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.status, ['QUEUED', 'RUNNING']));
      const busySet = new Set(busy.map((b) => b.orgId));
      let queued = 0;
      for (const org of active) {
        if (busySet.has(org.id)) continue;
        const [run] = await db.insert(pipelineRuns).values({ orgId: org.id, trigger: 'SCHEDULED', status: 'QUEUED' }).returning();
        await getQueue<PipelineJob>(QUEUES.pipeline).add('pipeline.run', { kind: 'pipeline.run', orgId: org.id, runId: run!.id, trigger: 'SCHEDULED' }, { jobId: `pipeline-${run!.id}`, attempts: 1 });
        queued++;
      }
      log.info({ queued }, 'Scheduled pipeline runs');
      return { queued };
    }
    const channel = pipelineProgressChannel(d.runId);
    const result = await runPipeline({
      llm,
      orgId: d.orgId,
      runId: d.runId,
      onProgress: async (e) => {
        await publisher.publish(channel, JSON.stringify(e));
        await job.updateProgress(e.progress);
      },
    });
    log.info({ orgId: d.orgId, runId: d.runId, ...result.stats, status: result.status }, 'Pipeline run finished');
    return result;
  },
  // Different orgs may run concurrently; one run per org is enforced by the API + job ids.
  { connection, concurrency: 2, lockDuration: 120_000 },
);

// ── outreach: emails ─────────────────────────────────────────────────────────
const outreachWorker = new Worker<OutreachJob>(
  QUEUES.outreach,
  async (job: Job<OutreachJob>) => {
    const d = job.data;
    const mail = getMail();
    if (d.kind === 'mail.invite') return mail.send(inviteEmail(d));
    if (d.kind === 'mail.password-reset') return mail.send(passwordResetEmail(d));

    const db = getDb();
    const [msg] = await db.select().from(outreachMessages).where(and(eq(outreachMessages.id, d.messageId), eq(outreachMessages.orgId, d.orgId)));
    if (!msg) throw new Error(`Outreach message ${d.messageId} not found`);
    if (msg.status === 'SENT') return { skipped: true };
    const [sender] = msg.sentBy ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, msg.sentBy)) : [];
    const [org] = await db.select({ name: organizations.name, settings: organizations.settings }).from(organizations).where(eq(organizations.id, d.orgId));
    try {
      const res = await mail.send({
        to: msg.to,
        subject: msg.subject ?? '(no subject)',
        text: msg.body,
        html: textToHtml(msg.body),
        fromName: sender ? `${sender.name} (${org?.settings.senderName ?? org?.name})` : org?.name,
        replyTo: sender?.email,
        headers: { 'X-SelloEasy-Message-Id': msg.id },
      });
      await db.update(outreachMessages).set({ status: 'SENT', providerMessageId: res.messageId, sentAt: new Date(), error: null }).where(eq(outreachMessages.id, msg.id));
      await db
        .update(activities)
        .set({ metadata: sql`${activities.metadata} || ${JSON.stringify({ status: 'sent', providerMessageId: res.messageId })}::jsonb` })
        .where(and(eq(activities.leadId, msg.leadId), sql`${activities.metadata}->>'messageId' = ${msg.id}`));
      return res;
    } catch (err) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final) {
        await db.update(outreachMessages).set({ status: 'FAILED', error: (err as Error).message.slice(0, 500) }).where(eq(outreachMessages.id, msg.id));
        await db
          .update(activities)
          .set({ metadata: sql`${activities.metadata} || ${JSON.stringify({ status: 'failed', error: (err as Error).message.slice(0, 200) })}::jsonb` })
          .where(and(eq(activities.leadId, msg.leadId), sql`${activities.metadata}->>'messageId' = ${msg.id}`));
      }
      throw err;
    }
  },
  { connection, concurrency: 5 },
);

// ── maintenance: audit retention ─────────────────────────────────────────────
const maintenanceWorker = new Worker<MaintenanceJob>(
  QUEUES.maintenance,
  async (job: Job<MaintenanceJob>) => {
    if (job.data.kind === 'maintenance.staging-purge') {
      const purged = await purgeStagingRows(cfg.STAGING_RETENTION_DAYS);
      log.info({ purged }, 'Purged staged import rows');
      return { purged };
    }
    const days = cfg.AUDIT_RETENTION_DAYS;
    const deleted = await getDb().transaction(async (tx) => {
      // The append-only trigger allows deletes only when this flag is set (migration 0001).
      await tx.execute(sql`set local selloeasy.audit_retention = 'on'`);
      const r = await tx.execute(sql`delete from audit_logs where occurred_at < now() - (${days} || ' days')::interval`);
      return r.rowCount ?? 0;
    });
    log.info({ deleted, days }, 'Audit retention applied');
    return { deleted };
  },
  { connection, concurrency: 1 },
);

// ── ingestion: platform data imports + connector runs (plan2 §6–7) ────────────
const ingestionWorker = new Worker<IngestionJob>(
  QUEUES.ingestion,
  async (job: Job<IngestionJob>) => {
    const d = job.data;
    switch (d.kind) {
      case 'import.validate': {
        const stats = await validateBatch(d.batchId, llm);
        log.info({ batchId: d.batchId, ...stats }, 'Import validated');
        return stats;
      }
      case 'import.commit': {
        try {
          const stats = await commitBatch(d.batchId, d.userId);
          log.info({ batchId: d.batchId, inserted: stats.inserted }, 'Import committed');
          return stats;
        } catch (err) {
          // Leave the batch reviewable again instead of stuck in COMMITTING.
          await getDb().update(dataBatches).set({ status: 'VALIDATED', error: (err as Error).message.slice(0, 500) }).where(eq(dataBatches.id, d.batchId));
          throw err;
        }
      }
      case 'ingestion.run': {
        const channel = ingestionProgressChannel(d.runId);
        const res = await runIngestion(d.runId, async (e) => {
          await publisher.publish(channel, JSON.stringify(e));
          await job.updateProgress(e.progress);
        });
        log.info({ runId: d.runId, ...res.stats, status: res.status }, 'Ingestion finished');
        return res;
      }
      case 'ingestion.schedule': {
        const db = getDb();
        const [c] = await db.select().from(dataConnectors).where(eq(dataConnectors.id, d.connectorId));
        if (!c?.enabled) return { skipped: 'disabled' };
        const [busy] = await db.select({ id: ingestionRuns.id }).from(ingestionRuns).where(and(eq(ingestionRuns.connectorId, c.id), inArray(ingestionRuns.status, ['QUEUED', 'RUNNING'])));
        if (busy) return { skipped: 'running' };
        const [run] = await db.insert(ingestionRuns).values({ connectorId: c.id, trigger: 'SCHEDULED', status: 'QUEUED' }).returning();
        await getQueue<IngestionJob>(QUEUES.ingestion).add('ingestion.run', { kind: 'ingestion.run', runId: run!.id }, { jobId: `ingest-${run!.id}`, attempts: 1 });
        return { runId: run!.id };
      }
    }
  },
  // Imports and ingestion runs are chunked; 2 concurrent jobs keeps DB pressure bounded.
  { connection, concurrency: 2, lockDuration: 300_000 },
);

// Repeatable schedules (idempotent upserts).
await getQueue<PipelineJob>(QUEUES.pipeline).upsertJobScheduler('pipeline-schedule', { pattern: cfg.PIPELINE_SCHEDULE_CRON }, { name: 'pipeline.schedule-tick', data: { kind: 'pipeline.schedule-tick' } });
await getQueue<MaintenanceJob>(QUEUES.maintenance).upsertJobScheduler('audit-retention', { pattern: '30 3 * * *' }, { name: 'maintenance.audit-retention', data: { kind: 'maintenance.audit-retention' } });
await getQueue<MaintenanceJob>(QUEUES.maintenance).upsertJobScheduler('staging-purge', { pattern: '45 3 * * *' }, { name: 'maintenance.staging-purge', data: { kind: 'maintenance.staging-purge' } });
// Re-sync per-connector schedules (plan2 §6.2) — the API upserts them on change; this covers fresh Redis.
for (const c of await getDb().select().from(dataConnectors)) {
  const id = `connector-${c.id}`;
  if (c.enabled && c.schedule) await getQueue<IngestionJob>(QUEUES.ingestion).upsertJobScheduler(id, { pattern: c.schedule }, { name: 'ingestion.schedule', data: { kind: 'ingestion.schedule', connectorId: c.id } });
  else await getQueue(QUEUES.ingestion).removeJobScheduler(id).catch(() => undefined);
}
// Ingestion runs left RUNNING by a crash are failed so the connector can run again.
await getDb().update(ingestionRuns).set({ status: 'FAILED', error: 'Worker restarted during the run', finishedAt: new Date() }).where(and(inArray(ingestionRuns.status, ['RUNNING', 'QUEUED']), sql`${ingestionRuns.createdAt} < now() - interval '30 minutes'`));

const workers = [profileWorker, pipelineWorker, outreachWorker, maintenanceWorker, ingestionWorker];
for (const w of workers) {
  w.on('failed', (job, err) => log.error({ queue: w.name, jobId: job?.id, kind: (job?.data as { kind?: string })?.kind, err: err.message }, 'Job failed'));
  w.on('error', (err) => log.error({ queue: w.name, err: err.message }, 'Worker error'));
}
log.info({ queues: workers.map((w) => w.name), schedule: cfg.PIPELINE_SCHEDULE_CRON }, 'Worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Worker shutting down (draining active jobs)');
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await Promise.allSettled([redis.quit(), publisher.quit()]);
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
