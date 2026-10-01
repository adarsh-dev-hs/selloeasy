/**
 * pnpm env:check [--file .env] [--target local|aws]
 *
 * Validates an env file against the single env schema (packages/shared/src/env.ts, ADR-0012).
 * - target=local  → runtime schema (what api/worker need)
 * - target=aws    → runtime schema with AWS production overrides + deploy schema (group 12)
 * Exit code 1 lists every missing/invalid key — used by `pnpm deploy:aws` before touching AWS.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deployEnvSchemaChecked, formatEnvError, runtimeEnvSchema } from '../packages/shared/src/env';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const hash = val.startsWith('"') || val.startsWith("'") ? -1 : val.search(/\s+#/);
    if (hash > -1) val = val.slice(0, hash).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

const file = resolve(arg('file', '.env'));
const target = arg('target', 'local');
if (!existsSync(file)) {
  console.error(`✗ ${file} not found`);
  process.exit(1);
}
const env = parseEnvFile(file);
let ok = true;

if (target === 'aws') {
  // Values the containers will receive in ECS (set by CDK), so the file itself doesn't need them.
  const ecs = {
    ...env,
    NODE_ENV: 'production',
    APP_ENV: env.DEPLOY_ENV ?? 'staging',
    STORAGE_DRIVER: 's3',
    MAIL_DRIVER: 'ses',
    COOKIE_SECURE: 'true',
    TRUST_PROXY: 'true',
    DATABASE_URL: env.DATABASE_URL || 'postgres://set-by-cdk',
    DATABASE_SSL: 'true',
    REDIS_URL: env.REDIS_URL || 'rediss://set-by-cdk:6379',
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET && !env.JWT_ACCESS_SECRET.startsWith('change-me') ? env.JWT_ACCESS_SECRET : 'generated-by-deploy-script-0123456789abcdef',
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET && !env.JWT_REFRESH_SECRET.startsWith('change-me') ? env.JWT_REFRESH_SECRET : 'generated-by-deploy-script-fedcba9876543210',
    LLM_MODE: 'live',
  };
  const d = deployEnvSchemaChecked.safeParse(env);
  if (!d.success) {
    ok = false;
    console.error(`✗ Deploy configuration (group 12) is invalid:\n${formatEnvError(d.error)}`);
  }
  const r = runtimeEnvSchema.safeParse(ecs);
  if (!r.success) {
    ok = false;
    console.error(`✗ Runtime configuration for AWS is invalid:\n${formatEnvError(r.error)}`);
  }
} else {
  const r = runtimeEnvSchema.safeParse(env);
  if (!r.success) {
    ok = false;
    console.error(`✗ Runtime configuration is invalid:\n${formatEnvError(r.error)}`);
  } else if (!env.OPENROUTER_API_KEY) {
    console.warn('! OPENROUTER_API_KEY is empty — the app will run in LLM mock mode.');
  }
}

if (!ok) process.exit(1);
console.log(`✓ ${file} is valid for target=${target}`);
