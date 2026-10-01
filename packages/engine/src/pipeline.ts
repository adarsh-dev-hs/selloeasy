import { createHash } from 'node:crypto';
import { getConfig } from '@selloeasy/core';
import {
  accounts,
  activities,
  and,
  contacts,
  directoryCompanies,
  directoryContacts,
  eq,
  getDb,
  gte,
  icps,
  ilike,
  inArray,
  isNull,
  leads,
  leadSignals,
  marketEvents,
  organizations,
  orgEventEvaluations,
  orgProfiles,
  pipelineRuns,
  products,
  signalMatches,
  signals,
  sql,
  type Tx,
} from '@selloeasy/db';
import { signalMatchPrompt, type LlmClient, type SignalMatchOutput } from '@selloeasy/llm';
import { acceptMatches, batch, dedupeKey, prefilter } from '@selloeasy/pipeline';
import type { PipelineProgressEvent, PipelineRunStats, PipelineStatus } from '@selloeasy/shared';
import { writeAudit } from './audit';
import { scoreLead, type ScoreBudget } from './scoring';

export interface RunPipelineOptions {
  llm: LlmClient;
  orgId: string;
  runId: string;
  now?: Date;
  onProgress?: (e: PipelineProgressEvent) => void | Promise<void>;
  /** Override PIPELINE_MAX_LLM_CALLS_PER_RUN (e.g. seed uses a larger budget in mock mode). */
  maxLlmCalls?: number;
  /**
   * Record evaluated events so re-runs skip them. The seed disables this so the first *live* run
   * re-evaluates the corpus with the real model and refines the mock-seeded leads.
   */
  recordEvaluations?: boolean;
}

type EventRow = typeof marketEvents.$inferSelect;
type MatchResult = SignalMatchOutput['results'][number];

const emptyStats = (): PipelineRunStats => ({
  eventsScanned: 0,
  prefiltered: 0,
  matched: 0,
  leadsCreated: 0,
  leadsUpdated: 0,
  llmCalls: 0,
  cacheHits: 0,
  costUsd: 0,
});

/** Resolve (or create) the tenant account for an event's buyer and copy directory contacts. */
async function resolveAccount(
  tx: Tx,
  orgId: string,
  event: EventRow,
  result: MatchResult,
): Promise<{ accountId: string; name: string; domain: string | null } | null> {
  const subject = event.companies.find((c) => c.role === 'subject') ?? event.companies[0];
  const name = subject?.name ?? result.account?.name;
  const domain = subject?.domain ?? result.account?.domain ?? null;
  if (!name) return null;

  // 1) Directory lookup (simulated enrichment provider).
  let dir: typeof directoryCompanies.$inferSelect | undefined;
  if (domain) [dir] = await tx.select().from(directoryCompanies).where(and(eq(directoryCompanies.domain, domain), isNull(directoryCompanies.retractedAt))).limit(1);
  if (!dir) [dir] = await tx.select().from(directoryCompanies).where(and(ilike(directoryCompanies.name, name), isNull(directoryCompanies.retractedAt))).limit(1);

  // 2) Existing tenant account?
  const existing = await tx
    .select({ id: accounts.id, name: accounts.name, domain: accounts.domain })
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        dir ? eq(accounts.directoryCompanyId, dir.id) : ilike(accounts.name, name),
      ),
    )
    .limit(1);
  if (existing[0]) return { accountId: existing[0].id, name: existing[0].name, domain: existing[0].domain };

  const [acc] = await tx
    .insert(accounts)
    .values({
      orgId,
      directoryCompanyId: dir?.id ?? null,
      name: dir?.name ?? name,
      domain: dir?.domain ?? domain,
      industry: dir?.industry ?? null,
      hqCountry: dir?.hqCountry ?? null,
      sizeBand: dir?.sizeBand ?? null,
      employees: dir?.employees ?? null,
      description: dir?.description ?? null,
    })
    .returning({ id: accounts.id, name: accounts.name, domain: accounts.domain });
  if (dir) {
    // ADR-0016: contacts retracted by a batch rollback are never copied into tenants.
    const dirContacts = await tx
      .select()
      .from(directoryContacts)
      .where(and(eq(directoryContacts.companyId, dir.id), isNull(directoryContacts.retractedAt)));
    if (dirContacts.length) {
      await tx.insert(contacts).values(
        dirContacts.map((c) => ({
          orgId,
          accountId: acc!.id,
          name: c.name,
          title: c.title,
          persona: c.persona,
          seniority: c.seniority,
          email: c.email,
          phone: c.phone,
          whatsapp: c.whatsapp,
          linkedinUrl: c.linkedinUrl,
          source: 'SYNTHETIC' as const,
        })),
      );
    }
  }
  return { accountId: acc!.id, name: acc!.name, domain: acc!.domain };
}

