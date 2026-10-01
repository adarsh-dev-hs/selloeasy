import {
  bandFor,
  SCORE_WEIGHTS,
  SIGNAL_HALF_LIFE_DAYS,
  type DimensionScore,
  type IcpCriteria,
  type ScoreBand,
  type ScoreBreakdown,
} from '@selloeasy/shared';

const clamp10 = (n: number) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;

// ─── Authority (deterministic) ────────────────────────────────────────────────

// C-level decides but is rarely the working buyer; VP/Head of the relevant function scores highest with a persona match.
const SENIORITY_RULES: [RegExp, number, string][] = [
  [/\b(ceo|cfo|coo|cto|cpo|cmo|chief|founder|managing director|president|owner)\b/i, 8, 'C-level'],
  [/\b(evp|svp|vp|vice president)\b/i, 7.5, 'VP'],
  [/\b(head|director|general manager|gm)\b/i, 6.5, 'Director/Head'],
  [/\b(manager|lead|principal)\b/i, 4.5, 'Manager'],
];

export function seniorityOf(title: string | null | undefined): { score: number; label: string } {
  if (!title) return { score: 0, label: 'unknown' };
  for (const [re, score, label] of SENIORITY_RULES) if (re.test(title)) return { score, label };
  return { score: 3, label: 'Individual contributor' };
}

/**
 * Authority: do we know a decision-maker at the account? Best contact seniority, +1 when the
 * title matches an ICP persona (plan §12).
 */
export function scoreAuthority(contacts: { name: string; title: string | null }[], icpPersonas: string[]): DimensionScore {
  if (contacts.length === 0) return { score: 1, rationale: 'No known contact at the account yet.' };
  const personaWords = icpPersonas.flatMap((p) => p.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 3);
  let best = { score: 0, label: '', name: '', title: '', persona: false };
  for (const c of contacts) {
    const s = seniorityOf(c.title);
    const persona = !!c.title && personaWords.some((w) => c.title!.toLowerCase().includes(w));
    const total = s.score + (persona ? 1 : 0);
    if (total > best.score) best = { score: total, label: s.label, name: c.name, title: c.title ?? '', persona };
  }
  return {
    score: clamp10(best.score),
    rationale: `${best.name} (${best.title}) is ${best.label}${best.persona ? ' and matches a target persona' : ''}.`,
  };
}

// ─── ICP fit (deterministic) ──────────────────────────────────────────────────

export interface IcpForFit {
  id: string;
  name: string;
  criteria: IcpCriteria;
}
export interface AccountForFit {
  industry: string | null;
  hqCountry: string | null;
  employees: number | null;
  description: string | null;
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  IN: ['india', 'in', 'south asia', 'apac', 'asia'],
  SG: ['singapore', 'sg', 'southeast asia', 'sea', 'apac', 'asia'],
  AE: ['uae', 'united arab emirates', 'middle east', 'gcc', 'ae'],
  SA: ['saudi', 'saudi arabia', 'middle east', 'gcc'],
  US: ['usa', 'united states', 'us', 'north america', 'global'],
};

function geoMatches(country: string | null, geos: string[]): boolean {
  if (!country || geos.length === 0) return false;
  const g = geos.map((x) => x.toLowerCase());
  if (g.some((x) => x.includes('global'))) return true;
  const aliases = COUNTRY_ALIASES[country.toUpperCase()] ?? [country.toLowerCase()];
  return g.some((x) => aliases.some((a) => x.includes(a)));
}

/** ICP fit: industry (50%), geography (25%), size (25%) against the best-matching active ICP. */
export function scoreIcpFit(account: AccountForFit, icps: IcpForFit[]): DimensionScore & { icpId: string | null } {
  if (icps.length === 0) return { score: 5, rationale: 'No active ICP defined; neutral fit.', icpId: null };
  let best = { score: -1, icp: icps[0]!, parts: [] as string[] };
  for (const icp of icps) {
    const parts: string[] = [];
    let s = 0;
    const industries = icp.criteria.industries.map((i) => i.toLowerCase());
    const accInd = account.industry?.toLowerCase() ?? '';
    if (accInd && industries.includes(accInd)) {
      s += 5;
      parts.push(`industry ${account.industry}`);
    } else if (accInd && industries.some((i) => accInd.includes(i) || i.includes(accInd))) {
      s += 3;
      parts.push(`adjacent industry ${account.industry}`);
    }
    if (geoMatches(account.hqCountry, icp.criteria.geographies)) {
      s += 2.5;
      parts.push(`geography ${account.hqCountry}`);
    }
    const { minEmployees, maxEmployees } = icp.criteria.companySize ?? {};
    if (account.employees != null) {
      const okMin = minEmployees == null || account.employees >= minEmployees;
      const okMax = maxEmployees == null || account.employees <= maxEmployees;
      if (okMin && okMax) {
        s += 2.5;
        parts.push('company size');
      } else if (okMax && minEmployees && account.employees >= minEmployees * 0.5) {
        s += 1;
        parts.push('near size band');
      }
    }
    if (s > best.score) best = { score: s, icp, parts };
  }
  return {
    score: clamp10(best.score),
    icpId: best.score > 0 ? best.icp.id : null,
    rationale: best.parts.length
      ? `Best ICP "${best.icp.name}" — matches ${best.parts.join(', ')}.`
      : `Does not clearly match any ICP (closest: "${best.icp.name}").`,
  };
}

// ─── Signal strength & recency (deterministic) ────────────────────────────────

export interface MatchForStrength {
  weight: number;
  confidence: number;
  publishedAt: Date;
  signalName: string;
}

export const decay = (ageDays: number) => 0.5 ** (Math.max(0, ageDays) / SIGNAL_HALF_LIFE_DAYS);

/** Σ(weight × confidence × decay) over supporting signals, capped at 10 (plan §12). */
export function scoreSignalStrength(matches: MatchForStrength[], now: Date): DimensionScore {
  if (matches.length === 0) return { score: 0, rationale: 'No supporting signals.' };
  const raw = matches.reduce((a, m) => a + m.weight * m.confidence * decay((now.getTime() - m.publishedAt.getTime()) / 86_400_000), 0);
  const distinct = new Set(matches.map((m) => m.signalName)).size;
  return {
    score: clamp10(raw * 4.5),
    rationale: `${matches.length} supporting event${matches.length > 1 ? 's' : ''} across ${distinct} signal${distinct > 1 ? 's' : ''} (age-decayed, half-life ${SIGNAL_HALF_LIFE_DAYS}d).`,
  };
}

export function recencyScore(latest: Date | null, now: Date): number {
  if (!latest) return 0;
  return clamp10(10 * decay((now.getTime() - latest.getTime()) / 86_400_000));
}

// ─── Combine ──────────────────────────────────────────────────────────────────

export function combineScore(breakdown: ScoreBreakdown): { total: number; band: ScoreBand } {
  const total = Math.round(
    (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce(
      (acc, k) => acc + (SCORE_WEIGHTS[k] * clamp10(breakdown[k].score)) / 10,
      0,
    ),
  );
  return { total, band: bandFor(total) };
}
