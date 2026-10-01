import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { ChatProvider, ProviderConfig } from './types';

export * from './types';
export * from './capabilities';
export { AnthropicProvider } from './anthropic';
export { OpenAICompatibleProvider } from './openai-compatible';

/** Build the adapter for a provider config. New vendors plug in here. */
export function createProvider(cfg: ProviderConfig, fetchImpl?: typeof fetch): ChatProvider {
  switch (cfg.id) {
    case 'anthropic':
      return new AnthropicProvider(cfg, fetchImpl);
    case 'openai':
    case 'openrouter':
      return new OpenAICompatibleProvider(cfg, fetchImpl);
    default:
      throw new Error(`Unknown LLM provider: ${String((cfg as { id: string }).id)}`);
  }
}
