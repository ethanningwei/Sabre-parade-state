#!/usr/bin/env bash
# Exact row count of every table in the public and drizzle schemas, one
# "schema.table|count" line each, sorted. Used by backup.sh and restore-backup.sh.
set -euo pipefail
: "${1:?usage: backup-counts.sh <database-url>}"

psql -X -At -v ON_ERROR_STOP=1 -d "$1" <<'SQL' | sort
SELECT format('SELECT %L || ''|'' || count(*) FROM %I.%I',
              table_schema || '.' || table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE'
\gexec
SQL
