#!/usr/bin/env bash
# Shared helpers for infra/scripts/deploy.sh and infra/scripts/seed-demo.sh. Source it; do not execute.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/infra"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_tools() {
  local t
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || die "'$t' is required but not installed"; done
}

# parse_env_file_arg "$@" → sets ENV_FILE (absolute) and REMAINING_ARGS
parse_env_file_arg() {
  ENV_FILE=""
  REMAINING_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file) ENV_FILE="${2:-}"; shift 2 ;;
      --env-file=*) ENV_FILE="${1#--env-file=}"; shift ;;
      *) REMAINING_ARGS+=("$1"); shift ;;
    esac
  done
  [[ -n "$ENV_FILE" ]] || die "missing --env-file <path> (e.g. --env-file .env.aws)"
  # pnpm runs scripts from the repo root; INIT_CWD is where the user typed the command.
  if [[ "$ENV_FILE" != /* ]]; then
    if [[ -f "${INIT_CWD:-$PWD}/$ENV_FILE" ]]; then ENV_FILE="${INIT_CWD:-$PWD}/$ENV_FILE"; else ENV_FILE="$REPO_ROOT/$ENV_FILE"; fi
  fi
  [[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
}

# Exports every non-empty key of the env file (parsed with Node's dotenv parser — never `source`d).
load_env_file() {
  local exports
  exports="$(node "$INFRA_DIR/scripts/env-to-shell.mjs" "$1")" || die "could not parse $1"
  eval "$exports"
  export AWS_REGION="${AWS_REGION:-ap-south-1}"
  export SES_REGION="${SES_REGION:-ap-south-1}"
  export DEPLOY_ENV="${DEPLOY_ENV:-staging}"
  export ECR_REPOSITORY_PREFIX="${ECR_REPOSITORY_PREFIX:-selloeasy}"
  export AWS_DEFAULT_REGION="$AWS_REGION"
  export AWS_PAGER=""
  [[ -n "${AWS_ACCOUNT_ID:-}" ]] || die "AWS_ACCOUNT_ID is empty in $1"
  STACK_PREFIX="${DEPLOY_ENV}-selloeasy"
  APP_SECRET_ID="selloeasy/${DEPLOY_ENV}/app"
  OUTPUTS_FILE="$INFRA_DIR/cdk.out/${DEPLOY_ENV}-outputs.json"
}

check_aws_identity() {
  local account
  account="$(aws sts get-caller-identity --query Account --output text)" || die "AWS credentials not configured (set AWS_PROFILE in the env file or use OIDC in CI)"
  [[ "$account" == "$AWS_ACCOUNT_ID" ]] || die "credentials are for account $account but AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID"
  info "AWS account $account, region $AWS_REGION, env $DEPLOY_ENV"
}

cdk_cli() {
  (cd "$INFRA_DIR" && pnpm exec cdk --no-notices "$@")
}

# stack_output <stack-name> <output-key> — read from the live CloudFormation stack.
stack_output() {
  local region="${3:-$AWS_REGION}"
  aws cloudformation describe-stacks --region "$region" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text
}

# run_one_off_task <label> [overrides-json] — runs the migrate task definition on Fargate and waits for exit 0.
run_one_off_task() {
  local label="$1" overrides="${2:-}"
  local cluster task_def subnets sg log_group task_arn exit_code reason
  cluster="$(stack_output "$STACK_PREFIX-appbase" ClusterName)"
  task_def="$(stack_output "$STACK_PREFIX-appbase" MigrateTaskDefinitionArn)"
  log_group="$(stack_output "$STACK_PREFIX-appbase" MigrateLogGroup)"
  subnets="$(stack_output "$STACK_PREFIX-network" PrivateSubnetIds)"
  sg="$(stack_output "$STACK_PREFIX-network" MigrateSecurityGroupId)"
  [[ -n "$cluster" && "$cluster" != "None" ]] || die "cluster not found — deploy the appbase stack first"

  local args=(ecs run-task --cluster "$cluster" --task-definition "$task_def" --launch-type FARGATE
    --started-by "selloeasy-$label"
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=DISABLED}"
    --query 'tasks[0].taskArn' --output text)
  [[ -n "$overrides" ]] && args+=(--overrides "$overrides")
  task_arn="$(aws "${args[@]}")"
  [[ -n "$task_arn" && "$task_arn" != "None" ]] || die "$label: run-task did not start a task"
  info "$label task: $task_arn"
  info "logs: aws logs tail $log_group --follow"

  # The waiter polls every 6s × 100; loop so long migrations/seeds (> 10 min) are fine.
  local attempt
  for attempt in 1 2 3; do
    if aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn" 2>/dev/null; then break; fi
    [[ $attempt -lt 3 ]] || die "$label: task did not stop within 30 minutes"
  done
  exit_code="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  if [[ "$exit_code" != "0" ]]; then
    reason="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --query 'tasks[0].stoppedReason' --output text)"
    aws logs tail "$log_group" --since 30m 2>/dev/null | tail -n 60 || true
    die "$label failed (exit code: $exit_code, reason: $reason)"
  fi
  info "$label finished successfully"
}
