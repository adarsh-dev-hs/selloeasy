import {
  accounts,
  and,
  asc,
  contacts,
  desc,
  eq,
  getDb,
  gte,
  ilike,
  inArray,
  isNull,
  leadSignals,
  leads,
  lte,
  marketEvents,
  organizations,
  signalMatches,
  signals,
  sql,
  users,
  type DbOrTx,
  type SQL,
} from '@selloeasy/db';
import type { LeadListItem, LeadListQuery } from '@selloeasy/shared';
import type { AuthContext } from '../types';
import { notFound } from './errors';

/**
 * Lead visibility (plan §8.4, ADR-0011) — enforced in ONE place for list, detail, export and "my stats".
 * `ALL` (v1 default): every org member can read every lead.
 * `ASSIGNED_ONLY`: SDRs only see leads they own.
 */
export async function visibilityFilter(auth: AuthContext): Promise<SQL | undefined> {
  if (auth.role !== 'SDR') return undefined;
  const [org] = await getDb().select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, auth.orgId!));
  if ((org?.settings.leadVisibility ?? 'ALL') === 'ASSIGNED_ONLY') return eq(leads.ownerUserId, auth.userId);
  return undefined;
}

export function leadFilters(orgId: string, q: Partial<LeadListQuery>, auth: AuthContext, visibility: SQL | undefined): SQL {
  const conds: (SQL | undefined)[] = [eq(leads.orgId, orgId), visibility];
  if (q.stage) conds.push(eq(leads.stage, q.stage));
  if (q.band) conds.push(eq(leads.scoreBand, q.band));
  if (q.icpId) conds.push(eq(leads.icpId, q.icpId));
  if (q.owner === 'me') conds.push(eq(leads.ownerUserId, auth.userId));
  else if (q.owner === 'unassigned') conds.push(isNull(leads.ownerUserId));
  else if (q.owner && q.owner !== 'any') conds.push(eq(leads.ownerUserId, q.owner));
  if (q.q) conds.push(ilike(accounts.name, `%${q.q.replace(/[%_]/g, '\\$&')}%`));
  if (q.from) conds.push(gte(leads.lastSignalAt, new Date(q.from)));
  if (q.to) conds.push(lte(leads.lastSignalAt, new Date(`${q.to}T23:59:59.999Z`)));
  if (q.signalId) {
    conds.push(
      sql`exists (select 1 from ${leadSignals} ls join ${signalMatches} sm on sm.id = ls.signal_match_id where ls.lead_id = ${leads.id} and sm.signal_id = ${q.signalId})`,
    );
  }
  return and(...conds)!;
}

export function leadOrder(sort: LeadListQuery['sort']) {
  switch (sort) {
    case 'recent':
      return [sql`${leads.lastSignalAt} desc nulls last`, desc(leads.id)];
    case 'oldest':
      return [asc(leads.firstSignalAt), asc(leads.id)];
    case 'account':
      return [asc(accounts.name), asc(leads.id)];
    default:
      // ADR-0005: stable ordering for offset pagination.
      return [desc(leads.scoreTotal), desc(leads.id)];
  }
}

/** Shape rows into LeadListItems with headline signal + signal counts (2 extra queries per page). */
export async function hydrateLeadItems(
  rows: {
    lead: typeof leads.$inferSelect;
    account: typeof accounts.$inferSelect;
    ownerName: string | null;
    contactName: string | null;
    contactTitle: string | null;
  }[],
): Promise<LeadListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.lead.id);
  const db = getDb();
  const headlines = await db
    .selectDistinctOn([leadSignals.leadId], {
      leadId: leadSignals.leadId,
      signalName: signals.name,
      eventTitle: marketEvents.title,
      publishedAt: marketEvents.publishedAt,
    })
    .from(leadSignals)
    .innerJoin(signalMatches, eq(signalMatches.id, leadSignals.signalMatchId))
    .innerJoin(signals, eq(signals.id, signalMatches.signalId))
    .innerJoin(marketEvents, eq(marketEvents.id, signalMatches.eventId))
    .where(inArray(leadSignals.leadId, ids))
    .orderBy(leadSignals.leadId, desc(marketEvents.publishedAt), desc(signalMatches.confidence));
  const counts = await db
    .select({ leadId: leadSignals.leadId, n: sql<number>`count(*)::int` })
    .from(leadSignals)
    .where(inArray(leadSignals.leadId, ids))
    .groupBy(leadSignals.leadId);
  const h = new Map(headlines.map((x) => [x.leadId, x]));
  const c = new Map(counts.map((x) => [x.leadId, x.n]));
  return rows.map(({ lead, account, ownerName, contactName, contactTitle }) => {
    const hl = h.get(lead.id);
    return {
      id: lead.id,
      account: { id: account.id, name: account.name, domain: account.domain, industry: account.industry, hqCountry: account.hqCountry },
      headlineSignal: hl ? { signalName: hl.signalName, eventTitle: hl.eventTitle, publishedAt: hl.publishedAt.toISOString() } : null,
      signalCount: c.get(lead.id) ?? 0,
      scoreTotal: lead.scoreTotal,
      scoreBand: lead.scoreBand,
      bant: {
        budget: lead.breakdown.budget.score,
        authority: lead.breakdown.authority.score,
        need: lead.breakdown.need.score,
        timeline: lead.breakdown.timeline.score,
      },
      stage: lead.stage,
      owner: lead.ownerUserId && ownerName ? { id: lead.ownerUserId, name: ownerName } : null,
      primaryContact: lead.primaryContactId && contactName ? { id: lead.primaryContactId, name: contactName, title: contactTitle } : null,
      lastSignalAt: lead.lastSignalAt?.toISOString() ?? null,
      lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
    };
  });
}

export function leadListSelect(db: DbOrTx) {
  return db
    .select({
      lead: leads,
      account: accounts,
      ownerName: users.name,
      contactName: contacts.name,
      contactTitle: contacts.title,
    })
    .from(leads)
    .innerJoin(accounts, eq(accounts.id, leads.accountId))
    .leftJoin(users, eq(users.id, leads.ownerUserId))
    .leftJoin(contacts, eq(contacts.id, leads.primaryContactId));
}

/** Load a lead in the caller's org that the caller may see; 404 otherwise (plan §8.1). */
export async function loadLead(auth: AuthContext, id: string) {
  const vis = await visibilityFilter(auth);
  const [row] = await getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.orgId, auth.orgId!), vis));
  if (!row) throw notFound('Lead');
  return row;
}
