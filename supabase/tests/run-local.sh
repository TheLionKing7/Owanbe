#!/usr/bin/env bash
# Runs the database tests against a throwaway local Postgres (16+). No Docker needed.
# Usage: bash supabase/tests/run-local.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
dir="$(mktemp -d)"; port="${PGTEST_PORT:-54329}"
trap '"$bin/pg_ctl" -D "$dir" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
"$bin/initdb" -D "$dir" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$dir" -o "-p $port -k $dir -c listen_addresses=''" -w start >/dev/null
psql=(psql -X -q -v ON_ERROR_STOP=1 -h "$dir" -p "$port" -U postgres -d postgres)
"${psql[@]}" -f "$here/supabase_stub.sql"
for m in "$here"/../migrations/*.sql "$here"/../pending/*.sql; do "${psql[@]}" -f "$m"; done
for t in "$here"/*.test.sql; do echo "▶ $(basename "$t")"; "${psql[@]}" -f "$t"; done
