import { createHash } from 'node:crypto';
import { getConfig, getStorage } from '@selloeasy/core';
import { MARKET_TAGS } from '@selloeasy/dataset';
import {
  and,
  desc,
  eq,
  getDb,
  icps,
  organizations,
  orgProfiles,
  orgSourceChunks,
  orgSources,
  policies,
  products,
  sql,
  type DbOrTx,
} from '@selloeasy/db';
import { icpSuggestPrompt, profileGeneratePrompt, type IcpSuggestOutput, type LlmClient } from '@selloeasy/llm';
import type { OrgProfileContent } from '@selloeasy/shared';
import { crawlSite } from './crawl';
import { chunkText, estimateTokens, extractText } from './extract';

export * from './crawl';
export * from './extract';

/** Replace a source's chunks with freshly chunked text. */
export async function storeChunks(db: DbOrTx, orgId: string, sourceId: string, text: string): Promise<number> {
  const chunks = chunkText(text);
  await db.delete(orgSourceChunks).where(eq(orgSourceChunks.sourceId, sourceId));
  if (chunks.length) {
    await db.insert(orgSourceChunks).values(
      chunks.map((content, ordinal) => ({ orgId, sourceId, ordinal, content, tokenCount: estimateTokens(content) })),
    );
  }
  return chunks.length;
}

/**
 * Worker job `source.process`: fetch/parse a source, chunk it, index it for FTS.
 * Status transitions: PENDING → PROCESSING → READY | FAILED (shown live in the onboarding wizard).
 */
export async function processSource(sourceId: string): Promise<{ chunks: number }> {
  const db = getDb();
  const [src] = await db.select().from(orgSources).where(eq(orgSources.id, sourceId));
  if (!src) throw new Error(`Source ${sourceId} not found`);
  await db.update(orgSources).set({ status: 'PROCESSING', error: null }).where(eq(orgSources.id, sourceId));
  try {
    let text = '';
    let bytes: number | null = src.bytes;
    if (src.type === 'WEBSITE') {
      const c = getConfig();
      const pages = await crawlSite(src.url!, { maxPages: c.CRAWL_MAX_PAGES, maxDepth: c.CRAWL_MAX_DEPTH });
      if (pages.length === 0) throw new Error('No readable pages found (site unreachable, blocked by robots.txt, or not HTML)');
      text = pages.map((p) => `# ${p.title}\n(${p.url})\n\n${p.text}`).join('\n\n');
      bytes = Buffer.byteLength(text);
    } else if (src.s3Key) {
      const buf = await getStorage().getObject(src.s3Key);
      bytes = buf.byteLength;
      if (bytes > getConfig().UPLOAD_MAX_MB * 1024 * 1024) throw new Error('File exceeds upload size limit');
      text = await extractText(buf, src.contentType ?? 'application/octet-stream');
    } else {
      throw new Error('Source has no content');
    }
    if (text.trim().length < 20) throw new Error('No extractable text found in document');
    const checksum = createHash('sha256').update(text).digest('hex');
    const chunks = await db.transaction(async (tx) => {
      const n = await storeChunks(tx, src.orgId, src.id, text);
      await tx.update(orgSources).set({ status: 'READY', bytes, checksum, error: null }).where(eq(orgSources.id, src.id));
      return n;
    });
    return { chunks };
  } catch (err) {
    await db
      .update(orgSources)
      .set({ status: 'FAILED', error: (err as Error).message.slice(0, 500) })
      .where(eq(orgSources.id, sourceId));
    throw err;
  }
}

/**
 * Retrieval over org knowledge (ADR-0004: Postgres FTS instead of vectors).
 * With a query: ts_rank_cd over websearch_to_tsquery. Without: first chunks of each source.
 */
