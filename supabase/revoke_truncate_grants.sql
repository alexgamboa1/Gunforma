-- ============================================================
-- Gunforma-v2 — revoke TRUNCATE from anon and authenticated in public
-- APPLIED 2026-10-06. See the record at the bottom of this file.
-- Rollback: revoke_truncate_grants_rollback.sql
--
-- WHY
-- TRUNCATE is the one write privilege row-level security does not govern.
-- An INSERT/UPDATE/DELETE grant with no policy behind it is refused by RLS;
-- a TRUNCATE grant is not — it empties the table. Measured 2026-10-06:
--
--   authenticated holds TRUNCATE on 64 relations in public —
--     57 tables, every one of them, and 7 views (where it is meaningless)
--   anon holds TRUNCATE on 0 (revoke_anon_write_grants.sql, 2026-09-26)
--
-- PostgREST has no truncate verb, so this was not reachable from the site.
-- The grants are what would turn any future path to a raw statement — a
-- SECURITY INVOKER function, a new API, a role mix-up — into an emptied
-- table. security_audit_4_6_7_9.sql and colors_admin_insert.sql both logged
-- these and deferred them to a grants audit; this is the TRUNCATE part of it.
--
-- NOTHING USES THEM. Checked before writing this:
--   - no function in any schema the app owns contains TRUNCATE (the only hit
--     database-wide is storage.list_objects_with_delimiter, which is
--     Supabase's own, in the storage schema, and touches no public table)
--   - no page, Netlify function, edge function or script issues one; the
--     browser and server talk PostgREST, which cannot
--   - scheduled jobs and edge functions run as service_role, which this
--     does not touch
--
-- WHAT THIS DOES NOT TOUCH
-- INSERT, UPDATE, DELETE, SELECT, REFERENCES, TRIGGER for either role.
-- authenticated's INSERT/UPDATE/DELETE grants are what the app's writes run
-- on (builds, build_photos, part_favorites, saved_builds, profiles, ...);
-- the ones with no policy behind them are a separate, larger audit.
-- service_role and postgres are unchanged.
-- ============================================================

begin;

-- Every existing table, view and materialized view in public. anon is a
-- no-op today and is named so a table that arrived since 2026-09-26 carrying
-- a stray grant is covered too.
revoke truncate on all tables in schema public from anon, authenticated;

-- And everything created from here on by postgres. Its entry currently gives
-- authenticated `D` (truncate); anon's was cleared on 2026-09-26.
alter default privileges for role postgres in schema public
  revoke truncate on tables from anon, authenticated;

commit;

-- ============================================================
-- AFTER APPLYING, expect:
--
--   select grantee, count(*)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and privilege_type = 'TRUNCATE'
--      and grantee in ('anon','authenticated')
--    group by grantee;                                   -- zero rows
--
-- and the postgres default-ACL entry for tables reads
--   authenticated=arwdxtm/postgres   (no D)
--
-- THE supabase_admin ENTRY STILL GRANTS TRUNCATE, and cannot be altered from
-- here — same limitation recorded in revoke_anon_write_grants.sql:
--
--   default ACL, owner supabase_admin, tables
--     anon=arwdDxtm/supabase_admin, authenticated=arwdDxtm/supabase_admin
--
-- A table created in public by Supabase's own tooling arrives with TRUNCATE
-- for both roles. Re-run the sweep above rather than assuming it holds.
-- ============================================================

-- ============================================================
-- APPLIED 2026-10-06 as migration revoke_truncate_grants (20261006160738) to
-- project lagjjcpclvzrjlrswojt, from this file as merged in #145.
-- Verified live, before -> after:
--   anon/authenticated TRUNCATE grants in public ........... 64 -> 0
--   every other anon/authenticated grant in public ........ 592 -> 592
--   default ACL, owner postgres, tables ... authenticated=arwdxtm (no D)
-- Public reads unchanged: 247 live products via the anon key, /parts 200.
-- ============================================================
