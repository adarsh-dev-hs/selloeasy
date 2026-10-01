import { capabilitiesFor, outputBudget, type Capabilities } from './capabilities';
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

/**
 * Adapter for OpenAI-style `/chat/completions` APIs — used by both `openrouter` and `openai`.
 * Differences are driven by Capabilities:
 * - OpenAI reasoning models (gpt-5*, o*): no custom temperature, `max_completion_tokens`, `reasoning_effort`.
 * - OpenRouter: `usage.include` returns cost; OpenAI cost comes from the optional price table.
 * Unsupported parameters named in a 400 are disabled for the rest of the process and the call is retried once.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly id;
  readonly model;
  private caps: Capabilities;

  constructor(
    private readonly cfg: ProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.id = cfg.id;
    this.model = cfg.model;
    this.caps = capabilitiesFor(cfg);
  }

  private body(req: ProviderRequest): Record<string, unknown> {
    const b: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      [this.caps.tokenParam]: outputBudget(this.caps, req.maxOutputTokens),
    };
    if (this.caps.supportsTemperature && req.temperature !== undefined) b.temperature = req.temperature;
    if (this.caps.supportsReasoningEffort && this.cfg.reasoningEffort)
      b.reasoning_effort = this.cfg.reasoningEffort;
    if (this.cfg.id === 'openrouter') b.usage = { include: true };
    if (req.jsonSchema && this.caps.supportsJsonSchema) {
      b.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, strict: false, schema: cleanSchema(req.jsonSchema.schema) },
      };
    }
    return b;
  }

  /** Disable a capability the model rejected; returns true when a retry makes sense. */
  private heal(message: string, body: Record<string, unknown>): boolean {
    if (body.response_format && /response_format|json_schema|structured/i.test(message)) {
      this.caps.supportsJsonSchema = false;
      return true;
    }
    if ('temperature' in body && /temperature/i.test(message)) {
      this.caps.supportsTemperature = false;
      return true;
    }
    if ('reasoning_effort' in body && /reasoning/i.test(message)) {
      this.caps.supportsReasoningEffort = false;
      return true;
    }
    if (/max_tokens/i.test(message) && this.caps.tokenParam === 'max_tokens') {
      this.caps.tokenParam = 'max_completion_tokens';
      return true;
    }
    return false;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = this.body(req);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (this.cfg.id === 'openrouter') {
        headers['HTTP-Referer'] = this.cfg.appUrl ?? 'https://selloeasy.local';
        headers['X-Title'] = this.cfg.appName ?? 'SelloEasy';
      }
      const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      });
      const json = await readJson(res);
      if (!res.ok || json.error) {
        const msg = errorMessage(json, res.status);
        const status = res.status || (json.error as { code?: number } | undefined)?.code;
        if (status === 400 && this.heal(msg, body)) continue;
        throw new ProviderHttpError(`${this.cfg.id} error: ${msg}`, status, isRetryableStatus(status));
      }
      const choice = (
        json.choices as
          | { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
          | undefined
      )?.[0];
      const content = choice?.message?.content ?? '';
      if (!content) {
        const why = choice?.message?.refusal
          ? `refused: ${choice.message.refusal}`
          : `empty completion (finish_reason=${choice?.finish_reason ?? 'unknown'})`;
        throw new ProviderHttpError(
          `${this.cfg.id} ${why}`,
          res.status,
          choice?.finish_reason !== 'content_filter',
        );
      }
      const usage = (json.usage ?? {}) as {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
      };
      const inputTokens = usage.prompt_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? 0;
      return {
        content,
        usage: {
          inputTokens,
          outputTokens,
          costUsd:
            typeof usage.cost === 'number' ? usage.cost : costFromTable(this.cfg, inputTokens, outputTokens),
        },
      };
    }
    throw new ProviderHttpError(`${this.cfg.id}: request rejected after capability fallbacks`, 400, false);
  }
}
