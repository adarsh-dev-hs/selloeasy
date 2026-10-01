import { keywordHits } from '@selloeasy/llm';

/** Minimal event shape the pure stages need. */
export interface PipelineEvent {
  id: string;
  title: string;
  body: string;
  publishedAt: Date;
  industryTags: string[];
}

export interface PrefilterSignal {
  id: string;
  keywords: string[];
  negativeKeywords: string[];
}

export interface PrefilterContext {
  /** Org target industries + active ICP industries (controlled vocabulary). */
  targetTags: string[];
  signals: PrefilterSignal[];
  windowDays: number;
  now: Date;
  /** Event ids already matched/evaluated for this org — skipped (idempotent re-runs). */
  alreadyEvaluated?: Set<string>;
}

export interface PrefilterResult<E extends PipelineEvent> {
  kept: E[];
  reasons: Map<string, string>;
  dropped: { outOfWindow: number; noOverlap: number; alreadyEvaluated: number };
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Stage 3 — cheap, LLM-free prefilter (plan §11.1). An event is kept when it is inside the recency
 * window AND (it shares an industry tag with the org OR it contains ≥1 keyword of an active signal).
 * This removes the bulk of irrelevant events before any paid LLM call.
 */
export function prefilter<E extends PipelineEvent>(events: E[], ctx: PrefilterContext): PrefilterResult<E> {
  const tags = new Set(ctx.targetTags.map(norm));
  const cutoff = ctx.now.getTime() - ctx.windowDays * 86_400_000;
  const allKeywords = [...new Set(ctx.signals.flatMap((s) => s.keywords))];
  const kept: E[] = [];
  const reasons = new Map<string, string>();
  const dropped = { outOfWindow: 0, noOverlap: 0, alreadyEvaluated: 0 };

  for (const e of events) {
    if (ctx.alreadyEvaluated?.has(e.id)) {
      dropped.alreadyEvaluated++;
      continue;
    }
    if (e.publishedAt.getTime() < cutoff || e.publishedAt.getTime() > ctx.now.getTime() + 86_400_000) {
      dropped.outOfWindow++;
      continue;
    }
    const tagHit = e.industryTags.find((t) => tags.has(norm(t)));
    const kwHits = keywordHits(`${e.title}\n${e.body}`, allKeywords);
    if (!tagHit && kwHits.length === 0) {
      dropped.noOverlap++;
      continue;
    }
    // Tag overlap alone is weak: require at least one keyword so generic industry news is skipped.
    if (kwHits.length === 0) {
      dropped.noOverlap++;
      continue;
    }
    kept.push(e);
    reasons.set(e.id, tagHit ? `tag:${tagHit}; keywords:${kwHits.slice(0, 3).join(',')}` : `keywords:${kwHits.slice(0, 3).join(',')}`);
  }
  // Most recent first: when the LLM budget runs out, we've processed the freshest signals.
  kept.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return { kept, reasons, dropped };
}

export function batch<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Stage 6 — dedupe key: one lead per target account per org (normalised domain, else name). */
export function dedupeKey(account: { name: string; domain?: string | null }): string {
  if (account.domain) {
    return `d:${account.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')}`;
  }
  return `n:${account.name
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|inc|llc|corp|corporation|co|plc|gmbh)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()}`;
}

/** Filter matches below the configured confidence threshold (PIPELINE_MATCH_THRESHOLD). */
export function acceptMatches<M extends { confidence: number; signalId: string }>(
  matches: M[],
  threshold: number,
  validSignalIds: Set<string>,
): M[] {
  return matches.filter((m) => m.confidence >= threshold && validSignalIds.has(m.signalId));
}
