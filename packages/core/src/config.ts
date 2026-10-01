import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { formatEnvError, runtimeEnvSchema, type RuntimeEnv } from '@selloeasy/shared/env';

/**
 * Config loading (ADR-0012).
 *
 * - `initConfig()` is awaited once at process boot. With SECRETS_SOURCE=aws-secrets-manager it pulls the
 *   JSON secret AWS_SECRETS_ID and merges it over process.env before validation.
 * - `getConfig()` returns the validated, typed config everywhere else. Nothing else reads process.env.
 */

export type Config = RuntimeEnv & { llmAutoMocked: boolean };

let cached: Config | undefined;
let dotenvLoaded = false;

/**
 * Host-side dev convenience: load the repo-root `.env` (never present inside images — see .dockerignore).
 * Existing process env always wins, so docker/ECS-provided values are never overridden.
 */
export function loadDotEnv(): string | null {
  if (dotenvLoaded) return null;
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      if (existsSync(candidate)) {
        process.loadEnvFile(candidate);
        return candidate;
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parse(env: NodeJS.ProcessEnv): Config {
  const input: Record<string, string | undefined> = { ...env };

  // Plan §22.2 / plan2 §10.3: with no key for the selected provider the platform still boots — in mock
  // mode — with a loud warning.
  let llmAutoMocked = false;
  const provider = input.LLM_PROVIDER?.trim() || 'openrouter';
  const keyVar = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY';
  if ((input.LLM_MODE ?? 'live') === 'live' && !input[keyVar]?.trim()) {
    input.LLM_MODE = 'mock';
    llmAutoMocked = true;
  }

  const result = runtimeEnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${formatEnvError(result.error)}`);
  }
  return { ...result.data, llmAutoMocked };
}

export async function loadAwsSecrets(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (env.SECRETS_SOURCE !== 'aws-secrets-manager') return 0;
  const secretId = env.AWS_SECRETS_ID;
  const region = env.AWS_REGION;
  if (!secretId || !region) {
    throw new Error('SECRETS_SOURCE=aws-secrets-manager requires AWS_SECRETS_ID and AWS_REGION');
  }
  const client = new SecretsManagerClient({ region });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`Secret ${secretId} has no SecretString`);
  const values = JSON.parse(res.SecretString) as Record<string, unknown>;
  let applied = 0;
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    env[k] = String(v);
    applied++;
  }
  return applied;
}

export async function initConfig(): Promise<Config> {
  loadDotEnv();
  await loadAwsSecrets();
  cached = parse(process.env);
  return cached;
}

export function getConfig(): Config {
  if (!cached) {
    loadDotEnv();
    cached = parse(process.env);
  }
  return cached;
}

/** Test helper: parse an explicit env object without touching the process cache. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  return parse(env as NodeJS.ProcessEnv);
}

export function resetConfigForTests(): void {
  cached = undefined;
}

/**
 * Connector auth values (plan2 §6.1): connectors store only the NAME of an env var. To stop a connector
 * from exfiltrating platform secrets (JWT_*, *_API_KEY…) to an external URL, only `CONNECTOR_*` vars are readable.
 */
export const CONNECTOR_SECRET_PATTERN = /^CONNECTOR_[A-Z0-9_]{1,60}$/;
export function readConnectorSecret(name: string): string | undefined {
  if (!CONNECTOR_SECRET_PATTERN.test(name)) throw new Error(`Connector secrets must be env vars named CONNECTOR_* (got ${name})`);
  loadDotEnv();
  return process.env[name] || undefined;
}
