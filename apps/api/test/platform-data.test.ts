import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, auditLogs, dataConnectors, eq, getDb, ingestionRuns, inArray } from '@selloeasy/db';
import { commitBatch, runIngestion, validateBatch } from '@selloeasy/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, login, makeApp, type Session } from './helpers';

/**
 * Platform data source (plan2 §11.5). The worker normally runs validate/commit/ingestion from BullMQ; here the
 * API enqueues the job (Redis db 1, no worker attached) and the test calls the same engine functions directly
 * so every step is deterministic.
 */

const root = join(import.meta.dirname, '..', '..', '..');
const SAMPLE = readFileSync(join(root, 'sampleData.csv'));
const INVALID = readFileSync(join(root, 'sampleData.invalid.csv'));

let app: FastifyInstance;
let sa: Session;
const orgRoles: Record<string, Session> = {};

function multipart(fileName: string, content: Buffer, fields: Record<string, string> = {}) {
  const boundary = `----selloeasy-test-${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function upload(s: Session | null, fileName: string, content: Buffer) {
  // fanOut=false keeps DATA_REFRESH pipeline runs out of the shared test DB.
  const { payload, contentType } = multipart(fileName, content, { fanOut: 'false' });
  return app.inject({
    method: 'POST',
    url: '/api/v1/platform/data/imports',
    headers: { ...(s ? { cookie: s.cookie } : {}), 'content-type': contentType },
    payload,
  });
}

/** Upload → worker validate; returns the VALIDATED batch DTO. */
async function uploadAndValidate(fileName: string, content: Buffer) {
  const res = await upload(sa, fileName, content);
  expect(res.statusCode, res.body).toBe(202);
  const batch = res.json();
  expect(batch.status).toBe('UPLOADED');
  await validateBatch(batch.id);
  const detail = await call(app, sa, 'GET', `/platform/data/batches/${batch.id}`);
  expect(detail.statusCode).toBe(200);
  return detail.json();
}

async function auditActions(entityId: string) {
  const rows = await getDb()
    .select({ action: auditLogs.action, scope: auditLogs.scope })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId));
  for (const r of rows) expect(r.scope).toBe('PLATFORM');
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  app = await makeApp();
  sa = await login(app, 'superadmin@selloeasy.local', 'Admin@123');
  for (const [role, email] of [
    ['ORG_ADMIN', 'admin@roadgrip.local'],
    ['SALES_MANAGER', 'manager@roadgrip.local'],
    ['SDR', 'sdr1@roadgrip.local'],
    ['VIEWER', 'viewer@roadgrip.local'],
  ] as const) {
    orgRoles[role] = await login(app, email);
  }
});
afterAll(async () => {
  await app.close();
});

describe('platform data RBAC (plan2 §11.5 — Super Admin only)', () => {
  it.each(['ORG_ADMIN', 'SALES_MANAGER', 'SDR', 'VIEWER'])(
    '%s gets 403 on events list and imports',
    async (role) => {
      const s = orgRoles[role]!;
      const list = await call(app, s, 'GET', '/platform/data/events');
      expect(list.statusCode).toBe(403);
      expect(list.headers['content-type']).toContain('application/problem+json');
      expect((await upload(s, 'sampleData.csv', SAMPLE)).statusCode).toBe(403);
    },
  );

  it('org admin gets 403 on every /platform/data route', async () => {
    const s = orgRoles.ORG_ADMIN!;
    const id = '00000000-0000-7000-8000-000000000000';
    const routes: [string, string, unknown?][] = [
      ['GET', '/platform/data/overview'],
      ['GET', `/platform/data/events/${id}`],
      ['GET', '/platform/data/companies'],
      ['GET', `/platform/data/companies/${id}`],
      ['GET', '/platform/data/contacts'],
      ['GET', '/platform/data/template'],
      ['GET', '/platform/data/template.csv'],
      ['GET', '/platform/data/template.schema.json'],
      ['GET', '/platform/data/samples/sampleData.csv'],
      ['GET', '/platform/data/batches'],
      ['GET', `/platform/data/batches/${id}`],
      ['GET', `/platform/data/batches/${id}/rows`],
      ['GET', `/platform/data/batches/${id}/errors.csv`],
      ['POST', `/platform/data/batches/${id}/commit`, {}],
      ['POST', `/platform/data/batches/${id}/discard`],
      ['POST', `/platform/data/batches/${id}/rollback`],
      ['GET', '/platform/data/connectors'],
      ['POST', '/platform/data/connectors', { name: 'x-conn', type: 'DEMO_FEED' }],
      ['PATCH', `/platform/data/connectors/${id}`, { enabled: false }],
      ['DELETE', `/platform/data/connectors/${id}`],
      ['POST', `/platform/data/connectors/${id}/test`],
      ['POST', `/platform/data/connectors/${id}/run`],
      ['GET', '/platform/data/ingestion-runs'],
      ['GET', `/platform/data/ingestion-runs/${id}`],
      ['GET', `/platform/data/ingestion-runs/${id}/events`],
    ];
    for (const [method, url, body] of routes) {
      const res = await call(app, s, method as 'GET', url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('unauthenticated → 401', async () => {
    expect((await call(app, null, 'GET', '/platform/data/events')).statusCode).toBe(401);
    expect((await upload(null, 'sampleData.csv', SAMPLE)).statusCode).toBe(401);
  });

  it('super admin → 200', async () => {
    const res = await call(app, sa, 'GET', '/platform/data/events');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });
});

describe('import with too many invalid rows (plan2 §7.1)', () => {
  // Runs before the round trip so imp-001 (the one good row) is not yet a duplicate.
  it('sampleData.invalid.csv → >20% invalid, commit 422, errors.csv lists the rows', async () => {
    const b = await uploadAndValidate('sampleData.invalid.csv', INVALID);
    expect(b.status).toBe('VALIDATED');
    expect(b.stats.rows).toBe(13);
    expect(b.stats.invalid).toBe(12); // bad-001…bad-012
    expect(b.stats.valid + b.stats.warnings).toBe(1); // imp-001 is a good row (not yet imported)
    expect(b.stats.invalid / b.stats.rows).toBeGreaterThan(0.2);
    expect(b.committable).toBe(false);
    const res = await call(app, sa, 'POST', `/platform/data/batches/${b.id}/commit`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().detail ?? res.json().title).toMatch(/invalid|limit/i);

    const csv = await call(app, sa, 'GET', `/platform/data/batches/${b.id}/errors.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('sampleData.invalid-issues.csv');
    const lines = csv.body.trim().split('\n');
    expect(lines[0]!.startsWith('row_number,status,issues,external_id')).toBe(true);
    for (let i = 1; i <= 12; i++) expect(csv.body).toContain(`bad-${String(i).padStart(3, '0')}`);
    expect(csv.body).toContain('INVALID');
  });
});

