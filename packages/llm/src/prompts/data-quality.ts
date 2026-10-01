import { z } from 'zod';
import type { PromptDefinition } from '../types';
import { JSON_RULE, UNTRUSTED_DATA_RULE } from './_util';

/**
 * Optional import quality gate (plan2 §7.2, IMPORT_AI_GATE_ENABLED). Judges whether each staged row is a
 * genuine B2B business event (launch, expansion, funding, tender, order, hiring…). Low scores only ever
 * produce WARNINGs — rows are never silently dropped.
 */
export interface QualityGateInput {
  rows: { rowNumber: number; source: string; title: string; body: string; company: string }[];
}

export const qualityGateSchema = z.object({
  results: z.array(
    z.object({
      rowNumber: z.number().int(),
      score: z.number().min(0).max(1),
      reason: z.string().max(300),
    }),
  ),
});
export type QualityGateOutput = z.infer<typeof qualityGateSchema>;

const BUSINESS_TERMS = /\b(launch|plant|capacity|expan|invest|fund|series [a-e]|raise|tender|award|order|contract|acqui|merger|opens?|build|hire|appoint|facility|warehouse|hospital|fab|mw|ppa|revenue|crore|million|billion)\w*/gi;

export const qualityGatePrompt: PromptDefinition<QualityGateInput, QualityGateOutput> = {
  id: 'data.quality-gate',
  version: 'v1',
  schema: qualityGateSchema,
  maxTokens: 1500,
  temperature: 0,
  build(input) {
    return {
      system: [
        'You review rows being imported into a B2B market-intelligence data source.',
        'For each row, score 0–1 how likely it is a genuine, specific business news event about a named company (launch, expansion, investment, funding, tender, order, leadership hire, M&A…).',
        'Low scores for: spam, marketing copy, placeholder or nonsensical text, personal content, vague statements with no concrete event.',
        UNTRUSTED_DATA_RULE,
        JSON_RULE,
        'JSON shape: {"results":[{"rowNumber":number,"score":number,"reason":string}]}',
      ].join('\n'),
      user: input.rows
        .map((r) => `<event row="${r.rowNumber}" source="${r.source.replace(/"/g, "'")}" company="${r.company.replace(/"/g, "'")}">\n${r.title}\n${r.body.slice(0, 700)}\n</event>`)
        .join('\n\n'),
    };
  },
  mock(input) {
    return {
      results: input.rows.map((r) => {
        const hits = new Set(`${r.title} ${r.body}`.toLowerCase().match(BUSINESS_TERMS) ?? []).size;
        const score = Math.min(0.95, 0.3 + hits * 0.12);
        return { rowNumber: r.rowNumber, score: Math.round(score * 100) / 100, reason: hits >= 3 ? 'Concrete business event vocabulary.' : 'Few concrete business-event signals.' };
      }),
    };
  },
};
