import { getConfig, getQueue, QUEUES, randomToken, sha256, type OutreachJob } from '@selloeasy/core';
import { and, eq, invitations, isNull, type DbOrTx } from '@selloeasy/db';
import type { OrgRole } from '@selloeasy/shared';

/**
 * Create an invitation: 32 random bytes, stored only as SHA-256, single use, INVITE_TTL_HOURS expiry
 * (plan §9.1). Pending invites for the same email+org are revoked (resend semantics).
 * The email is sent by the worker (outreach queue) so the request never blocks on SMTP.
 */
export async function createInvitation(
  db: DbOrTx,
  opts: { orgId: string; orgName: string; email: string; role: OrgRole; invitedBy: string; invitedByName: string | null },
) {
  const cfg = getConfig();
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.orgId, opts.orgId),
        eq(invitations.email, opts.email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  const token = randomToken(32);
  const [inv] = await db
    .insert(invitations)
    .values({
      orgId: opts.orgId,
      email: opts.email,
      role: opts.role,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + cfg.INVITE_TTL_HOURS * 3600_000),
      invitedBy: opts.invitedBy,
    })
    .returning();
  const link = `${cfg.WEB_URL}/accept-invite?token=${token}`;
  return { invitation: inv!, link };
}

export async function sendInviteEmail(opts: { to: string; orgName: string; role: string; link: string; invitedByName: string | null }) {
  await getQueue<OutreachJob>(QUEUES.outreach).add('mail.invite', { kind: 'mail.invite', ...opts });
}
