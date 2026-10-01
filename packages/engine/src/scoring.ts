import {
  accounts,
  activities,
  and,
  contacts,
  desc,
  eq,
  getDb,
  icps,
  leads,
  leadSignals,
  marketEvents,
  orgProfiles,
  products,
  signalMatches,
  signals,
} from '@selloeasy/db';
import { leadScorePrompt, type LlmClient, type LeadScoreInput, type LeadScoreOutput } from '@selloeasy/llm';
import {
  combineScore,
  recencyScore,
  scoreAuthority,
  scoreIcpFit,
  scoreSignalStrength,
} from '@selloeasy/pipeline';
import type { ScoreBreakdown } from '@selloeasy/shared';

export interface ScoreBudget {
  remaining: number;
}

export interface ScoreLeadResult {
  total: number;
  usedLlm: boolean;
  cached: boolean;
  heuristic: boolean;
  costUsd: number;
}

/** Load everything needed to explain & score one lead. */
export async function loadLeadEvidence(leadId: string) {
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, lead.accountId));
  const evidence = await db
    .select({
      matchId: signalMatches.id,
      confidence: signalMatches.confidence,
      rationale: signalMatches.rationale,
      signalId: signals.id,
      signalName: signals.name,
      weight: signals.weight,
      event: marketEvents,
    })
    .from(leadSignals)
    .innerJoin(signalMatches, eq(signalMatches.id, leadSignals.signalMatchId))
    .innerJoin(signals, eq(signals.id, signalMatches.signalId))
    .innerJoin(marketEvents, eq(marketEvents.id, signalMatches.eventId))
    .where(eq(leadSignals.leadId, leadId))
    .orderBy(desc(marketEvents.publishedAt));
  const accountContacts = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, lead.orgId), eq(contacts.accountId, lead.accountId)));
  return { lead, account: account!, evidence, contacts: accountContacts };
}

/**
 * Recompute a lead's BANT+ score (plan §12).
 * Deterministic: authority, ICP fit, signal strength, recency. LLM: budget, need, timeline —
 * falls back to the deterministic heuristic when the run's LLM budget is exhausted.
 */
export async function scoreLead(
  llm: LlmClient,
  leadId: string,
  opts: { now?: Date; budget?: ScoreBudget; actorUserId?: string | null } = {},
): Promise<ScoreLeadResult> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const { lead, account, evidence, contacts: accContacts } = await loadLeadEvidence(leadId);
  const [profile] = await db.select().from(orgProfiles).where(eq(orgProfiles.orgId, lead.orgId));
  const activeIcps = await db.select().from(icps).where(and(eq(icps.orgId, lead.orgId), eq(icps.isActive, true)));
  const prods = await db.select({ name: products.name }).from(products).where(eq(products.orgId, lead.orgId));

  const icpPersonas = activeIcps.flatMap((i) => i.criteria.personas);
  const authority = scoreAuthority(accContacts.map((c) => ({ name: c.name, title: c.title })), icpPersonas);
  const fit = scoreIcpFit(
    { industry: account.industry, hqCountry: account.hqCountry, employees: account.employees, description: account.description },
    activeIcps.map((i) => ({ id: i.id, name: i.name, criteria: i.criteria })),
  );
  const strength = scoreSignalStrength(
    evidence.map((e) => ({ weight: e.weight, confidence: e.confidence, publishedAt: e.event.publishedAt, signalName: e.signalName })),
    now,
  );
  const latest = evidence[0]?.event.publishedAt ?? null;

  const input: LeadScoreInput = {
    org: {
      name: 'the seller',
      summary: profile?.summary ?? '',
      products: prods.map((p) => p.name),
      targetIndustries: [...new Set([...(profile?.targetIndustries ?? []), ...activeIcps.flatMap((i) => i.criteria.industries)])],
    },
    account: {
      name: account.name,
      industry: account.industry,
      sizeBand: account.sizeBand,
      employees: account.employees,
      description: account.description,
    },
    evidence: evidence.slice(0, 5).map((e) => ({
      signalName: e.signalName,
      confidence: e.confidence,
      title: e.event.title,
      body: e.event.body,
      publishedAt: e.event.publishedAt.toISOString().slice(0, 10),
      amount: e.event.amount,
      currency: e.event.currency,
    })),
    contacts: accContacts.map((c) => ({ title: c.title })),
    now: now.toISOString().slice(0, 10),
  };

  let bnt: LeadScoreOutput;
  let usedLlm = false;
  let cached = false;
  let heuristic = false;
  let costUsd = 0;
  if (!opts.budget || opts.budget.remaining > 0) {
    const res = await llm.run(leadScorePrompt, input, { orgId: lead.orgId });
    bnt = res.data;
    usedLlm = true;
    cached = res.meta.cached;
    costUsd = res.meta.costUsd;
    if (opts.budget && !cached) opts.budget.remaining--;
  } else {
    // Budget guard (plan §11.3): deterministic heuristic, clearly labelled.
    const h = leadScorePrompt.mock(input);
    const tag = ' (heuristic — LLM budget reached; re-score to refine)';
    bnt = {
      budget: { ...h.budget, rationale: h.budget.rationale + tag },
      need: { ...h.need, rationale: h.need.rationale + tag },
      timeline: { ...h.timeline, rationale: h.timeline.rationale + tag },
    };
    heuristic = true;
  }

  const breakdown: ScoreBreakdown = {
    budget: bnt.budget,
    authority,
    need: bnt.need,
    timeline: bnt.timeline,
    icpFit: { score: fit.score, rationale: fit.rationale },
    signalStrength: strength,
  };
  const { total, band } = combineScore(breakdown);
  const previous = lead.scoreTotal;

  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        breakdown,
        scoreTotal: total,
        scoreBand: band,
        fitScore: fit.score,
        signalStrength: strength.score,
        recencyScore: recencyScore(latest, now),
        icpId: fit.icpId,
      })
      .where(eq(leads.id, leadId));
    if (previous > 0 && Math.abs(previous - total) >= 5) {
      await tx.insert(activities).values({
        orgId: lead.orgId,
        leadId,
        actorUserId: opts.actorUserId ?? null,
        type: 'SCORE_CHANGED',
        direction: 'INTERNAL',
        subject: `Score ${previous} → ${total}`,
        metadata: { from: previous, to: total, band },
      });
    }
  });
  return { total, usedLlm, cached, heuristic, costUsd };
}
