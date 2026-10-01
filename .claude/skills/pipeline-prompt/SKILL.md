---
name: pipeline-prompt
description: Adds or changes an LLM prompt in packages/llm (versioned PromptDefinition with zod output schema and deterministic mock) or a pipeline stage in packages/pipeline / packages/engine, then evaluates it. Use when asked to "change the prompt", "add a prompt", "tune signal matching/scoring/extraction", "add a pipeline stage", or "improve precision/recall".
---

# pipeline-prompt

## Where things live

- `packages/llm/src/types.ts` — `PromptDefinition<I, O>` (`id`, `version`, `schema`, `build`, `mock`,
  `temperature?`, `maxTokens?`).
- `packages/llm/src/client.ts` — `LlmClient.run(prompt, input, { orgId, noCache })`: OpenRouter call, JSON extraction,
  zod validation, cache, telemetry. Model = `OPENROUTER_MODEL` (ADR-0009). `LLM_MODE=mock` uses `prompt.mock`.
- `packages/llm/src/prompts/*.ts` — `profile`, `signals`, `scoring`, `outreach`; helpers in `_util.ts`
  (`UNTRUSTED_DATA_RULE`, `JSON_RULE`, `doc()`, `bullets()`, `keywordHits()`, `hashUnit()`, `extractTimeline()`).
- `packages/pipeline/src/{stages,scoring}.ts` — pure stages (prefilter, dedupe, BANT+ math); tests in `packages/pipeline/test/`.
- `packages/engine/src/pipeline.ts` / `scoring.ts` — I/O orchestration that calls the LLM and persists results.

## Changing an existing prompt

1. Bump `version` (`'v1'` → `'v2'`). The cache key includes the prompt hash, so old cached outputs are not reused.
2. If the output shape changes, update the zod `schema` **and** every consumer (engine, DTOs).
3. Update `mock` so it still returns schema-valid, deterministic output for the new input/shape.
4. `pnpm --filter @selloeasy/llm test`, `pnpm --filter @selloeasy/pipeline test`, `pnpm typecheck`.
5. `pnpm eval:pipeline` (live when `OPENROUTER_API_KEY` is set; otherwise mock baseline). Record
   precision/recall + prompt version + date in `docs/(architecture)/pipeline/evaluation.mdx`.
6. Update `docs/(architecture)/pipeline/prompts.mdx` (id, version, purpose, schema, change note) and `docs/(project)/changelog.mdx`.
   Quality/cost trade-off (e.g. fewer tokens, batching) → ADR.

## Adding a new prompt

```ts
// packages/llm/src/prompts/widgets.ts
import { z } from 'zod';
import type { PromptDefinition } from '../types';
import { doc, hashUnit, JSON_RULE, keywordHits, UNTRUSTED_DATA_RULE } from './_util';

export interface WidgetClassifyInput {
  orgName: string;
  keywords: string[];
  text: string;
}
export const widgetClassifySchema = z.object({
  relevant: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
});
export type WidgetClassifyOutput = z.infer<typeof widgetClassifySchema>;

export const widgetClassifyPrompt: PromptDefinition<WidgetClassifyInput, WidgetClassifyOutput> = {
  id: 'widget.classify',
  version: 'v1',
  schema: widgetClassifySchema,
  temperature: 0.1,
  maxTokens: 300,
  build(input) {
    const system = [
      `You decide whether a document is relevant to ${input.orgName}.`,
      UNTRUSTED_DATA_RULE,
      JSON_RULE,
      'JSON shape: {"relevant":boolean,"confidence":number,"reason":string}',
    ].join('\n');
    return { system, user: doc('input', input.text) };
  },
  // Deterministic: same input → same output. No Date.now()/Math.random().
  mock(input) {
    const hits = keywordHits(input.text, input.keywords);
    const confidence = Math.min(0.95, 0.4 + hits.length * 0.15 + hashUnit(input.text) * 0.05);
    return {
      relevant: hits.length > 0,
      confidence,
      reason: hits.length ? `Mentions ${hits.join(', ')}` : 'No keyword evidence',
    };
  },
};
```

Then export from `packages/llm/src/prompts/index.ts` and call it from engine:
`const { data } = await llm.run(widgetClassifyPrompt, input, { orgId });`

## Rules

- Untrusted text (uploads, crawled pages, events) only inside `doc()` / `<event>` blocks + `UNTRUSTED_DATA_RULE`.
- Never execute tools/actions from model output; always validate with the zod schema.
- Never put a model name in code, tests, fixtures, or docs examples — use `OPENROUTER_MODEL`.
- Pipeline stages in `packages/pipeline` stay pure (no db, fetch, env, clock — pass `now` in).
- Tests must pass with `LLM_MODE=mock` and no network.

## Checklist

- [ ] `version` bumped (or new `id` + `v1`)
- [ ] zod schema matches consumers; `mock` returns schema-valid deterministic output
- [ ] Unit test covers mock + any new pure stage
- [ ] `pnpm eval:pipeline` run; `docs/(architecture)/pipeline/evaluation.mdx` updated
- [ ] `docs/(architecture)/pipeline/prompts.mdx` + changelog (+ ADR for trade-offs) updated; `pnpm docs:check`