describe('import round trip (plan2 §7)', () => {
  let batchId: string;

  it('upload → validate gives 10 committable rows', async () => {
    const b = await uploadAndValidate('sampleData.csv', SAMPLE);
    batchId = b.id;
    expect(b.status).toBe('VALIDATED');
    expect(b.format).toBe('csv');
    expect(b.stats.rows).toBe(10);
    expect(b.stats.valid + b.stats.warnings).toBe(10);
    expect(b.stats.invalid).toBe(0);
    expect(b.stats.duplicates).toBe(0);
    expect(b.committable).toBe(true);
    const rows = await call(app, sa, 'GET', `/platform/data/batches/${batchId}/rows?pageSize=100`);
    expect(rows.json().total).toBe(10);
  });

  it('commit → COMMITTED and 10 events listed for the batch', async () => {
    const res = await call(app, sa, 'POST', `/platform/data/batches/${batchId}/commit`, { fanOut: false });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json().status).toBe('COMMITTING');
    // A second commit request while committing is refused.
    expect((await call(app, sa, 'POST', `/platform/data/batches/${batchId}/commit`, {})).statusCode).toBe(
      409,
    );
    const stats = await commitBatch(batchId, sa.me.user.id);
    expect(stats.inserted).toBe(10);

    const b = (await call(app, sa, 'GET', `/platform/data/batches/${batchId}`)).json();
    expect(b.status).toBe('COMMITTED');
    expect(b.committedAt).not.toBeNull();

    const list = await call(app, sa, 'GET', `/platform/data/events?batchId=${batchId}`);
    expect(list.statusCode).toBe(200);
    const page = list.json();
    expect(page.total).toBe(10);
    expect(page.items).toHaveLength(10);
    for (const e of page.items) {
      expect(e.sourceType).toBe('CSV_IMPORT');
      expect(e.batch).toMatchObject({ id: batchId, kind: 'IMPORT' });
      expect(e.snippet.length).toBeLessThanOrEqual(200); // list never returns full bodies
      expect(e).not.toHaveProperty('body');
    }
    expect(page.items.map((e: { externalId: string }) => e.externalId).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `imp-${String(i + 1).padStart(3, '0')}`),
    );
  });

  it('event detail returns template fields + provenance', async () => {
    const list = (await call(app, sa, 'GET', `/platform/data/events?batchId=${batchId}&pageSize=1`)).json();
    const res = await call(app, sa, 'GET', `/platform/data/events/${list.items[0].id}`);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.sourceType).toBe('CSV_IMPORT');
    expect(d.batch).toMatchObject({ id: batchId, kind: 'IMPORT', label: 'sampleData.csv' });
    expect(d.schemaVersion).toBe(1);
    expect(d.retractedAt).toBeNull();
    expect(d.ingestedBy).toBeTruthy();
    for (const f of [
      'external_id',
      'source',
      'source_url',
      'title',
      'body',
      'published_at',
      'industry_tags',
      'subject_company_name',
      'subject_company_domain',
    ])
      expect(d.record, f).toHaveProperty(f);
    expect(d.record.body.length).toBeGreaterThanOrEqual(200);
    expect(d.record.source_url).toMatch(/^https:\/\//);
    expect(d.distribution).toMatchObject({ orgsMatched: expect.any(Number) });
  });

  it('company detail returns its contacts and recent events', async () => {
    const list = (await call(app, sa, 'GET', `/platform/data/events?batchId=${batchId}&pageSize=1`)).json();
    const domain = list.items[0].subjectCompany.domain as string;
    const companies = (
      await call(app, sa, 'GET', `/platform/data/companies?q=${encodeURIComponent(domain)}`)
    ).json();
    const company = companies.items.find((c: { domain: string }) => c.domain === domain);
    expect(company).toBeTruthy();
    const res = await call(app, sa, 'GET', `/platform/data/companies/${company.id}`);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.domain).toBe(domain);
    expect(d.recentEvents.map((e: { id: string }) => e.id)).toContain(list.items[0].id);
    expect(Array.isArray(d.contacts)).toBe(true);
  });

  it('writes PLATFORM audit rows for upload, validate and commit', async () => {
    const actions = await auditActions(batchId);
    for (const a of [
      'data.import_uploaded',
      'data.import_validated',
      'data.import_commit_requested',
      'data.import_committed',
    ])
      expect(actions).toContain(a);
  });

  it('re-importing the same file → 10 duplicates, not committable, commit 422', async () => {
    const b = await uploadAndValidate('sampleData.csv', SAMPLE);
    expect(b.status).toBe('VALIDATED');
    expect(b.stats.duplicates).toBe(10);
    expect(b.stats.valid + b.stats.warnings).toBe(0);
    expect(b.committable).toBe(false);
    const res = await call(app, sa, 'POST', `/platform/data/batches/${b.id}/commit`, {});
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const dupRows = (
      await call(app, sa, 'GET', `/platform/data/batches/${b.id}/rows?status=DUPLICATE`)
    ).json();
    expect(dupRows.total).toBe(10);
    expect(dupRows.items.every((r: { duplicateOfEventId: string | null }) => !!r.duplicateOfEventId)).toBe(
      true,
    );
  });

  it('garbage bytes named .csv fail fast at the file layer (422, FAILED batch, no rows)', async () => {
    const garbage = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x01, 0x02, 0x03, 0x00, 0x00,
    ]);
    const res = await upload(sa, 'x.csv', garbage);
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const failed = (await call(app, sa, 'GET', '/platform/data/batches?status=FAILED&pageSize=100')).json();
    const b = failed.items.find((x: { fileName: string }) => x.fileName === 'x.csv');
    expect(b).toBeTruthy();
    expect(b.fileIssues.length).toBeGreaterThan(0);
    expect((await call(app, sa, 'GET', `/platform/data/batches/${b.id}/rows`)).json().total).toBe(0);
    expect(await auditActions(b.id)).toContain('data.import_rejected');
  });

  it('rejects non-template extensions', async () => {
    expect((await upload(sa, 'x.xlsx', SAMPLE)).statusCode).toBe(400);
  });

  it('rollback retracts the committed events (hidden by default, listed with retracted=only)', async () => {
    const res = await call(app, sa, 'POST', `/platform/data/batches/${batchId}/rollback`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('ROLLED_BACK');
    expect(res.json().retracted.events).toBe(10);

    const live = (await call(app, sa, 'GET', `/platform/data/events?batchId=${batchId}`)).json();
    expect(live.total).toBe(0);
    const retracted = (
      await call(app, sa, 'GET', `/platform/data/events?batchId=${batchId}&retracted=only`)
    ).json();
    expect(retracted.total).toBe(10);
    expect(retracted.items.every((e: { retractedAt: string | null }) => !!e.retractedAt)).toBe(true);
    const all = (
      await call(app, sa, 'GET', `/platform/data/events?batchId=${batchId}&retracted=include`)
    ).json();
    expect(all.total).toBe(10);

    // Rolling back twice is a state conflict, and the rollback is audited.
    expect((await call(app, sa, 'POST', `/platform/data/batches/${batchId}/rollback`)).statusCode).toBe(409);
    expect(await auditActions(batchId)).toContain('data.batch_rolled_back');
  });

  it('unknown batch → 404', async () => {
    const id = '00000000-0000-7000-8000-000000000001';
    expect((await call(app, sa, 'GET', `/platform/data/batches/${id}`)).statusCode).toBe(404);
    expect((await call(app, sa, 'POST', `/platform/data/batches/${id}/rollback`)).statusCode).toBe(404);
  });
});

