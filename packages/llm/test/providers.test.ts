import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { capabilitiesFor, LlmClient, providerOptionsFromEnv, type PromptDefinition } from '../src';

const prompt: PromptDefinition<{ n: number }, { value: number }> = {
  id: 'test.prompt',
  version: 'v1',
  schema: z.object({ value: z.number() }),
  build: (i) => ({ system: 'sys', user: `n=${i.n}` }),
  mock: (i) => ({ value: i.n }),
  temperature: 0.3,
  maxTokens: 500,
};
const base = { timeoutMs: 1000, maxConcurrency: 2, cacheTtlSeconds: 0 };
const openaiOk = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 });
const bodyOf = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse((f.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);
const urlOf = (f: ReturnType<typeof vi.fn>, i = 0) => (f.mock.calls[i] as unknown as [string])[0];

describe('capabilities', () => {
  it('treats OpenAI gpt-5 / o-series as reasoning models without custom temperature', () => {
    expect(capabilitiesFor({ id: 'openai', model: 'gpt-5.4-mini' })).toMatchObject({ supportsTemperature: false, tokenParam: 'max_completion_tokens', reasoning: true });
    expect(capabilitiesFor({ id: 'openai', model: 'o4-mini' }).supportsTemperature).toBe(false);
    expect(capabilitiesFor({ id: 'openai', model: 'gpt-4.1' }).supportsTemperature).toBe(true);
  });
  it('honours env overrides for models newer than the table', () => {
    expect(capabilitiesFor({ id: 'openai', model: 'gpt-9', supportsTemperature: true }).supportsTemperature).toBe(true);
    expect(capabilitiesFor({ id: 'anthropic', model: 'x', supportsJsonSchema: false }).supportsJsonSchema).toBe(false);
  });
});

describe('OpenAI adapter', () => {
  const provider = { id: 'openai' as const, apiKey: 'sk-test', model: 'gpt-5.4-mini', baseUrl: 'https://api.openai.test/v1', reasoningEffort: 'low', priceInputPerMTok: 1, priceOutputPerMTok: 4 };

  it('shapes requests for reasoning models and computes cost from the price table', async () => {
    const fetchImpl = vi.fn(async () => openaiOk('{"value": 1}'));
    const llm = new LlmClient({ ...base, mode: 'live', provider, fetchImpl });
    const r = await llm.run(prompt, { n: 1 });
    const body = bodyOf(fetchImpl);
    expect(urlOf(fetchImpl)).toBe('https://api.openai.test/v1/chat/completions');
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(500);
    expect(body.reasoning_effort).toBe('low');
    expect(body.usage).toBeUndefined(); // OpenRouter-only field
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(r.meta.provider).toBe('openai');
    expect(r.meta.costUsd).toBeCloseTo((1000 * 1 + 500 * 4) / 1e6);
  });

  it('self-heals when a model rejects temperature', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.3" } }), { status: 400 }))
      .mockResolvedValueOnce(openaiOk('{"value": 2}'));
    const llm = new LlmClient({ ...base, mode: 'live', provider: { ...provider, model: 'future-model', supportsTemperature: true }, fetchImpl });
    expect((await llm.run(prompt, { n: 1 })).data.value).toBe(2);
    expect(bodyOf(fetchImpl, 0).temperature).toBe(0.3);
    expect(bodyOf(fetchImpl, 1).temperature).toBeUndefined();
  });
});

describe('Anthropic adapter', () => {
  it('forces a tool call with the prompt schema and reads tool input as JSON', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'test_prompt', input: { value: 7 } }], usage: { input_tokens: 10, output_tokens: 5 } }), {
          status: 200,
        }),
    );
    const llm = new LlmClient({ ...base, mode: 'live', provider: { id: 'anthropic', apiKey: 'a', model: 'some-claude-model', baseUrl: 'https://api.anthropic.test' }, fetchImpl });
    const r = await llm.run(prompt, { n: 1 });
    expect(r.data.value).toBe(7);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.test/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('a');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'test_prompt' });
    expect(body.tools[0].input_schema.properties.value).toBeDefined();
    expect(r.meta.costUsd).toBe(0); // no price table configured → n/a (0)
  });
});

describe('failover', () => {
  it('uses LLM_FALLBACK_PROVIDER when the primary keeps failing', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('primary') ? new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 }) : openaiOk('{"value": 5}'),
    );
    const llm = new LlmClient({
      ...base,
      mode: 'live',
      provider: { id: 'openrouter', apiKey: 'k', model: 'm', baseUrl: 'https://primary.test' },
      fallback: { id: 'openai', apiKey: 'k2', model: 'm2', baseUrl: 'https://fallback.test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await llm.run(prompt, { n: 1 });
    expect(r.data.value).toBe(5);
    expect(r.meta.provider).toBe('openai');
  }, 20_000);
});

describe('providerOptionsFromEnv', () => {
  it('builds the selected provider from config (model only from env)', () => {
    const o = providerOptionsFromEnv({
      LLM_MODE: 'live',
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'k',
      OPENAI_MODEL: 'from-env',
      OPENAI_BASE_URL: 'https://x',
      OPENAI_REASONING_EFFORT: 'low',
      OPENROUTER_BASE_URL: 'https://o',
      ANTHROPIC_BASE_URL: 'https://a',
    } as never);
    expect(o.provider).toMatchObject({ id: 'openai', model: 'from-env', apiKey: 'k' });
    expect(providerOptionsFromEnv({ LLM_MODE: 'mock' } as never).provider).toBeUndefined();
  });
});
