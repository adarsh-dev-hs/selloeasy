import {
  dataBatches,
  directoryCompanies,
  getDb,
  inArray,
  leadSignals,
  marketEvents,
  organizations,
  signalMatches,
  sql,
  type SQL,
} from '@selloeasy/db';
import type { DataBatchDto, DataEventListItem, Distribution, Provenance } from '@selloeasy/shared';

type EventRow = typeof marketEvents.$inferSelect;
type BatchRow = typeof dataBatches.$inferSelect;

/**
 * Helpers for the Super Admin data explorer (plan2 §8–9). Everything here reads GLOBAL data-source tables;
 * the only tenant-derived output is the aggregate distribution (org name + counts, plan2 §8.4).
 */

/** Exact count when filtered; `pg_class.reltuples` estimate for big unfiltered tables (plan2 §9, ADR-0018). */
export async function countWithEstimate(
  table: string,
  filtered: boolean,
  exact: () => Promise<number>,
): Promise<{ total: number; estimate: boolean }> {
  if (!filtered) {
    const res = await getDb().execute(
      sql`select reltuples::bigint as n from pg_class where relname = ${table}`,
    );
    const n = Number((res.rows[0] as { n?: string | number } | undefined)?.n ?? 0);
    if (n > 50_000) return { total: n, estimate: true };
  }
  return { total: await exact(), estimate: false };
}

export function provenanceOf(
  sourceType: EventRow['sourceType'],
  batch: Pick<BatchRow, 'id' | 'label' | 'kind'> | null,
): Provenance {
  return { sourceType, batch: batch ? { id: batch.id, label: batch.label, kind: batch.kind } : null };
}

/** How many orgs matched each event (aggregate only). */
export async function orgsMatchedByEvent(eventIds: string[]): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ eventId: signalMatches.eventId, n: sql<number>`count(distinct ${signalMatches.orgId})::int` })
    .from(signalMatches)
    .where(inArray(signalMatches.eventId, eventIds))
    .groupBy(signalMatches.eventId);
  return new Map(rows.map((r) => [r.eventId, r.n]));
}

/** Distribution of a set of events to orgs: org name + match/lead counts only (never lead records). */
export async function distributionFor(eventFilter: SQL): Promise<Distribution> {
  const rows = await getDb()
    .select({
      orgId: signalMatches.orgId,
      orgName: organizations.name,
      matches: sql<number>`count(distinct ${signalMatches.id})::int`,
      leads: sql<number>`count(distinct ${leadSignals.leadId})::int`,
    })
    .from(signalMatches)
    .innerJoin(marketEvents, sql`${marketEvents.id} = ${signalMatches.eventId}`)
    .innerJoin(organizations, sql`${organizations.id} = ${signalMatches.orgId}`)
    .leftJoin(leadSignals, sql`${leadSignals.signalMatchId} = ${signalMatches.id}`)
    .where(eventFilter)
    .groupBy(signalMatches.orgId, organizations.name)
    .orderBy(sql`3 desc`);
  return {
    orgsMatched: rows.length,
    matches: rows.reduce((a, r) => a + r.matches, 0),
    leads: rows.reduce((a, r) => a + r.leads, 0),
    byOrg: rows,
  };
}

export function toEventListItem(
  e: EventRow,
  batch: Pick<BatchRow, 'id' | 'label' | 'kind'> | null,
  orgsMatched: number,
): DataEventListItem {
  const subject = e.companies.find((c) => c.role === 'subject') ?? e.companies[0] ?? null;
  return {
    id: e.id,
    externalId: e.externalId,
    publishedAt: e.publishedAt.toISOString(),
    title: e.title,
    // plan2 §9: list endpoints never return full bodies.
    snippet: e.body.length > 200 ? `${e.body.slice(0, 197)}…` : e.body,
    source: e.source,
    sourceUrl: e.url,
    industryTags: e.industryTags,
    subjectCompany: subject ? { name: subject.name, domain: subject.domain ?? null } : null,
    amount: e.amount,
    currency: e.currency,
    region: e.region,
    retractedAt: e.retractedAt?.toISOString() ?? null,
    orgsMatched,
    ...provenanceOf(e.sourceType, batch),
  };
}

/** Template-v1 view of a stored event (+ its subject company from the directory). */
export async function eventAsRecord(e: EventRow): Promise<Record<string, unknown>> {
  const subject = e.companies.find((c) => c.role === 'subject') ?? e.companies[0];
  const [company] = subject?.domain
    ? await getDb()
        .select()
        .from(directoryCompanies)
        .where(sql`${directoryCompanies.domain} = ${subject.domain}`)
        .limit(1)
    : [];
  return {
    external_id: e.externalId,
    source: e.source,
    source_url: e.url,
    title: e.title,
    body: e.body,
    published_at: e.publishedAt.toISOString(),
    industry_tags: e.industryTags,
    region: e.region,
    country: e.country,
    amount: e.amount,
    currency: e.currency,
    subject_company_name: subject?.name ?? null,
    subject_company_domain: subject?.domain ?? null,
    subject_company_industry: company?.industry ?? null,
    subject_company_country: company?.hqCountry ?? null,
    subject_company_size_band: company?.sizeBand ?? null,
    subject_company_employees: company?.employees ?? null,
    mentioned_companies: e.companies.filter((c) => c.role === 'mentioned').map((c) => c.name),
  };
}

export function toBatchDto(b: BatchRow, maxInvalidRatio: number): DataBatchDto {
  const s = b.stats;
  return {
    id: b.id,
    kind: b.kind,
    status: b.status,
    label: b.label,
    fileName: b.fileName,
    format: b.format,
    fileIssues: b.fileIssues,
    stats: s,
    fanOut: b.fanOut,
    error: b.error,
    createdBy: b.createdBy,
    committedBy: b.committedBy,
    createdAt: b.createdAt.toISOString(),
    validatedAt: b.validatedAt?.toISOString() ?? null,
    committedAt: b.committedAt?.toISOString() ?? null,
    rolledBackAt: b.rolledBackAt?.toISOString() ?? null,
    committable:
      b.status === 'VALIDATED' &&
      s.valid + s.warnings > 0 &&
      (s.rows === 0 || s.invalid / s.rows <= maxInvalidRatio),
    maxInvalidRatio,
  };
}

export async function batchesById(
  ids: (string | null)[],
): Promise<Map<string, Pick<BatchRow, 'id' | 'label' | 'kind'>>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await getDb()
    .select({ id: dataBatches.id, label: dataBatches.label, kind: dataBatches.kind })
    .from(dataBatches)
    .where(inArray(dataBatches.id, uniq));
  return new Map(rows.map((r) => [r.id, r]));
}

