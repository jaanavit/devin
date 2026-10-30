#!/usr/bin/env bash
# Prisma migration check (used in CI and runnable locally: pnpm db:check).
#  1. The committed migrations apply cleanly to an empty database.
#  2. The migrations produce exactly the schema in schema.prisma (fails if someone edited the
#     schema without generating a migration, or edited a migration by hand).
# Needs SHADOW_DATABASE_URL: an empty, disposable database (it is reset by Prisma).
set -euo pipefail
: "${SHADOW_DATABASE_URL:?SHADOW_DATABASE_URL must point at an empty, disposable database}"
cd "$(dirname "$0")/../../packages/models"

echo "1/2 Applying all migrations to an empty database..."
DATABASE_URL="$SHADOW_DATABASE_URL" pnpm exec prisma migrate reset --force --skip-seed --skip-generate >/dev/null
echo "    OK"

echo "2/2 Comparing migrations with schema.prisma..."
if ! pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code >/tmp/migration-drift.sql 2>&1; then
  echo "::error title=Migration check::schema.prisma and prisma/migrations are out of sync. Run 'pnpm db:migrate --name <change>' and commit the migration."
  cat /tmp/migration-drift.sql
  exit 1
fi
echo "    OK: migrations match schema.prisma"
