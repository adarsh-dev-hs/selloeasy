# @selloeasy/infra — AWS CDK

The runbook for first deploy, rollback, rotating secrets and restoring from a snapshot is in
[`docs/operations/aws-deployment.mdx`](../docs/operations/aws-deployment.mdx). This file only covers how `infra/` works.

```bash
cp .env.example .env.aws && $EDITOR .env.aws           # fill group 12 + OPENROUTER_API_KEY
pnpm env:check --file .env.aws --target aws
pnpm deploy:aws --env-file .env.aws                     # infra/scripts/deploy.sh
pnpm deploy:aws:seed-demo --env-file .env.aws           # optional, staging only: synthetic demo data

pnpm --filter @selloeasy/infra synth:check              # CI gate: staging + production synth + cdk-nag, no AWS account needed
```

## Implementation notes

### Stacks

All stacks are named `<DEPLOY_ENV>-selloeasy-<name>` and deployed to `AWS_REGION` unless noted.

| Stack                   | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap`             | ECR repos `<ECR_REPOSITORY_PREFIX>/<env>/{api,worker,web}` (scan on push, keep 30 images, expire untagged after 7 days). The GitHub OIDC provider and deploy role (output `GithubOidcRoleArn`) are created when `GITHUB_REPOSITORY` is set.                                                                                                                                                                                                                                                                                           |
| `network`               | VPC (10.40.0.0/16, 2 AZs, public + private-with-egress subnets, `NAT_GATEWAYS`), REJECT flow logs, an S3 gateway endpoint, and interface endpoints for ECR, ECR docker, Secrets Manager and CloudWatch Logs. It also holds the ALB and per-service security groups, which keeps the cross-stack references free of cycles. When `VPC_ID` is set it imports the VPC instead and creates no endpoints.                                                                                                                                  |
| `secrets`               | `selloeasy/<env>/app` JSON secret. CloudFormation only generates `ORIGIN_VERIFY_TOKEN`. `deploy.sh` merges in `OPENROUTER_API_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `SUPERADMIN_PASSWORD`.                                                                                                                                                                                                                                                                                                                              |
| `data`                  | RDS Postgres 16: gp3, encrypted, `rds.force_ssl=1`, generated master secret `selloeasy/<env>/rds`, backups, `RDS_MULTI_AZ`, deletion protection and snapshot-on-delete in production. ElastiCache Redis 7.1: TLS required, encrypted at rest, AUTH token `selloeasy/<env>/redis`, `noeviction` for BullMQ, 2 nodes with Multi-AZ in production. S3 uploads bucket: SSE-KMS with a rotating CMK, block public access, TLS enforced, versioned, CORS for presigned PUT/GET from `https://DOMAIN_NAME`. Also a shared access-log bucket. |
| `mail` (`SES_REGION`)   | SES domain identity for the **domain of `MAIL_FROM`**, with Easy DKIM CNAMEs written to `HOSTED_ZONE_ID`. Configuration set `selloeasy-<env>` (TLS required, bounce/complaint suppression).                                                                                                                                                                                                                                                                                                                                           |
| `appbase`               | ECS cluster (Container Insights) and the one-off `migrate` task definition (api image; default command `pnpm db:migrate && pnpm db:seed` with `SEED_DEMO_DATA=false`, which bootstraps the super admin and reference data).                                                                                                                                                                                                                                                                                                           |
| `app`                   | Fargate services `api`, `worker` and `web` with circuit-breaker rollback. The ALB is internet-facing, with an HTTPS listener using a DNS-validated regional cert for `DOMAIN_NAME` + `origin.DOMAIN_NAME`, access logs, and `drop_invalid_header_fields`. Listener rules: `/api/*` → api (health `/api/health`), `/*` → web (health `/`, 200–399), default → 403. Autoscaling: api on CPU at 60%, worker on CPU at 70%. Log groups `/selloeasy/<env>/<svc>` are kept for 30 days. Route53 `origin.DOMAIN_NAME` → ALB.                 |
| `edge-cert` (us-east-1) | CloudFront viewer certificate for `DOMAIN_NAME`, only when `ACM_CERTIFICATE_ARN` is empty. Otherwise `ACM_CERTIFICATE_ARN` must be a **us-east-1** cert.                                                                                                                                                                                                                                                                                                                                                                              |
| `edge`                  | CloudFront → `https://origin.DOMAIN_NAME`. The default and `/api/*` behaviours use CachingDisabled and AllViewer (all methods, cookies, headers and query strings). `/_next/static/*` is cached. Route53 A/AAAA alias records for `DOMAIN_NAME`.                                                                                                                                                                                                                                                                                      |
| `observability`         | SNS topic (KMS-encrypted) → `ALARM_EMAIL`. Alarms: ALB 5xx, api 5xx, api p95 latency, api unhealthy targets, RDS CPU and free storage, Redis memory, and CPU on each ECS service. Dashboard `selloeasy-<env>`.                                                                                                                                                                                                                                                                                                                        |

### How `DATABASE_URL` / `REDIS_URL` are built

`DATABASE_URL` and `REDIS_URL` are **assembled in the container entrypoint from ECS-injected parts**. See `lib/runtime-env.ts`.

