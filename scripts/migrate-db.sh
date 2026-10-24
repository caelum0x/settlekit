#!/usr/bin/env bash
# One-command migration off the Render free Postgres (settlekit-db) before it
# expires — see docs/DEPLOYMENT.md "DB EXPIRY" section.
#
# Render's free Postgres plans are deleted automatically after a fixed
# lifetime from creation (currently ~30 days). The schema does NOT need a
# manual migration step: packages/database's migrator runs automatically on
# every boot (see scripts/start.mjs / apps/api/Dockerfile CMD), so a brand
# new, EMPTY target database gets the current schema for free on first
# deploy. This script only matters if you want to carry over existing rows
# (today, that's a handful of testnet demo payments/sessions — check with
# `--count` first to decide if it's even worth it).
#
# Usage:
#   ./scripts/migrate-db.sh --count                         # row counts only, no copy
#   ./scripts/migrate-db.sh "$OLD_DATABASE_URL" "$NEW_DATABASE_URL"
#
# Requires: pg_dump + psql (same major version as Postgres 16, matching
# render.yaml's managed Postgres) on PATH. Does not touch the source database
# (dump is read-only); the target is only ever written to, never dropped.
set -euo pipefail

usage() {
  echo "Usage: $0 [--count SOURCE_URL] | $0 SOURCE_DATABASE_URL TARGET_DATABASE_URL" >&2
  exit 1
}

if [[ "${1:-}" == "--count" ]]; then
  SOURCE="${2:?pass the source DATABASE_URL after --count}"
  echo "Row counts in source database (read-only):"
  psql "$SOURCE" -At -c "
    select relname, n_live_tup
    from pg_stat_user_tables
    order by n_live_tup desc;
  "
  exit 0
fi

SOURCE="${1:-}"
TARGET="${2:-}"
[[ -z "$SOURCE" || -z "$TARGET" ]] && usage

command -v pg_dump >/dev/null || { echo "pg_dump not found on PATH" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql not found on PATH" >&2; exit 1; }

echo "==> Dumping schema + data from source (read-only, no lock escalation)..."
DUMP_FILE="$(mktemp -t settlekit-db-dump).sql"
pg_dump "$SOURCE" --no-owner --no-privileges --format=plain --file="$DUMP_FILE"
echo "    dumped to $DUMP_FILE ($(wc -c < "$DUMP_FILE") bytes)"

echo "==> Restoring into target..."
psql "$TARGET" --set ON_ERROR_STOP=1 --file="$DUMP_FILE"

echo "==> Done. Next steps:"
echo "    1. Set DATABASE_URL to the TARGET connection string on every Render"
echo "       service that uses settlekit-db today: settlekit-api,"
echo "       settlekit-checkout (and settlekit-worker if/when it exists)."
echo "    2. Redeploy those services (env var change triggers a redeploy)."
echo "    3. Confirm: curl -s https://settlekit-api.onrender.com/health and"
echo "       https://settlekit-api.onrender.com/v1/public/proof still answer."
echo "    4. Once confirmed, delete the old settlekit-db Render database (or"
echo "       just let it expire — nothing else points at it anymore)."
echo "    rm $DUMP_FILE"
