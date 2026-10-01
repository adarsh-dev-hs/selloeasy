import { z } from 'zod';
import type { PromptDefinition } from '../types';
import { bullets, extractTimeline, hashUnit, JSON_RULE, keywordHits, UNTRUSTED_DATA_RULE } from './_util';

export interface SignalMatchInput {
  org: { name: string; summary: string; products: string[]; personas: string[]; targetIndustries: string[] };
  signals: { id: string; name: string; matchInstructions: string; keywords: string[]; negativeKeywords: string[] }[];
  events: {
    id: string;
    title: string;
    body: string;
    publishedAt: string;
    companies: { name: string; role: 'subject' | 'mentioned' }[];
    industryTags: string[];
    amount: number | null;
    currency: string | null;
  }[];
}

export const signalMatchSchema = z.object({
  results: z.array(
    z.object({
      eventId: z.string(),
      matches: z
        .array(
          z.object({
            signalId: z.string(),
            confidence: z.number().min(0).max(1),
            rationale: z.string().max(600),
          }),
        )
        .default([]),
      account: z.object({ name: z.string(), domain: z.string().nullish() }).nullish(),
      personas: z.array(z.string()).max(5).default([]),
      dealHints: z
        .object({
          amount: z.number().nullish(),
          currency: z.string().nullish(),
          timeline: z.string().nullish(),
        })
        .nullish(),
    }),
  ),
});
export type SignalMatchOutput = z.infer<typeof signalMatchSchema>;

/**
 * Batched signal matching + extraction in one call (plan §11.1 stages 4–5).
 * Mock: keyword overlap → confidence (2 hits ≈ 0.72, 3 ≈ 0.84, 4+ ≈ 0.92; negative keyword → no match).
 * Events outside the seller's target industries need ≥3 hits and lose 0.12 confidence (off-target penalty).
 */
export const signalMatchPrompt: PromptDefinition<SignalMatchInput, SignalMatchOutput> = {
  id: 'signal.match',
  version: 'v1',
  schema: signalMatchSchema,
  maxTokens: 3000,
  temperature: 0.1,
  build(input) {
    const system = [
      `You are a B2B sales-intelligence analyst for ${input.org.name}. Decide which market events are buying signals for the seller.`,
      'For each event and each signal, judge whether the event satisfies the signal\'s match instructions. Only report matches with genuine buying intent for the seller\'s products.',
      'confidence: 0.9+ explicit and direct; 0.7-0.89 clear but indirect; 0.5-0.69 plausible/speculative; omit anything below 0.5.',
      'Events about companies outside the seller\'s target industries rarely qualify — only match them when the link to the seller\'s products is explicit.',
      'account = the company that would BUY (usually the event subject). personas = 1-3 buyer job titles to approach at that account.',
      'dealHints: amount/currency if the event states an investment or order size; timeline if a date/quarter/horizon is stated.',
      'Return one result per event, including events with no matches (empty matches array).',
      UNTRUSTED_DATA_RULE,
      JSON_RULE,
      'JSON shape: {"results":[{"eventId":string,"matches":[{"signalId":string,"confidence":number,"rationale":string}],"account":{"name":string,"domain":string|null}|null,"personas":string[],"dealHints":{"amount":number|null,"currency":string|null,"timeline":string|null}|null}]}',
    ].join('\n');
    const user = [
      `## Seller\n${input.org.summary}\nProducts:\n${bullets(input.org.products)}\nTarget industries: ${input.org.targetIndustries.join(', ') || 'n/a'}\nTypical buyer personas: ${input.org.personas.join(', ')}`,
      '## Signals',
      ...input.signals.map(
        (s) =>
          `- id: ${s.id}\n  name: ${s.name}\n  instructions: ${s.matchInstructions}\n  keywords: ${s.keywords.join(', ')}${s.negativeKeywords.length ? `\n  exclude if: ${s.negativeKeywords.join(', ')}` : ''}`,
      ),
      '## Events',
      ...input.events.map(
        (e) =>
          `<event id="${e.id}" published="${e.publishedAt}" tags="${e.industryTags.join(', ')}" companies="${e.companies.map((c) => `${c.name} (${c.role})`).join('; ')}">\n${e.title}\n\n${e.body.slice(0, 2500)}\n</event>`,
      ),
    ].join('\n\n');
    return { system, user };
  },
  mock(input) {
    const targets = new Set(input.org.targetIndustries.map((t) => t.toLowerCase()));
    return {
      results: input.events.map((e) => {
        const text = `${e.title}\n${e.body}`;
        const onTarget = targets.size === 0 || e.industryTags.some((t) => targets.has(t.toLowerCase()));
        const matches = input.signals.flatMap((s) => {
          if (keywordHits(text, s.negativeKeywords).length) return [];
          const hits = keywordHits(text, s.keywords);
          if (hits.length < (onTarget ? 2 : 3)) return [];
          const base = (hits.length >= 4 ? 0.9 : hits.length === 3 ? 0.82 : 0.7) - (onTarget ? 0 : 0.12);
          const confidence = Math.min(0.97, Math.round((base + hashUnit(e.id + s.id) * 0.05) * 100) / 100);
          return [
            {
              signalId: s.id,
              confidence,
              rationale: `Event mentions ${hits.slice(0, 4).map((h) => `"${h}"`).join(', ')}, consistent with "${s.name}".`,
            },
          ];
        });
        const subject = e.companies.find((c) => c.role === 'subject') ?? e.companies[0];
        const timeline = extractTimeline(text);
        return {
          eventId: e.id,
          matches,
          account: subject ? { name: subject.name, domain: null } : null,
          personas: input.org.personas.slice(0, 2),
          dealHints: { amount: e.amount, currency: e.currency, timeline: timeline ?? null },
        };
      }),
    };
  },
};
