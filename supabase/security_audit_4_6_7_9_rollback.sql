-- ============================================================
-- Gunforma-v2 — ROLLBACK for security_audit_4_6_7_9.sql
--
-- Restores the exact state recorded before the change:
--
--   partners              authenticated held a TABLE-level SELECT grant. The
--                         per-column rows visible in
--                         information_schema.column_privileges are that grant
--                         expanded, not separate grants — so restoring the
--                         table grant restores them. anon's column-only grants
--                         on (id, name, slug) are NOT touched by either file.
--   v_slide_frame_fit     security_invoker unset  => SECURITY DEFINER (default)   [confirmed]
--   set_part_class        proconfig null          => search_path not pinned        [confirmed]
--   record_price_change   \
--   prevent_owner_edit_   > EXECUTE reachable by anon and authenticated
--     history_change      /
--
-- CONFIRMED against pg_proc.proacl on 2026-09-22, before applying. Both
-- functions carry the same ACL, and it is BOTH forms at once — not the
-- either/or this file originally assumed:
--
--   {=X/postgres, postgres=X/postgres, anon=X/postgres,
--    authenticated=X/postgres, service_role=X/postgres}
--
--   =X/postgres            -> PUBLIC has EXECUTE
--   anon=X/, authenticated=X/ -> and both have it explicitly as well
--
-- So the restore has to name all three. service_role holds its own explicit
-- grant, which neither the migration nor this rollback touches, so the sync
-- keeps working throughout either direction.
-- ============================================================


-- ─── #4  partners ───────────────────────────────────────────────────────────
-- Drop the narrow column grants first, then restore the table-level grant.
-- Order matters: a table-level SELECT supersedes column grants, but leaving
-- the column rows behind would not match the recorded starting state.
revoke select (id, name, slug) on public.partners from authenticated;
grant  select on public.partners to authenticated;


-- ─── #6  trigger functions ──────────────────────────────────────────────────
grant execute on function public.record_price_change()               to public, anon, authenticated;
grant execute on function public.prevent_owner_edit_history_change() to public, anon, authenticated;


-- ─── #7  view back to SECURITY DEFINER ──────────────────────────────────────
-- RESET restores the default (false), which is exactly the prior state.
alter view public.v_slide_frame_fit reset (security_invoker);


-- ─── #9  unpin search_path ──────────────────────────────────────────────────
alter function public.set_part_class() reset search_path;
