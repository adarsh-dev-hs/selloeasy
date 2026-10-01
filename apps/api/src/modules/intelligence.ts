import { createRedis, pipelineProgressChannel } from '@selloeasy/core';
import { and, count, desc, eq, getDb, icps, leads, organizations, pipelineRuns, signalMatches, signals, signalTemplates, users } from '@selloeasy/db';
import { cloneTemplatesForOrg, suggestIcps } from '@selloeasy/engine';
import {
  icpSchema,
  idParamSchema,
  pageQuerySchema,
  signalSchema,
  toPage,
  offsetOf,
  type Icp,
  type PipelineConfig,
  type PipelineProgressEvent,
  type PipelineRun,
  type Signal,
  type SignalTemplate,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, notFound } from '../lib/errors';
import { enqueuePipelineRun } from '../lib/pipeline';
import { authOf, orgIdOf, requireOrg } from '../plugins/auth';

const toIcp = (i: typeof icps.$inferSelect, leadCount?: number): Icp => ({
  id: i.id,
  name: i.name,
  description: i.description,
  source: i.source,
  criteria: i.criteria,
  isActive: i.isActive,
  createdAt: i.createdAt.toISOString(),
  leadCount,
});

const toSignal = (s: typeof signals.$inferSelect, leadCount?: number): Signal => ({
  id: s.id,
  name: s.name,
  description: s.description,
  matchInstructions: s.matchInstructions,
  keywords: s.keywords,
  negativeKeywords: s.negativeKeywords,
  weight: s.weight,
  icpId: s.icpId,
  templateId: s.templateId,
  source: s.source,
  isActive: s.isActive,
  createdAt: s.createdAt.toISOString(),
  leadCount,
});

export const toRun = (r: typeof pipelineRuns.$inferSelect, triggeredBy: string | null = null): PipelineRun => ({
  id: r.id,
  trigger: r.trigger,
  status: r.status,
  startedAt: r.startedAt?.toISOString() ?? null,
  finishedAt: r.finishedAt?.toISOString() ?? null,
  stats: r.stats,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
  triggeredBy,
});

