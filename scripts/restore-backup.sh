#!/usr/bin/env bash
# Restore an encrypted nightly backup into an EMPTY database (a new Neon
# project or branch, or a local scratch database), then print its row counts.
#
#   scripts/restore-backup.sh <sabre-….dump.age> <age identity file> <target database URL>
#
# Refuses a target that already has tables. Needs age, and pg_restore at least as
# new as the dump (18 today: `brew install libpq`, then use /opt/homebrew/opt/libpq/bin).
set -euo pipefail

if (( $# != 3 )); then
  echo "usage: $0 <backup.dump.age> <age identity file> <target database URL>" >&2
  exit 1
fi
backup=$1 identity=$2 target=$3
here="$(cd "$(dirname "$0")" && pwd)"

tables=$(psql -X -At -d "$target" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public', 'drizzle')")
if (( tables > 0 )); then
  echo "The target already has $tables tables. Restore into an empty database." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age --decrypt --identity "$identity" --output "$work/sabre.dump" "$backup"
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$target" "$work/sabre.dump"

echo "Restored. Row counts:" >&2
"$here/backup-counts.sh" "$target"
