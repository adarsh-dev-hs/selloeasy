import { getQueue, QUEUES, type OutreachJob } from '@selloeasy/core';
import {
  accounts,
  activities,
  and,
  contacts,
  desc,
  eq,
  getDb,
  isNull,
  leads,
  organizations,
  orgProfiles,
  outreachMessages,
  policies,
  products,
  users,
  type Tx,
} from '@selloeasy/db';
import { loadLeadEvidence } from '@selloeasy/engine';
import { callScriptPrompt, emailDraftPrompt, whatsappDraftPrompt, type OutreachInput } from '@selloeasy/llm';
import {
  idParamSchema,
  LEAD_STAGES,
  outreachDraftSchema,
  outreachLogSchema,
  outreachSendSchema,
  ROLE_LABELS,
  type ActivityType,
  type LeadStage,
  type OutreachDraft,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, forbidden, serviceUnavailable } from '../lib/errors';
import { loadLead } from '../lib/leads';
import { authOf, requireOrg } from '../plugins/auth';
import type { AuthContext } from '../types';

type LeadRow = typeof leads.$inferSelect;

/**
 * SDRs act only on leads they own. Contacting an *unassigned* lead auto-claims it (race-safe),
 * which matches how SDR teams work in practice; a lead owned by someone else is off-limits.
 */
async function ensureCanAct(tx: Tx, auth: AuthContext, lead: LeadRow, audit: (e: Parameters<import('fastify').FastifyRequest['audit']>[0], db: Tx) => Promise<void>) {
  if (auth.role !== 'SDR') return;
  if (lead.ownerUserId === auth.userId) return;
  if (lead.ownerUserId) throw forbidden('This lead is owned by another teammate');
  const [row] = await tx.update(leads).set({ ownerUserId: auth.userId }).where(and(eq(leads.id, lead.id), isNull(leads.ownerUserId))).returning({ id: leads.id });
  if (!row) throw forbidden('This lead was just claimed by another teammate');
  await tx.insert(activities).values({ orgId: lead.orgId, leadId: lead.id, actorUserId: auth.userId, type: 'ASSIGNMENT', subject: `Claimed by ${auth.name}` });
  await audit({ action: 'lead.claimed', entityType: 'lead', entityId: lead.id, after: { ownerUserId: auth.userId, via: 'outreach' } }, tx);
}

const stageIdx = (s: LeadStage) => LEAD_STAGES.indexOf(s);

/** Outbound touches advance NEW → CONTACTED; a booked meeting advances to MEETING_SCHEDULED (plan §13.1). */
async function recordTouch(
  tx: Tx,
  opts: { lead: LeadRow; auth: AuthContext; type: ActivityType; subject?: string | null; body?: string | null; metadata?: Record<string, unknown>; targetStage?: LeadStage },
) {
  const now = new Date();
  await tx.insert(activities).values({
    orgId: opts.lead.orgId,
    leadId: opts.lead.id,
    actorUserId: opts.auth.userId,
    type: opts.type,
    direction: 'OUTBOUND',
    subject: opts.subject ?? null,
    body: opts.body ?? null,
    metadata: opts.metadata ?? {},
    occurredAt: now,
  });
  const target = opts.targetStage ?? 'CONTACTED';
  const advance = opts.lead.stage !== 'LOST' && opts.lead.stage !== 'WON' && stageIdx(opts.lead.stage) < stageIdx(target);
  await tx
    .update(leads)
    .set({
      lastActivityAt: now,
      firstTouchAt: opts.lead.firstTouchAt ?? now,
      ...(advance ? { stage: target, stageChangedAt: now } : {}),
    })
    .where(eq(leads.id, opts.lead.id));
  if (advance) {
    await tx.insert(activities).values({ orgId: opts.lead.orgId, leadId: opts.lead.id, actorUserId: opts.auth.userId, type: 'STAGE_CHANGE', subject: `${opts.lead.stage} → ${target}`, metadata: { from: opts.lead.stage, to: target, auto: true }, occurredAt: now });
  }
  return advance ? target : opts.lead.stage;
}

