import { getQueue, getStorage, QUEUES, type ProfileJob } from '@selloeasy/core';
import { and, count, desc, eq, getDb, orgProfiles, orgSourceChunks, orgSources, plans, policies, products, sql } from '@selloeasy/db';
import { assertPublicUrl } from '@selloeasy/engine';
import {
  idParamSchema,
  planSchema,
  policySchema,
  productSchema,
  textSourceSchema,
  updateOrgProfileSchema,
  updateVisibilitySchema,
  uploadUrlSchema,
  websiteSourceSchema,
  type OrgProfile,
  type OrgSource,
  type Plan,
  type Policy,
  type Product,
  type UploadUrlResponse,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, notFound } from '../lib/errors';
import { authOf, orgIdOf, requireOrg } from '../plugins/auth';

type SourceRow = typeof orgSources.$inferSelect;

async function toSources(rows: SourceRow[]): Promise<OrgSource[]> {
  if (rows.length === 0) return [];
  const counts = await getDb()
    .select({ sourceId: orgSourceChunks.sourceId, n: count() })
    .from(orgSourceChunks)
    .where(sql`${orgSourceChunks.sourceId} in (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)})`)
    .groupBy(orgSourceChunks.sourceId);
  const c = new Map(counts.map((r) => [r.sourceId, r.n]));
  return rows.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    url: s.url,
    visibility: s.visibility,
    status: s.status,
    error: s.error,
    bytes: s.bytes,
    chunkCount: c.get(s.id) ?? 0,
    createdAt: s.createdAt.toISOString(),
  }));
}

async function enqueueSource(orgId: string, sourceId: string) {
  await getQueue<ProfileJob>(QUEUES.profile).add('source.process', { kind: 'source.process', orgId, sourceId }, { jobId: `source-${sourceId}-${Date.now()}` });
}

const toProduct = (p: typeof products.$inferSelect): Product => ({
  id: p.id,
  name: p.name,
  category: p.category,
  description: p.description,
  targetSegments: p.targetSegments,
  priceNotes: p.priceNotes,
  visibility: p.visibility,
});
const toPlan = (p: typeof plans.$inferSelect): Plan => ({ id: p.id, name: p.name, pricing: p.pricing, features: p.features, visibility: p.visibility });
const toPolicy = (p: typeof policies.$inferSelect): Policy => ({ id: p.id, title: p.title, type: p.type, body: p.body, visibility: p.visibility });

