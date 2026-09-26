-- ============================================================
-- Gunforma-v2 — revoke every write grant from anon in public
-- APPLIED 2026-09-26. See the record at the bottom of this file.
--
-- No rollback file: the "before" state is anon holding INSERT, UPDATE,
-- DELETE and TRUNCATE on every table in the schema. Nothing about that is
-- worth being able to restore in one command.
--
-- WHY
-- Supabase's default ACL grants anon and authenticated full privileges on
-- every table created in public. CLAUDE.md has said since the price_history
-- work that a new table needs RLS *and* an explicit revoke, but that rule was
-- applied table by table, and the tables that predate it kept the grants.
--
-- RLS was doing the actual work — every one of those tables has policies, and
-- no policy admits anon for a write — so this was not an open door. It was
-- the door being unlocked with a guard in front of it. The grants are the
-- thing that turns one missing or mis-scoped policy into a writable table,
-- and `builds` was the worked example: it carried a DELETE grant for anon
-- with no anon-facing DELETE policy behind it, discovered while adding the
-- admin delete in PR #56.
--
-- WHAT THIS DOES NOT TOUCH
-- SELECT. anon's read access is the public website and is unchanged — 59
-- column/table SELECT grants before and after. authenticated is untouched
-- entirely; its writes are what the app is built on.
-- ============================================================

begin;

-- Every existing table, view and materialized view in public. GRANT/REVOKE
-- ... ON ALL TABLES covers all three: to Postgres they are all relations.
revoke insert, update, delete, truncate on all tables in schema public from anon;

-- And everything created from here on by the role that creates things here.
-- Without this the next `create table` re-grants exactly what was just
-- revoked, and the schema drifts straight back.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon;

commit;

-- ============================================================
-- APPLIED 2026-09-26 to project lagjjcpclvzrjlrswojt.
--
-- Verified: anon reads are identical before and after —
--   2 approved builds, 231 products, 493 live affiliate links —
-- and the server-rendered /parts page still lists all 231 products.
--
-- State after the change:
--   anon INSERT/UPDATE/DELETE/TRUNCATE grants in public ....... 0
--   anon SELECT grants in public .............................. 59  (unchanged)
--   default ACL, owner postgres, tables ....... anon=rxtm/postgres
--     r select · x references · t trigger · m maintain — no a/w/d/D
--
-- ONE ENTRY COULD NOT BE ALTERED, AND IT STILL GRANTS WRITES
--
--   default ACL, owner supabase_admin, tables .. anon=arwdDxtm/supabase_admin
--                                                     ^^^^ insert update delete truncate
--
-- ALTER DEFAULT PRIVILEGES can only be run by the role that owns the entry,
-- or a superuser. supabase_admin is neither us nor reachable from the SQL
-- editor, so that entry stands. The practical consequence:
--
--   a table created in public BY supabase_admin still arrives with
--   INSERT/UPDATE/DELETE/TRUNCATE granted to anon.
--
-- In normal use tables are created by postgres — the SQL editor, migrations,
-- this repo's files — and those are covered. The exposure is tables created
-- by Supabase's own tooling on our behalf, which is exactly the case nobody
-- is watching, because it does not look like a schema change we made.
--
-- So this needs re-checking rather than assuming. Sweep:
--
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'anon'
--      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
--    group by table_name
--    order by table_name;
--
-- Zero rows is the expected result. Anything it returns is a table that
-- arrived after this ran, carrying grants it should not have — revoke them on
-- that table and check whether its RLS policies were ever written.
--
-- The default-ACL entries themselves, if the above ever comes back non-empty
-- and the reason is not obvious:
--
--   select coalesce(r.rolname,'?') as owner, d.defaclobjtype,
--          array_to_string(d.defaclacl, ' | ') as acl
--     from pg_default_acl d
--     join pg_namespace n on n.oid = d.defaclnamespace
--     left join pg_roles r on r.oid = d.defaclrole
--    where n.nspname = 'public';
--
-- See CLAUDE.md, "A revoke is not permanent — default privileges re-grant".
-- ============================================================
