-- ============================================================
-- Gunforma-v2 — product-images storage policies must not read profiles inline
-- APPLIED 2026-09-25. See the record at the bottom of this file.
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
-- Window: 2026-09-22 (when the revoke was applied) to 2026-09-25 — three
-- days, silently. The only symptom anyone saw was a generic "Upload failed"
-- toast; nothing surfaced the 42501 or named profiles.
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
-- The invariant this cost us is recorded in CLAUDE.md, "A policy's table
-- reads are checked even when the policy doesn't apply".
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

-- ============================================================
-- APPLIED 2026-09-25 to project lagjjcpclvzrjlrswojt.
-- Verified live after the change:
--
--   zero policies on storage.objects reference profiles
--   four build photos uploaded successfully, from the same account that had
--     been getting 400s throughout the window above
--
-- Note for anyone reading the history: an earlier revision of this file
-- carried a NOT YET APPLIED status, recorded on 2026-09-25 from a read-only
-- check that found the old inline-profiles policies still live. The fix
-- landed later the same day, from another session. Both statements were true
-- when written; this one supersedes.
-- ============================================================
