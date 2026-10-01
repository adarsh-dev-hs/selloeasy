import { getDb } from '@selloeasy/db';
import { writeAudit } from '@selloeasy/engine';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Routes whose audit is handled explicitly or that are not user actions. */
const SKIP_SAFETY_NET = [/^\/api\/v1\/auth\/refresh/, /\/outreach\/draft$/, /\/icps\/suggest$/, /\/upload-url$/];

/**
 * Audit trail plumbing (plan §15):
 * - `req.audit(...)` for explicit domain events (pass the transaction of the change).
 * - `onResponse` safety net records any successful mutation that didn't record an explicit entry.
 */
export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auditRecorded', false);
  app.decorateRequest('audit', async function (this: import('fastify').FastifyRequest) {
    // replaced per request below
  });

  app.addHook('onRequest', async (req) => {
    req.auditRecorded = false;
    req.audit = async (entry, db) => {
      const a = req.auth;
      await writeAudit(db ?? getDb(), {
        scope: entry.scope ?? (a?.isSuperAdmin ? 'PLATFORM' : 'ORG'),
        orgId: entry.orgId !== undefined ? entry.orgId : (a?.orgId ?? null),
        actorUserId: a?.userId ?? null,
        actorRole: a?.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        requestId: req.id,
      });
      req.auditRecorded = true;
    };
  });

  app.addHook('onResponse', async (req, reply) => {
    if (!MUTATING.has(req.method) || req.auditRecorded) return;
    if (reply.statusCode >= 400) return;
    const path = req.routeOptions.url ?? req.url;
    if (SKIP_SAFETY_NET.some((r) => r.test(path))) return;
    try {
      await req.audit({ action: 'http.mutation', entityType: 'route', entityId: `${req.method} ${path}` });
    } catch (err) {
      req.log.error({ err }, 'Audit safety-net write failed');
    }
  });
});
