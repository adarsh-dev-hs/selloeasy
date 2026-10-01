import type { ScoreBand } from './enums';

/**
 * BANT+ scoring model (plan §12). Weights sum to 100.
 * LLM-judged dimensions: budget, need, timeline. Deterministic: authority, icpFit, signalStrength.
 */
export const SCORE_WEIGHTS = {
  budget: 20,
  authority: 15,
  need: 25,
  timeline: 15,
  icpFit: 15,
  signalStrength: 10,
} as const;
export type ScoreDimension = keyof typeof SCORE_WEIGHTS;

export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, string> = {
  budget: 'Budget',
  authority: 'Authority',
  need: 'Need',
  timeline: 'Timeline',
  icpFit: 'ICP fit',
  signalStrength: 'Signal strength',
};

export const HOT_THRESHOLD = 75;
export const WARM_THRESHOLD = 50;

/** Half-life (days) used to decay signal strength with event age. */
export const SIGNAL_HALF_LIFE_DAYS = 30;

export function bandFor(total: number): ScoreBand {
  if (total >= HOT_THRESHOLD) return 'HOT';
  if (total >= WARM_THRESHOLD) return 'WARM';
  return 'COLD';
}

/** One dimension's score, normalised to 0–10, with the reason shown in "Why this score?". */
export interface DimensionScore {
  score: number;
  rationale: string;
}

export type ScoreBreakdown = Record<ScoreDimension, DimensionScore>;