async function outreachContext(auth: AuthContext, leadId: string, contactId: string | undefined, tone: OutreachInput['tone']): Promise<{ input: OutreachInput; contact: typeof contacts.$inferSelect | null }> {
  const db = getDb();
  const { lead, account, evidence, contacts: cs } = await loadLeadEvidence(leadId);
  const contact = (contactId ? cs.find((c) => c.id === contactId) : cs.find((c) => c.id === lead.primaryContactId)) ?? cs[0] ?? null;
  if (contactId && !contact) throw badRequest('Contact does not belong to this lead');
  const [org] = await db.select().from(organizations).where(eq(organizations.id, auth.orgId!));
  const [profile] = await db.select().from(orgProfiles).where(eq(orgProfiles.orgId, auth.orgId!));
  const prods = await db.select().from(products).where(eq(products.orgId, auth.orgId!)).limit(8);
  const pols = await db.select({ title: policies.title }).from(policies).where(eq(policies.orgId, auth.orgId!)).limit(5);
  const [me] = await db.select().from(users).where(eq(users.id, auth.userId));
  const personaPains = profile?.personas.find((p) => contact?.title && contact.title.toLowerCase().includes(p.title.toLowerCase().split(' ').pop() ?? '###'))?.painPoints ?? profile?.personas[0]?.painPoints ?? [];
  return {
    contact,
    input: {
      tone,
      sender: { name: me!.name, title: ROLE_LABELS[auth.role], orgName: org!.settings.senderName ?? org!.name, calendlyUrl: me!.calendlyUrl ?? org!.settings.calendlyUrl ?? null },
      org: {
        summary: profile?.summary ?? org!.description ?? org!.name,
        valueProps: profile?.valueProps ?? [],
        products: prods.map((p) => ({ name: p.name, description: p.description })),
        policies: pols.map((p) => p.title),
      },
      lead: {
        accountName: account.name,
        contactName: contact?.name ?? null,
        contactTitle: contact?.title ?? null,
        evidence: evidence.slice(0, 3).map((e) => ({ signalName: e.signalName, title: e.event.title, summary: e.event.body.slice(0, 600), publishedAt: e.event.publishedAt.toISOString().slice(0, 10) })),
        painPoints: personaPains,
      },
    },
  };
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export const outreachRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ['outreach'];

  app.post(
    '/leads/:id/outreach/draft',
    { schema: { tags, summary: 'AI-draft an email, WhatsApp message or call script', params: idParamSchema, body: outreachDraftSchema.extend({ regenerate: z.boolean().optional() }) },
      preHandler: requireOrg('outreach:send'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const a = authOf(req);
      const lead = await loadLead(a, req.params.id);
      const { input, contact } = await outreachContext(a, lead.id, req.body.contactId, req.body.tone);
      const ctx = { orgId: a.orgId, noCache: !!req.body.regenerate };
      try {
        let draft: OutreachDraft;
        if (req.body.channel === 'email') {
          const r = await app.llm.run(emailDraftPrompt, input, ctx);
          draft = { channel: 'email', subject: r.data.subject, body: r.data.body, model: r.meta.model };
        } else if (req.body.channel === 'whatsapp') {
          const r = await app.llm.run(whatsappDraftPrompt, input, ctx);
          draft = { channel: 'whatsapp', body: r.data.body, model: r.meta.model };
        } else {
          const r = await app.llm.run(callScriptPrompt, input, ctx);
          draft = { channel: 'call', body: r.data.body, talkingPoints: r.data.talkingPoints, objections: r.data.objections, model: r.meta.model };
        }
        const links = {
          whatsapp: contact?.whatsapp ? `https://wa.me/${digits(contact.whatsapp)}?text=${encodeURIComponent(draft.body)}` : null,
          tel: contact?.phone ? `tel:${contact.phone.replace(/[^\d+]/g, '')}` : null,
          calendly: input.sender.calendlyUrl
            ? `${input.sender.calendlyUrl}${input.sender.calendlyUrl.includes('?') ? '&' : '?'}name=${encodeURIComponent(contact?.name ?? '')}&email=${encodeURIComponent(contact?.email ?? '')}`
            : null,
        };
        return { ...draft, contact: contact ? { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, whatsapp: contact.whatsapp } : null, links };
      } catch (e) {
        req.log.warn({ err: e }, 'Draft generation failed');
        throw serviceUnavailable(`Could not generate a draft right now: ${(e as Error).message}`);
      }
    },
  );

  app.post('/leads/:id/outreach/send', { schema: { tags, summary: 'Send an email (queued; logged as activity)', params: idParamSchema, body: outreachSendSchema }, preHandler: requireOrg('outreach:send') }, async (req, reply) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    const db = getDb();
    if (req.body.contactId) {
      const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, req.body.contactId), eq(contacts.accountId, lead.accountId)));
      if (!c) throw badRequest('Contact does not belong to this lead');
    }
    const result = await db.transaction(async (tx) => {
      await ensureCanAct(tx, a, lead, req.audit);
      const [msg] = await tx
        .insert(outreachMessages)
        .values({ orgId: lead.orgId, leadId: lead.id, contactId: req.body.contactId ?? null, channel: 'email', to: req.body.to, subject: req.body.subject, body: req.body.body, status: 'DRAFT', sentBy: a.userId })
        .returning();
      const stage = await recordTouch(tx, { lead, auth: a, type: 'EMAIL', subject: req.body.subject, body: req.body.body, metadata: { to: req.body.to, messageId: msg!.id, status: 'queued' } });
      await req.audit({ action: 'outreach.email_sent', entityType: 'lead', entityId: lead.id, after: { to: req.body.to, subject: req.body.subject, messageId: msg!.id } }, tx);
      return { messageId: msg!.id, stage };
    });
    await getQueue<OutreachJob>(QUEUES.outreach).add('outreach.send-email', { kind: 'outreach.send-email', orgId: lead.orgId, messageId: result.messageId });
    reply.code(202);
    return { ...result, status: 'QUEUED' };
  });

  app.post('/leads/:id/outreach/log', { schema: { tags, summary: 'Log a WhatsApp message, call or meeting', params: idParamSchema, body: outreachLogSchema }, preHandler: requireOrg('outreach:send') }, async (req, reply) => {
    const a = authOf(req);
    const lead = await loadLead(a, req.params.id);
    const b = req.body;
    const stage = await getDb().transaction(async (tx) => {
      await ensureCanAct(tx, a, lead, req.audit);
      let s: LeadStage;
      if (b.channel === 'whatsapp') {
        s = await recordTouch(tx, { lead, auth: a, type: 'WHATSAPP', body: b.body ?? b.notes ?? null, metadata: { contactId: b.contactId, notes: b.notes } });
      } else if (b.channel === 'call') {
        s = await recordTouch(tx, { lead, auth: a, type: 'CALL', subject: `Call — ${b.outcome.replace(/_/g, ' ').toLowerCase()}`, body: b.notes ?? null, metadata: { contactId: b.contactId, outcome: b.outcome, durationMin: b.durationMin } });
      } else {
        s = await recordTouch(tx, { lead, auth: a, type: 'MEETING', subject: 'Meeting scheduled', body: b.notes ?? null, metadata: { contactId: b.contactId, meetingAt: b.meetingAt, calendlyUrl: b.calendlyUrl }, targetStage: 'MEETING_SCHEDULED' });
      }
      await req.audit({ action: `outreach.${b.channel}_logged`, entityType: 'lead', entityId: lead.id, after: { ...b } }, tx);
      return s;
    });
    reply.code(201);
    return { stage };
  });

  app.get('/leads/:id/outreach', { schema: { tags, summary: 'Outreach messages for a lead', params: idParamSchema }, preHandler: requireOrg('leads:read') }, async (req) => {
    const lead = await loadLead(authOf(req), req.params.id);
    const rows = await getDb()
      .select({ m: outreachMessages, sentByName: users.name, accountName: accounts.name })
      .from(outreachMessages)
      .leftJoin(users, eq(users.id, outreachMessages.sentBy))
      .innerJoin(leads, eq(leads.id, outreachMessages.leadId))
      .innerJoin(accounts, eq(accounts.id, leads.accountId))
      .where(eq(outreachMessages.leadId, lead.id))
      .orderBy(desc(outreachMessages.createdAt));
    return rows.map(({ m, sentByName }) => ({
      id: m.id,
      channel: m.channel,
      to: m.to,
      subject: m.subject,
      body: m.body,
      status: m.status,
      error: m.error,
      sentBy: sentByName,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    }));
  });
};
