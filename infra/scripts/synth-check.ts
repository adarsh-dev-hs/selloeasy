/**
 * CI gate (plan §23.3, P8): synthesize every stack for staging AND production from test/fixture.env with dummy values,
 * with cdk-nag AwsSolutionsChecks applied. Fails on any synth error or unsuppressed cdk-nag error.
 * Needs no AWS account and no network access.
 *
 *   pnpm --filter @selloeasy/infra synth:check
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../lib/build-app';
import { readEnvFile } from '../lib/config';

// Deprecation notices emitted from inside aws-cdk-lib are noise here.
process.env.JSII_DEPRECATED ??= 'quiet';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readEnvFile(join(here, '..', 'test', 'fixture.env'));

const variants: Array<{ label: string; overrides: Record<string, string> }> = [
  { label: 'staging', overrides: { DEPLOY_ENV: 'staging' } },
  {
    label: 'production',
    overrides: { DEPLOY_ENV: 'production', DOMAIN_NAME: 'selloeasy.example.com', MAIL_FROM: 'SelloEasy <no-reply@selloeasy.example.com>', RDS_MULTI_AZ: 'true', NAT_GATEWAYS: '2', ECS_API_DESIRED_COUNT: '2', ECS_WEB_DESIRED_COUNT: '2' },
  },
  {
    label: 'production (existing CloudFront cert, no OIDC)',
    overrides: {
      DEPLOY_ENV: 'production',
      ACM_CERTIFICATE_ARN: 'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000',
      GITHUB_REPOSITORY: '',
      RDS_MULTI_AZ: 'true',
    },
  },
];

let failed = false;
for (const { label, overrides } of variants) {
  const outdir = mkdtempSync(join(tmpdir(), 'selloeasy-synth-'));
  try {
    const { app } = buildApp({ ...fixture, ...overrides }, { outdir });
    const assembly = app.synth();
    const errors: string[] = [];
    let warnings = 0;
    for (const stack of assembly.stacks) {
      for (const m of stack.messages) {
        if (m.level === 'error') errors.push(`  [${stack.stackName}] ${m.id}\n      ${String(m.entry.data).split('\n')[0]}`);
        if (m.level === 'warning') warnings++;
      }
    }
    const names = assembly.stacks.map((s) => `${s.stackName} (${s.environment.region})`);
    if (errors.length) {
      failed = true;
      console.error(`✗ ${label}: ${errors.length} error(s)\n${errors.join('\n')}`);
    } else {
      console.log(`✓ ${label}: ${assembly.stacks.length} stacks synthesized, cdk-nag clean (${warnings} warning(s))`);
      for (const n of names) console.log(`    - ${n}`);
    }
  } catch (err) {
    failed = true;
    console.error(`✗ ${label}: ${err instanceof Error ? err.stack : err}`);
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
