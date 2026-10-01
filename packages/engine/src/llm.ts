import { getConfig, type Redis } from '@selloeasy/core';
import { getDb, llmCalls } from '@selloeasy/db';
import { LlmClient, providerOptionsFromEnv, type LlmCache, type LlmCallMeta } from '@selloeasy/llm';

/** Redis-backed response cache (plan §16.2) — identical prompt+model+input costs nothing on re-run. */
export function redisLlmCache(redis: Redis): LlmCache {
  return {
    get: (k) => redis.get(k),
    set: async (k, v, ttl) => {
      await redis.set(k, v, 'EX', ttl);
    },
  };
}

/** Persists every call to `llm_calls` for cost/latency telemetry. Never throws. */
export async function recordLlmCall(meta: LlmCallMeta): Promise<void> {
  try {
    await getDb().insert(llmCalls).values({
      orgId: meta.orgId ?? null,
      purpose: meta.purpose,
      provider: meta.provider,
      model: meta.model,
      promptVersion: meta.promptVersion,
      promptHash: meta.promptHash,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costUsd: meta.costUsd,
      latencyMs: meta.latencyMs,
      status: meta.status,
      error: meta.error ?? null,
      cached: meta.cached,
    });
  } catch {
    // telemetry must not break business flows
  }
}

export function createLlm(opts: { redis?: Redis; onCall?: (m: LlmCallMeta) => void } = {}): LlmClient {
  const c = getConfig();
  return new LlmClient({
    ...providerOptionsFromEnv(c, { url: c.WEB_URL, name: 'SelloEasy' }),
    timeoutMs: c.LLM_TIMEOUT_MS,
    maxConcurrency: c.LLM_MAX_CONCURRENCY,
    cacheTtlSeconds: c.LLM_CACHE_TTL_SECONDS,
    cache: opts.redis ? redisLlmCache(opts.redis) : undefined,
    onCall: async (m) => {
      opts.onCall?.(m);
      await recordLlmCall(m);
    },
  });
}
