import { auditLogs, desc, eq, getDb, organizations, sql } from '@selloeasy/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, login, makeApp, type Session } from './helpers';

let app: FastifyInstance;
let admin: Session;
let sdr: Session;
let sdr2: Session;
let viewer: Session;

beforeAll(async () => {
  app = await makeApp();
  admin = await login(app, 'admin@roadgrip.local');
  sdr = await login(app, 'sdr1@roadgrip.local');
  sdr2 = await login(app, 'sdr2@roadgrip.local');
  viewer = await login(app, 'viewer@roadgrip.local');
});
afterAll(async () => {
  await app.close();
});

async function unassignedLead(): Promise<{ id: string; stage: string }> {
  const res = await call(app, admin, 'GET', '/leads?owner=unassigned&stage=NEW&pageSize=1');
  return res.json().items[0];
}

describe('leads list', () => {
  it('defaults to 6 per page with stable score ordering', async () => {
    const res = await call(app, admin, 'GET', '/leads');
    const body = res.json();
    expect(body.pageSize).toBe(6);
    expect(body.items).toHaveLength(6);
    const scores = body.items.map((l: { scoreTotal: number }) => l.scoreTotal);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(body.totalPages).toBe(Math.ceil(body.total / 6));
  });

  it('filters by band and stage', async () => {
    const hot = (await call(app, admin, 'GET', '/leads?band=HOT&pageSize=50')).json();
    expect(hot.items.every((l: { scoreBand: string }) => l.scoreBand === 'HOT')).toBe(true);
    const won = (await call(app, admin, 'GET', '/leads?stage=WON&pageSize=50')).json();
    expect(won.items.every((l: { stage: string }) => l.stage === 'WON')).toBe(true);
  });
});

describe('RBAC & ownership', () => {
  it('SDRs cannot change a lead they do not own, but can claim it', async () => {
    const lead = await unassignedLead();
    expect((await call(app, sdr, 'PATCH', `/leads/${lead.id}`, { stage: 'ENGAGED' })).statusCode).toBe(403);
    const claim = await call(app, sdr, 'POST', `/leads/${lead.id}/claim`);
    expect(claim.statusCode).toBe(200);
    // Second claim loses the race.
    expect((await call(app, sdr2, 'POST', `/leads/${lead.id}/claim`)).statusCode).toBe(409);
    expect((await call(app, sdr, 'PATCH', `/leads/${lead.id}`, { stage: 'ENGAGED' })).statusCode).toBe(200);
    // Another SDR still cannot touch it.
    expect((await call(app, sdr2, 'PATCH', `/leads/${lead.id}`, { stage: 'QUALIFIED' })).statusCode).toBe(403);
  });

  it('SDRs cannot reassign leads; managers can', async () => {
    const lead = await unassignedLead();
    expect((await call(app, sdr, 'PATCH', `/leads/${lead.id}`, { ownerUserId: sdr.me.user.id })).statusCode).toBe(403);
    expect((await call(app, admin, 'PATCH', `/leads/${lead.id}`, { ownerUserId: sdr2.me.user.id })).statusCode).toBe(200);
  });

  it('viewers are read-only', async () => {
    const lead = await unassignedLead();
    expect((await call(app, viewer, 'GET', `/leads/${lead.id}`)).statusCode).toBe(200);
    expect((await call(app, viewer, 'POST', `/leads/${lead.id}/claim`)).statusCode).toBe(403);
    expect((await call(app, viewer, 'POST', `/leads/${lead.id}/outreach/draft`, { channel: 'email' })).statusCode).toBe(403);
    expect((await call(app, viewer, 'POST', '/pipeline/runs')).statusCode).toBe(403);
  });

  it('LOST requires a reason; optimistic lock rejects stale versions', async () => {
    const lead = await unassignedLead();
    expect((await call(app, admin, 'PATCH', `/leads/${lead.id}`, { stage: 'LOST' })).statusCode).toBe(400);
    const detail = (await call(app, admin, 'GET', `/leads/${lead.id}`)).json();
    expect((await call(app, admin, 'PATCH', `/leads/${lead.id}`, { stage: 'CONTACTED', version: detail.version })).statusCode).toBe(200);
    expect((await call(app, admin, 'PATCH', `/leads/${lead.id}`, { stage: 'ENGAGED', version: detail.version })).statusCode).toBe(409);
  });
});

