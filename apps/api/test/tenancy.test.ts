import { getDb, leads, sql } from '@selloeasy/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, login, makeApp, type Session } from './helpers';

let app: FastifyInstance;
let roadAdmin: Session;
let mediAdmin: Session;
let sa: Session;
let mediLeadId: string;

beforeAll(async () => {
  app = await makeApp();
  roadAdmin = await login(app, 'admin@roadgrip.local');
  mediAdmin = await login(app, 'admin@medisphere.local');
  sa = await login(app, 'superadmin@selloeasy.local', 'Admin@123');
  const page = await call(app, mediAdmin, 'GET', '/leads?pageSize=1');
  mediLeadId = page.json().items[0].id;
});
afterAll(async () => {
  await app.close();
});

describe('tenant isolation (plan §8.1)', () => {
  it('returns 404 — not 403 — for another org\'s lead', async () => {
    expect((await call(app, roadAdmin, 'GET', `/leads/${mediLeadId}`)).statusCode).toBe(404);
    expect((await call(app, roadAdmin, 'PATCH', `/leads/${mediLeadId}`, { stage: 'WON' })).statusCode).toBe(404);
    expect((await call(app, roadAdmin, 'GET', `/leads/${mediLeadId}/activities`)).statusCode).toBe(404);
    expect((await call(app, roadAdmin, 'POST', `/leads/${mediLeadId}/outreach/draft`, { channel: 'email' })).statusCode).toBe(404);
  });

  it('only lists the caller\'s own org leads', async () => {
    const res = await call(app, roadAdmin, 'GET', '/leads?pageSize=50');
    const ids: string[] = res.json().items.map((l: { id: string }) => l.id);
    expect(ids).not.toContain(mediLeadId);
    const rows = await getDb().select({ orgId: leads.orgId }).from(leads).where(sql`${leads.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([roadAdmin.me.org!.id]));
  });

  it('never shows another org\'s audit entries', async () => {
    const res = await call(app, roadAdmin, 'GET', '/audit?pageSize=100');
    for (const e of res.json().items) expect(e.orgId).toBe(roadAdmin.me.org!.id);
  });
});

describe('super admin data boundary (ADR-0010)', () => {
  it('gets 403 on every tenant route', async () => {
    for (const url of ['/leads', `/leads/${mediLeadId}`, '/org', '/org/sources', '/icps', '/signals', '/dashboard', '/audit', '/tasks']) {
      const res = await call(app, sa, 'GET', url);
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('platform org view exposes only allow-listed public fields', async () => {
    const res = await call(app, sa, 'GET', `/platform/orgs/${mediAdmin.me.org!.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['activatedAt', 'companySize', 'createdAt', 'hq', 'id', 'industry', 'name', 'publicDocuments', 'publicProducts', 'publicProfile', 'regions', 'slug', 'status', 'websiteUrl'].sort(),
    );
    const json = JSON.stringify(body);
    for (const forbidden of ['leads', 'contacts', 'icps', 'signals', 'priceNotes', 'settings']) expect(json).not.toContain(`"${forbidden}"`);
    // Internal documents never appear.
    expect(body.publicDocuments.every((d: { title: string }) => !/internal/i.test(d.title))).toBe(true);
  });

  it('platform stats are aggregate numbers only', async () => {
    const res = await call(app, sa, 'GET', `/platform/orgs/${mediAdmin.me.org!.id}/stats`);
    const s = res.json();
    expect(typeof s.leads).toBe('number');
    expect(Object.values(s).some((v) => Array.isArray(v))).toBe(false);
  });

  it('platform audit contains only PLATFORM-scope entries', async () => {
    const res = await call(app, sa, 'GET', '/platform/audit?pageSize=100');
    expect(res.json().items.length).toBeGreaterThan(0);
    for (const e of res.json().items) expect(e.scope).toBe('PLATFORM');
  });

  it('org members cannot use platform routes', async () => {
    expect((await call(app, roadAdmin, 'GET', '/platform/orgs')).statusCode).toBe(403);
  });
});
