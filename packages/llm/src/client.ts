import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createProvider } from './providers';
import { ProviderHttpError, type ChatMessage, type ChatProvider } from './providers/types';
import {
  LlmError,
  type LlmCallMeta,
  type LlmOptions,
  type LlmResult,
  type PromptDefinition,
  type RunContext,
} from './types';

/** Minimal semaphore to cap concurrent LLM requests per process (LLM_MAX_CONCURRENCY). */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extract the first JSON object/array from a model response (tolerates ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('No JSON found in model response');
  }
}

/**
 * The single LLM entry point (plan §16, plan2 §10). Provider-agnostic: prompts, zod validation,
 * one repair retry, response cache, concurrency limit, retries with backoff, telemetry and mock mode.
 * The HTTP call itself is delegated to a provider adapter (OpenRouter / OpenAI / Anthropic) selected by
 * LLM_PROVIDER; the model is exactly the configured env value — no model names in code (ADR-0009).
 */
export class LlmClient {
  private readonly sem: Semaphore;
  private readonly primary: ChatProvider | null;
  private readonly fallback: ChatProvider | null;

  constructor(private readonly opts: LlmOptions) {
    this.sem = new Semaphore(Math.max(1, opts.maxConcurrency));
    if (opts.mode === 'live') {
      const p = opts.provider;
      if (!p?.apiKey || !p.model) {
        throw new LlmError(`LLM_MODE=live requires an API key and model for provider "${p?.id ?? 'unset'}"`);
      }
      this.primary = createProvider(p, opts.fetchImpl);
      this.fallback =
        opts.fallback?.apiKey && opts.fallback.model ? createProvider(opts.fallback, opts.fetchImpl) : null;
    } else {
      this.primary = null;
      this.fallback = null;
    }
  }

  get mode() {
    return this.opts.mode;
  }

  /** Provider id in use (`mock` in mock mode). */
  get providerId(): string {
    return this.primary?.id ?? 'mock';
  }

  /** The model identifier in use; `mock` in mock mode. */
  get model(): string {
    return this.primary?.model ?? 'mock';
  }

  /** Human label, e.g. `openai · gpt-5.4-mini`. */
  get label(): string {
    return this.primary ? `${this.primary.id} · ${this.primary.model}` : 'mock';
  }

