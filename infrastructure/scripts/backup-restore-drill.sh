#!/usr/bin/env bash
# Backup / restore drill against the local Docker Postgres.
#   1. dumps the live database (custom format, includes triggers and constraints)
#   2. restores it into a brand-new scratch database
#   3. compares row counts of every table, and checks that the ledger still balances and that the
#      integrity triggers survived the restore
#   4. drops the scratch database
# It never modifies the source database. Usage: bash infrastructure/scripts/backup-restore-drill.sh
set -euo pipefail

CONTAINER="${PG_CONTAINER:-triphub-postgres-1}"
DB="${PG_DB:-triphub}"
USER_="${PG_USER:-triphub}"
SCRATCH="drill_$(date +%s)"
DUMP="/tmp/${SCRATCH}.dump"

psql_() { docker exec -i "$CONTAINER" psql -U "$USER_" -v ON_ERROR_STOP=1 -At "$@"; }

echo "== dump $DB"
docker exec "$CONTAINER" pg_dump -U "$USER_" -Fc -f "$DUMP" "$DB"
SIZE=$(docker exec "$CONTAINER" sh -c "wc -c < $DUMP")
echo "dump size: ${SIZE} bytes"

echo "== restore into $SCRATCH"
psql_ -d postgres -c "CREATE DATABASE \"$SCRATCH\""
trap 'psql_ -d postgres -c "DROP DATABASE IF EXISTS \"'"$SCRATCH"'\"" >/dev/null; docker exec "$CONTAINER" rm -f "$DUMP"' EXIT
docker exec "$CONTAINER" pg_restore -U "$USER_" --no-owner -d "$SCRATCH" "$DUMP"

echo "== compare row counts"
TABLES=$(psql_ -d "$DB" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
FAIL=0
for t in $TABLES; do
  a=$(psql_ -d "$DB" -c "SELECT count(*) FROM \"$t\"")
  b=$(psql_ -d "$SCRATCH" -c "SELECT count(*) FROM \"$t\"")
  if [ "$a" != "$b" ]; then echo "MISMATCH $t: source=$a restored=$b"; FAIL=1; fi
done
echo "tables compared: $(echo "$TABLES" | wc -w)"

echo "== ledger still balances in the restored copy (must be 0 rows)"
BAD=$(psql_ -d "$SCRATCH" -c "SELECT count(*) FROM (SELECT \"entryId\", currency FROM ledger_line GROUP BY 1,2 HAVING sum(\"amountMinor\") <> 0) s")
echo "unbalanced entries: $BAD"
[ "$BAD" = "0" ] || FAIL=1

echo "== integrity triggers present in the restored copy"
TRIG=$(psql_ -d "$SCRATCH" -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")
SRC_TRIG=$(psql_ -d "$DB" -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")
echo "triggers: source=$SRC_TRIG restored=$TRIG"
[ "$TRIG" = "$SRC_TRIG" ] || FAIL=1

echo "== append-only guard still enforced after restore"
if psql_ -d "$SCRATCH" -c "DELETE FROM journal_entry" >/dev/null 2>&1; then echo "FAIL: ledger delete succeeded"; FAIL=1; else echo "ok: ledger delete refused"; fi

if [ "$FAIL" = "0" ]; then echo "DRILL PASSED"; else echo "DRILL FAILED"; exit 1; fi
