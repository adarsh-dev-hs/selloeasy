import {
  and,
  auditLogs,
  count,
  desc,
  eq,
  getDb,
  gte,
  icps,
  ilike,
  invitations,
  isNull,
  lte,
  memberships,
  organizations,
  orgProfiles,
  orgSources,
  policies,
  products,
  signals,
  users,
} from '@selloeasy/db';
import {
  auditQuerySchema,
  idParamSchema,
  inviteUserSchema,
  updateMemberSchema,
  updateOrgSchema,
  type OnboardingState,
  type OrgDetail,
  type OrgMember,
  type PlatformInvite,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { createInvitation, sendInviteEmail } from '../lib/invites';
import { enqueuePipelineRun } from '../lib/pipeline';
import { authOf, orgIdOf, requireOrg } from '../plugins/auth';
import { auditPage } from './platform';

export async function onboardingState(orgId: string): Promise<OnboardingState> {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const sources = await db.select({ type: orgSources.type, status: orgSources.status }).from(orgSources).where(eq(orgSources.orgId, orgId));
  const n = async (table: typeof products | typeof policies) => (await db.select({ n: count() }).from(table).where(eq(table.orgId, orgId)))[0]!.n;
  const [profile] = await db.select({ id: orgProfiles.id }).from(orgProfiles).where(eq(orgProfiles.orgId, orgId));
  const [icpN] = await db.select({ n: count() }).from(icps).where(and(eq(icps.orgId, orgId), eq(icps.isActive, true)));
  const [sigN] = await db.select({ n: count() }).from(signals).where(and(eq(signals.orgId, orgId), eq(signals.isActive, true)));
  return {
    basics: !!(org?.description && org.hq),
    website: sources.some((s) => s.type === 'WEBSITE'),
    documents: sources.some((s) => s.type !== 'WEBSITE' && s.status === 'READY'),
    products: (await n(products)) > 0,
    policies: (await n(policies)) > 0,
    profile: !!profile,
    icps: (icpN?.n ?? 0) > 0,
    signals: (sigN?.n ?? 0) > 0,
  };
}

async function orgDetail(orgId: string): Promise<OrgDetail> {
  const [o] = await getDb().select().from(organizations).where(eq(organizations.id, orgId));
  if (!o) throw notFound('Organization');
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    industry: o.industry,
    status: o.status,
    websiteUrl: o.websiteUrl,
    hq: o.hq,
    regions: o.regions,
    companySize: o.companySize,
    description: o.description,
    settings: o.settings,
    activatedAt: o.activatedAt?.toISOString() ?? null,
    onboarding: await onboardingState(orgId),
  };
}

