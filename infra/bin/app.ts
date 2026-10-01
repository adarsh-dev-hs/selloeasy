#!/usr/bin/env node
/**
 * CDK entrypoint (cdk.json → `npx tsx bin/app.ts`).
 *
 * Config comes from process.env (deploy.sh exports the env file) and, optionally, an env file given with
 * `--env-file <path>` / SELLOEASY_ENV_FILE. Values already in process.env win over the file.
 * Everything is validated with `deployEnvSchema` from @selloeasy/shared/env before any stack is built.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../lib/build-app';
import { readEnvFile } from '../lib/config';

function envFileArg(): string | undefined {
  const i = process.argv.indexOf('--env-file');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith('--env-file='));
  if (eq) return eq.slice('--env-file='.length);
  return process.env.SELLOEASY_ENV_FILE || undefined;
}

const file = envFileArg();
// Relative paths resolve against where the user ran pnpm (INIT_CWD), then against infra/.
const filePath = file
  ? ([resolve(process.env.INIT_CWD ?? process.cwd(), file), resolve(process.cwd(), file)].find((p) =>
      existsSync(p),
    ) ?? resolve(process.cwd(), file))
  : undefined;
const raw: Record<string, string | undefined> = {
  ...(filePath ? readEnvFile(filePath) : {}),
  ...process.env,
};

try {
  const { app } = buildApp(raw);
  app.synth();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
