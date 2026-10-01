import {
  accounts,
  activities,
  and,
  contacts,
  count,
  desc,
  eq,
  getDb,
  icps,
  inArray,
  isNull,
  leadSignals,
  leads,
  marketEvents,
  memberships,
  signalMatches,
  signals,
  sql,
  tasks,
  users,
} from '@selloeasy/db';
import { loadLeadEvidence, scoreLead } from '@selloeasy/engine';
import {
  bulkLeadSchema,
  can,
  contactSchema,
  createActivitySchema,
  idParamSchema,
  leadListQuerySchema,
  offsetOf,
  taskListQuerySchema,
  taskSchema,
  toPage,
  updateLeadSchema,
  updateTaskSchema,
  type Activity,
  type Contact,
  type LeadDetail,
  type Task,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { hydrateLeadItems, leadFilters, leadListSelect, leadOrder, loadLead, visibilityFilter } from '../lib/leads';
import { assertLeadOwnership, authOf, orgIdOf, requireOrg } from '../plugins/auth';

const toContact = (c: typeof contacts.$inferSelect): Contact => ({
  id: c.id,
  name: c.name,
  title: c.title,
  persona: c.persona,
  email: c.email,
  phone: c.phone,
  whatsapp: c.whatsapp,
  linkedinUrl: c.linkedinUrl,
  source: c.source,
});

async function assertMember(orgId: string, userId: string) {
  const [m] = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE')));
  if (!m) throw badRequest('Owner must be an active member of this organization');
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Prevent CSV formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const leadRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['leads'];

  app.get('/leads', { schema: { tags, summary: 'Paginated leads (default 6 per page)', querystring: leadListQuerySchema }, preHandler: requireOrg('leads:read') }, async (req) => {
    const a = authOf(req);
    const q = req.query;
    const where = leadFilters(a.orgId!, q, a, await visibilityFilter(a));
    const db = getDb();
    const rows = await leadListSelect(db)
      .where(where)
      .orderBy(...leadOrder(q.sort))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [{ total }] = (await db
      .select({ total: count() })
      .from(leads)
      .innerJoin(accounts, eq(accounts.id, leads.accountId))
      .where(where)) as [{ total: number }];
    return toPage(await hydrateLeadItems(rows), total, q);
  });

  app.get('/leads/export.csv', { schema: { tags, summary: 'Export filtered leads as CSV', querystring: leadListQuerySchema.omit({ page: true, pageSize: true }) }, preHandler: requireOrg('leads:export') }, async (req, reply) => {
    const a = authOf(req);
    const where = leadFilters(a.orgId!, req.query, a, await visibilityFilter(a));
    const rows = await leadListSelect(getDb()).where(where).orderBy(...leadOrder(req.query.sort)).limit(5000);
    const items = await hydrateLeadItems(rows);
    const header = ['Account', 'Domain', 'Industry', 'Country', 'Stage', 'Score', 'Band', 'Budget', 'Authority', 'Need', 'Timeline', 'Owner', 'Primary contact', 'Contact title', 'Headline signal', 'Last signal'];
    const lines = [header.join(',')].concat(
      items.map((l) =>
        [
          l.account.name,
          l.account.domain,
          l.account.industry,
          l.account.hqCountry,
          l.stage,
          l.scoreTotal,
          l.scoreBand,
          l.bant.budget,
          l.bant.authority,
          l.bant.need,
          l.bant.timeline,
          l.owner?.name,
          l.primaryContact?.name,
          l.primaryContact?.title,
          l.headlineSignal?.signalName,
          l.lastSignalAt?.slice(0, 10),
        ]
          .map(csvCell)
          .join(','),
      ),
    );
    await req.audit({ action: 'lead.exported', entityType: 'lead', after: { count: items.length, filters: req.query } });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    return lines.join('\n');
  });

  app.get('/leads/:id', { schema: { tags, summary: 'Lead detail with evidence and BANT rationale', params: idParamSchema }, preHandler: requireOrg('leads:read') }, async (req): Promise<LeadDetail> => {
    const a = authOf(req);
    await loadLead(a, req.params.id);
    const { lead, account, evidence, contacts: cs } = await loadLeadEvidence(req.params.id);
    const db = getDb();
    const [owner] = lead.ownerUserId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, lead.ownerUserId)) : [];
    const [icp] = lead.icpId ? await db.select({ id: icps.id, name: icps.name }).from(icps).where(eq(icps.id, lead.icpId)) : [];
    const primary = cs.find((c) => c.id === lead.primaryContactId) ?? null;
    const latest = evidence[0];
    return {
      id: lead.id,
      account: { id: account.id, name: account.name, domain: account.domain, industry: account.industry, hqCountry: account.hqCountry, description: account.description, sizeBand: account.sizeBand },
      headlineSignal: latest ? { signalName: latest.signalName, eventTitle: latest.event.title, publishedAt: latest.event.publishedAt.toISOString() } : null,
      signalCount: evidence.length,
      scoreTotal: lead.scoreTotal,
      scoreBand: lead.scoreBand,
      breakdown: lead.breakdown,
      fitScore: lead.fitScore,
      signalStrength: lead.signalStrength,
      recencyScore: lead.recencyScore,
      stage: lead.stage,
      owner: owner ?? null,
      primaryContact: primary ? { id: primary.id, name: primary.name, title: primary.title } : null,
      lastSignalAt: lead.lastSignalAt?.toISOString() ?? null,
      lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
      lostReason: lead.lostReason,
      wonValue: lead.wonValue,
      icp: icp ?? null,
      contacts: cs.map(toContact),
      evidence: evidence.map((e) => ({
        matchId: e.matchId,
        signalId: e.signalId,
        signalName: e.signalName,
        confidence: e.confidence,
        rationale: e.rationale,
        event: {
          id: e.event.id,
          title: e.event.title,
          summary: e.event.body,
          url: e.event.url,
          source: e.event.source,
          publishedAt: e.event.publishedAt.toISOString(),
          amount: e.event.amount,
          currency: e.event.currency,
          region: e.event.region,
        },
      })),
      suggestedPersonas: lead.suggestedPersonas,
      version: lead.version,
    };
  });

  app.patch('/leads/:id', { schema: { tags, summary: 'Change stage / owner / primary contact (optimistic lock)', params: idParamSchema, body: updateLeadSchema }, preHandler: requireOrg('leads:update') }, async (req) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    const b = req.body;
    if (b.ownerUserId !== undefined && b.ownerUserId !== lead.ownerUserId) {
      if (!can(a.role, 'leads:assign')) throw forbidden('Only managers and admins can reassign leads — use Claim instead');
      if (b.ownerUserId) await assertMember(a.orgId!, b.ownerUserId);
    } else {
      assertLeadOwnership(req, lead.ownerUserId);
    }
    if (b.version !== undefined && b.version !== lead.version) {
      throw conflict('This lead was changed by someone else — refresh and try again', { currentVersion: lead.version });
    }
    if (b.primaryContactId) {
      const [c] = await getDb().select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, b.primaryContactId), eq(contacts.accountId, lead.accountId)));
      if (!c) throw badRequest('Contact does not belong to this account');
    }
    const now = new Date();
    const updated = await getDb().transaction(async (tx) => {
      const patch: Partial<typeof leads.$inferInsert> = { version: lead.version + 1 };
      if (b.stage && b.stage !== lead.stage) {
        patch.stage = b.stage;
        patch.stageChangedAt = now;
        patch.lostReason = b.stage === 'LOST' ? b.lostReason : null;
        if (b.stage === 'WON' && b.wonValue !== undefined) patch.wonValue = b.wonValue;
        patch.lastActivityAt = now;
      }
      if (b.wonValue !== undefined) patch.wonValue = b.wonValue;
      if (b.ownerUserId !== undefined) patch.ownerUserId = b.ownerUserId;
      if (b.primaryContactId) patch.primaryContactId = b.primaryContactId;
      const [after] = await tx
        .update(leads)
        .set(patch)
        .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
        .returning();
      if (!after) throw conflict('This lead was changed by someone else — refresh and try again');
      if (patch.stage) {
        await tx.insert(activities).values({ orgId: lead.orgId, leadId: lead.id, actorUserId: a.userId, type: 'STAGE_CHANGE', subject: `${lead.stage} → ${patch.stage}`, body: b.lostReason ?? null, metadata: { from: lead.stage, to: patch.stage }, occurredAt: now });
        await req.audit({ action: 'lead.stage_changed', entityType: 'lead', entityId: lead.id, before: { stage: lead.stage }, after: { stage: patch.stage, lostReason: patch.lostReason, wonValue: after.wonValue } }, tx);
      }
      if (b.ownerUserId !== undefined && b.ownerUserId !== lead.ownerUserId) {
        const [owner] = b.ownerUserId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, b.ownerUserId)) : [];
        await tx.insert(activities).values({ orgId: lead.orgId, leadId: lead.id, actorUserId: a.userId, type: 'ASSIGNMENT', subject: owner ? `Assigned to ${owner.name}` : 'Unassigned', occurredAt: now });
        await req.audit({ action: 'lead.assigned', entityType: 'lead', entityId: lead.id, before: { ownerUserId: lead.ownerUserId }, after: { ownerUserId: b.ownerUserId } }, tx);
      }
      if (!req.auditRecorded) await req.audit({ action: 'lead.updated', entityType: 'lead', entityId: lead.id, before: lead as never, after: after as never }, tx);
      return after;
    });
    return { id: updated.id, stage: updated.stage, ownerUserId: updated.ownerUserId, version: updated.version };
  });

  app.post('/leads/:id/claim', { schema: { tags, summary: 'Claim an unassigned lead (race-safe)', params: idParamSchema }, preHandler: requireOrg('leads:claim') }, async (req) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    const now = new Date();
    const claimed = await getDb().transaction(async (tx) => {
      // Conditional update = no double-claims under concurrency (plan §13.5).
      const [row] = await tx
        .update(leads)
        .set({ ownerUserId: a.userId, version: sql`${leads.version} + 1` })
        .where(and(eq(leads.id, lead.id), isNull(leads.ownerUserId)))
        .returning();
      if (!row) return null;
      await tx.insert(activities).values({ orgId: lead.orgId, leadId: lead.id, actorUserId: a.userId, type: 'ASSIGNMENT', subject: `Claimed by ${a.name}`, occurredAt: now });
      await req.audit({ action: 'lead.claimed', entityType: 'lead', entityId: lead.id, after: { ownerUserId: a.userId } }, tx);
      return row;
    });
    if (!claimed) throw conflict('This lead already has an owner');
    return { id: claimed.id, ownerUserId: claimed.ownerUserId, version: claimed.version };
  });

  app.post('/leads/bulk', { schema: { tags, summary: 'Bulk assign or change stage', body: bulkLeadSchema }, preHandler: requireOrg('leads:update') }, async (req) => {
    const a = authOf(req);
    const { leadIds, action } = req.body;
    const vis = await visibilityFilter(a);
    const db = getDb();
    const rows = await db.select().from(leads).where(and(eq(leads.orgId, a.orgId!), inArray(leads.id, leadIds), vis));
    if (rows.length !== leadIds.length) throw notFound('One or more leads');
    if (action.type === 'assign') {
      if (!can(a.role, 'leads:assign')) throw forbidden('Only managers and admins can assign leads');
      if (action.ownerUserId) await assertMember(a.orgId!, action.ownerUserId);
    } else {
      for (const r of rows) assertLeadOwnership(req, r.ownerUserId);
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      if (action.type === 'assign') {
        await tx.update(leads).set({ ownerUserId: action.ownerUserId, version: sql`${leads.version} + 1` }).where(inArray(leads.id, leadIds));
        await tx.insert(activities).values(rows.map((r) => ({ orgId: r.orgId, leadId: r.id, actorUserId: a.userId, type: 'ASSIGNMENT' as const, subject: action.ownerUserId ? 'Bulk assigned' : 'Bulk unassigned', metadata: { ownerUserId: action.ownerUserId }, occurredAt: now })));
      } else {
        const changing = rows.filter((r) => r.stage !== action.stage);
        if (changing.length) {
          await tx.update(leads).set({ stage: action.stage, stageChangedAt: now, lastActivityAt: now, version: sql`${leads.version} + 1` }).where(inArray(leads.id, changing.map((r) => r.id)));
          await tx.insert(activities).values(changing.map((r) => ({ orgId: r.orgId, leadId: r.id, actorUserId: a.userId, type: 'STAGE_CHANGE' as const, subject: `${r.stage} → ${action.stage}`, metadata: { from: r.stage, to: action.stage, bulk: true }, occurredAt: now })));
        }
      }
      await req.audit({ action: action.type === 'assign' ? 'lead.bulk_assigned' : 'lead.bulk_stage_changed', entityType: 'lead', after: { leadIds, ...action } }, tx);
    });
    return { updated: rows.length };
  });

  app.post('/leads/:id/rescore', { schema: { tags, summary: 'Recompute BANT+ score (uses the LLM)', params: idParamSchema }, preHandler: requireOrg('leads:update') }, async (req) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    const r = await scoreLead(app.llm, lead.id, { actorUserId: a.userId });
    await req.audit({ action: 'lead.rescored', entityType: 'lead', entityId: lead.id, before: { scoreTotal: lead.scoreTotal }, after: { scoreTotal: r.total } });
    return { scoreTotal: r.total };
  });

  // ── Activities ─────────────────────────────────────────────────────────────
  app.get('/leads/:id/activities', { schema: { tags: ['crm'], summary: 'Activity timeline', params: idParamSchema }, preHandler: requireOrg('leads:read') }, async (req): Promise<Activity[]> => {
    const lead = await loadLead(authOf(req), req.params.id);
    const rows = await getDb()
      .select({ a: activities, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorUserId))
      .where(and(eq(activities.orgId, lead.orgId), eq(activities.leadId, lead.id)))
      .orderBy(desc(activities.occurredAt))
      .limit(200);
    return rows.map(({ a, actorName }) => ({
      id: a.id,
      type: a.type,
      direction: a.direction,
      subject: a.subject,
      body: a.body,
      metadata: a.metadata,
      actor: a.actorUserId && actorName ? { id: a.actorUserId, name: actorName } : null,
      occurredAt: a.occurredAt.toISOString(),
    }));
  });

  app.post('/leads/:id/activities', { schema: { tags: ['crm'], summary: 'Add a note', params: idParamSchema, body: createActivitySchema }, preHandler: requireOrg('leads:update') }, async (req, reply) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    assertLeadOwnership(req, lead.ownerUserId);
    const now = new Date();
    const [row] = await getDb().transaction(async (tx) => {
      const r = await tx.insert(activities).values({ orgId: lead.orgId, leadId: lead.id, actorUserId: a.userId, type: 'NOTE', body: req.body.body, occurredAt: now }).returning();
      await tx.update(leads).set({ lastActivityAt: now }).where(eq(leads.id, lead.id));
      await req.audit({ action: 'lead.note_added', entityType: 'lead', entityId: lead.id, after: { activityId: r[0]!.id } }, tx);
      return r;
    });
    reply.code(201);
    return { id: row!.id };
  });

  // ── Contacts ───────────────────────────────────────────────────────────────
  app.post('/leads/:id/contacts', { schema: { tags: ['crm'], summary: 'Add a contact to the lead\'s account', params: idParamSchema, body: contactSchema }, preHandler: requireOrg('leads:update') }, async (req, reply) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    assertLeadOwnership(req, lead.ownerUserId);
    const [c] = await getDb().insert(contacts).values({ ...req.body, orgId: lead.orgId, accountId: lead.accountId, source: 'MANUAL' }).returning();
    if (!lead.primaryContactId) await getDb().update(leads).set({ primaryContactId: c!.id }).where(eq(leads.id, lead.id));
    await req.audit({ action: 'contact.created', entityType: 'contact', entityId: c!.id, after: c as never });
    reply.code(201);
    return toContact(c!);
  });

  app.patch('/contacts/:id', { schema: { tags: ['crm'], summary: 'Update a contact', params: idParamSchema, body: contactSchema.partial() }, preHandler: requireOrg('leads:update') }, async (req) => {
    const a = authOf(req);
    const db = getDb();
    const [before] = await db.select().from(contacts).where(and(eq(contacts.id, req.params.id), eq(contacts.orgId, a.orgId!)));
    if (!before) throw notFound('Contact');
    const [after] = await db.update(contacts).set(req.body).where(eq(contacts.id, before.id)).returning();
    await req.audit({ action: 'contact.updated', entityType: 'contact', entityId: before.id, before: before as never, after: after as never });
    return toContact(after!);
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const toTask = (t: typeof tasks.$inferSelect, assigneeName: string | null, accountName?: string | null): Task => ({
    id: t.id,
    leadId: t.leadId,
    createdBy: t.createdBy,
    title: t.title,
    dueAt: t.dueAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    assignee: t.assigneeUserId && assigneeName ? { id: t.assigneeUserId, name: assigneeName } : null,
    ...(accountName ? { lead: { id: t.leadId, accountName } } : {}),
    createdAt: t.createdAt.toISOString(),
  });

  app.get('/tasks', { schema: { tags: ['crm'], summary: 'My (or all) tasks', querystring: taskListQuerySchema }, preHandler: requireOrg('leads:read') }, async (req) => {
    const a = authOf(req);
    const q = req.query;
    const rows = await getDb()
      .select({ t: tasks, assigneeName: users.name, accountName: accounts.name })
      .from(tasks)
      .innerJoin(leads, eq(leads.id, tasks.leadId))
      .innerJoin(accounts, eq(accounts.id, leads.accountId))
      .leftJoin(users, eq(users.id, tasks.assigneeUserId))
      .where(
        and(
          eq(tasks.orgId, a.orgId!),
          q.scope === 'mine' ? eq(tasks.assigneeUserId, a.userId) : undefined,
          q.status === 'open' ? isNull(tasks.completedAt) : q.status === 'done' ? sql`${tasks.completedAt} is not null` : undefined,
        ),
      )
      .orderBy(sql`${tasks.dueAt} asc nulls last`)
      .limit(200);
    return rows.map((r) => toTask(r.t, r.assigneeName, r.accountName));
  });

  app.get('/leads/:id/tasks', { schema: { tags: ['crm'], summary: 'Tasks for a lead', params: idParamSchema }, preHandler: requireOrg('leads:read') }, async (req) => {
    const lead = await loadLead(authOf(req), req.params.id);
    const rows = await getDb()
      .select({ t: tasks, assigneeName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeUserId))
      .where(eq(tasks.leadId, lead.id))
      .orderBy(sql`${tasks.completedAt} is not null`, sql`${tasks.dueAt} asc nulls last`);
    return rows.map((r) => toTask(r.t, r.assigneeName));
  });

  app.post('/leads/:id/tasks', { schema: { tags: ['crm'], summary: 'Create a task', params: idParamSchema, body: taskSchema }, preHandler: requireOrg('tasks:write') }, async (req, reply) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    const assignee = req.body.assigneeUserId ?? a.userId;
    if (assignee !== a.userId) {
      if (!can(a.role, 'leads:assign')) throw forbidden('Only managers and admins can assign tasks to others');
      await assertMember(a.orgId!, assignee);
    }
    const [t] = await getDb()
      .insert(tasks)
      .values({ orgId: lead.orgId, leadId: lead.id, title: req.body.title, dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null, assigneeUserId: assignee, createdBy: a.userId })
      .returning();
    await req.audit({ action: 'task.created', entityType: 'task', entityId: t!.id, after: t as never });
    reply.code(201);
    return toTask(t!, null);
  });

  app.patch('/tasks/:id', { schema: { tags: ['crm'], summary: 'Update / complete a task', params: idParamSchema, body: updateTaskSchema }, preHandler: requireOrg('tasks:write') }, async (req) => {
    const a = authOf(req);
    const db = getDb();
    const [before] = await db.select().from(tasks).where(and(eq(tasks.id, req.params.id), eq(tasks.orgId, a.orgId!)));
    if (!before) throw notFound('Task');
    if (before.assigneeUserId !== a.userId && !can(a.role, 'leads:assign')) throw forbidden('You can only update your own tasks');
    const { completed, dueAt, ...rest } = req.body;
    const [after] = await db
      .update(tasks)
      .set({
        ...rest,
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        ...(completed !== undefined ? { completedAt: completed ? new Date() : null } : {}),
      })
      .where(eq(tasks.id, before.id))
      .returning();
    await req.audit({ action: completed ? 'task.completed' : 'task.updated', entityType: 'task', entityId: before.id, before: before as never, after: after as never });
    return toTask(after!, null);
  });

  app.delete('/tasks/:id', { schema: { tags: ['crm'], summary: 'Delete a task', params: idParamSchema }, preHandler: requireOrg('tasks:write') }, async (req) => {
    const a = authOf(req);
    const [t] = await getDb().select().from(tasks).where(and(eq(tasks.id, req.params.id), eq(tasks.orgId, a.orgId!)));
    if (!t) throw notFound('Task');
    if (t.createdBy !== a.userId && !can(a.role, 'leads:assign')) throw forbidden();
    await getDb().delete(tasks).where(eq(tasks.id, t.id));
    await req.audit({ action: 'task.deleted', entityType: 'task', entityId: t.id, before: t as never });
    return { ok: true };
  });
};