/**
 * Full pipeline run for one org (plan §11). Idempotent: matches are unique per (org, event, signal)
 * and evaluated events are skipped on re-runs for the same signal set.
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<{ status: PipelineStatus; stats: PipelineRunStats }> {
  const db = getDb();
  const cfg = getConfig();
  const now = opts.now ?? new Date();
  const maxCalls = opts.maxLlmCalls ?? cfg.PIPELINE_MAX_LLM_CALLS_PER_RUN;
  const stats = emptyStats();
  const { orgId, runId, llm } = opts;

  const progress = async (stage: string, pct: number, status: PipelineStatus = 'RUNNING', message?: string) => {
    await opts.onProgress?.({ runId, status, stage, progress: Math.round(pct), stats: { ...stats }, message });
  };
  const persistStats = () => db.update(pipelineRuns).set({ stats: { ...stats } }).where(eq(pipelineRuns.id, runId));

  await db.update(pipelineRuns).set({ status: 'RUNNING', startedAt: now, error: null }).where(eq(pipelineRuns.id, runId));
  await progress('loading', 2);

  try {
    // ── Load org context ───────────────────────────────────────────────────
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) throw new Error('Organization not found');
    const [profile] = await db.select().from(orgProfiles).where(eq(orgProfiles.orgId, orgId));
    const activeSignals = await db.select().from(signals).where(and(eq(signals.orgId, orgId), eq(signals.isActive, true)));
    if (activeSignals.length === 0) throw new Error('No active signals — add or enable signals before running the pipeline');
    const activeIcps = await db.select().from(icps).where(and(eq(icps.orgId, orgId), eq(icps.isActive, true)));
    const prods = await db.select({ name: products.name }).from(products).where(eq(products.orgId, orgId));

    const targetTags = [...(profile?.targetIndustries ?? []), ...activeIcps.flatMap((i) => i.criteria.industries)];
    const signalsHash = createHash('sha256')
      .update(
        activeSignals
          .map((s) => `${s.id}|${s.matchInstructions}|${s.keywords.join(',')}|${s.negativeKeywords.join(',')}`)
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 16);

    // ── Stage 1–3: load window + prefilter ─────────────────────────────────
    const cutoff = new Date(now.getTime() - cfg.PIPELINE_EVENT_WINDOW_DAYS * 86_400_000);
    // Retracted events (rolled-back batches, ADR-0016) are never matched.
    const events = await db.select().from(marketEvents).where(and(gte(marketEvents.publishedAt, cutoff), isNull(marketEvents.retractedAt)));
    stats.eventsScanned = events.length;
    const evaluated = await db
      .select({ eventId: orgEventEvaluations.eventId })
      .from(orgEventEvaluations)
      .where(and(eq(orgEventEvaluations.orgId, orgId), eq(orgEventEvaluations.signalsHash, signalsHash)));
    const pre = prefilter(events, {
      targetTags,
      signals: activeSignals,
      windowDays: cfg.PIPELINE_EVENT_WINDOW_DAYS,
      now,
      alreadyEvaluated: new Set(evaluated.map((e) => e.eventId)),
    });
    stats.prefiltered = pre.kept.length;
    await persistStats();
    await progress('prefilter', 10, 'RUNNING', `${pre.kept.length} of ${events.length} events passed the prefilter`);

    // ── Stage 4–7: LLM match → upsert → collect leads to score ─────────────
    const signalById = new Map(activeSignals.map((s) => [s.id, s]));
    const validIds = new Set(activeSignals.map((s) => s.id));
    const touchedLeads = new Set<string>();
    const batches = batch(pre.kept, cfg.PIPELINE_BATCH_SIZE);
    let budgetExhausted = false;
    const personas = profile?.personas.map((p) => p.title) ?? [];

    for (let bi = 0; bi < batches.length; bi++) {
      // Reserve roughly half the budget for scoring the leads we find.
      if (stats.llmCalls >= Math.ceil(maxCalls * 0.6)) {
        budgetExhausted = true;
        break;
      }
      const evs = batches[bi]!;
      const { data, meta } = await llm.run(
        signalMatchPrompt,
        {
          org: {
            name: org.name,
            summary: profile?.summary ?? org.description ?? org.name,
            products: prods.map((p) => p.name),
            personas,
            targetIndustries: [...new Set(targetTags)],
          },
          signals: activeSignals.map((s) => ({
            id: s.id,
            name: s.name,
            matchInstructions: s.matchInstructions,
            keywords: s.keywords,
            negativeKeywords: s.negativeKeywords,
          })),
          events: evs.map((e) => ({
            id: e.id,
            title: e.title,
            body: e.body,
            publishedAt: e.publishedAt.toISOString().slice(0, 10),
            companies: e.companies.map((c) => ({ name: c.name, role: c.role })),
            industryTags: e.industryTags,
            amount: e.amount,
            currency: e.currency,
          })),
        },
        { orgId },
      );
      if (meta.cached) stats.cacheHits++;
      else stats.llmCalls++;
      stats.costUsd += meta.costUsd;

      const byEvent = new Map(data.results.map((r) => [r.eventId, r]));
      for (const e of evs) {
        const r = byEvent.get(e.id);
        const accepted = r ? acceptMatches(r.matches, cfg.PIPELINE_MATCH_THRESHOLD, validIds) : [];
        await db.transaction(async (tx) => {
          if (opts.recordEvaluations !== false) {
            await tx
              .insert(orgEventEvaluations)
              .values({ orgId, eventId: e.id, signalsHash, runId, matched: accepted.length > 0 })
              .onConflictDoNothing();
          }
          if (!r || accepted.length === 0) return;
          stats.matched += accepted.length;

          const acc = await resolveAccount(tx, orgId, e, r);
          if (!acc) return;

          const insertedMatches = await tx
            .insert(signalMatches)
            .values(
              accepted.map((m) => ({
                orgId,
                runId,
                eventId: e.id,
                signalId: m.signalId,
                confidence: m.confidence,
                rationale: m.rationale,
                extracted: {
                  accountName: acc.name,
                  accountDomain: acc.domain ?? undefined,
                  personas: r.personas,
                  dealHints: {
                    amount: r.dealHints?.amount ?? undefined,
                    currency: r.dealHints?.currency ?? undefined,
                    timeline: r.dealHints?.timeline ?? undefined,
                  },
                },
              })),
            )
            .onConflictDoNothing()
            .returning({ id: signalMatches.id, signalId: signalMatches.signalId });
          if (insertedMatches.length === 0) return;

          const key = dedupeKey({ name: acc.name, domain: acc.domain });
          const [existing] = await tx
            .select({ id: leads.id, lastSignalAt: leads.lastSignalAt })
            .from(leads)
            .where(and(eq(leads.orgId, orgId), eq(leads.dedupeKey, key)));
          let leadId: string;
          if (existing) {
            leadId = existing.id;
            const later = !existing.lastSignalAt || e.publishedAt > existing.lastSignalAt;
            await tx
              .update(leads)
              .set({
                ...(later ? { lastSignalAt: e.publishedAt } : {}),
                suggestedPersonas: r.personas.length ? r.personas : undefined,
              })
              .where(eq(leads.id, leadId));
            stats.leadsUpdated++;
          } else {
            const [primary] = await tx
              .select({ id: contacts.id })
              .from(contacts)
              .where(and(eq(contacts.orgId, orgId), eq(contacts.accountId, acc.accountId)))
              .orderBy(contacts.createdAt)
              .limit(1);
            const empty = { score: 0, rationale: 'Pending scoring' };
            const [created] = await tx
              .insert(leads)
              .values({
                orgId,
                accountId: acc.accountId,
                primaryContactId: primary?.id ?? null,
                dedupeKey: key,
                stage: 'NEW',
                breakdown: { budget: empty, authority: empty, need: empty, timeline: empty, icpFit: empty, signalStrength: empty },
                firstSignalAt: e.publishedAt,
                lastSignalAt: e.publishedAt,
                stageChangedAt: now,
                suggestedPersonas: r.personas,
              })
              .returning({ id: leads.id });
            leadId = created!.id;
            stats.leadsCreated++;
          }
          await tx
            .insert(leadSignals)
            .values(insertedMatches.map((m) => ({ leadId, signalMatchId: m.id })))
            .onConflictDoNothing();
          await tx.insert(activities).values({
            orgId,
            leadId,
            type: 'SIGNAL',
            direction: 'INBOUND',
            subject: insertedMatches.map((m) => signalById.get(m.signalId)?.name).filter(Boolean).join(', '),
            body: e.title,
            metadata: { eventId: e.id, runId, url: e.url },
            occurredAt: e.publishedAt,
          });
          touchedLeads.add(leadId);
        });
      }
      await persistStats();
      await progress('matching', 10 + ((bi + 1) / batches.length) * 60, 'RUNNING', `Matched batch ${bi + 1}/${batches.length}`);
    }

    // ── Stage 7: score touched leads ────────────────────────────────────────
    const budget: ScoreBudget = { remaining: Math.max(0, maxCalls - stats.llmCalls) };
    const leadIds = [...touchedLeads];
    for (let i = 0; i < leadIds.length; i++) {
      const r = await scoreLead(llm, leadIds[i]!, { now, budget });
      if (r.usedLlm) {
        if (r.cached) stats.cacheHits++;
        else stats.llmCalls++;
        stats.costUsd += r.costUsd;
      } else if (r.heuristic) {
        budgetExhausted = true;
      }
      if (i % 5 === 4 || i === leadIds.length - 1) {
        await persistStats();
        await progress('scoring', 70 + ((i + 1) / leadIds.length) * 28, 'RUNNING', `Scored ${i + 1}/${leadIds.length} leads`);
      }
    }

    stats.costUsd = Math.round(stats.costUsd * 10000) / 10000;
    stats.budgetExhausted = budgetExhausted;
    const status: PipelineStatus = budgetExhausted ? 'PARTIAL' : 'COMPLETED';
    await db.transaction(async (tx) => {
      await tx.update(pipelineRuns).set({ status, stats: { ...stats }, finishedAt: new Date() }).where(eq(pipelineRuns.id, runId));
      await writeAudit(tx, {
        scope: 'ORG',
        orgId,
        action: 'pipeline.run_completed',
        entityType: 'pipeline_run',
        entityId: runId,
        after: { status, ...stats },
      });
    });
    await progress('done', 100, status, budgetExhausted ? 'LLM budget reached — remaining events will be processed next run' : 'Run complete');
    return { status, stats };
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    await db
      .update(pipelineRuns)
      .set({ status: 'FAILED', error: message, stats: { ...stats }, finishedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));
    await writeAudit(db, {
      scope: 'ORG',
      orgId,
      action: 'pipeline.run_failed',
      entityType: 'pipeline_run',
      entityId: runId,
      after: { error: message },
    }).catch(() => undefined);
    await progress('failed', 100, 'FAILED', message);
    throw err;
  }
}

/** Mark runs stuck in RUNNING (e.g. worker crash) as FAILED so a new run can start. */
export async function failStaleRuns(olderThanMinutes = 30): Promise<number> {
  const res = await getDb()
    .update(pipelineRuns)
    .set({ status: 'FAILED', error: 'Run timed out or worker restarted', finishedAt: new Date() })
    .where(
      and(
        inArray(pipelineRuns.status, ['RUNNING', 'QUEUED']),
        sql`${pipelineRuns.createdAt} < now() - (${olderThanMinutes} || ' minutes')::interval`,
      ),
    )
    .returning({ id: pipelineRuns.id });
  return res.length;
}
