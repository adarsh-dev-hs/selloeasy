import { getQueue, hashPassword, QUEUES, randomToken, sha256, verifyPassword, type OutreachJob } from '@selloeasy/core';
import {
  and,
  eq,
  getDb,
  invitations,
  isNull,
  memberships,
  organizations,
  passwordResets,
  refreshTokens,
  users,
} from '@selloeasy/db';
import {
  acceptInviteSchema,
  forgotPasswordSchema,
  inviteTokenQuerySchema,
  loginSchema,
  resetPasswordSchema,
  ROLE_PERMISSIONS,
  updateMeSchema,
  type InvitePreview,
  type MeResponse,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { issueSession, revokeAllForUser, revokeFamily } from '../lib/session';
import { authOf, clearAuthCookies, REFRESH_COOKIE, requireAuth } from '../plugins/auth';

const LOCK_AFTER_FAILURES = 10;
const LOCK_MINUTES = 15;

async function loadInvite(token: string) {
  const db = getDb();
  const [inv] = await db
    .select({ inv: invitations, orgName: organizations.name, orgStatus: organizations.status })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, sha256(token)));
  if (!inv || inv.inv.acceptedAt || inv.inv.revokedAt) throw notFound('Invitation');
  if (inv.inv.expiresAt < new Date()) throw badRequest('This invitation has expired — ask your administrator to resend it');
  return inv;
}

