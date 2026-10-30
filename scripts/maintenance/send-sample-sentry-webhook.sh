#!/usr/bin/env bash
# Sends the sample Sentry event_alert payload to a running relay, signed like Sentry signs it.
#   SENTRY_WEBHOOK_SECRET=... scripts/maintenance/send-sample-sentry-webhook.sh [base_url] [fixture]
set -euo pipefail
BASE="${1:-http://localhost:3000}"
FIXTURE="${2:-$(dirname "$0")/../../apps/internal-tools/lib/maintenance/__fixtures__/sentry-event-alert.json}"
RESOURCE="event_alert"
case "$FIXTURE" in *issue-created*) RESOURCE="issue" ;; esac
: "${SENTRY_WEBHOOK_SECRET:?set SENTRY_WEBHOOK_SECRET to the same value the app uses}"
SIG=$(openssl dgst -sha256 -hmac "$SENTRY_WEBHOOK_SECRET" -hex < "$FIXTURE" | sed 's/^.*= //')
curl -sS -X POST "$BASE/api/webhooks/sentry" \
  -H "content-type: application/json" \
  -H "sentry-hook-resource: $RESOURCE" \
  -H "sentry-hook-signature: $SIG" \
  --data-binary "@$FIXTURE" -w "\nHTTP %{http_code}\n"
