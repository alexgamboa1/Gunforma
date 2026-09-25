-- ============================================================
-- Gunforma-v2 — product-images storage policies must not read profiles inline
-- NOT YET APPLIED. See the status note at the bottom of this header.
--
-- No rollback file on purpose: the "before" state is the outage described
-- below, and restoring it would restore the outage.
--
-- THE BUG
-- Audit finding #5 step 2 (supabase/profiles_revoke_hidden_columns.sql) ran
--     revoke select on public.profiles from authenticated;
-- and granted back only the 8 non-sensitive columns. `role` is deliberately
-- NOT among them — own-row access to it goes through get_my_profile(), which
-- is where commit c9ce30f (audit #5 step 1) moved every self-scoped read.
--
-- Three storage policies were missed by that migration. All three test for
-- admin by reading profiles inline:
--
--     EXISTS (SELECT 1 FROM profiles
--              WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
--
-- and `authenticated` can no longer select profiles.role, so that subquery
-- cannot execute.
--
-- WHY IT BROKE EVERYTHING AND NOT JUST PRODUCT IMAGES
-- Postgres permission-checks every relation a query plan references. The
-- check happens when the statement is planned, not lazily per row, so the
-- leading `bucket_id = 'product-images'` never gets to short-circuit it:
-- the policy expression is attached to storage.objects, so EVERY
-- insert/update/delete against storage.objects by an authenticated user is
-- planned with all three expressions in it and throws
--
--     42501  permission denied for table profiles
--
-- regardless of which bucket the write targets. That took out build photo
-- uploads, avatar uploads and photo deletion — none of which touch the
-- product-images bucket at all.
--
-- Window: 2026-09-22 (when the revoke was applied) until fixed.
--
-- THE FIX
-- Call public.is_admin() instead. It is SECURITY DEFINER with a pinned
-- search_path, so it reads profiles as its owner and the caller needs no
-- privilege on the table — the same reason every other admin policy in this
-- schema already uses it. Nothing about who counts as an admin changes.
--
-- The `auth.role() = 'authenticated'` clause in the old expressions is
-- dropped as redundant: `to authenticated` on the policy already says it.
--
-- STATUS
-- This file was written as a record of a change reported as already applied.
-- It is NOT applied. Verified read-only against project lagjjcpclvzrjlrswojt
-- on 2026-09-25: all three policies still carry the inline
-- EXISTS (SELECT 1 FROM profiles ...), `authenticated` still holds no
-- table-level SELECT on profiles, and `role` is not among its 8 column
-- grants. The outage above is therefore still live. Run this file.
-- ============================================================

begin;

-- INSERT — upload
drop policy "Admin upload product images" on storage.objects;
create policy "Admin upload product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

-- UPDATE — needs both: `using` picks the rows that may be updated,
-- `with check` constrains what they may be updated to. The policy being
-- replaced had only `using`, which left the post-image row unconstrained.
drop policy "Admin update product images" on storage.objects;
create policy "Admin update product images" on storage.objects
  for update to authenticated
  using      (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

-- DELETE — `using` only; there is no post-image row to check.
drop policy "Admin delete product images" on storage.objects;
create policy "Admin delete product images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

commit;

-- The public read policy on this bucket ("Public read access for product
-- images", using bucket_id = 'product-images') never referenced profiles and
-- is deliberately left alone.
