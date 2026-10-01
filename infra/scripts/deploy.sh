#!/usr/bin/env bash
# SelloEasy — one-command AWS deploy (plan §23.3).
#
#   cp .env.example .env.aws && $EDITOR .env.aws        # fill group 12 + LLM_PROVIDER and its *_API_KEY (+ optional secrets)
#   pnpm deploy:aws --env-file .env.aws
#
# Steps: env:check → cdk bootstrap (first time, per region) → Bootstrap + Secrets stacks → build & push images
#        → put app secret values → Network/Data/AppBase stacks → migrate task (new image) → all stacks (services,
#        CloudFront, alarms) → wait for services → smoke test https://$DOMAIN_NAME/api/ready
#
# Options:
#   --env-file <path>   required; dotenv file with the AWS keys (see .env.example group 12)
#   --skip-build        reuse images already pushed for IMAGE_TAG
#   --skip-migrate      do not run the migrate task (not recommended)
#   --skip-smoke        do not curl /api/ready at the end
#   -h, --help
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
for a in "$@"; do [[ "$a" == "-h" || "$a" == "--help" ]] && { usage; exit 0; }; done

parse_env_file_arg "$@"
SKIP_BUILD=false SKIP_MIGRATE=false SKIP_SMOKE=false
for a in "${REMAINING_ARGS[@]+"${REMAINING_ARGS[@]}"}"; do
  case "$a" in
    --skip-build) SKIP_BUILD=true ;;
    --skip-migrate) SKIP_MIGRATE=true ;;
    --skip-smoke) SKIP_SMOKE=true ;;
    *) die "unknown option: $a (see --help)" ;;
  esac
done

require_tools node pnpm aws docker openssl curl git
cd "$REPO_ROOT"

# ── 1. Config ────────────────────────────────────────────────────────────────────────────────
log "Validating $ENV_FILE"
pnpm env:check --file "$ENV_FILE" --target aws
load_env_file "$ENV_FILE"

if [[ -z "${IMAGE_TAG:-}" || "${IMAGE_TAG}" == "latest" ]]; then
  if IMAGE_TAG="$(git rev-parse --short=12 HEAD 2>/dev/null)"; then
    [[ -z "$(git status --porcelain 2>/dev/null)" ]] || IMAGE_TAG="${IMAGE_TAG}-dirty-$(date -u +%Y%m%d%H%M%S)"
  else
    IMAGE_TAG="build-$(date -u +%Y%m%d%H%M%S)"
  fi
fi
export IMAGE_TAG
info "IMAGE_TAG=$IMAGE_TAG"

log "Checking AWS credentials"
check_aws_identity

# ── 2. CDK bootstrap (once per account/region) ───────────────────────────────────────────────
regions="$AWS_REGION"
[[ -n "${ACM_CERTIFICATE_ARN:-}" ]] || regions="$regions us-east-1"
regions="$regions $SES_REGION"
for region in $(printf '%s\n' $regions | sort -u); do
  if aws cloudformation describe-stacks --region "$region" --stack-name CDKToolkit >/dev/null 2>&1; then
    info "CDK already bootstrapped in $region"
  else
    log "cdk bootstrap aws://$AWS_ACCOUNT_ID/$region"
    cdk_cli bootstrap "aws://$AWS_ACCOUNT_ID/$region"
  fi
done

mkdir -p "$(dirname "$OUTPUTS_FILE")"
CDK_DEPLOY=(deploy --require-approval never --outputs-file "$OUTPUTS_FILE")

# ── 3. ECR repositories + app secret shell ───────────────────────────────────────────────────
log "Deploying $STACK_PREFIX-bootstrap and $STACK_PREFIX-secrets"
cdk_cli "${CDK_DEPLOY[@]}" --exclusively "$STACK_PREFIX-bootstrap" "$STACK_PREFIX-secrets"

# ── 4. Build & push images (linux/amd64 — Fargate X86_64) ────────────────────────────────────
REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
if [[ "$SKIP_BUILD" == "true" ]]; then
  info "--skip-build: using existing images tagged $IMAGE_TAG"
