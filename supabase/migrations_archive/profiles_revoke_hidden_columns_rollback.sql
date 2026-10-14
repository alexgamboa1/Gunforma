-- ============================================================
-- Gunforma-v2 — ROLLBACK for profiles_revoke_hidden_columns.sql
--
-- Restores the exact state recorded before the change, verified against
-- information_schema on 2026-09-22:
--
--   authenticated  held a TABLE-level SELECT grant on public.profiles.
--                  The per-column rows visible in
--                  information_schema.column_privileges were that grant
--                  expanded across all 13 columns, NOT separate grants — so
--                  restoring the table grant restores them. (Same shape as
--                  the partners rollback in PR #25.)
--
--   anon           held column-only SELECT on 8 columns and no table grant.
--                  NEITHER file touches anon in either direction.
--
-- Order matters: drop the narrow column grants first, then restore the table
-- grant. A table-level SELECT supersedes column grants, but leaving the
-- column rows behind would not match the recorded starting state.
--
-- Nothing else needs undoing: the UPDATE grant, the RLS policies, the
-- escalation trigger and get_my_profile() are all untouched by the migration.
-- get_my_profile() can stay after a rollback — it is additive and harmless.
-- ============================================================

revoke select (
  id,
  username,
  bio,
  avatar_url,
  instagram_url,
  youtube_url,
  created_at,
  onboarding_complete
) on public.profiles from authenticated;

grant select on public.profiles to authenticated;