describe('outreach', () => {
  it('drafts with the mock LLM, sends email, auto-claims, advances stage, logs activity + audit', async () => {
    const lead = await unassignedLead();
    const draft = await call(app, sdr, 'POST', `/leads/${lead.id}/outreach/draft`, { channel: 'email' });
    expect(draft.statusCode).toBe(200);
    const d = draft.json();
    expect(d.model).toBe('mock');
    expect(d.subject.length).toBeGreaterThan(3);
    const send = await call(app, sdr, 'POST', `/leads/${lead.id}/outreach/send`, { channel: 'email', to: d.contact.email, subject: d.subject, body: d.body });
    expect(send.statusCode).toBe(202);
    expect(send.json().stage).toBe('CONTACTED');
    const detail = (await call(app, sdr, 'GET', `/leads/${lead.id}`)).json();
    expect(detail.owner.id).toBe(sdr.me.user.id);
    const acts = (await call(app, sdr, 'GET', `/leads/${lead.id}/activities`)).json();
    expect(acts.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['EMAIL', 'STAGE_CHANGE', 'ASSIGNMENT']));
    const [audit] = await getDb().select().from(auditLogs).where(eq(auditLogs.action, 'outreach.email_sent')).orderBy(desc(auditLogs.id)).limit(1);
    expect(audit?.entityId).toBe(lead.id);
    expect(audit?.actorUserId).toBe(sdr.me.user.id);
  });

  it('logging a meeting moves the lead to MEETING_SCHEDULED', async () => {
    const lead = await unassignedLead();
    const res = await call(app, admin, 'POST', `/leads/${lead.id}/outreach/log`, { channel: 'meeting', meetingAt: new Date(Date.now() + 86400000).toISOString() });
    expect(res.statusCode).toBe(201);
    expect(res.json().stage).toBe('MEETING_SCHEDULED');
  });
});

describe('lead visibility setting (ADR-0011)', () => {
  it('ASSIGNED_ONLY limits SDRs to their own leads; ALL shows everything', async () => {
    const all = (await call(app, sdr, 'GET', '/leads?pageSize=50')).json().total;
    await getDb().update(organizations).set({ settings: sql`${organizations.settings} || '{"leadVisibility":"ASSIGNED_ONLY"}'::jsonb` }).where(eq(organizations.id, sdr.me.org!.id));
    const mine = (await call(app, sdr, 'GET', '/leads?pageSize=50')).json();
    expect(mine.total).toBeLessThan(all);
    expect(mine.items.every((l: { owner: { id: string } | null }) => l.owner?.id === sdr.me.user.id)).toBe(true);
    // Admins are unaffected.
    expect((await call(app, admin, 'GET', '/leads')).json().total).toBe(all);
    await getDb().update(organizations).set({ settings: sql`${organizations.settings} || '{"leadVisibility":"ALL"}'::jsonb` }).where(eq(organizations.id, sdr.me.org!.id));
    expect((await call(app, sdr, 'GET', '/leads')).json().total).toBe(all);
  });
});

describe('dashboards', () => {
  it('org dashboard for admins, "my stats" for SDRs', async () => {
    const org = (await call(app, admin, 'GET', '/dashboard')).json();
    expect(org.scope).toBe('org');
    expect(org.summary.leads).toBeGreaterThan(0);
    expect(org.funnel).toHaveLength(8);
    const mine = (await call(app, sdr, 'GET', '/dashboard')).json();
    expect(mine.scope).toBe('me');
    expect(mine.summary.leads).toBeLessThanOrEqual(org.summary.leads);
  });
});

describe('audit trail (plan §15)', () => {
  it('is append-only at the database level', async () => {
    const cause = async (q: Promise<unknown>) => {
      try {
        await q;
        return 'no error';
      } catch (e) {
        // Drizzle wraps driver errors; the trigger message is on `cause`.
        return String((e as { cause?: Error }).cause?.message ?? (e as Error).message);
      }
    };
    expect(await cause(getDb().execute(sql`update audit_logs set action = 'tampered' where id = (select min(id) from audit_logs)`))).toMatch(/append-only/);
    expect(await cause(getDb().execute(sql`delete from audit_logs where id = (select min(id) from audit_logs)`))).toMatch(/append-only/);
  });

  it('records a safety-net entry for mutations without an explicit audit', async () => {
    const res = await call(app, admin, 'GET', '/audit?action=lead.&pageSize=5');
    expect(res.json().items.length).toBeGreaterThan(0);
  });
});
