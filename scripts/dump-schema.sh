#!/usr/bin/env bash
# Dump a Supabase project's schema the way `supabase db dump --schema public`
# does, without Docker.
#
# The Supabase CLI runs pg_dump inside a Docker container (its
# pkg/migration/scripts/dump_schema.sh). This machine has no Docker, so this
# script is that recipe, copied from CLI v2.115.0, run against a local
# pg_dump (brew install libpq). Flags and sed substitutions are the CLI's,
# byte for byte, with EXTRA_FLAGS fixed to --schema=public. The final
# sed ("/^--/d", drop comment lines) is in the script the CLI binary
# actually runs (seen with `supabase db dump --dry-run`) but not in the
# template published at that tag; without it a dump made here differs
# from one made by the CLI by every comment line pg_dump writes.
#
# Usage:
#   scripts/dump-schema.sh "$DB_URL" > out.sql
#
# DB_URL is a postgresql:// URL with the password in it. Never print it, never
# commit it, never put it in a file the repo can see. The session pooler on
# port 5432 works (postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres).
set -euo pipefail

DB_URL="${1:?usage: scripts/dump-schema.sh <db-url>}"
PG_DUMP="${PG_DUMP:-$(command -v pg_dump || echo /opt/homebrew/opt/libpq/bin/pg_dump)}"
EXCLUDED_SCHEMAS=""

"$PG_DUMP" "$DB_URL" \
    --schema-only \
    --quote-all-identifier \
    --role "postgres" \
    --exclude-schema "${EXCLUDED_SCHEMAS:-}" \
    --schema=public \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
| sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
| sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
| sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
| sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
| sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
| sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
| sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
| sed -E 's/^         WHEN TAG IN /-- &/' \
| sed -E 's/^   EXECUTE FUNCTION /-- &/' \
| sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
| sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
| sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
| sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
| sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
| sed -E "s/^GRANT (.+) ON (.+) \"(${EXCLUDED_SCHEMAS:-})\"/-- &/" \
| sed -E "s/^REVOKE (.+) ON (.+) \"(${EXCLUDED_SCHEMAS:-})\"/-- &/" \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
| sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
| sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
| sed -E 's/^ALTER TABLE "cron"/-- &/' \
| sed -E 's/^SET transaction_timeout = 0;/-- &/' \
| sed -E "/^--/d"
