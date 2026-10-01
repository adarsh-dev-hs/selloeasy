import type { ProviderConfig } from './types';

/**
 * What a (provider, model) pair accepts (plan2 §10.2). Resolved from model-family patterns, then
 * overridden by env (LLM_SUPPORTS_TEMPERATURE / LLM_SUPPORTS_JSON_SCHEMA) for models newer than this table.
 * Adapters additionally self-heal at runtime: a 400 that names an unsupported parameter disables it.
 */
export interface Capabilities {
  supportsTemperature: boolean;
  supportsJsonSchema: boolean;
  /** Request field that caps output tokens. */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** Reasoning models spend output budget on hidden reasoning — give them headroom. */
  reasoning: boolean;
  supportsReasoningEffort: boolean;
}

const OPENAI_REASONING = /^(o\d|gpt-5)/i;

export function capabilitiesFor(
  cfg: Pick<ProviderConfig, 'id' | 'model' | 'supportsTemperature' | 'supportsJsonSchema'>,
): Capabilities {
  let caps: Capabilities;
  switch (cfg.id) {
    case 'openai': {
      const reasoning = OPENAI_REASONING.test(cfg.model);
      caps = {
        supportsTemperature: !reasoning,
        supportsJsonSchema: true,
        tokenParam: 'max_completion_tokens',
        reasoning,
        supportsReasoningEffort: reasoning,
      };
      break;
    }
    case 'anthropic':
      caps = {
        supportsTemperature: true,
        supportsJsonSchema: true,
        tokenParam: 'max_tokens',
        reasoning: false,
        supportsReasoningEffort: false,
      };
      break;
    default: {
      // OpenRouter normalises most parameters across upstream models.
      const upstreamReasoning = /(^|\/)(o\d|gpt-5)/i.test(cfg.model);
      caps = {
        supportsTemperature: !upstreamReasoning,
        supportsJsonSchema: true,
        tokenParam: 'max_tokens',
        reasoning: upstreamReasoning,
        supportsReasoningEffort: false,
      };
    }
  }
  if (cfg.supportsTemperature !== undefined) caps.supportsTemperature = cfg.supportsTemperature;
  if (cfg.supportsJsonSchema !== undefined) caps.supportsJsonSchema = cfg.supportsJsonSchema;
  return caps;
}

/** Output budget including reasoning headroom. */
export function outputBudget(caps: Capabilities, requested: number): number {
  return caps.reasoning ? Math.max(4000, requested * 3) : requested;
}
