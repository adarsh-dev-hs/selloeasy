import { z } from 'zod';
import type { PromptDefinition } from '../types';
import { bullets, extractTimeline, hashUnit, JSON_RULE, UNTRUSTED_DATA_RULE } from './_util';

export interface LeadScoreInput {
  org: { name: string; summary: string; products: string[]; targetIndustries: string[] };
  account: { name: string; industry: string | null; sizeBand: string | null; employees: number | null; description: string | null };
  evidence: {
    signalName: string;
    confidence: number;
    title: string;
    body: string;
    publishedAt: string;
    amount: number | null;
    currency: string | null;
  }[];
  contacts: { title: string | null }[];
  now: string;
}

const dim = z.object({ score: z.number().min(0).max(10), rationale: z.string().max(500) });
export const leadScoreSchema = z.object({ budget: dim, need: dim, timeline: dim });
export type LeadScoreOutput = z.infer<typeof leadScoreSchema>;

const SIZE_BUDGET: Record<string, number> = {
  '1-50': 1.5,
  '51-200': 2.5,
  '201-1000': 4,
  '1001-5000': 5.5,
  '5001-10000': 6.5,
  '10000+': 7.5,
};

/** Rough USD normalisation for the mock budget heuristic. */
function toUsd(amount: number, currency: string | null): number {
  if (currency === 'INR') return amount / 83;
  if (currency === 'EUR') return amount * 1.08;
  return amount;
}

/**
 * LLM-judged BANT dimensions: Budget, Need, Timeline (plan §12).
 * Authority, ICP fit and signal strength are computed deterministically in @selloeasy/pipeline.
 */
export const leadScorePrompt: PromptDefinition<LeadScoreInput, LeadScoreOutput> = {
  id: 'lead.score-bant',
  version: 'v1',
  schema: leadScoreSchema,
  maxTokens: 900,
  temperature: 0.1,
  build(input) {
    const system = [
      `You qualify B2B leads for ${input.org.name} using BANT. Score each dimension 0-10 with a one-sentence rationale citing the evidence.`,
      'budget: evidence the account can spend (funding, capex, investment size, company scale).',
      'need: how directly the evidence implies need for the SELLER\'s products specifically.',
      'timeline: how soon a purchase is likely (explicit dates, launch/COD schedules, recency of the news).',
      'Be conservative: without evidence, score 3-5. Do not invent facts.',
      UNTRUSTED_DATA_RULE,
      JSON_RULE,
      'JSON shape: {"budget":{"score":number,"rationale":string},"need":{"score":number,"rationale":string},"timeline":{"score":number,"rationale":string}}',
    ].join('\n');
    const user = [
      `Today: ${input.now}`,
      `## Seller\n${input.org.summary}\nProducts:\n${bullets(input.org.products)}\nTarget industries: ${input.org.targetIndustries.join(', ') || 'n/a'}`,
      `## Account\n${input.account.name} — ${input.account.industry ?? 'unknown industry'}, size ${input.account.sizeBand ?? 'unknown'}${input.account.employees ? ` (~${input.account.employees} employees)` : ''}\n${input.account.description ?? ''}`,
      `Known contacts: ${input.contacts.map((c) => c.title).filter(Boolean).join(', ') || 'none'}`,
      '## Evidence',
      ...input.evidence.map(
        (e) =>
          `<event signal="${e.signalName}" confidence="${e.confidence}" published="${e.publishedAt}"${e.amount ? ` amount="${e.amount} ${e.currency ?? ''}"` : ''}>\n${e.title}\n${e.body.slice(0, 1500)}\n</event>`,
      ),
    ].join('\n\n');
    return { system, user };
  },
  mock(input) {
    const now = new Date(input.now).getTime();
    const best = [...input.evidence].sort((a, b) => b.confidence - a.confidence)[0];
    const maxUsd = Math.max(0, ...input.evidence.map((e) => (e.amount ? toUsd(e.amount, e.currency) : 0)));
    let budget = SIZE_BUDGET[input.account.sizeBand ?? ''] ?? 4;
    let budgetWhy = `Company size ${input.account.sizeBand ?? 'unknown'} suggests ${budget >= 6 ? 'substantial' : 'moderate'} purchasing capacity.`;
    if (maxUsd > 0) {
      const fromAmount = Math.min(9.5, 2 + Math.log10(Math.max(1, maxUsd / 100_000)) * 1.4);
      budget = Math.max(budget, fromAmount);
      budgetWhy = `Announced spend of ~$${Math.round(maxUsd / 1e6)}M indicates allocated budget.`;
    }
    const avgConf = input.evidence.reduce((a, e) => a + e.confidence, 0) / Math.max(1, input.evidence.length);
    const targets = input.org.targetIndustries.map((t) => t.toLowerCase());
    const onTarget = !input.account.industry || targets.length === 0 || targets.includes(input.account.industry.toLowerCase());
    const need = (avgConf - 0.5) * 12 + 1.5 + Math.min(1.5, (input.evidence.length - 1) * 0.7) - (onTarget ? 0 : 2);
    const text = input.evidence.map((e) => `${e.title} ${e.body}`).join('\n');
    const explicit = extractTimeline(text);
    const newestDays = Math.min(
      ...input.evidence.map((e) => Math.max(0, (now - new Date(e.publishedAt).getTime()) / 86_400_000)),
    );
    let timeline = newestDays <= 14 ? 5 : newestDays <= 45 ? 4 : newestDays <= 90 ? 3.5 : 2.5;
    if (explicit) timeline = Math.min(10, timeline + 1.5);
    const jitter = (k: string) => (hashUnit(input.account.name + k) - 0.5) * 0.8;
    const r = (n: number) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
    return {
      budget: { score: r(budget + jitter('b')), rationale: budgetWhy },
      need: {
        score: r(need + jitter('n')),
        rationale: best
          ? `"${best.signalName}" signal (${Math.round(best.confidence * 100)}% confidence)${onTarget ? ' in a target industry' : ', but the account is outside the target industries'}${input.evidence.length > 1 ? `; ${input.evidence.length} supporting events` : ''}.`
          : 'No direct evidence of need.',
      },
      timeline: {
        score: r(timeline + jitter('t')),
        rationale: explicit
          ? `Explicit timeline stated (${explicit}); latest signal ${Math.round(newestDays)} days old.`
          : `Latest signal is ${Math.round(newestDays)} days old; no explicit date given.`,
      },
    };
  },
};