describe('pagination (plan2 §9, ADR-0018)', () => {
  it('rejects pageSize above 100', async () => {
    const res = await call(app, sa, 'GET', '/platform/data/events?pageSize=101');
    expect(res.statusCode).toBe(400);
    expect((await call(app, sa, 'GET', '/platform/data/companies?pageSize=101')).statusCode).toBe(400);
    expect((await call(app, sa, 'GET', '/platform/data/batches?pageSize=0')).statusCode).toBe(400);
  });

  it('defaults to 25 per page and keyset `after` continues where page 1 ended', async () => {
    const p1 = (await call(app, sa, 'GET', '/platform/data/events')).json();
    expect(p1.pageSize).toBe(25);
    expect(p1.items).toHaveLength(25);
    expect(p1.total).toBeGreaterThan(25);
    expect(p1.nextAfter).toEqual(expect.stringContaining('|'));

    const k2 = (
      await call(app, sa, 'GET', `/platform/data/events?after=${encodeURIComponent(p1.nextAfter)}`)
    ).json();
    const o2 = (await call(app, sa, 'GET', '/platform/data/events?page=2')).json();
    expect(k2.items.length).toBeGreaterThan(0);
    const ids = (p: { items: { id: string }[] }) => p.items.map((e) => e.id);
    expect(ids(k2)).toEqual(ids(o2));
    expect(ids(k2).some((id) => ids(p1).includes(id))).toBe(false);
    // Strictly older-or-equal than the last item of page 1.
    const last = p1.items[24];
    expect(Date.parse(k2.items[0].publishedAt)).toBeLessThanOrEqual(Date.parse(last.publishedAt));
  });

  it('rejects a malformed keyset cursor', async () => {
    expect((await call(app, sa, 'GET', '/platform/data/events?after=nonsense')).statusCode).toBe(400);
  });
});

