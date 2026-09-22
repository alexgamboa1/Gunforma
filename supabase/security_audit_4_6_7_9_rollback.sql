-- ============================================================
-- Gunforma-v2 — ROLLBACK for security_audit_4_6_7_9.sql
--
-- Restores the exact state recorded before the change:
--
--   partners              authenticated held a TABLE-level SELECT grant
--                         (all columns) and no column-level grants of its own.
--                         anon's column grants on (id, name, slug) are NOT
--                         touched by either file.
--   v_slide_frame_fit     security_invoker unset  => SECURITY DEFINER (default)
--   set_part_class        proconfig null          => search_path not pinned
--   record_price_change   \
--   prevent_owner_edit_   > EXECUTE reachable by anon and authenticated
--     history_change      /
--
-- ⚠️ ONE VALUE STILL TO CONFIRM BEFORE EITHER FILE IS APPLIED.
-- For the two functions, `information_schema.routine_privileges` reported
-- grantees anon + authenticated, but that view expands PUBLIC, so it cannot
-- distinguish "granted to PUBLIC" (the Postgres default for a new function)
-- from "granted explicitly to anon and authenticated". The two need different
-- rollbacks. Confirm with:
--
--   select proname, proacl from pg_proc
--    where proname in ('record_price_change','prevent_owner_edit_history_change');
--
--   proacl null or containing "=X/"  -> PUBLIC          -> use variant A below
--   proacl containing "anon=X/"      -> explicit grants -> use variant B below
--
-- Variant A is written live because a null/PUBLIC acl is the expected state
-- for functions created without an explicit revoke, which is how both of
-- these were created. Swap if the check says otherwise.
-- ============================================================


-- ─── #4  partners ───────────────────────────────────────────────────────────
-- Drop the narrow column grants first, then restore the table-level grant.
-- Order matters: a table-level SELECT supersedes column grants, but leaving
-- the column rows behind would not match the recorded starting state.
revoke select (id, name, slug) on public.partners from authenticated;
grant  select on public.partners to authenticated;


-- ─── #6  trigger functions — VARIANT A (privilege came from PUBLIC) ─────────
grant execute on function public.record_price_change()               to public;
grant execute on function public.prevent_owner_edit_history_change() to public;

-- ─── #6  trigger functions — VARIANT B (explicit grants) ────────────────────
-- Use INSTEAD of variant A if proacl shows explicit anon/authenticated grants.
-- grant execute on function public.record_price_change()               to anon, authenticated;
-- grant execute on function public.prevent_owner_edit_history_change() to anon, authenticated;


-- ─── #7  view back to SECURITY DEFINER ──────────────────────────────────────
-- RESET restores the default (false), which is exactly the prior state.
alter view public.v_slide_frame_fit reset (security_invoker);


-- ─── #9  unpin search_path ──────────────────────────────────────────────────
alter function public.set_part_class() reset search_path;