- Non-secret parts are plain task env from CloudFormation attributes: `DB_HOST`, `DB_PORT`, `DB_NAME=selloeasy`, `REDIS_HOST` and `REDIS_PORT`.
- Secret parts come in through ECS `secrets` and the execution role: `DB_USER` and `DB_PASSWORD` from the RDS-generated secret, and `REDIS_AUTH_TOKEN` from the Redis AUTH secret.
- The task `entryPoint` is `sh -c '<script>' selloeasy-entrypoint`. The script:
  - percent-encodes the password
  - exports `DATABASE_URL=postgres://user:pass@host:port/selloeasy` and `REDIS_URL=rediss://:token@host:port`
  - unsets the raw parts
  - runs `exec "$@"`, where `"$@"` is the task `command` (or a `run-task` command override, as in the migrate and seed-demo tasks)
- The images and the app code are unchanged. The app still reads a plain `DATABASE_URL` / `REDIS_URL`, with `DATABASE_SSL=true` (RDS CA bundle at `/app/certs/rds-global-bundle.pem`) and `REDIS_TLS=true`.
- Credentials never appear in the template or in the app secret. After a password change, new tasks pick up the new password once the services are redeployed.

The other runtime values are plain env: `NODE_ENV=production`, `APP_ENV=<env>`, `TRUST_PROXY`, `COOKIE_SECURE`, `WEB_URL`/`CORS_ORIGINS=https://DOMAIN_NAME`, `STORAGE_DRIVER=s3` (no endpoint or static keys; the task role is used), `MAIL_DRIVER=ses`, `SES_CONFIGURATION_SET`, `SEED_ON_START=false`, `OPENROUTER_MODEL`, and `SECRETS_SOURCE=aws-secrets-manager` with `AWS_SECRETS_ID=selloeasy/<env>/app`. `initConfig()` loads the JSON secret at boot. Optional tunables from the env file are passed through when they are non-empty: `LOG_LEVEL`, `LLM_*`, `PIPELINE_*`, `SUPERADMIN_EMAIL` and the others listed in `RUNTIME_PASSTHROUGH_KEYS` in `lib/config.ts`.

### Origin protection

CloudFront adds `X-Origin-Verify: <ORIGIN_VERIFY_TOKEN>`. Both the CloudFront origin header and the ALB listener conditions read the token with a CloudFormation dynamic reference to the app secret. Requests without the header get a fixed 403 from the ALB.

### Task IAM (least privilege)

- **api / worker / migrate task roles** get:
  - S3 read, write and delete on `orgs/*` in the uploads bucket, plus its KMS key
  - `secretsmanager:GetSecretValue` on the app secret
- **api / worker** additionally get `ses:SendEmail` and `ses:SendRawEmail` on the mail-domain identity and the configuration set.
- **web** has no task permissions.
- **Execution roles** only pull from ECR, write logs and read the RDS and Redis secrets.

### Deploy flow (`scripts/deploy.sh`)

1. Run `env:check --target aws`, then export the env file. It is parsed with Node's dotenv parser, never `source`d.
2. Set `IMAGE_TAG` to the git SHA when the value is empty or `latest`.
3. Check the account and run `cdk bootstrap` in `AWS_REGION`, us-east-1 and `SES_REGION` if a region isn't bootstrapped yet.
4. Deploy the `bootstrap` and `secrets` stacks.
5. Build with `docker buildx --platform linux/amd64` and push. Tags that already exist are skipped.
6. Merge values into the app secret. JWT secrets and the super-admin password are generated with `openssl rand` when neither the env file nor the existing secret has a usable value.
7. Deploy `appbase`, which also deploys `network`, `data` and `secrets`.
8. Run the migrate task with the **new** image and wait for exit 0. Services never serve a new release against an un-migrated schema.
9. Run `cdk deploy --all`, then `ecs wait services-stable`, then curl `https://DOMAIN_NAME/api/ready`.

Rollback: redeploy with the previous `IMAGE_TAG`. Migrations must be backward-compatible (expand/contract).

### Infra-only optional env keys (not in the app schema)

- `GITHUB_REPOSITORY` (`owner/repo`): creates the GitHub OIDC deploy role. GitHub Actions sets it automatically.
- `GITHUB_OIDC_PROVIDER_ARN`: reuses an existing `token.actions.githubusercontent.com` provider. The provider is account-global, so set this for the second environment in the same account.
- `SELLOEASY_ENV_FILE` / `--env-file`: env file for `bin/app.ts` when you run `cdk` directly, e.g. `SELLOEASY_ENV_FILE=.env.aws pnpm --filter @selloeasy/infra synth`.

### cdk-nag

`AwsSolutionsChecks` runs on every synth. The only suppressions are listed below, each with a reason in the code:

- ECS2: task env holds only non-secret configuration.
- IAM5: the S3 `orgs/*` prefix, KMS `*` action families, the SES identity wildcard, CDK-generated execution and LogRetention policies, and the deploy role.
- IAM4 and L1: CDK helper Lambdas.
- EC23: the ALB, which is gated by the origin header.
- RDS3 / RDS10 / AEC4: staging only.
- RDS11 / AEC5: default ports on private resources.
- SMG4: rotation needs a coordinated redeploy (see runbook).
- CFR1/2/3: no geo restriction, WAF is a follow-up, and ALB access logs cover request logging.
- S1: on the log bucket itself.

### Known follow-ups

- **Worker autoscaling on BullMQ queue depth**, and alarms on queue depth and job failures, need a custom CloudWatch metric that the worker doesn't publish yet. For now the worker scales on CPU.
- **WAF** on CloudFront.
- **RDS and Redis secret rotation**, with a service redeploy hook.
- **SES** starts in the sandbox. Request production access before inviting real users. The `MAIL_FROM` domain must be inside `HOSTED_ZONE_ID` so the DKIM records can be written.