export const orgRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['org'];

  app.get('/org', { schema: { tags, summary: 'Current organization with onboarding state' }, preHandler: requireOrg('org:profile:read') }, async (req) =>
    orgDetail(orgIdOf(req)),
  );

  app.patch('/org', { schema: { tags, summary: 'Update organization basics & settings', body: updateOrgSchema }, preHandler: requireOrg('org:profile:write') }, async (req) => {
    const db = getDb();
    const orgId = orgIdOf(req);
    const [before] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    const { settings, ...rest } = req.body;
    if (settings?.leadVisibility && settings.leadVisibility !== (before!.settings.leadVisibility ?? 'ALL') && !app.config.FEATURE_LEAD_VISIBILITY_TOGGLE) {
      throw forbidden('Changing lead visibility is not enabled on this platform yet (FEATURE_LEAD_VISIBILITY_TOGGLE)');
    }
    const patch = {
      ...rest,
      ...(rest.websiteUrl !== undefined ? { websiteUrl: rest.websiteUrl || null } : {}),
      ...(settings ? { settings: { ...before!.settings, ...settings } } : {}),
    };
    await db.transaction(async (tx) => {
      const [after] = await tx.update(organizations).set(patch).where(eq(organizations.id, orgId)).returning();
      await req.audit({ action: 'org.updated', entityType: 'organization', entityId: orgId, before: before as never, after: after as never }, tx);
    });
    return orgDetail(orgId);
  });

  app.post('/org/activate', { schema: { tags, summary: 'Finish onboarding and start the first pipeline run' }, preHandler: requireOrg('org:profile:write') }, async (req) => {
    const db = getDb();
    const orgId = orgIdOf(req);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (org!.status === 'ACTIVE') throw badRequest('Organization is already active');
    const state = await onboardingState(orgId);
    const missing = (['profile', 'signals'] as const).filter((k) => !state[k]);
    if (missing.length) throw badRequest(`Complete these onboarding steps first: ${missing.join(', ')}`, { missing });
    await db.transaction(async (tx) => {
      await tx.update(organizations).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(organizations.id, orgId));
      await req.audit({ action: 'org.activated', entityType: 'organization', entityId: orgId, before: { status: org!.status }, after: { status: 'ACTIVE' } }, tx);
      await req.audit({ scope: 'PLATFORM', action: 'org.activated', entityType: 'organization', entityId: orgId }, tx);
    });
    const run = await enqueuePipelineRun(orgId, 'ONBOARDING', authOf(req).userId);
    return { ...(await orgDetail(orgId)), pipelineRunId: run.id };
  });

  // ── Members ────────────────────────────────────────────────────────────────
  app.get('/org/users', { schema: { tags, summary: 'Org members' }, preHandler: requireOrg('org:profile:read') }, async (req): Promise<OrgMember[]> => {
    const rows = await getDb()
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status, lastLoginAt: users.lastLoginAt, calendlyUrl: users.calendlyUrl })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgIdOf(req)))
      .orderBy(memberships.role, users.name);
    return rows.map((r) => ({ ...r, lastLoginAt: r.lastLoginAt?.toISOString() ?? null }));
  });

  app.patch(
    '/org/users/:id',
    { schema: { tags, summary: 'Change a member role or disable a member', params: idParamSchema, body: updateMemberSchema }, preHandler: requireOrg('org:users:manage') },
    async (req) => {
      const db = getDb();
      const orgId = orgIdOf(req);
      const a = authOf(req);
      const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, req.params.id)));
      if (!m) throw notFound('Member');
      if (req.params.id === a.userId && (req.body.role !== undefined || req.body.status === 'DISABLED')) {
        throw badRequest('You cannot change your own role or disable yourself');
      }
      // Never leave an org without an active admin.
      if (m.role === 'ORG_ADMIN' && ((req.body.role && req.body.role !== 'ORG_ADMIN') || req.body.status === 'DISABLED')) {
        const [admins] = await db
          .select({ n: count() })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'ORG_ADMIN'), eq(memberships.status, 'ACTIVE')));
        if ((admins?.n ?? 0) <= 1) throw badRequest('An organization needs at least one active Org Admin');
      }
      await db.transaction(async (tx) => {
        const [after] = await tx.update(memberships).set(req.body).where(eq(memberships.id, m.id)).returning();
        await req.audit(
          { action: req.body.role && req.body.role !== m.role ? 'member.role_changed' : 'member.updated', entityType: 'user', entityId: m.userId, before: { role: m.role, status: m.status }, after: { role: after!.role, status: after!.status } },
          tx,
        );
      });
      return { ok: true };
    },
  );

  // ── Invites ────────────────────────────────────────────────────────────────
  app.get('/org/invites', { schema: { tags, summary: 'Pending and past invitations' }, preHandler: requireOrg('org:users:manage') }, async (req): Promise<PlatformInvite[]> => {
    const rows = await getDb().select().from(invitations).where(eq(invitations.orgId, orgIdOf(req))).orderBy(desc(invitations.createdAt));
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      revokedAt: i.revokedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    }));
  });

  app.post('/org/invites', { schema: { tags, summary: 'Invite a teammate with a role', body: inviteUserSchema }, preHandler: requireOrg('org:users:manage') }, async (req, reply) => {
    const db = getDb();
    const orgId = orgIdOf(req);
    const a = authOf(req);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, req.body.email));
    if (existing) {
      const [m] = await db.select().from(memberships).where(eq(memberships.userId, existing.id));
      if (m) throw conflict(m.orgId === orgId ? 'This person is already a member' : 'This email belongs to a user in another organization');
    }
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    const { invitation, link } = await db.transaction(async (tx) => {
      const r = await createInvitation(tx, { orgId, orgName: org!.name, email: req.body.email, role: req.body.role, invitedBy: a.userId, invitedByName: a.name });
      await req.audit({ action: 'invite.sent', entityType: 'invitation', entityId: r.invitation.id, after: { email: req.body.email, role: req.body.role } }, tx);
      return r;
    });
    await sendInviteEmail({ to: req.body.email, orgName: org!.name, role: req.body.role, link, invitedByName: a.name });
    reply.code(201);
    return { id: invitation.id, expiresAt: invitation.expiresAt.toISOString(), ...(app.config.APP_ENV === 'local' ? { inviteLink: link } : {}) };
  });

  app.delete('/org/invites/:id', { schema: { tags, summary: 'Revoke an invitation', params: idParamSchema }, preHandler: requireOrg('org:users:manage') }, async (req) => {
    const [inv] = await getDb()
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, req.params.id), eq(invitations.orgId, orgIdOf(req)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning();
    if (!inv) throw notFound('Pending invitation');
    await req.audit({ action: 'invite.revoked', entityType: 'invitation', entityId: inv.id, after: { email: inv.email } });
    return { ok: true };
  });

  // ── Org audit log ──────────────────────────────────────────────────────────
  app.get('/audit', { schema: { tags: ['audit'], summary: 'Org-scope audit log with diffs', querystring: auditQuerySchema }, preHandler: requireOrg('audit:org:read') }, async (req) => {
    const q = req.query;
    const where = and(
      eq(auditLogs.scope, 'ORG'),
      eq(auditLogs.orgId, orgIdOf(req)),
      q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
      q.action ? ilike(auditLogs.action, `${q.action}%`) : undefined,
      q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
      q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
      q.from ? gte(auditLogs.occurredAt, new Date(q.from)) : undefined,
      q.to ? lte(auditLogs.occurredAt, new Date(`${q.to}T23:59:59.999Z`)) : undefined,
    );
    return auditPage(where, q, false);
  });
};
