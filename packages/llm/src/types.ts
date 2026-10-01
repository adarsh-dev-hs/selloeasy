import type { z } from 'zod';

/**
 * A versioned prompt (plan §16.2). Every prompt:
 * - builds system + user messages from a typed input,
 * - declares a zod schema for its JSON output (validated on every call),
 * - ships a deterministic `mock` used when LLM_MODE=mock (tests, CI, key-less demo).
 */
export interface PromptDefinition<I, O> {
  id: string;
  version: string;
  schema: z.ZodType<O>;
  build(input: I): { system: string; user: string };
  mock(input: I): O;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCallMeta {
  purpose: string;
  /** openrouter | openai | anthropic | mock */
  provider: string;
  promptVersion: string;
  model: string;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  promptHash: string;
  status: 'ok' | 'error';
  error?: string;
  orgId?: string | null;
}

export interface LlmResult<O> {
  data: O;
  meta: LlmCallMeta;
}

export interface LlmCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface LlmOptions {
  mode: 'live' | 'mock';
  /** Primary provider (required in live mode). See ./providers. */
  provider?: import('./providers/types').ProviderConfig;
  /** Optional failover used when the primary fails after retries (5xx / timeouts). */
  fallback?: import('./providers/types').ProviderConfig;
  timeoutMs: number;
  maxConcurrency: number;
  cacheTtlSeconds: number;
  cache?: LlmCache;
  /** Telemetry sink — the caller persists to `llm_calls`. */
  onCall?: (meta: LlmCallMeta) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

export interface RunContext {
  orgId?: string | null;
  /** Skip the response cache (e.g. user asked for a fresh outreach draft). */
  noCache?: boolean;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
