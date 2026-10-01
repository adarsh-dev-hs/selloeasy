#!/usr/bin/env bash
# SelloEasy — load the synthetic demo dataset (5 orgs + events) into a deployed environment (plan §23.3).
#
#   pnpm deploy:aws:seed-demo --env-file .env.aws
#
# Runs the migrate task definition (api image) with command `pnpm db:seed` and SEED_DEMO_DATA=true.
# The seed is idempotent. Refuses to run against DEPLOY_ENV=production unless --allow-production is passed.
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

for a in "$@"; do [[ "$a" == "-h" || "$a" == "--help" ]] && { sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }; done
parse_env_file_arg "$@"
ALLOW_PRODUCTION=false
for a in "${REMAINING_ARGS[@]+"${REMAINING_ARGS[@]}"}"; do
  case "$a" in
    --allow-production) ALLOW_PRODUCTION=true ;;
    *) die "unknown option: $a" ;;
  esac
done

require_tools node aws
cd "$REPO_ROOT"
load_env_file "$ENV_FILE"
if [[ "$DEPLOY_ENV" == "production" && "$ALLOW_PRODUCTION" != "true" ]]; then
  die "refusing to load demo data into production (pass --allow-production if you really mean it)"
fi

log "Checking AWS credentials"
check_aws_identity

log "Seeding demo data into $DEPLOY_ENV"
run_one_off_task seed-demo '{"containerOverrides":[{"name":"migrate","command":["pnpm","db:seed"],"environment":[{"name":"SEED_DEMO_DATA","value":"true"}]}]}'
log "Demo data loaded — sign in at https://$DOMAIN_NAME"
