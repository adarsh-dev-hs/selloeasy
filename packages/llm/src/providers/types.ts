/**
 * Provider adapter contract (plan2 §10.2). Adapters only shape the HTTP call for one vendor;
 * everything provider-agnostic (prompts, validation, repair, cache, retries, telemetry, mock)
 * lives in LlmClient.
 */
export type ProviderId = 'openrouter' | 'openai' | 'anthropic';
export const PROVIDER_IDS: readonly ProviderId[] = ['openrouter', 'openai', 'anthropic'];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  system: string;
  messages: ChatMessage[];
  /** JSON Schema of the expected output — sent as structured output where the provider supports it. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens: number;
  temperature?: number;
  signal: AbortSignal;
}

export interface ProviderResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
}

export interface ProviderConfig {
  id: ProviderId;
  apiKey: string;
  /** Exactly the configured model string — never hard-coded (ADR-0009). */
  model: string;
  baseUrl: string;
  /** OpenAI reasoning models only: minimal | low | medium | high. */
  reasoningEffort?: string;
  /** USD per 1M tokens, for providers that don't report cost. */
  priceInputPerMTok?: number;
  priceOutputPerMTok?: number;
  /** Capability overrides for models newer than our table. */
  supportsTemperature?: boolean;
  supportsJsonSchema?: boolean;
  appUrl?: string;
  appName?: string;
}

export interface ChatProvider {
  readonly id: ProviderId;
  readonly model: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/** Remove JSON Schema keys vendors commonly reject in structured-output schemas. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, ...rest } = schema;
  void _s;
  return rest;
}

export function costFromTable(cfg: ProviderConfig, inputTokens: number, outputTokens: number): number | null {
  if (cfg.priceInputPerMTok === undefined && cfg.priceOutputPerMTok === undefined) return null;
  return (
    ((cfg.priceInputPerMTok ?? 0) * inputTokens + (cfg.priceOutputPerMTok ?? 0) * outputTokens) / 1_000_000
  );
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export function errorMessage(json: Record<string, unknown>, status: number): string {
  const err = json.error as { message?: string } | string | undefined;
  if (typeof err === 'string') return err;
  return err?.message ?? `HTTP ${status}`;
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500);
}