export async function buildMe(userId: string, features: { leadVisibilityToggle: boolean }): Promise<MeResponse> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw unauthorized();
  if (user.isSuperAdmin) {
    return {
      user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: true, calendlyUrl: user.calendlyUrl, phone: user.phone },
      role: 'SUPER_ADMIN',
      permissions: [...ROLE_PERMISSIONS.SUPER_ADMIN],
      org: null,
      features,
    };
  }
  const [m] = await db
    .select({ role: memberships.role, org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE')))
    .limit(1);
  if (!m) throw unauthorized();
  return {
    user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: false, calendlyUrl: user.calendlyUrl, phone: user.phone },
    role: m.role,
    permissions: [...ROLE_PERMISSIONS[m.role]],
    org: { id: m.org.id, name: m.org.name, slug: m.org.slug, industry: m.org.industry, status: m.org.status },
    features,
  };
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const features = () => ({ leadVisibilityToggle: app.config.FEATURE_LEAD_VISIBILITY_TOGGLE });

  app.post(
    '/auth/login',
    {
      schema: { tags: ['auth'], summary: 'Log in with email + password', body: loginSchema },
      config: {
        // Plan §24: 5 attempts / minute per IP+email.
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => `login:${req.ip}:${(req.body as { email?: string } | undefined)?.email ?? ''}`,
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { email, password } = req.body;
      const [user] = await db.select().from(users).where(eq(users.email, email));
      const fail = async (reason: string) => {
        await req.audit({ scope: 'PLATFORM', orgId: null, action: 'auth.login_failed', entityType: 'user', entityId: user?.id ?? null, after: { email, reason } });
        throw unauthorized('Invalid email or password');
      };
      if (!user) return fail('unknown_email');
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await req.audit({ scope: 'PLATFORM', orgId: null, action: 'auth.login_locked', entityType: 'user', entityId: user.id, after: { email } });
        throw forbidden(`Account temporarily locked after repeated failures. Try again after ${user.lockedUntil.toISOString()}`);
      }
      if (user.status !== 'ACTIVE') return fail('disabled');
      if (!(await verifyPassword(user.passwordHash, password))) {
        const failures = user.failedLoginCount + 1;
        await db
          .update(users)
          .set({
            failedLoginCount: failures,
            lockedUntil: failures >= LOCK_AFTER_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
          })
          .where(eq(users.id, user.id));
        return fail('bad_password');
      }
      let orgId: string | null = null;
      if (!user.isSuperAdmin) {
        const [m] = await db
          .select({ orgId: memberships.orgId, orgStatus: organizations.status })
          .from(memberships)
          .innerJoin(organizations, eq(organizations.id, memberships.orgId))
          .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'ACTIVE')))
          .limit(1);
        if (!m) return fail('no_membership');
        if (m.orgStatus === 'SUSPENDED') throw forbidden('Your organization has been suspended. Contact the platform administrator.');
        orgId = m.orgId;
      }
      await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await issueSession(app, req, reply, user.id);
      const me = await buildMe(user.id, features());
      req.auth = { userId: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin, role: me.role, orgRole: me.role === 'SUPER_ADMIN' ? null : me.role, orgId };
      await req.audit({
        scope: user.isSuperAdmin ? 'PLATFORM' : 'ORG',
        orgId,
        action: 'auth.login_succeeded',
        entityType: 'user',
        entityId: user.id,
      });
      return me;
    },
  );

  app.post('/auth/refresh', { schema: { tags: ['auth'], summary: 'Rotate the refresh token and issue a new access token' } }, async (req, reply) => {
    const db = getDb();
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('No session');
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
    if (!row) {
      clearAuthCookies(app, reply);
      throw unauthorized('Session expired');
    }
    if (row.revokedAt) {
      // Reuse of a rotated token ⇒ likely theft: revoke the whole family (plan §24).
      await revokeFamily(row.familyId);
      await req.audit({ scope: 'PLATFORM', orgId: null, action: 'auth.refresh_reuse_detected', entityType: 'user', entityId: row.userId });
      clearAuthCookies(app, reply);
      throw unauthorized('Session revoked');
    }
    if (row.expiresAt < new Date()) {
      clearAuthCookies(app, reply);
      throw unauthorized('Session expired');
    }
    const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, row.userId));
    if (!user || user.status !== 'ACTIVE') {
      await revokeFamily(row.familyId);
      clearAuthCookies(app, reply);
      throw unauthorized('Account disabled');
    }
    const { refreshTokenId } = await issueSession(app, req, reply, row.userId, row.familyId);
    await db.update(refreshTokens).set({ revokedAt: new Date(), replacedBy: refreshTokenId }).where(eq(refreshTokens.id, row.id));
    return { ok: true };
  });

  app.post('/auth/logout', { schema: { tags: ['auth'], summary: 'Log out and revoke the session' } }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      const [row] = await getDb().select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
      if (row) await revokeFamily(row.familyId);
    }
    if (req.auth) await req.audit({ action: 'auth.logout', entityType: 'user', entityId: req.auth.userId });
    clearAuthCookies(app, reply);
    return { ok: true };
  });

  app.get('/auth/invite', { schema: { tags: ['auth'], summary: 'Preview an invitation', querystring: inviteTokenQuerySchema } }, async (req): Promise<InvitePreview> => {
    const { inv, orgName } = await loadInvite(req.query.token);
    return { email: inv.email, role: inv.role, orgName, expiresAt: inv.expiresAt.toISOString() };
  });

  app.post(
    '/auth/accept-invite',
    {
      schema: { tags: ['auth'], summary: 'Accept an invitation, set a password and start a session', body: acceptInviteSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const db = getDb();
      const { inv, orgStatus } = await loadInvite(req.body.token);
      const [existing] = await db.select().from(users).where(eq(users.email, inv.email));
      if (existing) {
        const [m] = await db.select().from(memberships).where(eq(memberships.userId, existing.id)).limit(1);
        if (m || existing.isSuperAdmin) throw conflict('This email already belongs to an account. Each user can belong to one organization.');
      }
      const passwordHash = await hashPassword(req.body.password);
      const userId = await db.transaction(async (tx) => {
        let uid = existing?.id;
        if (uid) {
          await tx.update(users).set({ name: req.body.name, passwordHash, status: 'ACTIVE' }).where(eq(users.id, uid));
        } else {
          const [u] = await tx.insert(users).values({ email: inv.email, name: req.body.name, passwordHash }).returning({ id: users.id });
          uid = u!.id;
        }
        await tx.insert(memberships).values({ userId: uid, orgId: inv.orgId, role: inv.role });
        await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
        if (orgStatus === 'INVITED' && inv.role === 'ORG_ADMIN') {
          await tx.update(organizations).set({ status: 'ONBOARDING' }).where(eq(organizations.id, inv.orgId));
        }
        return uid;
      });
      req.auth = { userId, email: inv.email, name: req.body.name, isSuperAdmin: false, role: inv.role, orgRole: inv.role, orgId: inv.orgId };
      await req.audit({ action: 'invite.accepted', entityType: 'invitation', entityId: inv.id, after: { email: inv.email, role: inv.role } });
      if (orgStatus === 'INVITED' && inv.role === 'ORG_ADMIN') {
        await req.audit({ scope: 'PLATFORM', action: 'org.onboarding_started', entityType: 'organization', entityId: inv.orgId });
      }
      await issueSession(app, req, reply, userId);
      return buildMe(userId, features());
    },
  );

  app.post(
    '/auth/forgot-password',
    { schema: { tags: ['auth'], summary: 'Request a password reset email', body: forgotPasswordSchema }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, req.body.email));
      // Always 200 — never reveal whether an email exists.
      if (user && user.status === 'ACTIVE') {
        const token = randomToken(32);
        await db.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) });
        await getQueue<OutreachJob>(QUEUES.outreach).add('mail.password-reset', {
          kind: 'mail.password-reset',
          to: user.email,
          link: `${app.config.WEB_URL}/reset-password?token=${token}`,
        });
        await req.audit({ scope: 'PLATFORM', orgId: null, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
      }
      return { ok: true };
    },
  );

  app.post(
    '/auth/reset-password',
    { schema: { tags: ['auth'], summary: 'Set a new password using a reset token', body: resetPasswordSchema }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.tokenHash, sha256(req.body.token)), isNull(passwordResets.usedAt)));
      if (!row || row.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired');
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(req.body.password), failedLoginCount: 0, lockedUntil: null })
          .where(eq(users.id, row.userId));
        await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));
      });
      await revokeAllForUser(row.userId);
      await req.audit({ scope: 'PLATFORM', orgId: null, action: 'auth.password_reset', entityType: 'user', entityId: row.userId });
      return { ok: true };
    },
  );

  app.get('/auth/me', { schema: { tags: ['auth'], summary: 'Current user, role, permissions and org' }, preHandler: requireAuth }, async (req) =>
    buildMe(authOf(req).userId, features()),
  );

  app.patch('/auth/me', { schema: { tags: ['auth'], summary: 'Update own profile (name, Calendly link, phone)', body: updateMeSchema }, preHandler: requireAuth }, async (req) => {
    const db = getDb();
    const a = authOf(req);
    const [before] = await db.select().from(users).where(eq(users.id, a.userId));
    const patch = {
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...('calendlyUrl' in req.body ? { calendlyUrl: req.body.calendlyUrl ?? null } : {}),
      ...(req.body.phone !== undefined ? { phone: req.body.phone || null } : {}),
    };
    const [after] = await db.update(users).set(patch).where(eq(users.id, a.userId)).returning();
    await req.audit({ action: 'user.profile_updated', entityType: 'user', entityId: a.userId, before: before as never, after: after as never });
    return buildMe(a.userId, features());
  });
};
