#!/usr/bin/env bash
# Nightly backup: dump the database, restore the dump into a scratch Postgres
# (the restore drill), check every table's row count matches, then encrypt it.
# Run by .github/workflows/backup.yml; runs locally the same way.
#
#   DATABASE_URL     the database to back up (Neon's unpooled URL)
#   DRILL_URL        an empty scratch Postgres of the same major version; it is wiped
#   AGE_RECIPIENTS   age public keys (age1…), separated by spaces or newlines
#   OUT_DIR          where the encrypted file goes (default: .)
#
# Prints the encrypted file's path on the last line. Needs pg_dump/pg_restore/psql
# at least as new as the server (18 for Neon today) and age.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${DRILL_URL:?DRILL_URL is not set}"
: "${AGE_RECIPIENTS:?AGE_RECIPIENTS is not set}"
OUT_DIR="${OUT_DIR:-.}"

# The drill wipes DRILL_URL, so it must be a local scratch server, never Neon.
case "$DRILL_URL" in
  postgres://*@localhost[:/]* | postgresql://*@localhost[:/]* | postgres://*@127.0.0.1[:/]* | postgresql://*@127.0.0.1[:/]*) ;;
  *) echo "DRILL_URL must point at localhost: the drill wipes it." >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

server=$(psql -X -At -d "$DATABASE_URL" -c "show server_version_num")
client=$(pg_dump --version | sed -E 's/.* ([0-9]+)\..*/\1/')
if (( client < server / 10000 )); then
  echo "pg_dump $client is older than the server ($((server / 10000))). Install a newer client." >&2
  exit 1
fi

stamp=$(TZ=Asia/Singapore date +%Y-%m-%d-%H%M)
dump="$work/sabre-$stamp.dump"

echo "Counting rows in the source…" >&2
"$here/backup-counts.sh" "$DATABASE_URL" > "$work/source.txt"

echo "Dumping…" >&2
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$dump"

echo "Restore drill…" >&2
psql -X -q -v ON_ERROR_STOP=1 -d "$DRILL_URL" \
  -c "SET client_min_messages = warning; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$DRILL_URL" "$dump"
"$here/backup-counts.sh" "$DRILL_URL" > "$work/drill.txt"

# A write between the count and the dump fails this too (rare at 0300); run it again.
if ! diff -u "$work/source.txt" "$work/drill.txt" >&2; then
  echo "The restored copy's row counts don't match the source." >&2
  exit 1
fi
echo "Restore drill passed: $(wc -l < "$work/drill.txt" | tr -d ' ') tables, $(awk -F'|' '{n += $2} END {print n}' "$work/drill.txt") rows." >&2

recipients=()
for key in $AGE_RECIPIENTS; do recipients+=(--recipient "$key"); done
mkdir -p "$OUT_DIR"
out="$OUT_DIR/$(basename "$dump").age"
age "${recipients[@]}" --output "$out" "$dump"
echo "$out"