  async run<I, O>(prompt: PromptDefinition<I, O>, input: I, ctx: RunContext = {}): Promise<LlmResult<O>> {
    const { system, user } = prompt.build(input);
    const promptHash = createHash('sha256')
      .update(`${this.providerId}:${this.model}\n${prompt.id}@${prompt.version}\n${system}\n${user}`)
      .digest('hex');
    const base: Omit<LlmCallMeta, 'status' | 'latencyMs'> = {
      purpose: prompt.id,
      provider: this.providerId,
      promptVersion: prompt.version,
      model: this.model,
      cached: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      promptHash,
      orgId: ctx.orgId ?? null,
    };
    const started = Date.now();

    if (!this.primary) {
      const data = prompt.schema.parse(prompt.mock(input));
      const meta: LlmCallMeta = { ...base, status: 'ok', latencyMs: Date.now() - started };
      await this.opts.onCall?.(meta);
      return { data, meta };
    }

    const cacheKey = `llm:${promptHash}`;
    if (this.opts.cache && !ctx.noCache) {
      const hit = await this.opts.cache.get(cacheKey).catch(() => null);
      if (hit) {
        const parsed = prompt.schema.safeParse(JSON.parse(hit));
        if (parsed.success) {
          const meta: LlmCallMeta = { ...base, cached: true, status: 'ok', latencyMs: Date.now() - started };
          await this.opts.onCall?.(meta);
          return { data: parsed.data, meta };
        }
      }
    }

    const jsonSchema = {
      name: prompt.id.replace(/[^a-zA-Z0-9_-]/g, '_'),
      schema: z.toJSONSchema(prompt.schema as z.ZodType, { io: 'input', unrepresentable: 'any' }) as Record<
        string,
        unknown
      >,
    };
    const messages: ChatMessage[] = [{ role: 'user', content: user }];
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let provider = this.primary;

    try {
      // Attempt 1 + one repair turn when the JSON fails schema validation (plan §16.2).
      for (let attempt = 0; attempt < 2; attempt++) {
        let res;
        try {
          res = await this.sem.run(() => this.callWithRetry(provider, system, messages, prompt, jsonSchema));
        } catch (err) {
          // Failover (LLM_FALLBACK_PROVIDER) only for transient/provider-side failures.
          if (
            this.fallback &&
            provider === this.primary &&
            err instanceof LlmError &&
            (err.retryable || (err.status ?? 0) >= 500)
          ) {
            provider = this.fallback;
            res = await this.sem.run(() =>
              this.callWithRetry(provider, system, messages, prompt, jsonSchema),
            );
          } else throw err;
        }
        inputTokens += res.usage.inputTokens;
        outputTokens += res.usage.outputTokens;
        costUsd += res.usage.costUsd ?? 0;
        let parsed: z.ZodSafeParseResult<O>;
        try {
          parsed = prompt.schema.safeParse(extractJson(res.content));
        } catch (e) {
          parsed = {
            success: false,
            error: new z.ZodError([
              { code: 'custom', path: [], message: (e as Error).message, input: res.content },
            ]),
          } as z.ZodSafeParseResult<O>;
        }
        if (parsed.success) {
          if (this.opts.cache) {
            await this.opts.cache
              .set(cacheKey, JSON.stringify(parsed.data), this.opts.cacheTtlSeconds)
              .catch(() => undefined);
          }
          const meta: LlmCallMeta = {
            ...base,
            provider: provider.id,
            model: provider.model,
            inputTokens,
            outputTokens,
            costUsd,
            status: 'ok',
            latencyMs: Date.now() - started,
          };
          await this.opts.onCall?.(meta);
          return { data: parsed.data, meta };
        }
        messages.push(
          { role: 'assistant', content: res.content },
          {
            role: 'user',
            content: `Your previous answer did not match the required JSON schema:\n${z.prettifyError(parsed.error)}\nReturn ONLY corrected JSON, no prose.`,
          },
        );
      }
      throw new LlmError(`Model output failed schema validation for ${prompt.id}`);
    } catch (err) {
      const meta: LlmCallMeta = {
        ...base,
        provider: provider.id,
        model: provider.model,
        inputTokens,
        outputTokens,
        costUsd,
        status: 'error',
        error: (err as Error).message.slice(0, 500),
        latencyMs: Date.now() - started,
      };
      await this.opts.onCall?.(meta);
      throw err;
    }
  }

  /** Timeout + retries with exponential backoff and jitter (plan §11.3). */
  private async callWithRetry(
    provider: ChatProvider,
    system: string,
    messages: ChatMessage[],
    prompt: PromptDefinition<unknown, unknown>,
    jsonSchema: { name: string; schema: Record<string, unknown> },
  ) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        return await provider.complete({
          system,
          messages: [...messages],
          jsonSchema,
          maxOutputTokens: prompt.maxTokens ?? 2000,
          temperature: prompt.temperature ?? 0.2,
          signal: controller.signal,
        });
      } catch (err) {
        lastErr = err;
        const retryable =
          (err instanceof ProviderHttpError && err.retryable) ||
          (err as Error).name === 'AbortError' ||
          (err as Error).name === 'TypeError';
        if (!retryable || attempt === 3) break;
        await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300);
      } finally {
        clearTimeout(timer);
      }
    }
    if ((lastErr as Error)?.name === 'AbortError')
      throw new LlmError(`${provider.id} request timed out after ${this.opts.timeoutMs}ms`, 408, true);
    if (lastErr instanceof ProviderHttpError)
      throw new LlmError(lastErr.message, lastErr.status, lastErr.retryable);
    throw lastErr;
  }
}
