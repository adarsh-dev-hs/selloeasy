import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { deployEnvSchemaChecked, formatEnvError, type DeployEnv } from '@selloeasy/shared/env';

/**
 * Infra configuration (plan §22.3 group 12, §23.1).
 *
 * The deploy keys are validated with the shared `deployEnvSchema` — the same schema `pnpm env:check --target aws`
 * uses — so CDK never sees a value the platform would reject. A few infra-only extras (GitHub OIDC trust, runtime
 * tunables passed through to the containers) are read here as well; they are all optional.
 */

/** Runtime keys that are copied verbatim from the deploy env file into every container (when non-empty). */
export const RUNTIME_PASSTHROUGH_KEYS = [
  'LOG_LEVEL',
  'OPENROUTER_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_REASONING_EFFORT',
  'ANTHROPIC_BASE_URL',
  'LLM_FALLBACK_PROVIDER',
  'LLM_SUPPORTS_TEMPERATURE',
  'LLM_SUPPORTS_JSON_SCHEMA',
  'LLM_PRICE_INPUT_PER_MTOK',
  'LLM_PRICE_OUTPUT_PER_MTOK',
  'LLM_MODE',
  'LLM_MAX_CONCURRENCY',
  'LLM_TIMEOUT_MS',
  'LLM_CACHE_TTL_SECONDS',
  'ACCESS_TOKEN_TTL',
  'REFRESH_TOKEN_TTL',
  'INVITE_TTL_HOURS',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW',
  'SUPERADMIN_EMAIL',
  'DATABASE_POOL_MAX',
  'UPLOAD_MAX_MB',
  'PIPELINE_SCHEDULE_CRON',
  'PIPELINE_MATCH_THRESHOLD',
  'PIPELINE_MAX_LLM_CALLS_PER_RUN',
  'PIPELINE_EVENT_WINDOW_DAYS',
  'PIPELINE_BATCH_SIZE',
  'LEADS_PAGE_SIZE_DEFAULT',
  'CRAWL_MAX_PAGES',
  'CRAWL_MAX_DEPTH',
  'FEATURE_LEAD_VISIBILITY_TOGGLE',
  'AUDIT_RETENTION_DAYS',
  'OTEL_ENABLED',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_SERVICE_NAMESPACE',
] as const;

export interface InfraConfig extends DeployEnv {
  /** `owner/repo` allowed to assume the GitHub OIDC deploy role. Empty → no OIDC role is created. */
  githubRepository?: string;
  /** Re-use an existing `token.actions.githubusercontent.com` provider (it is account-global). */
  githubOidcProviderArn?: string;
  /** Mail domain = the domain part of MAIL_FROM (SES identity + DKIM records). */
  mailDomain: string;
  /** Hostname CloudFront uses to reach the ALB (`origin.<DOMAIN_NAME>`). */
  originDomainName: string;
  /** Resource name prefix, e.g. `selloeasy-staging`. */
  prefix: string;
  /** Secrets Manager id of the app JSON secret. */
  appSecretName: string;
  /** Passthrough runtime tunables (non-secret). */
  runtimePassthrough: Record<string, string>;
  isProduction: boolean;
}

/** Reads a dotenv file (same parser Node uses for --env-file). Values already in `base` win. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`Env file not found: ${path}`);
  return { ...parseEnv(readFileSync(path, 'utf8')) } as Record<string, string>;
}

export function loadInfraConfig(raw: Record<string, string | undefined>): InfraConfig {
  const parsed = deployEnvSchemaChecked.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid AWS deploy configuration (plan §22.3 group 12):\n${formatEnvError(parsed.error)}`);
  }
  const env = parsed.data;
  const problems: string[] = [];

  if (env.NAT_GATEWAYS < 1 && !env.VPC_ID) {
    problems.push('NAT_GATEWAYS must be >= 1 (the worker calls OpenRouter and crawls websites over the internet)');
  }
  if (env.ACM_CERTIFICATE_ARN && !env.ACM_CERTIFICATE_ARN.startsWith('arn:aws:acm:us-east-1:')) {
    problems.push('ACM_CERTIFICATE_ARN is used by CloudFront and must be an ACM certificate in us-east-1');
  }
  const mailMatch = /<?([^<>\s@]+)@([^<>\s@]+)>?\s*$/.exec(env.MAIL_FROM.trim());
  if (!mailMatch) problems.push(`MAIL_FROM must contain an email address (got "${env.MAIL_FROM}")`);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.DOMAIN_NAME)) problems.push('DOMAIN_NAME must be a hostname like app.example.com');
  if (problems.length) {
    throw new Error(`Invalid AWS deploy configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const runtimePassthrough: Record<string, string> = {};
  for (const key of RUNTIME_PASSTHROUGH_KEYS) {
    const v = raw[key]?.trim();
    if (v) runtimePassthrough[key] = v;
  }

  const githubRepository = raw.GITHUB_REPOSITORY?.trim() || undefined;
  const githubOidcProviderArn = raw.GITHUB_OIDC_PROVIDER_ARN?.trim() || undefined;

  return {
    ...env,
    githubRepository,
    githubOidcProviderArn,
    mailDomain: mailMatch![2]!.toLowerCase(),
    originDomainName: `origin.${env.DOMAIN_NAME}`,
    prefix: `selloeasy-${env.DEPLOY_ENV}`,
    appSecretName: `selloeasy/${env.DEPLOY_ENV}/app`,
    runtimePassthrough,
    isProduction: env.DEPLOY_ENV === 'production',
  };
}

/** Stack id / CloudFormation stack name, prefixed with DEPLOY_ENV (plan §23.1). */
export function stackName(cfg: Pick<InfraConfig, 'DEPLOY_ENV'>, name: string): string {
  return `${cfg.DEPLOY_ENV}-selloeasy-${name}`;
}

export const ECR_SERVICES = ['api', 'worker', 'web'] as const;
export type EcrService = (typeof ECR_SERVICES)[number];

export function ecrRepositoryName(cfg: Pick<InfraConfig, 'ECR_REPOSITORY_PREFIX' | 'DEPLOY_ENV'>, service: EcrService) {
  return `${cfg.ECR_REPOSITORY_PREFIX}/${cfg.DEPLOY_ENV}/${service}`;
}
