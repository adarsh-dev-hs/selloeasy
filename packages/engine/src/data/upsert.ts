import {
  and,
  directoryCompanies,
  directoryContacts,
  eq,
  isNull,
  marketEvents,
  or,
  sql,
  type DbOrTx,
} from '@selloeasy/db';
import { contentHashOf, recordHash } from '@selloeasy/pipeline';
import type { DataSourceType, MarketEventRecord } from '@selloeasy/shared';

export interface UpsertMeta {
  batchId: string;
  sourceType: DataSourceType;
  userId: string | null;
}

export interface UpsertStats {
  inserted: number;
  duplicates: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
}

export const emptyUpsertStats = (): UpsertStats => ({
  inserted: 0,
  duplicates: 0,
  companiesCreated: 0,
  companiesUpdated: 0,
  contactsCreated: 0,
});

/**
 * Upsert one validated template-v1 record (plan2 §7.3):
 * - company matched on domain; missing attributes filled, existing non-empty values never overwritten;
 * - contact matched on (company, email) or (company, phone), inserted when new;
 * - event inserted (duplicates were excluded by validation; unique indexes are the final guard).
 * Returns the new event id, or null when the event already existed (race / concurrent import).
 */
export async function upsertRecord(
  tx: DbOrTx,
  r: MarketEventRecord,
  meta: UpsertMeta,
  stats: UpsertStats,
): Promise<string | null> {
  // 1) Company
  const [existing] = await tx
    .select()
    .from(directoryCompanies)
    .where(eq(directoryCompanies.domain, r.subject_company_domain))
    .limit(1);
  let companyId: string;
  if (existing) {
    companyId = existing.id;
    const fill: Partial<typeof directoryCompanies.$inferInsert> = {};
    if (!existing.industry && r.subject_company_industry) fill.industry = r.subject_company_industry;
    if (!existing.hqCountry && r.subject_company_country) fill.hqCountry = r.subject_company_country;
    if (!existing.sizeBand && r.subject_company_size_band) fill.sizeBand = r.subject_company_size_band;
    if (!existing.employees && r.subject_company_employees) fill.employees = r.subject_company_employees;
    if (existing.retractedAt) fill.retractedAt = null;
    if (Object.keys(fill).length) {
      await tx
        .update(directoryCompanies)
        .set({ ...fill, updatedByBatchId: meta.batchId })
        .where(eq(directoryCompanies.id, existing.id));
      stats.companiesUpdated++;
    }
  } else {
    const [created] = await tx
      .insert(directoryCompanies)
      .values({
        key: `dom:${r.subject_company_domain}`,
        name: r.subject_company_name,
        domain: r.subject_company_domain,
        industry: r.subject_company_industry ?? r.industry_tags[0] ?? null,
        hqCountry: r.subject_company_country ?? r.country ?? null,
        sizeBand: r.subject_company_size_band ?? null,
        employees: r.subject_company_employees ?? null,
        synthetic: r.subject_company_domain.endsWith('.example'),
        sourceType: meta.sourceType,
        batchId: meta.batchId,
      })
      .onConflictDoNothing()
      .returning({ id: directoryCompanies.id });
    if (created) {
      companyId = created.id;
      stats.companiesCreated++;
    } else {
      const [again] = await tx
        .select({ id: directoryCompanies.id })
        .from(directoryCompanies)
        .where(eq(directoryCompanies.domain, r.subject_company_domain));
      companyId = again!.id;
    }
  }

  // 2) Contact
  if (r.contact_name) {
    const match = [
      r.contact_email ? eq(directoryContacts.email, r.contact_email) : undefined,
      r.contact_phone ? eq(directoryContacts.phone, r.contact_phone) : undefined,
    ].filter(Boolean);
    const [contact] = match.length
      ? await tx
          .select({ id: directoryContacts.id })
          .from(directoryContacts)
          .where(and(eq(directoryContacts.companyId, companyId), or(...match)))
          .limit(1)
      : [];
    if (!contact) {
      await tx.insert(directoryContacts).values({
        companyId,
        name: r.contact_name,
        title: r.contact_title ?? null,
        email: r.contact_email ?? null,
        phone: r.contact_phone ?? null,
        whatsapp: r.contact_whatsapp ?? r.contact_phone ?? null,
        linkedinUrl: r.contact_linkedin_url ?? null,
        synthetic: r.subject_company_domain.endsWith('.example'),
        sourceType: meta.sourceType,
        batchId: meta.batchId,
      });
      stats.contactsCreated++;
    }
  }

  // 3) Event
  const [event] = await tx
    .insert(marketEvents)
    .values({
      externalId: r.external_id ?? null,
      source: r.source,
      url: r.source_url,
      title: r.title,
      body: r.body,
      publishedAt: new Date(r.published_at),
      industryTags: r.industry_tags,
      companies: [
        { name: r.subject_company_name, domain: r.subject_company_domain, role: 'subject' as const },
        ...(r.mentioned_companies ?? []).map((name) => ({ name, role: 'mentioned' as const })),
      ],
      region: r.region ?? null,
      country: r.country ?? null,
      amount: r.amount ?? null,
      currency: r.currency ?? null,
      synthetic: r.subject_company_domain.endsWith('.example'),
      hash: recordHash(r),
      contentHash: contentHashOf(r.title, r.body),
      sourceType: meta.sourceType,
      batchId: meta.batchId,
      schemaVersion: 1,
      ingestedBy: meta.userId,
    })
    .onConflictDoNothing()
    .returning({ id: marketEvents.id });
  if (!event) {
    stats.duplicates++;
    return null;
  }
  stats.inserted++;
  return event.id;
}

