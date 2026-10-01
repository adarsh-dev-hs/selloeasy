import type { RuntimeEnv } from '@selloeasy/shared/env';
import type { ProviderConfig, ProviderId } from './providers/types';

type LlmEnv = Pick<
  RuntimeEnv,
  | 'LLM_MODE'
  | 'LLM_PROVIDER'
  | 'LLM_FALLBACK_PROVIDER'
  | 'LLM_SUPPORTS_TEMPERATURE'
  | 'LLM_SUPPORTS_JSON_SCHEMA'
  | 'LLM_PRICE_INPUT_PER_MTOK'
  | 'LLM_PRICE_OUTPUT_PER_MTOK'
  | 'OPENROUTER_API_KEY'
  | 'OPENROUTER_MODEL'
  | 'OPENROUTER_BASE_URL'
  | 'OPENAI_API_KEY'
  | 'OPENAI_MODEL'
  | 'OPENAI_BASE_URL'
  | 'OPENAI_REASONING_EFFORT'
  | 'ANTHROPIC_API_KEY'
  | 'ANTHROPIC_MODEL'
  | 'ANTHROPIC_BASE_URL'
>;

/**
 * Build a provider config from the already-validated runtime config (plan2 §10.3).
 * This module never reads process.env — the caller passes `getConfig()`.
 */
export function providerConfig(env: LlmEnv, id: ProviderId, app?: { url?: string; name?: string }): ProviderConfig {
  const common = {
    priceInputPerMTok: env.LLM_PRICE_INPUT_PER_MTOK,
    priceOutputPerMTok: env.LLM_PRICE_OUTPUT_PER_MTOK,
    supportsTemperature: env.LLM_SUPPORTS_TEMPERATURE,
    supportsJsonSchema: env.LLM_SUPPORTS_JSON_SCHEMA,
    appUrl: app?.url,
    appName: app?.name,
  };
  switch (id) {
    case 'openai':
      return {
        id,
        apiKey: env.OPENAI_API_KEY ?? '',
        model: env.OPENAI_MODEL ?? '',
        baseUrl: env.OPENAI_BASE_URL,
        reasoningEffort: env.OPENAI_REASONING_EFFORT || undefined,
        ...common,
      };
    case 'anthropic':
      return { id, apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.ANTHROPIC_MODEL ?? '', baseUrl: env.ANTHROPIC_BASE_URL, ...common };
    default:
      return { id: 'openrouter', apiKey: env.OPENROUTER_API_KEY ?? '', model: env.OPENROUTER_MODEL ?? '', baseUrl: env.OPENROUTER_BASE_URL, ...common };
  }
}

export function providerOptionsFromEnv(env: LlmEnv, app?: { url?: string; name?: string }) {
  return {
    mode: env.LLM_MODE,
    provider: env.LLM_MODE === 'live' ? providerConfig(env, env.LLM_PROVIDER, app) : undefined,
    fallback: env.LLM_MODE === 'live' && env.LLM_FALLBACK_PROVIDER ? providerConfig(env, env.LLM_FALLBACK_PROVIDER, app) : undefined,
  };
}

/** Key/model env names per provider — used for validation messages and the auto-mock check. */
export const PROVIDER_ENV_KEYS: Record<ProviderId, { key: string; model: string }> = {
  openrouter: { key: 'OPENROUTER_API_KEY', model: 'OPENROUTER_MODEL' },
  openai: { key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL' },
  anthropic: { key: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL' },
};
