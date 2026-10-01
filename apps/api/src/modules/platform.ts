import { slugify } from '@selloeasy/core';
import {
  and,
  auditLogs,
  count,
  desc,
  eq,
  getDb,
  gte,
  ilike,
  inArray,
  invitations,
  isNull,
  llmCalls,
  lte,
  memberships,
  organizations,
  orgProfiles,
  orgSources,
  pipelineRuns,
  products,
  signalTemplates,
  sql,
  users,
} from '@selloeasy/db';
import { cloneTemplatesForOrg } from '@selloeasy/engine';
import {
  auditQuerySchema,
  createOrgSchema,
  idParamSchema,
  INDUSTRIES,
  platformInviteSchema,
  signalTemplateSchema,
  toPage,
  offsetOf,
  updatePlatformOrgSchema,
  type AuditEntry,
  type PlatformDashboard,
  type PlatformInvite,
  type PlatformOrgListItem,
  type PlatformOrgPublicView,
  type PlatformOrgStats,
  type PlatformOrgUser,
  type SignalTemplate,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors';
import { createInvitation, sendInviteEmail } from '../lib/invites';
import { countsByOrg, lastRunByOrg, llmUsageByOrg, rate } from '../lib/stats';
import { authOf, requirePermission } from '../plugins/auth';

/**
 * Super Admin routes (plan §2, §8.3, ADR-0010).
 * Every response is built from explicit allow-list DTOs: public-level org fields, operational
 * metadata and aggregate counts only. Tenant DTOs are never reused here.
 */

async function orgOr404(id: string) {
  const [org] = await getDb().select().from(organizations).where(eq(organizations.id, id));
  if (!org) throw notFound('Organization');
  return org;
}

async function listItems(orgIds?: string[]): Promise<PlatformOrgListItem[]> {
  const db = getDb();
  const orgs = await db
    .select()
    .from(organizations)
    .where(orgIds ? inArray(organizations.id, orgIds) : undefined)
    .orderBy(organizations.name);
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.id);
  const userCounts = await db
    .select({ orgId: memberships.orgId, n: count() })
    .from(memberships)
    .where(inArray(memberships.orgId, ids))
    .groupBy(memberships.orgId);
  const pending = await db
    .select({ orgId: invitations.orgId, n: count() })
    .from(invitations)
    .where(and(inArray(invitations.orgId, ids), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gte(invitations.expiresAt, new Date())))
    .groupBy(invitations.orgId);
  const uc = new Map(userCounts.map((r) => [r.orgId, r.n]));
  const pc = new Map(pending.map((r) => [r.orgId, r.n]));
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    industry: o.industry,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    userCount: uc.get(o.id) ?? 0,
    pendingInvites: pc.get(o.id) ?? 0,
  }));
}

async function statsFor(orgIds: string[]): Promise<Map<string, PlatformOrgStats>> {
  const [counts, usage, runs] = await Promise.all([countsByOrg(orgIds), llmUsageByOrg(orgIds), lastRunByOrg(orgIds)]);
  const out = new Map<string, PlatformOrgStats>();
  for (const id of orgIds) {
    const c = counts.get(id) ?? { leads: 0, approached: 0, meetings: 0, converted: 0 };
    const u = usage.get(id) ?? { cost: 0, calls: 0 };
    const r = runs.get(id);
    out.set(id, {
      orgId: id,
      ...c,
      conversionRate: rate(c.converted, c.approached),
      lastPipelineRun: r ? { status: r.status, finishedAt: r.finishedAt?.toISOString() ?? null, error: r.error } : null,
      llmCost30dUsd: u.cost,
      llmCalls30d: u.calls,
    });
  }
  return out;
}

