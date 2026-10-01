import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRedis,
  getQueue,
  getStorage,
  ingestionProgressChannel,
  QUEUES,
  type IngestionJob,
} from '@selloeasy/core';
import { SAMPLES_DIR } from '@selloeasy/dataset';
import {
  and,
  count,
  dataBatches,
  dataBatchRows,
  dataConnectors,
  desc,
  directoryCompanies,
  directoryContacts,
  eq,
  getDb,
  gte,
  ilike,
  inArray,
  ingestionRuns,
  isNotNull,
  isNull,
  lt,
  lte,
  marketEvents,
  or,
  sql,
  users,
  type SQL,
} from '@selloeasy/db';
import { assertCommittable, DataBatchError, discardBatch, rollbackBatch, testConnector } from '@selloeasy/engine';
import { csvSafe, inspectFile } from '@selloeasy/pipeline';
import {
  commitBatchSchema,
  connectorSchema,
  dataBatchesQuerySchema,
  dataBatchRowsQuerySchema,
  dataCompaniesQuerySchema,
  dataContactsQuerySchema,
  dataEventsQuerySchema,
  DATA_SOURCE_TYPES,
  idParamSchema,
  offsetOf,
  templateCsv,
  templateJsonSchema,
  TEMPLATE_V1_FIELDS,
  TEMPLATE_VERSION,
  updateConnectorSchema,
  type ConnectorDto,
  type DataBatchDetail,
  type DataBatchRowDto,
  type DataCompanyDetail,
  type DataCompanyListItem,
  type DataContactListItem,
  type DataEventDetail,
  type DataOverview,
  type DataPage,
  type IngestionProgressEvent,
  type IngestionRunDto,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import {
  batchesById,
  countWithEstimate,
  distributionFor,
  eventAsRecord,
  orgsMatchedByEvent,
  provenanceOf,
  toBatchDto,
  toEventListItem,
} from '../lib/data';
import { authOf, requirePermission } from '../plugins/auth';

/**
 * Super Admin "Data source" (plan2): browse the raw platform data, import CSV/JSONL with a two-phase
 * validate → review → commit flow, manage connectors and run ingestion. Global data only; the distribution
 * view exposes org names + counts (plan2 §8.4), never lead records.
 */

const dataPageQueryWithConnector = dataBatchesQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({ connectorId: z.uuid().optional() });

function page<T>(
  items: T[],
  q: { page: number; pageSize: number },
  total: number,
  estimate: boolean,
  nextAfter: string | null,
): DataPage<T> {
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalIsEstimate: estimate,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    nextAfter,
  };
}

const escLike = (s: string) => s.replace(/[%_\\]/g, (m) => `\\${m}`);

async function connectorScheduler(c: typeof dataConnectors.$inferSelect) {
  // One BullMQ job scheduler per connector (plan2 §6.2) — removed when disabled / unscheduled.
  const q = getQueue<IngestionJob>(QUEUES.ingestion);
  const id = `connector-${c.id}`;
  if (c.enabled && c.schedule)
    await q.upsertJobScheduler(
      id,
      { pattern: c.schedule },
      { name: 'ingestion.schedule', data: { kind: 'ingestion.schedule', connectorId: c.id } },
    );
  else await q.removeJobScheduler(id).catch(() => undefined);
}