export const intelligenceRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── ICPs ───────────────────────────────────────────────────────────────────
  const icpTags = ['icps'];
  app.get('/icps', { schema: { tags: icpTags, summary: 'List ICPs with lead counts' }, preHandler: requireOrg('icps:read') }, async (req) => {
    const orgId = orgIdOf(req);
    const db = getDb();
    const rows = await db.select().from(icps).where(eq(icps.orgId, orgId)).orderBy(icps.createdAt);
    const counts = await db.select({ icpId: leads.icpId, n: count() }).from(leads).where(eq(leads.orgId, orgId)).groupBy(leads.icpId);
    const c = new Map(counts.map((r) => [r.icpId, r.n]));
    return rows.map((r) => toIcp(r, c.get(r.id) ?? 0));
  });

  app.post('/icps', { schema: { tags: icpTags, summary: 'Create an ICP', body: icpSchema }, preHandler: requireOrg('icps:write') }, async (req, reply) => {
    const body = req.body;
    const [row] = await getDb()
      .insert(icps)
      .values({ orgId: orgIdOf(req), name: body.name, description: body.description, criteria: body.criteria, isActive: body.isActive, source: 'CUSTOM' })
      .returning();
    await req.audit({ action: 'icp.created', entityType: 'icp', entityId: row!.id, after: row as never });
    reply.code(201);
    return toIcp(row!, 0);
  });

  app.post('/icps/accept', { schema: { tags: icpTags, summary: 'Save an AI-suggested ICP', body: icpSchema }, preHandler: requireOrg('icps:write') }, async (req, reply) => {
    const [row] = await getDb()
      .insert(icps)
      .values({ orgId: orgIdOf(req), name: req.body.name, description: req.body.description, criteria: req.body.criteria, isActive: true, source: 'AI_SUGGESTED' })
      .returning();
    await req.audit({ action: 'icp.accepted', entityType: 'icp', entityId: row!.id, after: row as never });
    reply.code(201);
    return toIcp(row!, 0);
  });

  app.patch('/icps/:id', { schema: { tags: icpTags, summary: 'Update an ICP', params: idParamSchema, body: icpSchema.partial() }, preHandler: requireOrg('icps:write') }, async (req) => {
    const db = getDb();
    const [before] = await db.select().from(icps).where(and(eq(icps.id, req.params.id), eq(icps.orgId, orgIdOf(req))));
    if (!before) throw notFound('ICP');
    const [after] = await db.update(icps).set(req.body).where(eq(icps.id, before.id)).returning();
    await req.audit({ action: 'icp.updated', entityType: 'icp', entityId: before.id, before: before as never, after: after as never });
    return toIcp(after!);
  });

  app.delete('/icps/:id', { schema: { tags: icpTags, summary: 'Delete an ICP', params: idParamSchema }, preHandler: requireOrg('icps:write') }, async (req) => {
    const [row] = await getDb().delete(icps).where(and(eq(icps.id, req.params.id), eq(icps.orgId, orgIdOf(req)))).returning();
    if (!row) throw notFound('ICP');
    await req.audit({ action: 'icp.deleted', entityType: 'icp', entityId: row.id, before: row as never });
    return { ok: true };
  });

  app.post('/icps/suggest', { schema: { tags: icpTags, summary: 'AI-suggest ICPs from the knowledge profile' }, preHandler: requireOrg('icps:write') }, async (req) => {
    try {
      return await suggestIcps(app.llm, orgIdOf(req));
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  });

  // ── Signals ────────────────────────────────────────────────────────────────
  const sigTags = ['signals'];
  app.get('/signal-templates', { schema: { tags: sigTags, summary: 'Industry signal templates for my org' }, preHandler: requireOrg('signals:read') }, async (req): Promise<SignalTemplate[]> => {
    const [org] = await getDb().select({ industry: organizations.industry }).from(organizations).where(eq(organizations.id, orgIdOf(req)));
    const rows = await getDb().select().from(signalTemplates).where(eq(signalTemplates.industry, org!.industry));
    return rows.map((t) => ({ id: t.id, industry: t.industry, key: t.key, name: t.name, description: t.description, matchInstructions: t.matchInstructions, defaultKeywords: t.defaultKeywords, defaultWeight: t.defaultWeight }));
  });

  app.get('/signals', { schema: { tags: sigTags, summary: 'List signals with lead counts' }, preHandler: requireOrg('signals:read') }, async (req) => {
    const orgId = orgIdOf(req);
    const db = getDb();
    const rows = await db.select().from(signals).where(eq(signals.orgId, orgId)).orderBy(signals.source, signals.name);
    const counts = await db
      .select({ signalId: signalMatches.signalId, n: count() })
      .from(signalMatches)
      .where(eq(signalMatches.orgId, orgId))
      .groupBy(signalMatches.signalId);
    const c = new Map(counts.map((r) => [r.signalId, r.n]));
    return rows.map((r) => toSignal(r, c.get(r.id) ?? 0));
  });

  app.post('/signals', { schema: { tags: sigTags, summary: 'Create a custom signal', body: signalSchema }, preHandler: requireOrg('signals:write') }, async (req, reply) => {
    const orgId = orgIdOf(req);
    if (req.body.icpId) {
      const [i] = await getDb().select({ id: icps.id }).from(icps).where(and(eq(icps.id, req.body.icpId), eq(icps.orgId, orgId)));
      if (!i) throw badRequest('Unknown ICP');
    }
    const [row] = await getDb().insert(signals).values({ ...req.body, icpId: req.body.icpId ?? null, orgId, source: 'CUSTOM' }).returning();
    await req.audit({ action: 'signal.created', entityType: 'signal', entityId: row!.id, after: row as never });
    reply.code(201);
    return toSignal(row!, 0);
  });

  app.patch('/signals/:id', { schema: { tags: sigTags, summary: 'Update / toggle a signal', params: idParamSchema, body: signalSchema.partial() }, preHandler: requireOrg('signals:write') }, async (req) => {
    const db = getDb();
    const [before] = await db.select().from(signals).where(and(eq(signals.id, req.params.id), eq(signals.orgId, orgIdOf(req))));
    if (!before) throw notFound('Signal');
    const [after] = await db.update(signals).set(req.body).where(eq(signals.id, before.id)).returning();
    await req.audit({ action: req.body.isActive !== undefined && Object.keys(req.body).length === 1 ? (req.body.isActive ? 'signal.enabled' : 'signal.disabled') : 'signal.updated', entityType: 'signal', entityId: before.id, before: before as never, after: after as never });
    return toSignal(after!);
  });

  app.delete('/signals/:id', { schema: { tags: sigTags, summary: 'Delete a custom signal', params: idParamSchema }, preHandler: requireOrg('signals:write') }, async (req) => {
    const db = getDb();
    const [s] = await db.select().from(signals).where(and(eq(signals.id, req.params.id), eq(signals.orgId, orgIdOf(req))));
    if (!s) throw notFound('Signal');
    if (s.source === 'PREDEFINED') throw badRequest('Predefined signals cannot be deleted — disable them instead');
    await db.delete(signals).where(eq(signals.id, s.id));
    await req.audit({ action: 'signal.deleted', entityType: 'signal', entityId: s.id, before: s as never });
    return { ok: true };
  });

  app.post('/signals/restore-templates', { schema: { tags: sigTags, summary: 'Re-add any missing industry templates' }, preHandler: requireOrg('signals:write') }, async (req) => {
    const orgId = orgIdOf(req);
    const [org] = await getDb().select({ industry: organizations.industry }).from(organizations).where(eq(organizations.id, orgId));
    const added = await cloneTemplatesForOrg(getDb(), orgId, org!.industry);
    if (added) await req.audit({ action: 'signal.templates_restored', entityType: 'signal', after: { added } });
    return { added };
  });

  // ── Pipeline ───────────────────────────────────────────────────────────────
  const pipeTags = ['pipeline'];
  app.post('/pipeline/runs', { schema: { tags: pipeTags, summary: 'Start a pipeline run now' }, preHandler: requireOrg('pipeline:run') }, async (req, reply) => {
    const orgId = orgIdOf(req);
    const run = await enqueuePipelineRun(orgId, 'MANUAL', authOf(req).userId);
    await req.audit({ action: 'pipeline.run_requested', entityType: 'pipeline_run', entityId: run.id });
    reply.code(202);
    return toRun(run, authOf(req).name);
  });

  app.get('/pipeline/config', { schema: { tags: pipeTags, summary: 'Effective pipeline settings (budget, batch size, threshold, schedule, model)' }, preHandler: requireOrg('pipeline:read') }, async (): Promise<PipelineConfig> => {
    const c = app.config;
    return {
      maxLlmCallsPerRun: c.PIPELINE_MAX_LLM_CALLS_PER_RUN,
      batchSize: c.PIPELINE_BATCH_SIZE,
      matchThreshold: c.PIPELINE_MATCH_THRESHOLD,
      eventWindowDays: c.PIPELINE_EVENT_WINDOW_DAYS,
      schedule: c.PIPELINE_SCHEDULE_CRON,
      llmMode: c.LLM_MODE,
      model: app.llm.label,
    };
  });

  app.get('/pipeline/runs', { schema: { tags: pipeTags, summary: 'Run history', querystring: pageQuerySchema }, preHandler: requireOrg('pipeline:read') }, async (req) => {
    const orgId = orgIdOf(req);
    const q = req.query;
    const db = getDb();
    const rows = await db
      .select({ r: pipelineRuns, by: users.name })
      .from(pipelineRuns)
      .leftJoin(users, eq(users.id, pipelineRuns.triggeredBy))
      .where(eq(pipelineRuns.orgId, orgId))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [{ total }] = (await db.select({ total: count() }).from(pipelineRuns).where(eq(pipelineRuns.orgId, orgId))) as [{ total: number }];
    return toPage(rows.map((x) => toRun(x.r, x.by)), total, q);
  });

  app.get('/pipeline/runs/:id', { schema: { tags: pipeTags, summary: 'One run', params: idParamSchema }, preHandler: requireOrg('pipeline:read') }, async (req) => {
    const [row] = await getDb().select().from(pipelineRuns).where(and(eq(pipelineRuns.id, req.params.id), eq(pipelineRuns.orgId, orgIdOf(req))));
    if (!row) throw notFound('Pipeline run');
    return toRun(row);
  });

  /** Live progress via Server-Sent Events backed by Redis pub/sub (plan §6 decision 3). */
  app.get('/pipeline/runs/:id/events', { schema: { tags: pipeTags, summary: 'SSE stream of run progress', params: idParamSchema }, preHandler: requireOrg('pipeline:read') }, async (req, reply) => {
    const [run] = await getDb().select().from(pipelineRuns).where(and(eq(pipelineRuns.id, req.params.id), eq(pipelineRuns.orgId, orgIdOf(req))));
    if (!run) throw notFound('Pipeline run');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (e: Partial<PipelineProgressEvent>) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ runId: run.id, status: run.status, stage: 'snapshot', progress: run.status === 'COMPLETED' || run.status === 'PARTIAL' || run.status === 'FAILED' ? 100 : 0, stats: run.stats });
    if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(run.status)) {
      res.end();
      return;
    }
    const sub = createRedis();
    const channel = pipelineProgressChannel(run.id);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      sub.unsubscribe(channel).catch(() => undefined);
      sub.quit().catch(() => undefined);
    };
    req.raw.on('close', cleanup);
    sub.on('message', (_ch, msg) => {
      res.write(`data: ${msg}\n\n`);
      try {
        const e = JSON.parse(msg) as PipelineProgressEvent;
        if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(e.status)) {
          cleanup();
          res.end();
        }
      } catch {
        /* ignore */
      }
    });
    await sub.subscribe(channel);
  });
};
