#!/usr/bin/env bash
# Deploy stub: scripts/deploy.sh <preview|staging|production> <ref>
# No hosting provider is configured for this repo. When one is chosen (e.g. Vercel, Render, Fly,
# ECS), set <ENV>_DEPLOY_HOOK_URL as a GitHub environment secret and this script will call it;
# replace the body with the provider's CLI if hooks are not supported.
# A real deploy must also: run `pnpm db:deploy` against that environment's DATABASE_URL, start the
# app (`pnpm --filter @fintech/internal-tools start`), payments-mock and the job worker
# (`pnpm jobs:worker`), with secrets from the environment (see .env.example).
set -euo pipefail
ENVIRONMENT="${1:?environment required}"
REF="${2:?ref required}"
case "$ENVIRONMENT" in preview|staging|production) ;; *) echo "unknown environment: $ENVIRONMENT" >&2; exit 2 ;; esac

if [ -z "${DEPLOY_HOOK_URL:-}" ]; then
  echo "::notice title=Deploy stub::No deploy target configured for '$ENVIRONMENT'. Would deploy ref '$REF' (migrate DB, start app + payments-mock + job worker)."
  exit 0
fi
echo "Triggering $ENVIRONMENT deploy of $REF"
curl --fail --silent --show-error -X POST -H "content-type: application/json" \
  --data "{\"environment\":\"$ENVIRONMENT\",\"ref\":\"$REF\"}" "$DEPLOY_HOOK_URL" >/dev/null
echo "Deploy hook accepted."
