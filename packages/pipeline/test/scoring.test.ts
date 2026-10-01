import { describe, expect, it } from 'vitest';
import { combineScore, dedupeKey, prefilter, scoreAuthority, scoreIcpFit, scoreSignalStrength, seniorityOf } from '../src';

const now = new Date('2026-09-24T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('prefilter', () => {
  const events = [
    { id: 'a', title: 'Veltrix to launch new SUV from Pune plant', body: 'capacity expansion', publishedAt: daysAgo(5), industryTags: ['Automotive'] },
    { id: 'b', title: 'Veltrix CEO wins award', body: 'ceremony in Mumbai', publishedAt: daysAgo(5), industryTags: ['Automotive'] },
    { id: 'c', title: 'Old launch news', body: 'launch plant', publishedAt: daysAgo(400), industryTags: ['Automotive'] },
    { id: 'd', title: 'Hospital opens new wing', body: 'beds', publishedAt: daysAgo(2), industryTags: ['Hospitals'] },
  ];
  const signals = [{ id: 's1', keywords: ['launch', 'plant', 'capacity'], negativeKeywords: [] }];

  it('keeps in-window events with keyword hits and drops the rest', () => {
    const r = prefilter(events, { targetTags: ['Automotive'], signals, windowDays: 180, now });
    expect(r.kept.map((e) => e.id)).toEqual(['a']);
    expect(r.dropped.outOfWindow).toBe(1);
    expect(r.dropped.noOverlap).toBe(2);
  });

  it('skips already-evaluated events (idempotent re-runs)', () => {
    const r = prefilter(events, { targetTags: ['Automotive'], signals, windowDays: 180, now, alreadyEvaluated: new Set(['a']) });
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.alreadyEvaluated).toBe(1);
  });
});

describe('dedupeKey', () => {
  it('prefers normalised domain', () => {
    expect(dedupeKey({ name: 'X', domain: 'https://www.Veltrix.example/about' })).toBe('d:veltrix.example');
  });
  it('normalises names without domain', () => {
    expect(dedupeKey({ name: 'Veltrix Motors Pvt. Ltd.' })).toBe(dedupeKey({ name: 'veltrix motors' }));
  });
});

describe('authority', () => {
  it('ranks C-level above managers and rewards persona match', () => {
    expect(seniorityOf('Chief Procurement Officer').score).toBe(8);
    expect(seniorityOf('Procurement Manager').score).toBe(4.5);
    const a = scoreAuthority([{ name: 'A', title: 'VP Procurement' }], ['VP Procurement']);
    expect(a.score).toBe(8.5);
    expect(scoreAuthority([], []).score).toBe(1);
  });
});

describe('icp fit', () => {
  it('scores industry + geo + size', () => {
    const r = scoreIcpFit(
      { industry: 'Automotive', hqCountry: 'IN', employees: 5000, description: null },
      [{ id: 'i1', name: 'OEMs', criteria: { industries: ['Automotive'], geographies: ['India'], companySize: { minEmployees: 1000 }, personas: [], painPoints: [], keywords: [] } }],
    );
    expect(r.score).toBe(10);
    expect(r.icpId).toBe('i1');
  });
});

describe('signal strength & combine', () => {
  it('decays with age', () => {
    const fresh = scoreSignalStrength([{ weight: 1, confidence: 0.8, publishedAt: daysAgo(0), signalName: 's' }], now);
    const old = scoreSignalStrength([{ weight: 1, confidence: 0.8, publishedAt: daysAgo(60), signalName: 's' }], now);
    expect(fresh.score).toBeGreaterThan(old.score);
  });
  it('combines weighted dimensions into a 0-100 total and band', () => {
    const d = (score: number) => ({ score, rationale: '' });
    const all10 = { budget: d(10), authority: d(10), need: d(10), timeline: d(10), icpFit: d(10), signalStrength: d(10) };
    expect(combineScore(all10)).toEqual({ total: 100, band: 'HOT' });
    const mid = { budget: d(6), authority: d(6), need: d(6), timeline: d(6), icpFit: d(6), signalStrength: d(6) };
    expect(combineScore(mid)).toEqual({ total: 60, band: 'WARM' });
  });
});
