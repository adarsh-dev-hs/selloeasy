import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Stack } from 'aws-cdk-lib';
import type { InfraConfig } from './config';
import { DB_NAME } from './data-stack';

/**
 * Runtime environment for the api / worker / migrate containers (plan §22.3, §23.1, §23.2).
 *
 * DATABASE_URL / REDIS_URL approach (chosen): **assembled in the container entrypoint from ECS-injected parts.**
 *   - Non-secret parts (DB_HOST, DB_PORT, DB_NAME, REDIS_HOST, REDIS_PORT) are plain task env from CFN attributes.
 *   - Secret parts (DB_USER, DB_PASSWORD from the CDK-generated RDS master secret; REDIS_AUTH_TOKEN from the
 *     generated Redis AUTH secret) are injected via ECS `secrets` by the task execution role.
 *   - `ENTRYPOINT_SCRIPT` (below) percent-encodes the password, exports
 *       DATABASE_URL=postgres://user:pass@host:port/selloeasy   and   REDIS_URL=rediss://:token@host:port
 *     unsets the raw parts and `exec`s the image's normal command.
 * Nothing is typed by hand, nothing credential-bearing lands in the template or the app secret, and a password
 * change only needs new tasks (a service redeploy) — no secret re-assembly step.
 */
// Plain `$VAR` (no braces) on purpose: `${…}` inside a template string trips CloudFormation's Fn::Sub validation.
export const ENTRYPOINT_SCRIPT = [
  'set -e',
  'if [ -n "$DB_PASSWORD" ]; then',
  `  DB_PASSWORD_ENC="$(node -e 'process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))')"`,
  '  export DATABASE_URL="postgres://$DB_USER:$DB_PASSWORD_ENC@$DB_HOST:$DB_PORT/$DB_NAME"',
  'fi',
  'if [ -n "$REDIS_AUTH_TOKEN" ]; then',
  '  export REDIS_URL="rediss://:$REDIS_AUTH_TOKEN@$REDIS_HOST:$REDIS_PORT"',
  'fi',
  'unset DB_PASSWORD DB_PASSWORD_ENC REDIS_AUTH_TOKEN',
  'exec "$@"',
].join('\n');

/** `sh -c <script> <argv0> <command…>` — ECS appends the task `command` (or a run-task override) as "$@". */
export const ENTRYPOINT = ['sh', '-c', ENTRYPOINT_SCRIPT, 'selloeasy-entrypoint'];

export interface BackendRefs {
  cfg: InfraConfig;
  dbHost: string;
  dbPort: string;
  dbSecret: secretsmanager.ISecret;
  redisHost: string;
  redisPort: string;
  redisAuthSecret: secretsmanager.ISecret;
  appSecret: secretsmanager.ISecret;
  uploadsBucket: s3.IBucket;
  sesConfigurationSetName: string;
}

export function backendEnvironment(
  r: BackendRefs,
  extra: Record<string, string> = {},
): Record<string, string> {
  const { cfg } = r;
  return {
    ...cfg.runtimePassthrough,
    NODE_ENV: 'production',
    APP_ENV: cfg.DEPLOY_ENV,
    TRUST_PROXY: 'true',
    COOKIE_SECURE: 'true',
    WEB_URL: `https://${cfg.DOMAIN_NAME}`,
    CORS_ORIGINS: `https://${cfg.DOMAIN_NAME}`,
    API_PORT: '4000',
    // LLM provider + model names are plain env (keys live in the app secret) — plan2 §10.3.
    LLM_PROVIDER: cfg.LLM_PROVIDER,
    ...(cfg.OPENROUTER_MODEL ? { OPENROUTER_MODEL: cfg.OPENROUTER_MODEL } : {}),
    ...(cfg.OPENAI_MODEL ? { OPENAI_MODEL: cfg.OPENAI_MODEL } : {}),
    ...(cfg.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: cfg.ANTHROPIC_MODEL } : {}),
    // Storage: S3 through the task role — no endpoint, no static keys.
    STORAGE_DRIVER: 's3',
    S3_BUCKET: r.uploadsBucket.bucketName,
    S3_REGION: cfg.AWS_REGION,
    S3_FORCE_PATH_STYLE: 'false',
    // Mail: SES through the task role.
    MAIL_DRIVER: 'ses',
    MAIL_FROM: cfg.MAIL_FROM,
    SES_REGION: cfg.SES_REGION,
    SES_CONFIGURATION_SET: r.sesConfigurationSetName,
    // Postgres (TLS with the RDS CA bundle baked into the image at /app/certs/rds-global-bundle.pem).
    DATABASE_SSL: 'true',
    DB_HOST: r.dbHost,
    DB_PORT: r.dbPort,
    DB_NAME,
    // Redis (ElastiCache in-transit encryption).
    REDIS_TLS: 'true',
    REDIS_HOST: r.redisHost,
    REDIS_PORT: r.redisPort,
    SEED_ON_START: 'false',
    SEED_DEMO_DATA: 'false',
    // Secrets Manager JSON secret loaded by initConfig() at boot (provider API keys, JWT_*, SUPERADMIN_PASSWORD).
    SECRETS_SOURCE: 'aws-secrets-manager',
    AWS_SECRETS_ID: cfg.appSecretName,
    AWS_REGION: cfg.AWS_REGION,
    ...extra,
  };
}

export function backendSecrets(r: BackendRefs): Record<string, ecs.Secret> {
  return {
    DB_USER: ecs.Secret.fromSecretsManager(r.dbSecret, 'username'),
    DB_PASSWORD: ecs.Secret.fromSecretsManager(r.dbSecret, 'password'),
    REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(r.redisAuthSecret, 'authToken'),
  };
}

/** Least-privilege grants for a backend task role (api / worker / migrate). */
export function grantBackendAccess(stack: Stack, role: iam.IRole, r: BackendRefs, opts: { ses: boolean }) {
  // Uploads: objects under orgs/* only (knowledge sources, attachments).
  r.uploadsBucket.grantReadWrite(role, 'orgs/*');
  r.uploadsBucket.grantDelete(role, 'orgs/*');
  // App secret: read at boot by initConfig().
  r.appSecret.grantRead(role);
  if (opts.ses) {
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SesSend',
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:${stack.partition}:ses:${r.cfg.SES_REGION}:${stack.account}:identity/${r.cfg.mailDomain}`,
          `arn:${stack.partition}:ses:${r.cfg.SES_REGION}:${stack.account}:identity/*@${r.cfg.mailDomain}`,
          `arn:${stack.partition}:ses:${r.cfg.SES_REGION}:${stack.account}:configuration-set/${r.sesConfigurationSetName}`,
        ],
      }),
    );
  }
}
