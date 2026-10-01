import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '@selloeasy/core';
import { and, eq, getDb, isNull, refreshTokens } from '@selloeasy/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { setAuthCookies } from '../plugins/auth';

/** Parse "15m" / "7d" / "3600s" / "12h" into milliseconds. */
export function durationMs(input: string): number {
  const m = input.trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) throw new Error(`Invalid duration: ${input}`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1000);
}

/**
 * Issue a new session: short-lived access JWT + opaque refresh token (stored hashed) in a token family.
 * Refresh tokens rotate on every use; reusing a rotated token revokes the whole family (plan §24).
 */
export async function issueSession(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  familyId: string = randomUUID(),
) {
  const refresh = randomToken(32);
  const expiresAt = new Date(Date.now() + durationMs(app.config.REFRESH_TOKEN_TTL));
  const [row] = await getDb()
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: sha256(refresh),
      familyId,
      expiresAt,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: req.ip,
    })
    .returning({ id: refreshTokens.id });
  const access = app.jwt.sign({ sub: userId });
  setAuthCookies(app, reply, access, refresh, expiresAt);
  return { refreshTokenId: row!.id };
}

export async function revokeFamily(familyId: string) {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(userId: string) {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
