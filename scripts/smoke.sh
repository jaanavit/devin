#!/usr/bin/env bash
# End-to-end smoke test against a running app: signs in through Auth.js as a demo user and
# prints HTTP status codes. Usage: scripts/smoke.sh <sub> <path>...   (BASE defaults to :3000)
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
SUB="$1"; shift
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
CSRF="$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')"
curl -s -o /dev/null -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/callback/mock-oidc" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "sub=$SUB" --data-urlencode "json=true"
for path in "$@"; do
  printf '%s %s -> %s\n' "$SUB" "$path" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE$path")"
done
