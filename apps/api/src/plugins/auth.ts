import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { and, eq, getDb, memberships, organizations, users } from '@selloeasy/db';
import { can, requiresOwnership, type Permission } from '@selloeasy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { forbidden, unauthorized } from '../lib/errors';
import type { AuthContext } from '../types';

export const ACCESS_COOKIE = 'se_at';
export const REFRESH_COOKIE = 'se_rt';

interface AccessClaims {
  sub: string;
}

/** Resolve the caller from the access cookie (or Bearer token) on every request. */
async function resolveAuth(app: FastifyInstance, req: FastifyRequest): Promise<AuthContext | null> {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = bearer ?? req.cookies[ACCESS_COOKIE];
  if (!token) return null;
  let claims: AccessClaims;
  try {
    claims = app.jwt.verify<AccessClaims>(token);
  } catch {
    return null;
  }
  // Load fresh user + membership each request so role changes/disablement take effect immediately.
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, claims.sub));
  if (!user || user.status !== 'ACTIVE') return null;
  if (user.isSuperAdmin) {
    return { userId: user.id, email: user.email, name: user.name, isSuperAdmin: true, role: 'SUPER_ADMIN', orgRole: null, orgId: null };
  }
  const [m] = await db
    .select({ role: memberships.role, orgId: memberships.orgId, orgStatus: organizations.status })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'ACTIVE')))
    .limit(1);
  // Suspended orgs lose access immediately.
  if (!m || m.orgStatus === 'SUSPENDED') return null;
  return { userId: user.id, email: user.email, name: user.name, isSuperAdmin: false, role: m.role, orgRole: m.role, orgId: m.orgId };
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: app.config.JWT_ACCESS_SECRET,
    sign: { expiresIn: app.config.ACCESS_TOKEN_TTL },
  });
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    req.auth = await resolveAuth(app, req);
  });
});

// ─── Guards (preHandlers) ────────────────────────────────────────────────────

export const requireAuth: preHandlerAsyncHookHandler = async (req) => {
  if (!req.auth) throw unauthorized();
};

/** Default-deny guard: route must declare a permission (plan §24). */
export function requirePermission(permission: Permission): preHandlerAsyncHookHandler {
  return async (req) => {
    if (!req.auth) throw unauthorized();
    if (!can(req.auth.role, permission)) throw forbidden();
  };
}

/**
 * Tenant routes: the caller must be an org member. Super Admins have no membership and get 403
 * on every tenant route (ADR-0010).
 */
export function requireOrg(permission: Permission): preHandlerAsyncHookHandler {
  return async (req) => {
    if (!req.auth) throw unauthorized();
    if (req.auth.isSuperAdmin || !req.auth.orgId) {
      throw forbidden('Platform administrators cannot access organization data');
    }
    if (!can(req.auth.role, permission)) throw forbidden();
  };
}

export function orgIdOf(req: FastifyRequest): string {
  if (!req.auth?.orgId) throw forbidden();
  return req.auth.orgId;
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** SDRs may only mutate leads they own (plan §8.2). */
export function assertLeadOwnership(req: FastifyRequest, ownerUserId: string | null) {
  const a = authOf(req);
  if (requiresOwnership(a.role) && ownerUserId !== a.userId) {
    throw forbidden('You can only act on leads assigned to you — claim the lead first');
  }
}

export function setAuthCookies(app: FastifyInstance, reply: FastifyReply, access: string, refresh: string, refreshExpires: Date) {
  const c = app.config;
  const base = { httpOnly: true, secure: c.COOKIE_SECURE, sameSite: 'lax' as const, domain: c.COOKIE_DOMAIN };
  reply.setCookie(ACCESS_COOKIE, access, { ...base, path: '/' });
  reply.setCookie(REFRESH_COOKIE, refresh, { ...base, path: '/api/v1/auth', expires: refreshExpires });
}

export function clearAuthCookies(app: FastifyInstance, reply: FastifyReply) {
  const c = app.config;
  reply.clearCookie(ACCESS_COOKIE, { path: '/', domain: c.COOKIE_DOMAIN });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth', domain: c.COOKIE_DOMAIN });
}