export const platformDataRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['platform-data'];
  const read = requirePermission('platform:data:read');
  const importPerm = requirePermission('platform:data:import');
  const manage = requirePermission('platform:data:manage');
  const maxRatio = () => app.config.IMPORT_MAX_INVALID_RATIO;

  // ── Overview ─────────────────────────────────────────────────────────────
  app.get(
    '/platform/data/overview',
    { schema: { tags, summary: 'Data source overview' }, preHandler: read },
    async (): Promise<DataOverview> => {
      const db = getDb();
      const live = isNull(marketEvents.retractedAt);
      const [s] = await db
        .select({
          events: sql<number>`count(*) filter (where ${marketEvents.retractedAt} is null)::int`,
          last7: sql<number>`count(*) filter (where ${marketEvents.retractedAt} is null and ${marketEvents.createdAt} > now() - interval '7 days')::int`,
          last30: sql<number>`count(*) filter (where ${marketEvents.retractedAt} is null and ${marketEvents.createdAt} > now() - interval '30 days')::int`,
          retracted: sql<number>`count(*) filter (where ${marketEvents.retractedAt} is not null)::int`,
          sources: sql<number>`count(distinct ${marketEvents.source})::int`,
          newest: sql<
            string | null
          >`max(${marketEvents.publishedAt}) filter (where ${marketEvents.retractedAt} is null)`,
        })
        .from(marketEvents);
      const [{ n: companies }] = (await db
        .select({ n: count() })
        .from(directoryCompanies)
        .where(isNull(directoryCompanies.retractedAt))) as [{ n: number }];
      const [{ n: contacts }] = (await db
        .select({ n: count() })
        .from(directoryContacts)
        .where(isNull(directoryContacts.retractedAt))) as [{ n: number }];
      const bySourceType = await db
        .select({ sourceType: marketEvents.sourceType, count: sql<number>`count(*)::int` })
        .from(marketEvents)
        .where(live)
        .groupBy(marketEvents.sourceType);
      const byTag = await db
        .select({ tag: sql<string>`t.tag`, count: sql<number>`count(*)::int` })
        .from(sql`${marketEvents}, unnest(${marketEvents.industryTags}) as t(tag)`)
        .where(live)
        .groupBy(sql`t.tag`)
        .orderBy(sql`2 desc`);
      const weeklyRows = await db
        .select({
          week: sql<string>`to_char(date_trunc('week', ${marketEvents.publishedAt}), 'YYYY-MM-DD')`,
          st: marketEvents.sourceType,
          n: sql<number>`count(*)::int`,
        })
        .from(marketEvents)
        .where(and(live, gte(marketEvents.publishedAt, sql`now() - interval '26 weeks'`)))
        .groupBy(sql`1`, marketEvents.sourceType)
        .orderBy(sql`1`);
      const weekly = new Map<string, DataOverview['weekly'][number]>();
      for (const r of weeklyRows) {
        const w = weekly.get(r.week) ?? {
          week: r.week,
          SEED: 0,
          CSV_IMPORT: 0,
          JSONL_IMPORT: 0,
          CONNECTOR: 0,
        };
        w[r.st] += r.n;
        weekly.set(r.week, w);
      }
      const [{ n: connectors }] = (await db.select({ n: count() }).from(dataConnectors)) as [{ n: number }];
      const [last] = await db
        .select({ at: ingestionRuns.finishedAt })
        .from(ingestionRuns)
        .where(isNotNull(ingestionRuns.finishedAt))
        .orderBy(desc(ingestionRuns.finishedAt))
        .limit(1);
      return {
        events: s!.events,
        eventsLast7d: s!.last7,
        eventsLast30d: s!.last30,
        companies,
        contacts,
        sources: s!.sources,
        retractedEvents: s!.retracted,
        newestPublishedAt: s!.newest ? new Date(s!.newest).toISOString() : null,
        bySourceType: DATA_SOURCE_TYPES.map((st) => ({
          sourceType: st,
          count: bySourceType.find((r) => r.sourceType === st)?.count ?? 0,
        })),
        byTag,
        weekly: [...weekly.values()],
        connectors,
        lastIngestionAt: last?.at?.toISOString() ?? null,
      };
    },
  );

  // ── Events ───────────────────────────────────────────────────────────────
  app.get(
    '/platform/data/events',
    {
      schema: {
        tags,
        summary: 'Market events (paginated, 25/page default)',
        querystring: dataEventsQuerySchema,
      },
      preHandler: read,
    },
    async (req) => {
      const q = req.query;
      const db = getDb();
      const conds: (SQL | undefined)[] = [
        q.retracted === 'exclude'
          ? isNull(marketEvents.retractedAt)
          : q.retracted === 'only'
            ? isNotNull(marketEvents.retractedAt)
            : undefined,
        q.q ? sql`${marketEvents.tsv} @@ websearch_to_tsquery('english', ${q.q})` : undefined,
        q.tag ? sql`${q.tag} = any(${marketEvents.industryTags})` : undefined,
        q.source ? ilike(marketEvents.source, `%${escLike(q.source)}%`) : undefined,
        q.sourceType ? eq(marketEvents.sourceType, q.sourceType) : undefined,
        q.batchId ? eq(marketEvents.batchId, q.batchId) : undefined,
        q.from ? gte(marketEvents.publishedAt, new Date(q.from)) : undefined,
        q.to ? lte(marketEvents.publishedAt, new Date(`${q.to}T23:59:59.999Z`)) : undefined,
      ];
      const filtered = !!(
        q.q ||
        q.tag ||
        q.source ||
        q.sourceType ||
        q.batchId ||
        q.from ||
        q.to ||
        q.retracted !== 'exclude'
      );
      const where = and(...conds);
      // ADR-0018: keyset paging via `after` for deep pages; offset otherwise.
      let keyset: SQL | undefined;
      if (q.after) {
        const [ts, id] = q.after.split('|');
        if (!ts || !id || Number.isNaN(Date.parse(ts))) throw badRequest('Invalid "after" cursor');
        keyset = or(
          lt(marketEvents.publishedAt, new Date(ts)),
          and(eq(marketEvents.publishedAt, new Date(ts)), lt(marketEvents.id, id)),
        );
      }
      const rows = await db
        .select()
        .from(marketEvents)
        .where(and(where, keyset))
        .orderBy(desc(marketEvents.publishedAt), desc(marketEvents.id))
        .limit(q.pageSize + 1)
        .offset(q.after ? 0 : offsetOf(q));
      const more = rows.length > q.pageSize;
      const items = rows.slice(0, q.pageSize);
      const { total, estimate } = await countWithEstimate(
        'market_events',
        filtered,
        async () =>
          ((await db.select({ n: count() }).from(marketEvents).where(where)) as [{ n: number }])[0].n,
      );
      const batches = await batchesById(items.map((e) => e.batchId));
      const matched = await orgsMatchedByEvent(items.map((e) => e.id));
      const last = items[items.length - 1];
      return page(
        items.map((e) =>
          toEventListItem(e, e.batchId ? (batches.get(e.batchId) ?? null) : null, matched.get(e.id) ?? 0),
        ),
        q,
        total,
        estimate,
        more && last ? `${last.publishedAt.toISOString()}|${last.id}` : null,
      );
    },
  );

  app.get(
    '/platform/data/events/:id',
    {
      schema: {
        tags,
        summary: 'One event: every template field, provenance and distribution',
        params: idParamSchema,
      },
      preHandler: read,
    },
    async (req): Promise<DataEventDetail> => {
      const db = getDb();
      const [e] = await db.select().from(marketEvents).where(eq(marketEvents.id, req.params.id));
      if (!e) throw notFound('Event');
      const batches = await batchesById([e.batchId]);
      const [by] = e.ingestedBy
        ? await db.select({ name: users.name }).from(users).where(eq(users.id, e.ingestedBy))
        : [];
      return {
        id: e.id,
        record: await eventAsRecord(e),
        retractedAt: e.retractedAt?.toISOString() ?? null,
        ingestedAt: e.createdAt.toISOString(),
        ingestedBy: by?.name ?? null,
        schemaVersion: e.schemaVersion,
        distribution: await distributionFor(eq(marketEvents.id, e.id)),
        ...provenanceOf(e.sourceType, e.batchId ? (batches.get(e.batchId) ?? null) : null),
      };
    },
  );

  // ── Companies & contacts ─────────────────────────────────────────────────
  const companyFields = {
    c: directoryCompanies,
    contactsCount: sql<number>`(select count(*)::int from ${directoryContacts} dc where dc.company_id = ${directoryCompanies.id} and dc.retracted_at is null)`,
    eventsCount: sql<number>`(select count(*)::int from ${marketEvents} me where me.retracted_at is null and me.companies @> jsonb_build_array(jsonb_build_object('domain', ${directoryCompanies.domain})))`,
  };
  const toCompany = async (
    rows: { c: typeof directoryCompanies.$inferSelect; contactsCount: number; eventsCount: number }[],
  ): Promise<DataCompanyListItem[]> => {
    const batches = await batchesById(rows.map((r) => r.c.batchId));
    return rows.map(({ c, contactsCount, eventsCount }) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      hqCountry: c.hqCountry,
      sizeBand: c.sizeBand,
      employees: c.employees,
      contactsCount,
      eventsCount,
      retractedAt: c.retractedAt?.toISOString() ?? null,
      ...provenanceOf(c.sourceType, c.batchId ? (batches.get(c.batchId) ?? null) : null),
    }));
  };

  app.get(
    '/platform/data/companies',
    {
      schema: { tags, summary: 'Company directory (paginated)', querystring: dataCompaniesQuerySchema },
      preHandler: read,
    },
    async (req) => {
      const q = req.query;
      const db = getDb();
      const where = and(
        isNull(directoryCompanies.retractedAt),
        q.q
          ? or(
              ilike(directoryCompanies.name, `%${escLike(q.q)}%`),
              ilike(directoryCompanies.domain, `%${escLike(q.q)}%`),
            )
          : undefined,
        q.industry ? eq(directoryCompanies.industry, q.industry) : undefined,
        q.country ? eq(directoryCompanies.hqCountry, q.country.toUpperCase()) : undefined,
        q.sourceType ? eq(directoryCompanies.sourceType, q.sourceType) : undefined,
      );
      const rows = await db
        .select(companyFields)
        .from(directoryCompanies)
        .where(where)
        .orderBy(directoryCompanies.name, directoryCompanies.id)
        .limit(q.pageSize)
        .offset(offsetOf(q));
      const filtered = !!(q.q || q.industry || q.country || q.sourceType);
      const { total, estimate } = await countWithEstimate(
        'directory_companies',
        filtered,
        async () =>
          ((await db.select({ n: count() }).from(directoryCompanies).where(where)) as [{ n: number }])[0].n,
      );
      return page(await toCompany(rows), q, total, estimate, null);
    },
  );

  const toContacts = async (
    rows: {
      k: typeof directoryContacts.$inferSelect;
      company: { id: string; name: string; domain: string | null };
    }[],
  ): Promise<DataContactListItem[]> => {
    const batches = await batchesById(rows.map((r) => r.k.batchId));
    return rows.map(({ k, company }) => ({
      id: k.id,
      name: k.name,
      title: k.title,
      email: k.email,
      phone: k.phone,
      whatsapp: k.whatsapp,
      linkedinUrl: k.linkedinUrl,
      company,
      retractedAt: k.retractedAt?.toISOString() ?? null,
      ...provenanceOf(k.sourceType, k.batchId ? (batches.get(k.batchId) ?? null) : null),
    }));
  };
  const contactSelect = {
    k: directoryContacts,
    company: { id: directoryCompanies.id, name: directoryCompanies.name, domain: directoryCompanies.domain },
  };

  app.get(
    '/platform/data/companies/:id',
    {
      schema: { tags, summary: 'Company with contacts and recent events', params: idParamSchema },
      preHandler: read,
    },
    async (req): Promise<DataCompanyDetail> => {
      const db = getDb();
      const [row] = await db
        .select(companyFields)
        .from(directoryCompanies)
        .where(eq(directoryCompanies.id, req.params.id));
      if (!row) throw notFound('Company');
      const [item] = await toCompany([row]);
      const contacts = await db
        .select(contactSelect)
        .from(directoryContacts)
        .innerJoin(directoryCompanies, eq(directoryCompanies.id, directoryContacts.companyId))
        .where(eq(directoryContacts.companyId, row.c.id))
        .orderBy(directoryContacts.name);
      const events = row.c.domain
        ? await db
            .select()
            .from(marketEvents)
            .where(
              sql`${marketEvents.companies} @> jsonb_build_array(jsonb_build_object('domain', ${row.c.domain}::text))`,
            )
            .orderBy(desc(marketEvents.publishedAt))
            .limit(20)
        : [];
      const batches = await batchesById(events.map((e) => e.batchId));
      const matched = await orgsMatchedByEvent(events.map((e) => e.id));
      return {
        ...item!,
        description: row.c.description,
        contacts: await toContacts(contacts),
        recentEvents: events.map((e) =>
          toEventListItem(e, e.batchId ? (batches.get(e.batchId) ?? null) : null, matched.get(e.id) ?? 0),
        ),
      };
    },
  );

  app.get(
    '/platform/data/contacts',
    {
      schema: { tags, summary: 'Directory contacts (paginated)', querystring: dataContactsQuerySchema },
      preHandler: read,
    },
    async (req) => {
      const q = req.query;
      const db = getDb();
      const where = and(
        isNull(directoryContacts.retractedAt),
        q.q
          ? or(
              ilike(directoryContacts.name, `%${escLike(q.q)}%`),
              ilike(directoryContacts.email, `%${escLike(q.q)}%`),
              ilike(directoryCompanies.name, `%${escLike(q.q)}%`),
            )
          : undefined,
        q.sourceType ? eq(directoryContacts.sourceType, q.sourceType) : undefined,
      );
      const rows = await db
        .select(contactSelect)
        .from(directoryContacts)
        .innerJoin(directoryCompanies, eq(directoryCompanies.id, directoryContacts.companyId))
        .where(where)
        .orderBy(directoryContacts.name, directoryContacts.id)
        .limit(q.pageSize)
        .offset(offsetOf(q));
      const filtered = !!(q.q || q.sourceType);
      const { total, estimate } = await countWithEstimate(
        'directory_contacts',
        filtered,
        async () =>
          (
            (await db
              .select({ n: count() })
              .from(directoryContacts)
              .innerJoin(directoryCompanies, eq(directoryCompanies.id, directoryContacts.companyId))
              .where(where)) as [{ n: number }]
          )[0].n,
      );
      return page(await toContacts(rows), q, total, estimate, null);
    },
  );

  // ── Template ─────────────────────────────────────────────────────────────
  app.get(
    '/platform/data/template',
    { schema: { tags, summary: 'Template v1 field reference' }, preHandler: read },
    async () => ({
      version: TEMPLATE_VERSION,
      fields: TEMPLATE_V1_FIELDS,
      limits: {
        maxMb: app.config.IMPORT_MAX_MB,
        maxRows: app.config.IMPORT_MAX_ROWS,
        maxInvalidRatio: maxRatio(),
        maxAgeDays: app.config.DATA_MAX_AGE_DAYS,
      },
    }),
  );
  app.get(
    '/platform/data/template.csv',
    { schema: { tags, summary: 'Download the CSV template' }, preHandler: read },
    async (_req, reply) => {
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="selloeasy-template-v1.csv"');
      return templateCsv();
    },
  );
  app.get(
    '/platform/data/template.schema.json',
    { schema: { tags, summary: 'Download the JSON Schema' }, preHandler: read },
    async (_req, reply) => {
      reply.header('Content-Disposition', 'attachment; filename="template-v1.schema.json"');
      return templateJsonSchema();
    },
  );
  app.get(
    '/platform/data/samples/:name',
    {
      schema: {
        tags,
        summary: 'Download sampleData.csv / sampleData.invalid.csv',
        params: z.object({ name: z.enum(['sampleData.csv', 'sampleData.invalid.csv']) }),
      },
      preHandler: read,
    },
    async (req, reply) => {
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${req.params.name}"`);
      return readFileSync(join(SAMPLES_DIR, req.params.name), 'utf8');
    },
  );

  // ── Imports (two-phase: upload → validate → review → commit) ─────────────
  app.post(
    '/platform/data/imports',
    {
      schema: { tags, summary: 'Upload a CSV / JSONL / JSON file for validation (multipart field "file")' },
      preHandler: importPerm,
    },
    async (req, reply) => {
      const a = authOf(req);
      const part = await req.file({ limits: { fileSize: app.config.IMPORT_MAX_MB * 1024 * 1024, files: 1 } });
      if (!part) throw badRequest('Attach a file in the "file" field');
      const fileName = part.filename.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'upload';
      if (!/\.(csv|jsonl|ndjson|json)$/i.test(fileName))
        throw badRequest('Upload a .csv, .jsonl or .json file');
      const buf = await part.toBuffer().catch(() => {
        throw badRequest(`File exceeds ${app.config.IMPORT_MAX_MB} MB`);
      });
      if (part.file.truncated) throw badRequest(`File exceeds ${app.config.IMPORT_MAX_MB} MB`);
      const fanOutField = part.fields.fanOut as { value?: string } | undefined;
      const fanOut = fanOutField?.value !== 'false';
      const db = getDb();
      const [batch] = await db
        .insert(dataBatches)
        .values({
          kind: 'IMPORT',
          status: 'UPLOADED',
          label: fileName,
          fileName,
          createdBy: a.userId,
          fanOut,
        })
        .returning();
      const key = `platform/imports/${batch!.id}/${fileName}`;
      await getStorage().putObject(key, buf, 'application/octet-stream');
      // Fast fail on the file layer (the worker re-checks); a rejected file never produces staging rows.
      const file = inspectFile(buf, fileName, {
        maxBytes: app.config.IMPORT_MAX_MB * 1024 * 1024,
        maxRows: app.config.IMPORT_MAX_ROWS,
      });
      if (!file.ok) {
        const [failed] = await db.transaction(async (tx) => {
          const r = await tx
            .update(dataBatches)
            .set({
              status: 'FAILED',
              fileS3Key: key,
              fileIssues: file.fileIssues,
              error: file.fileIssues[0]?.message ?? 'Invalid file',
            })
            .where(eq(dataBatches.id, batch!.id))
            .returning();
          await req.audit(
            {
              scope: 'PLATFORM',
              orgId: null,
              action: 'data.import_rejected',
              entityType: 'data_batch',
              entityId: batch!.id,
              after: { fileName, reason: file.fileIssues[0]?.code },
            },
            tx,
          );
          return r;
        });
        throw unprocessable(file.fileIssues[0]?.message ?? 'Invalid file', {
          batch: toBatchDto(failed!, maxRatio()),
        });
      }
      const [updated] = await db.transaction(async (tx) => {
        const r = await tx
          .update(dataBatches)
          .set({ fileS3Key: key, format: file.format, stats: { ...batch!.stats, rows: file.rows.length } })
          .where(eq(dataBatches.id, batch!.id))
          .returning();
        await req.audit(
          {
            scope: 'PLATFORM',
            orgId: null,
            action: 'data.import_uploaded',
            entityType: 'data_batch',
            entityId: batch!.id,
            after: { fileName, rows: file.rows.length, format: file.format },
          },
          tx,
        );
        return r;
      });
      await getQueue<IngestionJob>(QUEUES.ingestion).add(
        'import.validate',
        { kind: 'import.validate', batchId: batch!.id },
        { jobId: `validate-${batch!.id}`, attempts: 1 },
      );
      reply.code(202);
      return toBatchDto(updated!, maxRatio());
    },
  );

  app.get(
    '/platform/data/batches',
    {
      schema: { tags, summary: 'Import & ingestion batches', querystring: dataBatchesQuerySchema },
      preHandler: read,
    },
    async (req) => {
      const q = req.query;
      const db = getDb();
      const where = and(
        q.kind ? eq(dataBatches.kind, q.kind) : undefined,
        q.status ? eq(dataBatches.status, q.status) : undefined,
      );
      const rows = await db
        .select()
        .from(dataBatches)
        .where(where)
        .orderBy(desc(dataBatches.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q));
      const [{ n }] = (await db.select({ n: count() }).from(dataBatches).where(where)) as [{ n: number }];
      return page(
        rows.map((b) => toBatchDto(b, maxRatio())),
        q,
        n,
        false,
        null,
      );
    },
  );

  const loadBatch = async (id: string) => {
    const [b] = await getDb().select().from(dataBatches).where(eq(dataBatches.id, id));
    if (!b) throw notFound('Batch');
    return b;
  };

  app.get(
    '/platform/data/batches/:id',
    {
      schema: { tags, summary: 'Batch with stats and distribution', params: idParamSchema },
      preHandler: read,
    },
    async (req): Promise<DataBatchDetail> => {
      const b = await loadBatch(req.params.id);
      const distribution = ['COMMITTED', 'ROLLED_BACK'].includes(b.status)
        ? await distributionFor(eq(marketEvents.batchId, b.id))
        : null;
      return { ...toBatchDto(b, maxRatio()), distribution };
    },
  );

  app.get(
    '/platform/data/batches/:id/rows',
    {
      schema: {
        tags,
        summary: 'Validation report rows (paginated)',
        params: idParamSchema,
        querystring: dataBatchRowsQuerySchema,
      },
      preHandler: read,
    },
    async (req) => {
      const q = req.query;
      await loadBatch(req.params.id);
      const db = getDb();
      const where = and(
        eq(dataBatchRows.batchId, req.params.id),
        q.status ? eq(dataBatchRows.status, q.status) : undefined,
      );
      const rows = await db
        .select()
        .from(dataBatchRows)
        .where(where)
        .orderBy(dataBatchRows.rowNumber)
        .limit(q.pageSize)
        .offset(offsetOf(q));
      const [{ n }] = (await db.select({ n: count() }).from(dataBatchRows).where(where)) as [{ n: number }];
      const items: DataBatchRowDto[] = rows.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        issues: r.issues,
        raw: r.raw,
        duplicateOfEventId: r.duplicateOfEventId,
        insertedEventId: r.insertedEventId,
      }));
      return page(items, q, n, false, null);
    },
  );

  app.get(
    '/platform/data/batches/:id/errors.csv',
    {
      schema: { tags, summary: 'Download rejected/flagged rows with issues', params: idParamSchema },
      preHandler: read,
    },
    async (req, reply) => {
      const b = await loadBatch(req.params.id);
      const rows = await getDb()
        .select()
        .from(dataBatchRows)
        .where(
          and(
            eq(dataBatchRows.batchId, b.id),
            inArray(dataBatchRows.status, ['INVALID', 'DUPLICATE', 'WARNING']),
          ),
        )
        .orderBy(dataBatchRows.rowNumber);
      const cols = TEMPLATE_V1_FIELDS.map((f) => f.name);
      const lines = [['row_number', 'status', 'issues', ...cols].join(',')];
      for (const r of rows) {
        const issues = r.issues.map((i) => `[${i.severity}] ${i.field}: ${i.message}`).join(' | ');
        lines.push([r.rowNumber, r.status, issues, ...cols.map((c) => r.raw[c])].map(csvSafe).join(','));
      }
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${b.label.replace(/\.[a-z]+$/i, '')}-issues.csv"`,
        );
      return lines.join('\n');
    },
  );

  app.post(
    '/platform/data/batches/:id/commit',
    {
      schema: {
        tags,
        summary: 'Commit valid + warning rows (refused above the invalid-ratio limit)',
        params: idParamSchema,
        body: commitBatchSchema,
      },
      preHandler: importPerm,
    },
    async (req, reply) => {
      const b = await loadBatch(req.params.id);
      if (b.status !== 'VALIDATED')
        throw conflict(`Batch is ${b.status}; only VALIDATED batches can be committed`);
      // Same rule (and message order) as the worker's commit, so the API never disagrees with it.
      try {
        assertCommittable(b.stats, maxRatio());
      } catch (e) {
        if (e instanceof DataBatchError) throw unprocessable(e.message);
        throw e;
      }
      const db = getDb();
      await db.transaction(async (tx) => {
        await tx
          .update(dataBatches)
          .set({
            status: 'COMMITTING',
            ...(req.body.fanOut !== undefined ? { fanOut: req.body.fanOut } : {}),
          })
          .where(eq(dataBatches.id, b.id));
        await req.audit(
          {
            scope: 'PLATFORM',
            orgId: null,
            action: 'data.import_commit_requested',
            entityType: 'data_batch',
            entityId: b.id,
            after: { rows: b.stats.valid + b.stats.warnings },
          },
          tx,
        );
      });
      await getQueue<IngestionJob>(QUEUES.ingestion).add(
        'import.commit',
        { kind: 'import.commit', batchId: b.id, userId: authOf(req).userId },
        { jobId: `commit-${b.id}`, attempts: 1 },
      );
      reply.code(202);
      return toBatchDto(await loadBatch(b.id), maxRatio());
    },
  );

  const mapBatchError = (e: unknown): never => {
    if (e instanceof DataBatchError) {
      if (e.code === 'not_found') throw notFound('Batch');
      throw conflict(e.message);
    }
    throw e;
  };

  app.post(
    '/platform/data/batches/:id/discard',
    {
      schema: { tags, summary: 'Discard a validated or failed import', params: idParamSchema },
      preHandler: importPerm,
    },
    async (req) => {
      await discardBatch(req.params.id, authOf(req).userId).catch(mapBatchError);
      req.auditRecorded = true; // audited by the engine in the same transaction
      return toBatchDto(await loadBatch(req.params.id), maxRatio());
    },
  );

  app.post(
    '/platform/data/batches/:id/rollback',
    {
      schema: {
        tags,
        summary: 'Retract a committed batch (leads orgs already created are kept)',
        params: idParamSchema,
      },
      preHandler: manage,
    },
    async (req) => {
      const res = await rollbackBatch(req.params.id, authOf(req).userId).catch(mapBatchError);
      req.auditRecorded = true;
      return { ...toBatchDto(await loadBatch(req.params.id), maxRatio()), retracted: res };
    },
  );

  // ── Connectors & ingestion ───────────────────────────────────────────────
  const toConnector = (c: typeof dataConnectors.$inferSelect, runningRunId: string | null): ConnectorDto => ({
    id: c.id,
    name: c.name,
    type: c.type,
    config: c.config,
    schedule: c.schedule,
    enabled: c.enabled,
    fanOut: c.fanOut,
    cursor: c.cursor,
    lastRunAt: c.lastRunAt?.toISOString() ?? null,
    lastStatus: c.lastStatus,
    createdAt: c.createdAt.toISOString(),
    runningRunId,
  });
  const runningByConnector = async () => {
    const rows = await getDb()
      .select({ id: ingestionRuns.id, c: ingestionRuns.connectorId })
      .from(ingestionRuns)
      .where(inArray(ingestionRuns.status, ['QUEUED', 'RUNNING']));
    return new Map(rows.map((r) => [r.c, r.id]));
  };
  const loadConnector = async (id: string) => {
    const [c] = await getDb().select().from(dataConnectors).where(eq(dataConnectors.id, id));
    if (!c) throw notFound('Connector');
    return c;
  };

  app.get(
    '/platform/data/connectors',
    { schema: { tags, summary: 'Data connectors' }, preHandler: read },
    async () => {
      const rows = await getDb().select().from(dataConnectors).orderBy(dataConnectors.name);
      const running = await runningByConnector();
      return rows.map((c) => toConnector(c, running.get(c.id) ?? null));
    },
  );

  app.post(
    '/platform/data/connectors',
    { schema: { tags, summary: 'Create a connector', body: connectorSchema }, preHandler: manage },
    async (req, reply) => {
      const db = getDb();
      const [c] = await db.transaction(async (tx) => {
        const r = await tx
          .insert(dataConnectors)
          .values({ ...req.body, createdBy: authOf(req).userId })
          .onConflictDoNothing()
          .returning();
        if (!r[0]) throw conflict('A connector with this name already exists');
        await req.audit(
          {
            scope: 'PLATFORM',
            orgId: null,
            action: 'data.connector_created',
            entityType: 'data_connector',
            entityId: r[0].id,
            after: { name: r[0].name, type: r[0].type, url: r[0].config.url, schedule: r[0].schedule },
          },
          tx,
        );
        return r;
      });
      await connectorScheduler(c!);
      reply.code(201);
      return toConnector(c!, null);
    },
  );

  app.patch(
    '/platform/data/connectors/:id',
    {
      schema: { tags, summary: 'Update a connector', params: idParamSchema, body: updateConnectorSchema },
      preHandler: manage,
    },
    async (req) => {
      const before = await loadConnector(req.params.id);
      const patch = {
        ...req.body,
        ...(req.body.config ? { config: { ...before.config, ...req.body.config } } : {}),
      };
      if (before.type === 'HTTP_FEED' && patch.config?.url && !patch.config.url.startsWith('https://'))
        throw badRequest('HTTP feeds need an https:// URL');
      const [after] = await getDb().transaction(async (tx) => {
        const r = await tx
          .update(dataConnectors)
          .set(patch)
          .where(eq(dataConnectors.id, before.id))
          .returning();
        await req.audit(
          {
            scope: 'PLATFORM',
            orgId: null,
            action: 'data.connector_updated',
            entityType: 'data_connector',
            entityId: before.id,
            before: {
              name: before.name,
              config: before.config,
              schedule: before.schedule,
              enabled: before.enabled,
            },
            after: {
              name: r[0]!.name,
              config: r[0]!.config,
              schedule: r[0]!.schedule,
              enabled: r[0]!.enabled,
            },
          },
          tx,
        );
        return r;
      });
      await connectorScheduler(after!);
      return toConnector(after!, (await runningByConnector()).get(after!.id) ?? null);
    },
  );

  app.delete(
    '/platform/data/connectors/:id',
    {
      schema: { tags, summary: 'Delete a connector (its batches and data stay)', params: idParamSchema },
      preHandler: manage,
    },
    async (req) => {
      const c = await loadConnector(req.params.id);
      if ((await runningByConnector()).has(c.id)) throw conflict('Wait for the running ingestion to finish');
      await getDb().transaction(async (tx) => {
        await tx.delete(dataConnectors).where(eq(dataConnectors.id, c.id));
        await req.audit(
          {
            scope: 'PLATFORM',
            orgId: null,
            action: 'data.connector_deleted',
            entityType: 'data_connector',
            entityId: c.id,
            before: { name: c.name, type: c.type },
          },
          tx,
        );
      });
      await getQueue(QUEUES.ingestion)
        .removeJobScheduler(`connector-${c.id}`)
        .catch(() => undefined);
      return { ok: true };
    },
  );

  app.post(
    '/platform/data/connectors/:id/test',
    {
      schema: {
        tags,
        summary: 'Fetch up to 5 rows and validate them without inserting',
        params: idParamSchema,
      },
      preHandler: manage,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const c = await loadConnector(req.params.id);
      try {
        return await testConnector(c);
      } catch (e) {
        throw badRequest(`Connection test failed: ${(e as Error).message}`);
      }
    },
  );

  app.post(
    '/platform/data/connectors/:id/run',
    { schema: { tags, summary: 'Run ingestion now', params: idParamSchema }, preHandler: manage },
    async (req, reply) => {
      const c = await loadConnector(req.params.id);
      if (!c.enabled) throw conflict('Connector is disabled');
      const running = (await runningByConnector()).get(c.id);
      if (running)
        throw conflict('An ingestion run is already in progress for this connector', { runId: running });
      const [run] = await getDb().transaction(async (tx) => {
        const r = await tx
          .insert(ingestionRuns)
          .values({ connectorId: c.id, trigger: 'MANUAL', status: 'QUEUED', triggeredBy: authOf(req).userId })
          .returning();
        await req.audit(
          {
            scope: 'PLATFORM',
            orgId: null,
            action: 'data.ingestion_requested',
            entityType: 'ingestion_run',
            entityId: r[0]!.id,
            after: { connector: c.name },
          },
          tx,
        );
        return r;
      });
      await getQueue<IngestionJob>(QUEUES.ingestion).add(
        'ingestion.run',
        { kind: 'ingestion.run', runId: run!.id },
        { jobId: `ingest-${run!.id}`, attempts: 1 },
      );
      reply.code(202);
      return toRun(run!, c.name);
    },
  );

  const toRun = (
    r: typeof ingestionRuns.$inferSelect,
    connectorName: string,
    by: string | null = null,
  ): IngestionRunDto => ({
    id: r.id,
    connector: { id: r.connectorId, name: connectorName },
    batchId: r.batchId,
    trigger: r.trigger,
    status: r.status,
    stats: r.stats,
    error: r.error,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    triggeredBy: by,
  });

  app.get(
    '/platform/data/ingestion-runs',
    {
      schema: { tags, summary: 'Ingestion run history', querystring: dataPageQueryWithConnector },
      preHandler: read,
    },
    async (req) => {
      const q = req.query;
      const db = getDb();
      const where = q.connectorId ? eq(ingestionRuns.connectorId, q.connectorId) : undefined;
      const rows = await db
        .select({ r: ingestionRuns, name: dataConnectors.name, by: users.name })
        .from(ingestionRuns)
        .innerJoin(dataConnectors, eq(dataConnectors.id, ingestionRuns.connectorId))
        .leftJoin(users, eq(users.id, ingestionRuns.triggeredBy))
        .where(where)
        .orderBy(desc(ingestionRuns.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q));
      const [{ n }] = (await db.select({ n: count() }).from(ingestionRuns).where(where)) as [{ n: number }];
      return page(
        rows.map((x) => toRun(x.r, x.name, x.by)),
        q,
        n,
        false,
        null,
      );
    },
  );

  app.get(
    '/platform/data/ingestion-runs/:id',
    { schema: { tags, summary: 'One ingestion run', params: idParamSchema }, preHandler: read },
    async (req) => {
      const [x] = await getDb()
        .select({ r: ingestionRuns, name: dataConnectors.name })
        .from(ingestionRuns)
        .innerJoin(dataConnectors, eq(dataConnectors.id, ingestionRuns.connectorId))
        .where(eq(ingestionRuns.id, req.params.id));
      if (!x) throw notFound('Ingestion run');
      return toRun(x.r, x.name);
    },
  );

  /** Live ingestion progress via SSE (same pattern as org pipeline runs). */
  app.get(
    '/platform/data/ingestion-runs/:id/events',
    {
      schema: { tags, summary: 'SSE stream of ingestion progress', params: idParamSchema },
      preHandler: read,
    },
    async (req, reply) => {
      const [run] = await getDb().select().from(ingestionRuns).where(eq(ingestionRuns.id, req.params.id));
      if (!run) throw notFound('Ingestion run');
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const done = ['COMPLETED', 'PARTIAL', 'FAILED'].includes(run.status);
      const snapshot: IngestionProgressEvent = {
        runId: run.id,
        status: done ? (run.status as IngestionProgressEvent['status']) : 'RUNNING',
        stage: 'snapshot',
        progress: done ? 100 : 0,
        stats: run.stats,
      };
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      if (done) return res.end();
      const sub = createRedis();
      const channel = ingestionProgressChannel(run.id);
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
          if (
            ['COMPLETED', 'PARTIAL', 'FAILED'].includes((JSON.parse(msg) as IngestionProgressEvent).status)
          ) {
            cleanup();
            res.end();
          }
        } catch {
          /* ignore */
        }
      });
      await sub.subscribe(channel);
    },
  );
};
