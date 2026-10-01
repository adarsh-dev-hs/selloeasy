import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { extractJson, LlmClient, signalMatchPrompt, type PromptDefinition } from '../src';

const prompt: PromptDefinition<{ n: number }, { value: number }> = {
  id: 'test.prompt',
  version: 'v1',
  schema: z.object({ value: z.number() }),
  build: (i) => ({ system: 'sys', user: `n=${i.n}` }),
  mock: (i) => ({ value: i.n * 2 }),
};

function completion(content: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const base = { timeoutMs: 1000, maxConcurrency: 2, cacheTtlSeconds: 60 };
const or = (model = 'm') => ({ id: 'openrouter' as const, apiKey: 'k', model, baseUrl: 'https://openrouter.test/api/v1' });

describe('extractJson', () => {
  it('handles fences and surrounding prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a":2} hope that helps')).toEqual({ a: 2 });
  });
});

describe('LlmClient', () => {
  it('mock mode returns the deterministic fixture without network', async () => {
    const fetchImpl = vi.fn();
    const llm = new LlmClient({ ...base, mode: 'mock', fetchImpl });
    const r = await llm.run(prompt, { n: 21 });
    expect(r.data.value).toBe(42);
    expect(r.meta.model).toBe('mock');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires key and model in live mode (model only from env, ADR-0009)', () => {
    expect(() => new LlmClient({ ...base, mode: 'live' })).toThrow(/API key and model/);
  });

  it('sends the configured model and records usage + cost', async () => {
    const fetchImpl = vi.fn(async () => completion('{"value": 7}'));
    const calls: unknown[] = [];
    const llm = new LlmClient({ ...base, mode: 'live', provider: or('vendor/model-x'), fetchImpl, onCall: (m) => void calls.push(m) });
    const r = await llm.run(prompt, { n: 1 });
    expect(r.data.value).toBe(7);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('vendor/model-x');
    expect(body.response_format.type).toBe('json_schema');
    expect(r.meta.costUsd).toBe(0.001);
    expect(calls).toHaveLength(1);
  });

  it('repairs schema-invalid output with one follow-up turn', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(completion('{"value": "not a number"}')).mockResolvedValueOnce(completion('{"value": 3}'));
    const llm = new LlmClient({ ...base, mode: 'live', provider: or(), fetchImpl });
    const r = await llm.run(prompt, { n: 1 });
    expect(r.data.value).toBe(3);
    const second = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(second.messages.at(-1).content).toMatch(/did not match the required JSON schema/);
  });

  it('falls back to prompt-only JSON when the model rejects response_format', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'response_format json_schema is not supported' } }), { status: 400 }))
      .mockResolvedValueOnce(completion('{"value": 5}'));
    const llm = new LlmClient({ ...base, mode: 'live', provider: or(), fetchImpl });
    expect((await llm.run(prompt, { n: 1 })).data.value).toBe(5);
    const retryBody = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(retryBody.response_format).toBeUndefined();
  });

  it('retries 429s with backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }))
      .mockResolvedValueOnce(completion('{"value": 9}'));
    const llm = new LlmClient({ ...base, mode: 'live', provider: or(), fetchImpl });
    expect((await llm.run(prompt, { n: 1 })).data.value).toBe(9);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serves repeated prompts from cache', async () => {
    const store = new Map<string, string>();
    const fetchImpl = vi.fn(async () => completion('{"value": 11}'));
    const llm = new LlmClient({
      ...base,
      mode: 'live',
      provider: or(),
      fetchImpl,
      cache: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) },
    });
    await llm.run(prompt, { n: 1 });
    const again = await llm.run(prompt, { n: 1 });
    expect(again.meta.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('signal.match mock', () => {
  const input = {
    org: { name: 'Tyres', summary: '', products: [], personas: ['VP Procurement'], targetIndustries: ['Automotive'] },
    signals: [{ id: 's1', name: 'Launch', matchInstructions: '', keywords: ['launch', 'new suv', 'plant'], negativeKeywords: ['recall'] }],
    events: [
      { id: 'e1', title: 'Veltrix to launch new SUV', body: 'from its Pune plant in Q2 2027', publishedAt: '2026-09-01', companies: [{ name: 'Veltrix', role: 'subject' as const }], industryTags: ['Automotive'], amount: null, currency: null },
      { id: 'e2', title: 'Veltrix launch recall', body: 'new suv plant recall', publishedAt: '2026-09-01', companies: [{ name: 'Veltrix', role: 'subject' as const }], industryTags: ['Automotive'], amount: null, currency: null },
      { id: 'e3', title: 'Hospital launch of new plant', body: 'new suv', publishedAt: '2026-09-01', companies: [{ name: 'H', role: 'subject' as const }], industryTags: ['Hospitals'], amount: null, currency: null },
    ],
  };
  it('matches on keywords, honours negatives, penalises off-target events', () => {
    const out = signalMatchPrompt.mock(input);
    const byId = Object.fromEntries(out.results.map((r) => [r.eventId, r]));
    expect(byId.e1!.matches[0]!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(byId.e1!.dealHints?.timeline).toBe('Q2 2027');
    expect(byId.e2!.matches).toHaveLength(0);
    expect(byId.e3!.matches[0]!.confidence).toBeLessThan(byId.e1!.matches[0]!.confidence);
  });
});