export async function retrieve(orgId: string, query: string | null, limit = 12): Promise<{ title: string; text: string }[]> {
  const db = getDb();
  if (query?.trim()) {
    const rows = await db
      .select({ title: orgSources.title, content: orgSourceChunks.content })
      .from(orgSourceChunks)
      .innerJoin(orgSources, eq(orgSources.id, orgSourceChunks.sourceId))
      .where(
        and(
          eq(orgSourceChunks.orgId, orgId),
          sql`${orgSourceChunks.tsv} @@ websearch_to_tsquery('english', ${query})`,
        ),
      )
      .orderBy(desc(sql`ts_rank_cd(${orgSourceChunks.tsv}, websearch_to_tsquery('english', ${query}))`))
      .limit(limit);
    if (rows.length) return rows.map((r) => ({ title: r.title, text: r.content }));
  }
  const rows = await db
    .select({ title: orgSources.title, content: orgSourceChunks.content, ordinal: orgSourceChunks.ordinal })
    .from(orgSourceChunks)
    .innerJoin(orgSources, eq(orgSources.id, orgSourceChunks.sourceId))
    .where(and(eq(orgSourceChunks.orgId, orgId), eq(orgSources.status, 'READY')))
    .orderBy(orgSourceChunks.ordinal)
    .limit(limit);
  return rows.map((r) => ({ title: r.title, text: r.content }));
}

async function loadOrgKnowledge(orgId: string) {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new Error(`Org ${orgId} not found`);
  const [prods, pols] = await Promise.all([
    db.select().from(products).where(eq(products.orgId, orgId)),
    db.select().from(policies).where(eq(policies.orgId, orgId)),
  ]);
  return { org, prods, pols };
}

/** Worker job `profile.generate`: map the org's materials into a structured knowledge profile. */
export async function generateProfile(llm: LlmClient, orgId: string): Promise<OrgProfileContent> {
  const db = getDb();
  const { org, prods, pols } = await loadOrgKnowledge(orgId);
  const documents = await retrieve(orgId, null, 14);
  const { data, meta } = await llm.run(
    profileGeneratePrompt,
    {
      org: {
        name: org.name,
        industry: org.industry,
        websiteUrl: org.websiteUrl,
        description: org.description,
        hq: org.hq,
        regions: org.regions,
      },
      products: prods.map((p) => ({ name: p.name, category: p.category, description: p.description, targetSegments: p.targetSegments })),
      policies: pols.map((p) => ({ title: p.title, body: p.body })),
      documents,
      marketTags: MARKET_TAGS,
    },
    { orgId },
  );
  const values = {
    summary: data.summary,
    valueProps: data.valueProps,
    differentiators: data.differentiators,
    targetIndustries: data.targetIndustries,
    geographies: data.geographies,
    personas: data.personas,
    generatedByModel: meta.model,
  };
  await db
    .insert(orgProfiles)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: orgProfiles.orgId, set: { ...values, version: sql`${orgProfiles.version} + 1` } });
  return data;
}

/** AI-suggested ICPs (plan §10.1) — returned as proposals; the admin accepts/edits them. */
export async function suggestIcps(llm: LlmClient, orgId: string): Promise<IcpSuggestOutput> {
  const db = getDb();
  const { org, prods } = await loadOrgKnowledge(orgId);
  const [profile] = await db.select().from(orgProfiles).where(eq(orgProfiles.orgId, orgId));
  if (!profile) throw new Error('Generate the org profile before suggesting ICPs');
  const existing = await db.select({ name: icps.name }).from(icps).where(eq(icps.orgId, orgId));
  const { data } = await llm.run(
    icpSuggestPrompt,
    {
      org: { name: org.name, industry: org.industry },
      profile: {
        summary: profile.summary,
        valueProps: profile.valueProps,
        differentiators: profile.differentiators,
        targetIndustries: profile.targetIndustries,
        geographies: profile.geographies,
        personas: profile.personas,
      },
      products: prods.map((p) => ({ name: p.name, description: p.description, targetSegments: p.targetSegments })),
      marketTags: MARKET_TAGS,
    },
    { orgId },
  );
  const names = new Set(existing.map((e) => e.name.toLowerCase()));
  return { icps: data.icps.filter((i) => !names.has(i.name.toLowerCase())) };
}
