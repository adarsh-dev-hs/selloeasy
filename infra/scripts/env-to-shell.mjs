#!/usr/bin/env node
// Prints `export KEY='value'` lines for every non-empty key of a dotenv file, for `eval` in bash.
// Uses Node's own dotenv parser (same as `node --env-file`), so values with spaces / inline comments are safe —
// `source .env.aws` would execute e.g. `PIPELINE_SCHEDULE_CRON=0 */6 * * *` as a command.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const file = process.argv[2];
if (!file) {
  console.error('usage: env-to-shell.mjs <env-file>');
  process.exit(2);
}
const env = parseEnv(readFileSync(file, 'utf8'));
const quote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
for (const [key, value] of Object.entries(env)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === '') continue;
  process.stdout.write(`export ${key}=${quote(value)}\n`);
}
