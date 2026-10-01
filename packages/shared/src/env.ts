import { z } from 'zod';

/**
 * Single source of truth for every environment variable (plan §22.3, ADR-0012).
 *
 * - Every key read anywhere in the platform is declared here.
 * - Apps read configuration only through `@selloeasy/core` `getConfig()`, which parses with this schema.
 * - `scripts/docs-check.ts` verifies every key here is present in `.env.example` and documented.
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) => z.coerce.number().int().default(def);
const str = (def: string) => z.string().default(def);
const optStr = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));

export const runtimeEnvShape = z.object({
    // 1. LLM — provider switch (plan2 §10). The model always comes from the selected provider's *_MODEL.
    LLM_PROVIDER: z.enum(['openrouter', 'openai', 'anthropic']).default('openrouter'),
    // Optional failover provider (used after retries fail with 5xx/timeouts). Must be configured too.
    LLM_FALLBACK_PROVIDER: z
      .union([z.enum(['openrouter', 'openai', 'anthropic']), z.literal('')])
      .optional()
      .transform((v) => v || undefined),
    // Capability overrides for models newer than the built-in table ('' = auto).
    LLM_SUPPORTS_TEMPERATURE: z
      .union([z.literal('true'), z.literal('false'), z.literal('')])
      .optional()
      .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
    LLM_SUPPORTS_JSON_SCHEMA: z
      .union([z.literal('true'), z.literal('false'), z.literal('')])
      .optional()
      .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
    // USD per 1M tokens for providers that don't report cost (OpenAI, Anthropic). Empty = cost shown as n/a.
    LLM_PRICE_INPUT_PER_MTOK: z.union([z.coerce.number().min(0), z.literal('')]).optional().transform((v) => (v === '' ? undefined : v)),
    LLM_PRICE_OUTPUT_PER_MTOK: z.union([z.coerce.number().min(0), z.literal('')]).optional().transform((v) => (v === '' ? undefined : v)),
    // OpenRouter
    OPENROUTER_API_KEY: optStr(),
    OPENROUTER_MODEL: optStr(),
    OPENROUTER_BASE_URL: str('https://openrouter.ai/api/v1'),
    // OpenAI (direct)
    OPENAI_API_KEY: optStr(),
    OPENAI_MODEL: optStr(),
    OPENAI_BASE_URL: str('https://api.openai.com/v1'),
    OPENAI_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high', '']).default('low'),
    // Anthropic (direct)
    ANTHROPIC_API_KEY: optStr(),
    ANTHROPIC_MODEL: optStr(),
    ANTHROPIC_BASE_URL: str('https://api.anthropic.com'),
    LLM_MODE: z.enum(['live', 'mock']).default('live'),
    LLM_MAX_CONCURRENCY: int(4),
    LLM_TIMEOUT_MS: int(30000),
    LLM_CACHE_TTL_SECONDS: int(604800),

    // 2. App runtime
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_ENV: z.enum(['local', 'staging', 'production', 'test']).default('local'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    WEB_URL: str('http://localhost:3000'),
    API_INTERNAL_URL: str('http://localhost:4000'),
    API_PORT: int(4000),
    WEB_PORT: int(3000),
    DOCS_PORT: int(3001),
    CORS_ORIGINS: str('http://localhost:3000'),
    COOKIE_DOMAIN: optStr(),
    COOKIE_SECURE: bool.default(false),
    TRUST_PROXY: bool.default(false),

    // 3. Auth & security
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: str('15m'),
    REFRESH_TOKEN_TTL: str('7d'),
    INVITE_TTL_HOURS: int(72),
    RATE_LIMIT_MAX: int(300),
    RATE_LIMIT_WINDOW: str('1m'),
    SUPERADMIN_EMAIL: z.string().email().default('superadmin@selloeasy.local'),
    SUPERADMIN_PASSWORD: str('Admin@123'),

    // 4. Database
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool.default(false),
    DATABASE_SSL_CA_FILE: str('/app/certs/rds-global-bundle.pem'),
    DATABASE_POOL_MAX: int(10),

    // 5. Redis
    REDIS_URL: z.string().min(1),
    REDIS_TLS: bool.default(false),

    // 6. Object storage
    STORAGE_DRIVER: z.enum(['minio', 's3']).default('minio'),
    S3_BUCKET: str('selloeasy-uploads'),
    S3_REGION: str('ap-south-1'),
    S3_ENDPOINT: optStr(),
    S3_PUBLIC_ENDPOINT: optStr(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_ACCESS_KEY_ID: optStr(),
    S3_SECRET_ACCESS_KEY: optStr(),
    UPLOAD_MAX_MB: int(20),

    // 7. Email
    MAIL_DRIVER: z.enum(['smtp', 'ses']).default('smtp'),
    MAIL_FROM: str('SelloEasy <no-reply@selloeasy.local>'),
    SMTP_HOST: str('localhost'),
    SMTP_PORT: int(1025),
    SMTP_USER: optStr(),
    SMTP_PASSWORD: optStr(),
    SMTP_SECURE: bool.default(false),
    SES_REGION: optStr(),
    SES_CONFIGURATION_SET: optStr(),

    // 8. Pipeline & product defaults
    PIPELINE_SCHEDULE_CRON: str('0 */6 * * *'),
    PIPELINE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
    PIPELINE_MAX_LLM_CALLS_PER_RUN: int(60),
    PIPELINE_EVENT_WINDOW_DAYS: int(180),
    PIPELINE_BATCH_SIZE: int(8),
    LEADS_PAGE_SIZE_DEFAULT: int(6),
    CRAWL_MAX_PAGES: int(25),
    CRAWL_MAX_DEPTH: int(2),
    FEATURE_LEAD_VISIBILITY_TOGGLE: bool.default(false),

    // 8b. Platform data source (plan2 §6–7)
    IMPORT_MAX_MB: int(10),
    IMPORT_MAX_ROWS: int(5000),
    IMPORT_MAX_INVALID_RATIO: z.coerce.number().min(0).max(1).default(0.2),
    DATA_MAX_AGE_DAYS: int(730),
    INGESTION_MAX_ROWS_PER_RUN: int(500),
    IMPORT_AI_GATE_ENABLED: bool.default(false),
    IMPORT_AI_GATE_MAX_CALLS: int(10),
    STAGING_RETENTION_DAYS: int(30),
    AUDIT_RETENTION_DAYS: int(365),

    // 9. Seed / demo
    SEED_ON_START: bool.default(true),
    SEED_DEMO_DATA: bool.default(true),

    // 10. Observability
    OTEL_ENABLED: bool.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: optStr(),
    OTEL_SERVICE_NAMESPACE: str('selloeasy'),

    // 11. Secrets source
    SECRETS_SOURCE: z.enum(['env', 'aws-secrets-manager']).default('env'),
    AWS_SECRETS_ID: optStr(),
    AWS_REGION: optStr(),
});

