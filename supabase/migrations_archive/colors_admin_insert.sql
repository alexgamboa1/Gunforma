-- colors_admin_insert.sql
-- APPLIED 2026-10-04, after gunforma-admin-part.html (#133) was merged and
-- live. See the record at the bottom of this file.
--
-- Lets an admin add a colour from the add-a-part page. create_variant()
-- refuses any colour not in public.colors ("Add it there first (with a
-- color_family)"), and until now the only way to add one was SQL: the table
-- carries one policy, colors_public_read, and nothing that admits a write.
--
-- INSERT only. The page never edits or removes a colour, so no UPDATE or
-- DELETE policy is added.
--
-- is_admin(), never an inline read of profiles: a policy's table reads are
-- permission-checked at plan time for every statement on the table, so an
-- inline `exists (select 1 from profiles …)` would break INSERTs for anyone
-- without SELECT on profiles, whatever the predicate says. See CLAUDE.md,
-- "A policy's table reads are checked even when the policy doesn't apply".
-- is_admin() is SECURITY DEFINER with a pinned search_path.
--
-- GRANTS, logged and deliberately NOT changed here: authenticated holds
-- INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on
-- public.colors. INSERT is the one this policy needs. UPDATE, DELETE and
-- TRUNCATE have no policy behind them (RLS refuses the first two; TRUNCATE
-- is not subject to RLS at all) and belong to the grants audit, not here.

create policy colors_admin_insert on public.colors
  for insert to authenticated
  with check (public.is_admin());

-- ============================================================
-- APPLIED 2026-10-04 as migration colors_admin_insert (20261004032655) to
-- project lagjjcpclvzrjlrswojt, from this file as merged in #133.
-- Verified live after the change:
--
--   policies on public.colors: colors_admin_insert, colors_public_read
--   colors_admin_insert: INSERT, to authenticated, with check is_admin()
--   simulated callers, rolled back: admin inserts; signed-in non-admin
--     refused (42501, row-level security); anon refused (42501, no grant)
--   colors: 57 before and after — nothing was left behind by the tests
-- ============================================================
