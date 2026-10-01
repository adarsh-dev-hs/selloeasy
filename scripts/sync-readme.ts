/**
 * pnpm docs:sync-readme
 * Injects shared snippets into README.md between <!-- docs:start:NAME --> / <!-- docs:end:NAME --> markers
 * so README and /docs never drift (plan §20.1). Snippets are generated from source files.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const readmePath = join(root, 'README.md');
const envExample = readFileSync(join(root, '.env.example'), 'utf8');
const provider = envExample.match(/^LLM_PROVIDER=(.*)$/m)?.[1]?.trim() || 'openrouter';
const model = envExample.match(/^OPENROUTER_MODEL=(.*)$/m)?.[1]?.trim() ?? '(unset)';

const snippets: Record<string, string> = {
  model: `The submission uses **\`${model}\`** via OpenRouter — the value of \`OPENROUTER_MODEL\` in [.env.example](.env.example) (\`LLM_PROVIDER=${provider}\`). The model is read only from env (no model names in code, ADR-0009/ADR-0017); set \`LLM_PROVIDER\` to \`openai\` or \`anthropic\` plus that provider's key and model to switch.`,
  'required-env': [
    '| Variable | Required | Notes |',
    '|---|---|---|',
    `| \`LLM_PROVIDER\` | No | \`openrouter\` (default, currently \`${provider}\`), \`openai\` or \`anthropic\`; each needs its own \`*_API_KEY\` + \`*_MODEL\`. |`,
    '| `OPENROUTER_API_KEY` | For live AI | Empty ⇒ the app runs in deterministic **mock** mode (seed data still works). |',
    `| \`OPENROUTER_MODEL\` | Yes (live) | Currently \`${model}\`. |`,
    '| Everything else | No | Sensible local defaults in `.env.example`; full reference at `/docs/getting-started/environment-variables`. |',
  ].join('\n'),
};

let readme = readFileSync(readmePath, 'utf8');
for (const [name, body] of Object.entries(snippets)) {
  const re = new RegExp(`(<!-- docs:start:${name} -->)[\\s\\S]*?(<!-- docs:end:${name} -->)`);
  if (!re.test(readme)) {
    console.warn(`! README has no markers for "${name}"`);
    continue;
  }
  readme = readme.replace(re, `$1\n${body}\n$2`);
}
writeFileSync(readmePath, readme);
console.log('✓ README snippets synced');
