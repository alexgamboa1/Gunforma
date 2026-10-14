-- ============================================================
-- Gunforma-v2 — build_photos: admins may INSERT
-- APPLIED 2026-09-26. See the record at the bottom of this file.
--
-- No rollback file: the "before" state is the bug below, and restoring it
-- would restore it. To undo, drop the policy by name.
--
-- THE BUG
-- build_photos carried a full set of admin escape hatches — except the one
-- that mattered:
--
--   Admins can view all build photos     SELECT   is_admin()
--   Admins can edit any build photo      UPDATE   is_admin()
--   Admins can delete any build photo    DELETE   is_admin()
--   (nothing)                            INSERT
--
-- and the only INSERT policy was the owner one:
--
--   Owners can add photos to their own unreviewed builds
--     with check ( auth.uid() = build_photos.user_id
--                  AND EXISTS (select 1 from builds b
--                               where b.id = build_photos.build_id
--                                 AND b.status in ('draft','pending')
--                                 AND b.user_id = auth.uid()) )
--
-- gunforma-admin-post.html publishes with status 'approved' and
-- user_id null, by design — the build is live immediately and the real
-- builder is linked later by the launch-invite Edge Function. Both of the
-- trailing clauses above therefore fail: the status is not draft or pending,
-- and builds.user_id is null rather than the admin's id. No policy permitted
-- the insert, so every photo insert from that page was refused with
--
--     42501  new row violates row-level security policy for table "build_photos"
--
-- /admin-post had never successfully attached a photo to a build. Not
-- "regressed" — never worked.
--
-- WHY IT WENT UNSEEN
-- The page inserted the build row first and committed it, then attempted the
-- photos, and reported failures as "Publish failed — see console". So each
-- attempt left a live, approved, ownerless, photo-less build behind and said
-- nothing about it. On 2026-09-26 one failing publish became seven orphaned
-- public builds, because each retry created another. The publish path is made
-- atomic in the same change as this file: a failed photo insert now deletes
-- the build row it just created, and the 42501 above is shown on screen
-- instead of being swallowed.
--
-- THE FIX
-- Give admins the INSERT hatch they already have for the other three verbs,
-- with the same predicate. public.is_admin() is SECURITY DEFINER with a
-- pinned search_path, so this does not read profiles inline — see CLAUDE.md,
-- "A policy's table reads are checked even when the policy doesn't apply",
-- which is the failure mode that took storage down for three days in
-- September.
--
-- The owner policy is untouched and still governs ordinary builders: this
-- widens nothing for them, and a non-admin gets exactly what they got before.
-- ============================================================

begin;

create policy "Admins can add photos to any build"
  on public.build_photos
  for insert to authenticated
  with check (public.is_admin());

commit;

-- ============================================================
-- APPLIED 2026-09-26 to project lagjjcpclvzrjlrswojt.
--
-- Policy set on public.build_photos after this change:
--
--   cmd     policy                                                predicate
--   SELECT  Public can view photos of approved builds             build is approved
--   SELECT  Owners can view their own build photos                auth.uid() = user_id
--   SELECT  Admins can view all build photos                      is_admin()
--   INSERT  Owners can add photos to their own unreviewed builds  owner + draft|pending
--   INSERT  Admins can add photos to any build                    is_admin()      <- new
--   UPDATE  Owners can edit photo metadata …                      owner + draft|pending
--   UPDATE  Admins can edit any build photo                       is_admin()
--   DELETE  Owners can delete photos from their own …             owner + draft|pending
--   DELETE  Admins can delete any build photo                     is_admin()
--
-- INSERT policies are permissive and OR together, so the owner rule is
-- unchanged for everyone who is not an admin.
--
-- Worth knowing for the seven orphans from 2026-09-26: they are approved
-- builds with user_id null and no photo rows. They are not cleaned up by
-- this file — deleting live public rows is a deliberate act, not a migration.
-- They can be found with
--
--   select id, name, created_at from public.builds
--    where user_id is null and status = 'approved'
--      and not exists (select 1 from public.build_photos p where p.build_id = builds.id);
--
-- and that query will also match any legitimately photo-less admin post, so
-- read the list before deleting from it.
-- ============================================================