describe('DEMO_FEED ingestion (plan2 §11.5 worker)', () => {
  it('each run inserts the next 10 feed events and advances the cursor', async () => {
    const [demo] = await getDb().select().from(dataConnectors).where(eq(dataConnectors.type, 'DEMO_FEED'));
    expect(demo).toBeTruthy();
    // Keep fan-out off so no DATA_REFRESH pipeline runs land in the shared test DB.
    const patch = await call(app, sa, 'PATCH', `/platform/data/connectors/${demo!.id}`, { fanOut: false });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json().schedule).toBe(demo!.schedule); // PATCH must not wipe fields it did not send

    const startOffset = Number((demo!.cursor as { offset?: number } | null)?.offset ?? 0);
    for (const round of [1, 2]) {
      const run = await call(app, sa, 'POST', `/platform/data/connectors/${demo!.id}/run`);
      expect(run.statusCode, run.body).toBe(202);
      expect(run.json().status).toBe('QUEUED');
      // A second run while one is queued is refused.
      expect((await call(app, sa, 'POST', `/platform/data/connectors/${demo!.id}/run`)).statusCode).toBe(409);

      const progress: string[] = [];
      const res = await runIngestion(run.json().id, (p) => {
        progress.push(p.stage);
      });
      expect(res.stats.fetched).toBe(10);
      expect(res.stats.inserted).toBe(10);
      expect(res.stats.invalid).toBe(0);
      expect(res.status).toBe('PARTIAL'); // the reserve has more than 20 rows
      expect(progress.at(-1)).toBe('done');

      const [c] = await getDb().select().from(dataConnectors).where(eq(dataConnectors.id, demo!.id));
      expect((c!.cursor as { offset: number }).offset).toBe(startOffset + round * 10);
      expect(c!.lastStatus).toBe('COMPLETED');

      const r = (await call(app, sa, 'GET', `/platform/data/ingestion-runs/${run.json().id}`)).json();
      expect(r.status).toBe('PARTIAL');
      const events = (await call(app, sa, 'GET', `/platform/data/events?batchId=${r.batchId}`)).json();
      expect(events.total).toBe(10);
      expect(events.items.every((e: { sourceType: string }) => e.sourceType === 'CONNECTOR')).toBe(true);
      const actions = await auditActions(run.json().id);
      expect(actions).toEqual(
        expect.arrayContaining([
          'data.ingestion_requested',
          'data.ingestion_started',
          'data.ingestion_completed',
        ]),
      );
    }
    const runs = await getDb()
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(
        and(eq(ingestionRuns.connectorId, demo!.id), inArray(ingestionRuns.status, ['QUEUED', 'RUNNING'])),
      );
    expect(runs).toHaveLength(0);
  });
});

describe('connectors', () => {
  it('PATCH only changes the fields it sends (schedule survives a fanOut toggle), and is audited', async () => {
    const created = await call(app, sa, 'POST', '/platform/data/connectors', {
      name: 'Test demo feed (patch)',
      type: 'DEMO_FEED',
      schedule: '0 6 * * *',
      enabled: false,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id;
    expect(created.json().schedule).toBe('0 6 * * *');

    const patched = await call(app, sa, 'PATCH', `/platform/data/connectors/${id}`, { fanOut: false });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().fanOut).toBe(false);
    expect(patched.json().schedule).toBe('0 6 * * *');

    // Explicitly clearing the schedule still works.
    const cleared = await call(app, sa, 'PATCH', `/platform/data/connectors/${id}`, { schedule: '' });
    expect(cleared.json().schedule).toBeNull();

    expect((await call(app, sa, 'DELETE', `/platform/data/connectors/${id}`)).statusCode).toBe(200);
    expect(
      (await call(app, sa, 'GET', `/platform/data/connectors`))
        .json()
        .some((c: { id: string }) => c.id === id),
    ).toBe(false);
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['data.connector_created', 'data.connector_updated', 'data.connector_deleted']),
    );
  });
});
