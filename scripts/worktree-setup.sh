#!/usr/bin/env bash
# Creates an isolated git worktree for building one phase in parallel:
#   scripts/worktree-setup.sh <N> <branch>     e.g. scripts/worktree-setup.sh 3 phase-3-kyc
# Gives it its own databases (fintech_pN_dev / fintech_pN_test), .env, and ports (300N / 410N).
set -euo pipefail
N="$1"; BRANCH="$2"; BASE="${BASE_BRANCH:-phase-2-playbooks}"
REPO="$(git rev-parse --show-toplevel)"
DIR="$HOME/fit-p$N"
DEV_DB="fintech_p${N}_dev"; TEST_DB="fintech_p${N}_test"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

git -C "$REPO" worktree add "$DIR" -b "$BRANCH" "$BASE"
for db in "$DEV_DB" "$TEST_DB"; do createdb -U postgres "$db"; done

# Drop any per-instance lines from the source .env, then append this worktree's values, so the
# result is correct whether or not the root .env predates PORT / PAYMENTS_MOCK_PORT.
sed -E \
  -e "s#/fintech_tools_test\?#/${TEST_DB}?#" \
  -e "s#/fintech_tools\?#/${DEV_DB}?#" \
  -e "/^(PORT|NEXTAUTH_URL|PAYMENTS_MOCK_PORT|PAYMENTS_MOCK_URL)=/d" \
  "$REPO/.env" > "$DIR/.env"
cat >> "$DIR/.env" <<ENV

# Worktree-specific (scripts/worktree-setup.sh)
PORT="300${N}"
NEXTAUTH_URL="http://localhost:300${N}"
PAYMENTS_MOCK_PORT="410${N}"
PAYMENTS_MOCK_URL="http://localhost:410${N}"
ENV
grep -q "/${DEV_DB}?" "$DIR/.env" && grep -q "/${TEST_DB}?" "$DIR/.env" || { echo "DATABASE_URL rewrite failed" >&2; exit 1; }

cd "$DIR"
pnpm install --frozen-lockfile >/dev/null
pnpm db:deploy >/dev/null
SEED_TRANSACTIONS=50000 SEED_CUSTOMERS=5000 pnpm db:seed | tail -3
echo "Ready: $DIR (branch $BRANCH, app :300$N, payments-mock :410$N, db $DEV_DB / $TEST_DB)"