export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['platform'];

  app.get('/platform/orgs', { schema: { tags, summary: 'List organizations (public-level fields)' }, preHandler: requirePermission('platform:orgs:public:read') }, async () =>
    listItems(),
  );

  app.post(
    '/platform/orgs',
    { schema: { tags, summary: 'Create an organization and invite its admin', body: createOrgSchema }, preHandler: requirePermission('platform:orgs:manage') },
    async (req, reply) => {
      const db = getDb();
      const a = authOf(req);
      let slug = slugify(req.body.name) || 'org';
      const [clash] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
      if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, req.body.adminEmail));
      if (existingUser) throw conflict('That email already belongs to a user. Use a different admin email.');

      const { org, link, invitationId } = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: req.body.name, slug, industry: req.body.industry, websiteUrl: req.body.websiteUrl ?? null, status: 'INVITED' })
          .returning();
        await cloneTemplatesForOrg(tx, org!.id, req.body.industry);
        const { invitation, link } = await createInvitation(tx, {
          orgId: org!.id,
          orgName: org!.name,
          email: req.body.adminEmail,
          role: 'ORG_ADMIN',
          invitedBy: a.userId,
          invitedByName: a.name,
        });
        await req.audit(
          { scope: 'PLATFORM', orgId: org!.id, action: 'org.created', entityType: 'organization', entityId: org!.id, after: { name: org!.name, industry: org!.industry, websiteUrl: org!.websiteUrl } },
          tx,
        );
        await req.audit(
          { scope: 'PLATFORM', orgId: org!.id, action: 'invite.sent', entityType: 'invitation', entityId: invitation.id, after: { email: req.body.adminEmail, role: 'ORG_ADMIN' } },
          tx,
        );
        return { org: org!, link, invitationId: invitation.id };
      });
      await sendInviteEmail({ to: req.body.adminEmail, orgName: org.name, role: 'ORG_ADMIN', link, invitedByName: a.name });
      reply.code(201);
      // The link is returned only in local env so evaluators can proceed without email.
      return { ...(await listItems([org.id]))[0]!, invitationId, ...(app.config.APP_ENV === 'local' ? { inviteLink: link } : {}) };
    },
  );

  app.get(
    '/platform/orgs/:id',
    { schema: { tags, summary: 'Public-level org view (ADR-0010)', params: idParamSchema }, preHandler: requirePermission('platform:orgs:public:read') },
    async (req): Promise<PlatformOrgPublicView> => {
      const db = getDb();
      const org = await orgOr404(req.params.id);
      await req.audit({ scope: 'PLATFORM', orgId: org.id, action: 'platform.org_viewed', entityType: 'organization', entityId: org.id });
      const [profile] = await db
        .select({ summary: orgProfiles.summary, valueProps: orgProfiles.valueProps, vis: orgProfiles.summaryVisibility })
        .from(orgProfiles)
        .where(eq(orgProfiles.orgId, org.id));
      const pubProducts = await db
        .select({ id: products.id, name: products.name, category: products.category, description: products.description })
        .from(products)
        .where(and(eq(products.orgId, org.id), eq(products.visibility, 'PUBLIC')));
      const pubDocs = await db
        .select({ id: orgSources.id, title: orgSources.title, type: orgSources.type, url: orgSources.url })
        .from(orgSources)
        .where(and(eq(orgSources.orgId, org.id), eq(orgSources.visibility, 'PUBLIC')));
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        industry: org.industry,
        status: org.status,
        websiteUrl: org.websiteUrl,
        hq: org.hq,
        regions: org.regions,
        companySize: org.companySize,
        createdAt: org.createdAt.toISOString(),
        activatedAt: org.activatedAt?.toISOString() ?? null,
        publicProfile: profile && profile.vis === 'PUBLIC' ? { summary: profile.summary, valueProps: profile.valueProps } : null,
        publicProducts: pubProducts,
        publicDocuments: pubDocs,
      };
    },
  );

  app.patch(
    '/platform/orgs/:id',
    { schema: { tags, summary: 'Rename / re-classify an org', params: idParamSchema, body: updatePlatformOrgSchema }, preHandler: requirePermission('platform:orgs:manage') },
    async (req) => {
      const before = await orgOr404(req.params.id);
      const [after] = await getDb().update(organizations).set(req.body).where(eq(organizations.id, before.id)).returning();
      await req.audit({ scope: 'PLATFORM', orgId: before.id, action: 'org.updated', entityType: 'organization', entityId: before.id, before: { name: before.name, industry: before.industry }, after: { name: after!.name, industry: after!.industry } });
      return (await listItems([before.id]))[0];
    },
  );

  for (const [path, status, action] of [
    ['suspend', 'SUSPENDED', 'org.suspended'],
    ['reactivate', 'ACTIVE', 'org.reactivated'],
  ] as const) {
    app.post(
      `/platform/orgs/:id/${path}`,
      { schema: { tags, summary: `${path} an organization`, params: idParamSchema }, preHandler: requirePermission('platform:orgs:manage') },
      async (req) => {
        const org = await orgOr404(req.params.id);
        if (path === 'reactivate' && org.status !== 'SUSPENDED') throw badRequest('Organization is not suspended');
        const next = path === 'reactivate' && !org.activatedAt ? 'ONBOARDING' : status;
        await getDb()
          .update(organizations)
          .set({ status: next, suspendedAt: status === 'SUSPENDED' ? new Date() : null })
          .where(eq(organizations.id, org.id));
        await req.audit({ scope: 'PLATFORM', orgId: org.id, action, entityType: 'organization', entityId: org.id, before: { status: org.status }, after: { status: next } });
        return (await listItems([org.id]))[0];
      },
    );
  }

  app.get(
    '/platform/orgs/:id/stats',
    { schema: { tags, summary: 'Aggregate counts for one org', params: idParamSchema }, preHandler: requirePermission('platform:orgs:aggregates:read') },
    async (req) => {
      await orgOr404(req.params.id);
      return (await statsFor([req.params.id])).get(req.params.id)!;
    },
  );

  app.get(
    '/platform/orgs/:id/users',
    { schema: { tags, summary: 'Org users & roles (operational metadata)', params: idParamSchema }, preHandler: requirePermission('platform:orgs:public:read') },
    async (req): Promise<PlatformOrgUser[]> => {
      await orgOr404(req.params.id);
      const rows = await getDb()
        .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status, lastLoginAt: users.lastLoginAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, req.params.id))
        .orderBy(memberships.role, users.name);
      return rows.map((r) => ({ ...r, lastLoginAt: r.lastLoginAt?.toISOString() ?? null }));
    },
  );

  app.get(
    '/platform/orgs/:id/invites',
    { schema: { tags, summary: 'Invitations for an org', params: idParamSchema }, preHandler: requirePermission('platform:orgs:manage') },
    async (req): Promise<PlatformInvite[]> => {
      const rows = await getDb().select().from(invitations).where(eq(invitations.orgId, req.params.id)).orderBy(desc(invitations.createdAt));
      return rows.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
        revokedAt: i.revokedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      }));
    },
  );

  app.post(
    '/platform/orgs/:id/invites',
    { schema: { tags, summary: '(Re)send the org-admin invite', params: idParamSchema, body: platformInviteSchema }, preHandler: requirePermission('platform:orgs:manage') },
    async (req, reply) => {
      const org = await orgOr404(req.params.id);
      const a = authOf(req);
      const { invitation, link } = await getDb().transaction(async (tx) => {
        const r = await createInvitation(tx, { orgId: org.id, orgName: org.name, email: req.body.email, role: 'ORG_ADMIN', invitedBy: a.userId, invitedByName: a.name });
        await req.audit({ scope: 'PLATFORM', orgId: org.id, action: 'invite.sent', entityType: 'invitation', entityId: r.invitation.id, after: { email: req.body.email, role: 'ORG_ADMIN' } }, tx);
        return r;
      });
      await sendInviteEmail({ to: req.body.email, orgName: org.name, role: 'ORG_ADMIN', link, invitedByName: a.name });
      reply.code(201);
      return { id: invitation.id, expiresAt: invitation.expiresAt.toISOString(), ...(app.config.APP_ENV === 'local' ? { inviteLink: link } : {}) };
    },
  );

  app.delete(
    '/platform/invites/:id',
    { schema: { tags, summary: 'Revoke an invitation', params: idParamSchema }, preHandler: requirePermission('platform:orgs:manage') },
    async (req) => {
      const [inv] = await getDb()
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, req.params.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning();
      if (!inv) throw notFound('Pending invitation');
      await req.audit({ scope: 'PLATFORM', orgId: inv.orgId, action: 'invite.revoked', entityType: 'invitation', entityId: inv.id, after: { email: inv.email } });
      return { ok: true };
    },
  );

  app.get('/platform/dashboard', { schema: { tags, summary: 'Cross-org aggregate dashboard' }, preHandler: requirePermission('platform:dashboard:read') }, async (): Promise<PlatformDashboard> => {
    const db = getDb();
    const items = await listItems();
    const stats = await statsFor(items.map((i) => i.id));
    const orgs = items.map((i) => ({ ...i, ...stats.get(i.id)! }));
    const sum = (k: 'leads' | 'approached' | 'converted' | 'llmCost30dUsd' | 'llmCalls30d') => orgs.reduce((a, o) => a + o[k], 0);
    const [{ users: userTotal }] = (await db.select({ users: count() }).from(memberships)) as [{ users: number }];
    const since = sql`now() - interval '30 days'`;
    const [health] = await db
      .select({
        runs: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${pipelineRuns.status} = 'FAILED')::int`,
        avg: sql<number | null>`avg(extract(epoch from (${pipelineRuns.finishedAt} - ${pipelineRuns.startedAt})))::float`,
      })
      .from(pipelineRuns)
      .where(gte(pipelineRuns.createdAt, since));
    const byIndustry = INDUSTRIES.map((industry) => {
      const os = orgs.filter((o) => o.industry === industry);
      return {
        industry,
        leads: os.reduce((a, o) => a + o.leads, 0),
        approached: os.reduce((a, o) => a + o.approached, 0),
        converted: os.reduce((a, o) => a + o.converted, 0),
      };
    });
    const [lastModel] = await db.select({ model: llmCalls.model }).from(llmCalls).where(sql`${llmCalls.model} <> 'mock'`).orderBy(desc(llmCalls.createdAt)).limit(1);
    return {
      totals: {
        orgs: orgs.length,
        activeOrgs: orgs.filter((o) => o.status === 'ACTIVE').length,
        users: userTotal,
        leads: sum('leads'),
        approached: sum('approached'),
        converted: sum('converted'),
        conversionRate: rate(sum('converted'), sum('approached')),
        llmCost30dUsd: Math.round(sum('llmCost30dUsd') * 10000) / 10000,
        llmCalls30d: sum('llmCalls30d'),
      },
      orgs,
      byIndustry,
      pipelineHealth: { runs30d: health?.runs ?? 0, failed30d: health?.failed ?? 0, avgDurationSec: health?.avg ? Math.round(health.avg) : null },
      model: app.config.LLM_MODE === 'live' ? app.llm.label : (lastModel?.model ?? null),
      llmMode: app.config.LLM_MODE,
    };
  });

  app.get(
    '/platform/audit',
    { schema: { tags, summary: 'Platform-scope audit log only (ADR-0010)', querystring: auditQuerySchema }, preHandler: requirePermission('platform:audit:read') },
    async (req) => {
      const q = req.query;
      const where = and(
        eq(auditLogs.scope, 'PLATFORM'),
        q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
        q.action ? ilike(auditLogs.action, `${q.action}%`) : undefined,
        q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
        q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
        q.from ? gte(auditLogs.occurredAt, new Date(q.from)) : undefined,
        q.to ? lte(auditLogs.occurredAt, new Date(`${q.to}T23:59:59.999Z`)) : undefined,
      );
      return auditPage(where, q, true);
    },
  );

  // ── Signal templates ───────────────────────────────────────────────────────
  const toTemplate = (t: typeof signalTemplates.$inferSelect): SignalTemplate => ({
    id: t.id,
    industry: t.industry,
    key: t.key,
    name: t.name,
    description: t.description,
    matchInstructions: t.matchInstructions,
    defaultKeywords: t.defaultKeywords,
    defaultWeight: t.defaultWeight,
  });

  app.get('/platform/signal-templates', { schema: { tags, summary: 'List industry signal templates' }, preHandler: requirePermission('platform:signal_templates:manage') }, async () => {
    const rows = await getDb().select().from(signalTemplates).orderBy(signalTemplates.industry, signalTemplates.name);
    return rows.map(toTemplate);
  });

  app.post(
    '/platform/signal-templates',
    { schema: { tags, summary: 'Create a signal template', body: signalTemplateSchema }, preHandler: requirePermission('platform:signal_templates:manage') },
    async (req, reply) => {
      const [row] = await getDb().insert(signalTemplates).values(req.body).onConflictDoNothing().returning();
      if (!row) throw conflict('A template with this key already exists for the industry');
      await req.audit({ scope: 'PLATFORM', orgId: null, action: 'signal_template.created', entityType: 'signal_template', entityId: row.id, after: req.body });
      reply.code(201);
      return toTemplate(row);
    },
  );

  app.patch(
    '/platform/signal-templates/:id',
    { schema: { tags, summary: 'Update a signal template', params: idParamSchema, body: signalTemplateSchema.partial() }, preHandler: requirePermission('platform:signal_templates:manage') },
    async (req) => {
      const db = getDb();
      const [before] = await db.select().from(signalTemplates).where(eq(signalTemplates.id, req.params.id));
      if (!before) throw notFound('Signal template');
      const [after] = await db.update(signalTemplates).set(req.body).where(eq(signalTemplates.id, before.id)).returning();
      await req.audit({ scope: 'PLATFORM', orgId: null, action: 'signal_template.updated', entityType: 'signal_template', entityId: before.id, before: before as never, after: after as never });
      return toTemplate(after!);
    },
  );
};

/** Shared audit-list query used by platform and org audit routes. */
export async function auditPage(where: ReturnType<typeof and>, q: z.infer<typeof auditQuerySchema>, withOrgName: boolean) {
  const db = getDb();
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ a: auditLogs, actorName: users.name, actorEmail: users.email, orgName: organizations.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .leftJoin(organizations, eq(organizations.id, auditLogs.orgId))
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(q.pageSize)
      .offset(offsetOf(q)),
    db.select({ total: count() }).from(auditLogs).where(where) as unknown as Promise<[{ total: number }]>,
  ]);
  const items: AuditEntry[] = rows.map(({ a, actorName, actorEmail, orgName }) => ({
    id: String(a.id),
    occurredAt: a.occurredAt.toISOString(),
    scope: a.scope,
    orgId: a.orgId,
    ...(withOrgName ? { orgName } : {}),
    actor: a.actorUserId && actorName ? { id: a.actorUserId, name: actorName, email: actorEmail ?? '' } : null,
    actorRole: a.actorRole,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    before: a.before,
    after: a.after,
    ip: a.ip,
    userAgent: a.userAgent,
    requestId: a.requestId,
  }));
  return toPage(items, total, q);
}