export const knowledgeRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['knowledge'];
  const read = requireOrg('org:profile:read');
  const write = requireOrg('org:profile:write');

  // ── Sources ──────────────────────────────────────────────────────────────
  app.get('/org/sources', { schema: { tags, summary: 'Knowledge sources with processing status' }, preHandler: read }, async (req) => {
    const rows = await getDb().select().from(orgSources).where(eq(orgSources.orgId, orgIdOf(req))).orderBy(desc(orgSources.createdAt));
    return toSources(rows);
  });

  app.post('/org/sources/website', { schema: { tags, summary: 'Add the website to crawl (SSRF-protected)', body: websiteSourceSchema }, preHandler: write }, async (req, reply) => {
    const orgId = orgIdOf(req);
    try {
      await assertPublicUrl(req.body.url);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const [src] = await getDb()
      .insert(orgSources)
      .values({ orgId, type: 'WEBSITE', title: new URL(req.body.url).hostname, url: req.body.url, visibility: req.body.visibility, status: 'PENDING' })
      .returning();
    await req.audit({ action: 'source.created', entityType: 'org_source', entityId: src!.id, after: { type: 'WEBSITE', url: req.body.url } });
    await enqueueSource(orgId, src!.id);
    reply.code(201);
    return (await toSources([src!]))[0];
  });

  app.post('/org/sources/text', { schema: { tags, summary: 'Add pasted text as a knowledge source', body: textSourceSchema }, preHandler: write }, async (req, reply) => {
    const orgId = orgIdOf(req);
    const [src] = await getDb()
      .insert(orgSources)
      .values({ orgId, type: 'TEXT', title: req.body.title, visibility: req.body.visibility, contentType: 'text/plain', status: 'PENDING', bytes: Buffer.byteLength(req.body.content) })
      .returning();
    const key = `orgs/${orgId}/sources/${src!.id}/content.txt`;
    await getStorage().putObject(key, req.body.content, 'text/plain');
    await getDb().update(orgSources).set({ s3Key: key }).where(eq(orgSources.id, src!.id));
    await req.audit({ action: 'source.created', entityType: 'org_source', entityId: src!.id, after: { type: 'TEXT', title: req.body.title } });
    await enqueueSource(orgId, src!.id);
    reply.code(201);
    return (await toSources([{ ...src!, s3Key: key }]))[0];
  });

  app.post('/org/sources/upload-url', { schema: { tags, summary: 'Get a presigned URL to upload a document', body: uploadUrlSchema }, preHandler: write }, async (req, reply): Promise<UploadUrlResponse> => {
    const orgId = orgIdOf(req);
    if (req.body.size > app.config.UPLOAD_MAX_MB * 1024 * 1024) throw badRequest(`Files must be ≤ ${app.config.UPLOAD_MAX_MB} MB`);
    const [{ n }] = (await getDb().select({ n: count() }).from(orgSources).where(and(eq(orgSources.orgId, orgId), sql`${orgSources.type} <> 'WEBSITE'`))) as [{ n: number }];
    if (n >= 20) throw badRequest('Maximum of 20 documents per organization');
    const type = req.body.contentType === 'application/pdf' ? 'PDF' : 'DOC';
    const safeName = req.body.filename.replace(/[^\w.\-]+/g, '_').slice(0, 120);
    const [src] = await getDb()
      .insert(orgSources)
      .values({ orgId, type, title: req.body.filename, visibility: req.body.visibility, contentType: req.body.contentType, status: 'PENDING', bytes: req.body.size })
      .returning();
    const key = `orgs/${orgId}/sources/${src!.id}/${safeName}`;
    await getDb().update(orgSources).set({ s3Key: key }).where(eq(orgSources.id, src!.id));
    const uploadUrl = await getStorage().presignPut(key, req.body.contentType);
    reply.code(201);
    return { sourceId: src!.id, uploadUrl, headers: { 'Content-Type': req.body.contentType } };
  });

  app.post('/org/sources/:id/complete', { schema: { tags, summary: 'Mark an upload complete and start processing', params: idParamSchema }, preHandler: write }, async (req) => {
    const orgId = orgIdOf(req);
    const [src] = await getDb().select().from(orgSources).where(and(eq(orgSources.id, req.params.id), eq(orgSources.orgId, orgId)));
    if (!src) throw notFound('Source');
    await req.audit({ action: 'source.created', entityType: 'org_source', entityId: src.id, after: { type: src.type, title: src.title, visibility: src.visibility } });
    await enqueueSource(orgId, src.id);
    return (await toSources([src]))[0];
  });

  app.post('/org/sources/:id/reprocess', { schema: { tags, summary: 'Re-run processing for a source', params: idParamSchema }, preHandler: write }, async (req) => {
    const orgId = orgIdOf(req);
    const [src] = await getDb().update(orgSources).set({ status: 'PENDING', error: null }).where(and(eq(orgSources.id, req.params.id), eq(orgSources.orgId, orgId))).returning();
    if (!src) throw notFound('Source');
    await req.audit({ action: 'source.reprocessed', entityType: 'org_source', entityId: src.id });
    await enqueueSource(orgId, src.id);
    return (await toSources([src]))[0];
  });

  app.patch('/org/sources/:id', { schema: { tags, summary: 'Change source visibility (Public/Internal)', params: idParamSchema, body: updateVisibilitySchema }, preHandler: write }, async (req) => {
    const db = getDb();
    const orgId = orgIdOf(req);
    const [before] = await db.select().from(orgSources).where(and(eq(orgSources.id, req.params.id), eq(orgSources.orgId, orgId)));
    if (!before) throw notFound('Source');
    const [after] = await db.update(orgSources).set({ visibility: req.body.visibility }).where(eq(orgSources.id, before.id)).returning();
    await req.audit({ action: 'source.visibility_changed', entityType: 'org_source', entityId: before.id, before: { visibility: before.visibility }, after: { visibility: after!.visibility } });
    return (await toSources([after!]))[0];
  });

  app.get('/org/sources/:id/download', { schema: { tags, summary: 'Presigned download URL', params: idParamSchema }, preHandler: read }, async (req) => {
    const [src] = await getDb().select().from(orgSources).where(and(eq(orgSources.id, req.params.id), eq(orgSources.orgId, orgIdOf(req))));
    if (!src?.s3Key) throw notFound('Document');
    return { url: await getStorage().presignGet(src.s3Key) };
  });

  app.delete('/org/sources/:id', { schema: { tags, summary: 'Delete a source and its chunks', params: idParamSchema }, preHandler: write }, async (req) => {
    const [src] = await getDb().delete(orgSources).where(and(eq(orgSources.id, req.params.id), eq(orgSources.orgId, orgIdOf(req)))).returning();
    if (!src) throw notFound('Source');
    if (src.s3Key) await getStorage().deleteObject(src.s3Key).catch(() => undefined);
    await req.audit({ action: 'source.deleted', entityType: 'org_source', entityId: src.id, before: { title: src.title, type: src.type } });
    return { ok: true };
  });

  // ── Products / Plans / Policies (generic CRUD) ─────────────────────────────
  const crud = <T extends typeof products | typeof plans | typeof policies, O>(
    path: string,
    table: T,
    schema: typeof productSchema | typeof planSchema | typeof policySchema,
    map: (row: T['$inferSelect']) => O,
    entity: string,
  ) => {
    app.get(`/org/${path}`, { schema: { tags, summary: `List ${path}` }, preHandler: read }, async (req) => {
      const rows = await getDb().select().from(table as typeof products).where(eq((table as typeof products).orgId, orgIdOf(req))).orderBy((table as typeof products).createdAt);
      return rows.map((r) => map(r as T['$inferSelect']));
    });
    app.post(`/org/${path}`, { schema: { tags, summary: `Create ${entity}`, body: schema }, preHandler: write }, async (req, reply) => {
      const [row] = await getDb().insert(table as typeof products).values({ ...(req.body as object), orgId: orgIdOf(req) } as never).returning();
      await req.audit({ action: `${entity}.created`, entityType: entity, entityId: row!.id, after: row as never });
      reply.code(201);
      return map(row as T['$inferSelect']);
    });
    app.patch(`/org/${path}/:id`, { schema: { tags, summary: `Update ${entity}`, params: idParamSchema, body: schema.partial() }, preHandler: write }, async (req) => {
      const db = getDb();
      const t = table as typeof products;
      const [before] = await db.select().from(t).where(and(eq(t.id, req.params.id), eq(t.orgId, orgIdOf(req))));
      if (!before) throw notFound(entity);
      const [after] = await db.update(t).set(req.body as never).where(eq(t.id, before.id)).returning();
      await req.audit({ action: `${entity}.updated`, entityType: entity, entityId: before.id, before: before as never, after: after as never });
      return map(after as T['$inferSelect']);
    });
    app.delete(`/org/${path}/:id`, { schema: { tags, summary: `Delete ${entity}`, params: idParamSchema }, preHandler: write }, async (req) => {
      const t = table as typeof products;
      const [row] = await getDb().delete(t).where(and(eq(t.id, req.params.id), eq(t.orgId, orgIdOf(req)))).returning();
      if (!row) throw notFound(entity);
      await req.audit({ action: `${entity}.deleted`, entityType: entity, entityId: row.id, before: row as never });
      return { ok: true };
    });
  };
  crud('products', products, productSchema, toProduct, 'product');
  crud('plans', plans, planSchema, toPlan, 'plan');
  crud('policies', policies, policySchema, toPolicy, 'policy');

  // ── Knowledge profile ──────────────────────────────────────────────────────
  const toProfile = (p: typeof orgProfiles.$inferSelect): OrgProfile => ({
    id: p.id,
    summary: p.summary,
    valueProps: p.valueProps,
    differentiators: p.differentiators,
    targetIndustries: p.targetIndustries,
    geographies: p.geographies,
    personas: p.personas,
    version: p.version,
    generatedByModel: p.generatedByModel,
    updatedAt: p.updatedAt.toISOString(),
    summaryVisibility: p.summaryVisibility,
  });

  app.get('/org/profile', { schema: { tags, summary: 'AI knowledge profile (null until generated)' }, preHandler: read }, async (req) => {
    const [p] = await getDb().select().from(orgProfiles).where(eq(orgProfiles.orgId, orgIdOf(req)));
    return p ? toProfile(p) : null;
  });

  app.patch('/org/profile', { schema: { tags, summary: 'Edit the knowledge profile', body: updateOrgProfileSchema }, preHandler: write }, async (req) => {
    const db = getDb();
    const orgId = orgIdOf(req);
    const [before] = await db.select().from(orgProfiles).where(eq(orgProfiles.orgId, orgId));
    if (!before) throw badRequest('Generate the profile first');
    const [after] = await db
      .update(orgProfiles)
      .set({ ...req.body, version: sql`${orgProfiles.version} + 1` })
      .where(eq(orgProfiles.id, before.id))
      .returning();
    await req.audit({ action: 'profile.updated', entityType: 'org_profile', entityId: before.id, before: before as never, after: after as never });
    return toProfile(after!);
  });

  app.post('/org/profile/generate', { schema: { tags, summary: 'Queue AI profile generation from all sources' }, preHandler: write }, async (req, reply) => {
    const orgId = orgIdOf(req);
    const job = await getQueue<ProfileJob>(QUEUES.profile).add(
      'profile.generate',
      { kind: 'profile.generate', orgId, requestedBy: authOf(req).userId },
      { jobId: `profile-${orgId}-${Date.now()}`, attempts: 2 },
    );
    await req.audit({ action: 'profile.generation_requested', entityType: 'org_profile', entityId: orgId });
    reply.code(202);
    return { jobId: job.id };
  });

  app.get('/org/profile/jobs/:jobId', { schema: { tags, summary: 'Profile generation job status' }, preHandler: read }, async (req) => {
    const { jobId } = req.params as { jobId: string };
    if (!jobId.startsWith(`profile-${orgIdOf(req)}-`)) throw notFound('Job');
    const job = await getQueue(QUEUES.profile).getJob(jobId);
    if (!job) throw notFound('Job');
    return { id: job.id, state: await job.getState(), failedReason: job.failedReason ?? null };
  });
};