else
  log "Building and pushing images to $REGISTRY"
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
  for svc in api worker web; do
    repo="$ECR_REPOSITORY_PREFIX/$DEPLOY_ENV/$svc"
    if aws ecr describe-images --repository-name "$repo" --image-ids "imageTag=$IMAGE_TAG" >/dev/null 2>&1; then
      info "$repo:$IMAGE_TAG already exists — skipping build"
      continue
    fi
    info "docker buildx build $svc"
    docker buildx build --platform linux/amd64 \
      -f "apps/$svc/Dockerfile" \
      -t "$REGISTRY/$repo:$IMAGE_TAG" \
      --provenance=false \
      --push .
  done
fi

# ── 5. App secret values (merged; existing values preserved) ─────────────────────────────────
log "Updating Secrets Manager secret $APP_SECRET_ID"
current_secret="$(aws secretsmanager get-secret-value --secret-id "$APP_SECRET_ID" --query SecretString --output text 2>/dev/null || echo '{}')"
# Candidates used only when neither the env file nor the existing secret has a usable value.
GENERATED_JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
GENERATED_JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
GENERATED_SUPERADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
export GENERATED_JWT_ACCESS_SECRET GENERATED_JWT_REFRESH_SECRET GENERATED_SUPERADMIN_PASSWORD
new_secret="$(printf '%s' "$current_secret" | node "$INFRA_DIR/scripts/merge-app-secret.mjs")"
unset GENERATED_JWT_ACCESS_SECRET GENERATED_JWT_REFRESH_SECRET GENERATED_SUPERADMIN_PASSWORD
if [[ "$new_secret" != "$current_secret" ]]; then
  secret_file="$(mktemp)"
  chmod 600 "$secret_file"
  trap 'rm -f "$secret_file"' EXIT
  printf '%s' "$new_secret" >"$secret_file"
  aws secretsmanager put-secret-value --secret-id "$APP_SECRET_ID" --secret-string "file://$secret_file" >/dev/null
  rm -f "$secret_file"
  info "secret updated (read the super-admin password with: aws secretsmanager get-secret-value --secret-id $APP_SECRET_ID)"
else
  info "secret unchanged"
fi
unset current_secret new_secret

# ── 6. Network, data, cluster + migrate task definition ─────────────────────────────────────
log "Deploying network, data and $STACK_PREFIX-appbase (cluster + migrate task @ $IMAGE_TAG)"
cdk_cli "${CDK_DEPLOY[@]}" "$STACK_PREFIX-appbase"

# ── 7. Migrations (+ idempotent bootstrap seed: super admin, reference data; SEED_DEMO_DATA=false) ─
if [[ "$SKIP_MIGRATE" == "true" ]]; then
  info "--skip-migrate: not running migrations"
else
  log "Running migrate task (pnpm db:migrate && pnpm db:seed)"
  run_one_off_task migrate
fi

# ── 8. Everything else: services, CloudFront, SES, alarms ───────────────────────────────────
log "Deploying all stacks"
cdk_cli "${CDK_DEPLOY[@]}" --all

log "Waiting for ECS services to be stable"
CLUSTER="$(stack_output "$STACK_PREFIX-appbase" ClusterName)"
aws ecs wait services-stable --cluster "$CLUSTER" --services api worker web
info "api, worker, web stable"

# ── 9. Smoke test ────────────────────────────────────────────────────────────────────────────
if [[ "$SKIP_SMOKE" == "true" ]]; then
  info "--skip-smoke"
else
  log "Smoke test https://$DOMAIN_NAME/api/ready"
  if curl -fsS --retry 20 --retry-delay 15 --retry-all-errors --max-time 20 "https://$DOMAIN_NAME/api/ready"; then
    echo
    info "ready ✓"
  else
    die "https://$DOMAIN_NAME/api/ready did not become ready (DNS/CloudFront may still be propagating — retry the curl in a few minutes)"
  fi
fi

log "Deployed SelloEasy $DEPLOY_ENV @ $IMAGE_TAG → https://$DOMAIN_NAME"
info "stack outputs: $OUTPUTS_FILE"
