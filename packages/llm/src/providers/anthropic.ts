import { capabilitiesFor, type Capabilities } from './capabilities';
import {
  cleanSchema,
  costFromTable,
  errorMessage,
  isRetryableStatus,
  ProviderHttpError,
  readJson,
  type ChatProvider,
  type ProviderConfig,
  type ProviderRequest,
  type ProviderResponse,
} from './types';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic Messages API adapter (plan2 §10.2).
 * Structured output: we force a single tool call whose `input_schema` is the prompt's JSON Schema —
 * the tool input *is* the JSON we want, which is more reliable than asking for JSON text.
 */
export class AnthropicProvider implements ChatProvider {
  readonly id = 'anthropic' as const;
  readonly model;
  private caps: Capabilities;

  constructor(
    private readonly cfg: ProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = cfg.model;
    this.caps = capabilitiesFor(cfg);
  }

  body(req: ProviderRequest): Record<string, unknown> {
    const b: Record<string, unknown> = {
      model: this.cfg.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (this.caps.supportsTemperature && req.temperature !== undefined) b.temperature = req.temperature;
    if (req.jsonSchema && this.caps.supportsJsonSchema) {
      const name = req.jsonSchema.name.slice(0, 64);
      b.tools = [
        {
          name,
          description: 'Return the result in exactly this structure.',
          input_schema: cleanSchema(req.jsonSchema.schema),
        },
      ];
      b.tool_choice = { type: 'tool', name };
    }
    return b;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = this.body(req);
      const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      const json = await readJson(res);
      if (!res.ok) {
        const msg = errorMessage(json, res.status);
        if (res.status === 400 && 'temperature' in body && /temperature/i.test(msg)) {
          this.caps.supportsTemperature = false;
          continue;
        }
        if (res.status === 400 && body.tools && /tool/i.test(msg)) {
          this.caps.supportsJsonSchema = false;
          continue;
        }
        // 529 = overloaded
        throw new ProviderHttpError(
          `anthropic error: ${msg}`,
          res.status,
          isRetryableStatus(res.status) || res.status === 529,
        );
      }
      const blocks = (json.content ?? []) as { type: string; text?: string; input?: unknown }[];
      const tool = blocks.find((b) => b.type === 'tool_use');
      const content = tool
        ? JSON.stringify(tool.input)
        : blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
      if (!content) throw new ProviderHttpError('anthropic returned an empty response', res.status, true);
      const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      return {
        content,
        usage: { inputTokens, outputTokens, costUsd: costFromTable(this.cfg, inputTokens, outputTokens) },
      };
    }
    throw new ProviderHttpError('anthropic: request rejected after capability fallbacks', 400, false);
  }
}