export const runtimeEnvSchema = runtimeEnvShape.superRefine((env, ctx) => {
    const require = (key: keyof typeof env, when: string) => {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when ${when}` });
    };
    // ADR-0009: the model is whatever the selected provider's *_MODEL says — there is no default in code.
    const keys = { openrouter: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'], openai: ['OPENAI_API_KEY', 'OPENAI_MODEL'], anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'] } as const;
    if (env.LLM_MODE === 'live') {
      for (const k of keys[env.LLM_PROVIDER]) require(k, `LLM_MODE=live and LLM_PROVIDER=${env.LLM_PROVIDER}`);
    }
    if (env.LLM_FALLBACK_PROVIDER) {
      if (env.LLM_FALLBACK_PROVIDER === env.LLM_PROVIDER)
        ctx.addIssue({ code: 'custom', path: ['LLM_FALLBACK_PROVIDER'], message: 'LLM_FALLBACK_PROVIDER must differ from LLM_PROVIDER' });
      for (const k of keys[env.LLM_FALLBACK_PROVIDER]) require(k, `LLM_FALLBACK_PROVIDER=${env.LLM_FALLBACK_PROVIDER}`);
    }
    if (env.MAIL_DRIVER === 'ses') require('SES_REGION', 'MAIL_DRIVER=ses');
    if (env.STORAGE_DRIVER === 'minio') {
      require('S3_ENDPOINT', 'STORAGE_DRIVER=minio');
      require('S3_ACCESS_KEY_ID', 'STORAGE_DRIVER=minio');
      require('S3_SECRET_ACCESS_KEY', 'STORAGE_DRIVER=minio');
    }
    if (env.SECRETS_SOURCE === 'aws-secrets-manager') {
      require('AWS_SECRETS_ID', 'SECRETS_SOURCE=aws-secrets-manager');
      require('AWS_REGION', 'SECRETS_SOURCE=aws-secrets-manager');
    }
    if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
      if (!env.COOKIE_SECURE)
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE must be true outside local' });
      if (env.JWT_ACCESS_SECRET.startsWith('change-me'))
        ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'Replace the placeholder JWT secret' });
    }
  });

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

/** Group 12 — read by infra/ CDK and deploy scripts only. */
export const deployEnvSchema = z.object({
  AWS_ACCOUNT_ID: z.string().regex(/^\d{12}$/, 'AWS_ACCOUNT_ID must be a 12-digit account id'),
  AWS_REGION: z.string().min(1).default('ap-south-1'),
  AWS_PROFILE: optStr(),
  DEPLOY_ENV: z.enum(['staging', 'production']).default('staging'),
  DOMAIN_NAME: z.string().min(1, 'DOMAIN_NAME is required to deploy'),
  HOSTED_ZONE_ID: z.string().min(1, 'HOSTED_ZONE_ID is required to deploy'),
  ACM_CERTIFICATE_ARN: optStr(),
  ECR_REPOSITORY_PREFIX: str('selloeasy'),
  IMAGE_TAG: str('latest'),
  VPC_ID: optStr(),
  NAT_GATEWAYS: int(1),
  RDS_INSTANCE_CLASS: str('t4g.micro'),
  RDS_ALLOCATED_STORAGE_GB: int(20),
  RDS_MULTI_AZ: bool.default(false),
  RDS_BACKUP_RETENTION_DAYS: int(7),
  REDIS_NODE_TYPE: str('cache.t4g.micro'),
  ECS_API_CPU: int(512),
  ECS_API_MEMORY: int(1024),
  ECS_API_DESIRED_COUNT: int(1),
  ECS_WORKER_CPU: int(512),
  ECS_WORKER_MEMORY: int(1024),
  ECS_WORKER_DESIRED_COUNT: int(1),
  ECS_WEB_CPU: int(256),
  ECS_WEB_MEMORY: int(512),
  ECS_WEB_DESIRED_COUNT: int(1),
  ALARM_EMAIL: optStr(),
  GITHUB_OIDC_ROLE_ARN: optStr(),
  // Secrets that the deploy script pushes into Secrets Manager.
  LLM_PROVIDER: z.enum(['openrouter', 'openai', 'anthropic']).default('openrouter'),
  OPENROUTER_API_KEY: optStr(),
  OPENROUTER_MODEL: optStr(),
  OPENAI_API_KEY: optStr(),
  OPENAI_MODEL: optStr(),
  ANTHROPIC_API_KEY: optStr(),
  ANTHROPIC_MODEL: optStr(),
  MAIL_FROM: z.string().min(1),
  SES_REGION: str('ap-south-1'),
});
export type DeployEnv = z.infer<typeof deployEnvSchema>;

/** Deploy-time check: the selected provider must have a key and a model. */
export const deployEnvSchemaChecked = deployEnvSchema.superRefine((env, ctx) => {
  const pairs = { openrouter: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'], openai: ['OPENAI_API_KEY', 'OPENAI_MODEL'], anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'] } as const;
  for (const k of pairs[env.LLM_PROVIDER]) {
    if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required to deploy with LLM_PROVIDER=${env.LLM_PROVIDER}` });
  }
});

/** All keys the platform knows about, used by docs/env checks. */
export const ALL_ENV_KEYS: string[] = [
  ...Object.keys(runtimeEnvShape.shape),
  ...Object.keys(deployEnvSchema.shape),
].filter((k, i, a) => a.indexOf(k) === i);

export function formatEnvError(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
