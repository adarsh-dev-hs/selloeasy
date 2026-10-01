/**
 * pnpm eval:pipeline [--mode live|mock]
 *
 * Measures signal-matching quality on the labelled gold set (packages/dataset/data/eval) — plan §11.4.
 * Runs the real `signal.match` prompt (live OpenRouter model, or the deterministic mock) with no database,
 * then reports micro precision/recall/F1 overall and per org, and writes eval/results-<mode>.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '@selloeasy/core';
import { loadCompanies, loadEvents, loadGold, loadOrgs, loadSignalTemplates } from '@selloeasy/dataset';
import { LlmClient, providerOptionsFromEnv, signalMatchPrompt } from '@selloeasy/llm';
import { batch } from './stages';

const cfg = getConfig();
const modeArg = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : undefined;
const mode = (modeArg as 'live' | 'mock' | undefined) ?? cfg.LLM_MODE;
const llm = new LlmClient({
  ...providerOptionsFromEnv({ ...cfg, LLM_MODE: mode }),
  timeoutMs: cfg.LLM_TIMEOUT_MS,
  maxConcurrency: cfg.LLM_MAX_CONCURRENCY,
  cacheTtlSeconds: 0,
});

const templates = loadSignalTemplates();
const orgs = loadOrgs();
const events = new Map(loadEvents().map((e) => [e.externalId, e]));
const companies = new Map(loadCompanies().map((c) => [c.key, c]));
const gold = loadGold();

interface Row {
  org: string;
  tp: number;
  fp: number;
  fn: number;
  negativesCorrect: number;
  negatives: number;
}
const rows: Row[] = [];
const details: { org: string; event: string; expected: string[]; predicted: string[] }[] = [];
let calls = 0;
let cost = 0;

for (const org of orgs) {
  const orgGold = gold.filter((g) => g.orgSlug === org.slug);
  if (!orgGold.length) continue;
  const signals = [
    ...templates.filter((t) => t.industry === org.industry).map((t) => ({ id: t.key, name: t.name, matchInstructions: t.matchInstructions, keywords: t.defaultKeywords, negativeKeywords: [] as string[] })),
    ...org.customSignals.map((s, i) => ({ id: `custom_${i}`, name: s.name, matchInstructions: s.matchInstructions, keywords: s.keywords, negativeKeywords: s.negativeKeywords })),
  ];
  const nameById = new Map(signals.map((s) => [s.id, s.name]));
  const row: Row = { org: org.slug, tp: 0, fp: 0, fn: 0, negativesCorrect: 0, negatives: 0 };
  const targetIndustries = [...new Set([...org.profile.targetIndustries, ...org.icps.flatMap((i) => i.criteria.industries)])];

  for (const chunk of batch(orgGold, 8)) {
    const evs = chunk.map((g) => events.get(g.eventExternalId)!).filter(Boolean);
    const { data, meta } = await llm.run(signalMatchPrompt, {
      org: { name: org.name, summary: org.profile.summary, products: org.products.map((p) => p.name), personas: org.profile.personas.map((p) => p.title), targetIndustries },
      signals,
      events: evs.map((e) => ({
        id: e.externalId,
        title: e.title,
        body: e.body,
        publishedAt: new Date(Date.now() - e.publishedDaysAgo * 86400000).toISOString().slice(0, 10),
        companies: e.companies.map((c) => ({ name: companies.get(c.key)?.name ?? c.key, role: c.role })),
        industryTags: e.industryTags,
        amount: e.amount,
        currency: e.currency,
      })),
    });
    calls++;
    cost += meta.costUsd;
    const byEvent = new Map(data.results.map((r) => [r.eventId, r]));
    for (const g of chunk) {
      const predicted = (byEvent.get(g.eventExternalId)?.matches ?? [])
        .filter((m) => m.confidence >= cfg.PIPELINE_MATCH_THRESHOLD)
        .map((m) => nameById.get(m.signalId))
        .filter((n): n is string => !!n);
      const exp = new Set(g.expectedSignals);
      const pred = new Set(predicted);
      for (const p of pred) (exp.has(p) ? row.tp++ : row.fp++);
      for (const e of exp) if (!pred.has(e)) row.fn++;
      if (exp.size === 0) {
        row.negatives++;
        if (pred.size === 0) row.negativesCorrect++;
      }
      details.push({ org: org.slug, event: g.eventExternalId, expected: [...exp], predicted: [...pred] });
    }
  }
  rows.push(row);
}

const f = (tp: number, fp: number, fn: number) => {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
};
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const total = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn, nc: a.nc + r.negativesCorrect, n: a.n + r.negatives }), { tp: 0, fp: 0, fn: 0, nc: 0, n: 0 });
const overall = f(total.tp, total.fp, total.fn);

console.log(`\nSignal-matching evaluation — mode=${mode}${mode === 'live' ? ` provider=${llm.providerId} model=${llm.model}` : ''} threshold=${cfg.PIPELINE_MATCH_THRESHOLD}\n`);
console.log('| Org | Precision | Recall | F1 | Negatives rejected |');
console.log('|---|---|---|---|---|');
for (const r of rows) {
  const m = f(r.tp, r.fp, r.fn);
  console.log(`| ${r.org} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${r.negativesCorrect}/${r.negatives} |`);
}
console.log(`| **All** | **${pct(overall.precision)}** | **${pct(overall.recall)}** | **${pct(overall.f1)}** | **${total.nc}/${total.n}** |`);
console.log(`\n${details.length} gold items · ${calls} LLM calls · $${cost.toFixed(4)}\n`);

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'eval');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, `results-${mode}.json`),
  JSON.stringify({ mode, provider: llm.providerId, model: llm.model, threshold: cfg.PIPELINE_MATCH_THRESHOLD, ranAt: new Date().toISOString(), overall, perOrg: rows, details }, null, 2),
);