/** Existing (non-seed or seed) events matching the dedupe keys — used by validation (plan2 §7.2). */
export async function findExistingEvents(
  db: DbOrTx,
  keys: { sourceExternal: string | null; sourceUrl: string; contentHash: string }[],
): Promise<{
  bySourceExternal: Map<string, string>;
  byUrl: Map<string, string>;
  byHash: Map<string, string>;
}> {
  const bySourceExternal = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byHash = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const se = chunk.map((k) => k.sourceExternal).filter((k): k is string => !!k);
    const urls = chunk.map((k) => k.sourceUrl);
    const hashes = chunk.map((k) => k.contentHash);
    const inList = (vals: string[]) =>
      sql.join(
        vals.map((v) => sql`${v}`),
        sql`, `,
      );
    const conds = [
      se.length
        ? sql`lower(${marketEvents.source}) || '::' || lower(${marketEvents.externalId}) in (${inList(se)})`
        : undefined,
      sql`lower(rtrim(${marketEvents.url}, '/')) in (${inList(urls)})`,
      sql`${marketEvents.contentHash} in (${inList(hashes)})`,
    ].filter(Boolean);
    const rows = await db
      .select({
        id: marketEvents.id,
        se: sql<string | null>`lower(${marketEvents.source}) || '::' || lower(${marketEvents.externalId})`,
        url: sql<string | null>`lower(rtrim(${marketEvents.url}, '/'))`,
        hash: marketEvents.contentHash,
      })
      .from(marketEvents)
      .where(or(...conds));
    for (const r of rows) {
      if (r.se) bySourceExternal.set(r.se, r.id);
      if (r.url) byUrl.set(r.url, r.id);
      if (r.hash) byHash.set(r.hash, r.id);
    }
  }
  return { bySourceExternal, byUrl, byHash };
}

/** Directory names by domain — used to warn on "same domain, different name" (plan2 §7.2 consistency). */
export async function directoryNamesByDomain(db: DbOrTx, domains: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(domains)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = await db
      .select({ domain: directoryCompanies.domain, name: directoryCompanies.name })
      .from(directoryCompanies)
      .where(
        and(
          sql`${directoryCompanies.domain} in (${sql.join(
            chunk.map((d) => sql`${d}`),
            sql`, `,
          )})`,
          isNull(directoryCompanies.retractedAt),
        ),
      );
    for (const r of rows) if (r.domain) out.set(r.domain, r.name);
  }
  return out;
}
