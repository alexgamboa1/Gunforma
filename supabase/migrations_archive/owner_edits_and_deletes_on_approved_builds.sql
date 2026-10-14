-- ============================================================
-- Gunforma-v2 — owners may edit live builds in part, and delete at any status
-- APPLIED 2026-09-26. See the record at the bottom of this file.
--
-- No rollback file: reverting means narrowing two policies back and dropping
-- the trigger, which is three statements and a product decision, not a
-- mechanical undo.
--
-- WHAT CHANGED
-- Two owner policies on public.builds were widened, and a BEFORE trigger was
-- added to hold the line the policies can no longer hold on their own.
--
--   before                                      after
--   "Owners can edit their own unreviewed       "Owners can edit their own
--    builds"                                     builds"
--     auth.uid() = user_id AND status in           auth.uid() = user_id
--     ('draft','pending','rejected')
--
--   "Owners can delete their own draft          "Owners can delete their own
--    builds"                                     builds"
--     auth.uid() = user_id AND                     auth.uid() = user_id
--     status = 'draft'
--
-- WHY A TRIGGER AND NOT A POLICY
-- RLS decides WHICH ROWS a statement may touch. It cannot say "this row, but
-- only these columns, and only when the old row looked like this" — a WITH
-- CHECK sees the new row, not the old one, so it cannot express "you may
-- change the name but not the platform of a build that is already approved".
-- That rule is per-column and depends on OLD, so it lives in a BEFORE trigger.
--
-- THE RULE
-- On a build that is already approved, an owner may change name, description
-- and activities. Any change to the platform, the parts, the status, the
-- tier, ownership, the consent columns or the review columns raises. The
-- message is deliberately a sentence a builder can act on rather than a
-- constraint name:
--
--   "On a live build you can change the name, description and activity. To
--    change the gun itself, delete this build and post the new one."
--
-- THE EARLY RETURN IS LOAD-BEARING
-- The function returns NEW immediately when request.jwt.claims is NULL.
-- PostgREST sets that setting on every API request; a direct SQL connection —
-- psql, the Supabase SQL editor, a migration — has no such setting and reads
-- NULL. Without the early return the guard would fire on those connections
-- too, and the owner of the database would be locked out of fixing their own
-- data through the only tool that can fix it. An earlier draft of this
-- function omitted that check and would have done exactly that.
--
-- This is not a hole: reaching a direct SQL connection already requires
-- credentials nobody but the project owner holds, and service_role is
-- admitted explicitly on the line below for the same reason. The guard exists
-- to constrain API callers, which is where owners actually are.
--
-- Note it is the same claim CLAUDE.md prescribes reading elsewhere
-- ("A SECURITY DEFINER function must identify the caller from the request
-- JWT"), and the same asymmetry recorded in
-- supabase/fix_build_photo_tampering_guard.sql — service_role bypasses RLS
-- but not triggers, so it has to be let through by name.
-- ============================================================

begin;

drop policy if exists "Owners can edit their own unreviewed builds" on public.builds;
create policy "Owners can edit their own builds" on public.builds
  for update to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners can delete their own draft builds" on public.builds;
create policy "Owners can delete their own builds" on public.builds
  for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.restrict_owner_edits_on_approved_build()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare claims text; jwt_role text;
begin
  claims := current_setting('request.jwt.claims', true);
  -- NULL on a direct SQL connection, which already requires credentials
  -- nobody but the owner holds. This guard is for API callers.
  if claims is null then return new; end if;
  begin jwt_role := coalesce(claims::jsonb ->> 'role',''); exception when others then jwt_role := ''; end;

  if old.status = 'approved' and jwt_role <> 'service_role' and not public.is_admin() then
    if new.platform_id is distinct from old.platform_id
       or new.parts_snapshot is distinct from old.parts_snapshot
       or new.status is distinct from old.status
       or new.tier is distinct from old.tier
       or new.user_id is distinct from old.user_id
       or new.legal_confirmed is distinct from old.legal_confirmed
       or new.content_license_confirmed is distinct from old.content_license_confirmed
       or new.builder_agreement_version is distinct from old.builder_agreement_version
       or new.confirmed_at is distinct from old.confirmed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.created_at is distinct from old.created_at
    then
      raise exception 'On a live build you can change the name, description and activity. To change the gun itself, delete this build and post the new one.';
    end if;
  end if;
  return new;
end; $function$;

create trigger trg_restrict_owner_edits_on_approved
  before update on public.builds
  for each row execute function public.restrict_owner_edits_on_approved_build();

commit;

-- ============================================================
-- APPLIED 2026-09-26 to project lagjjcpclvzrjlrswojt.
--
-- Function body above is the deployed definition, read back with
-- pg_get_functiondef rather than reconstructed — this file documents a guard,
-- and a plausible-but-different body in the record is worse than no record.
--
-- Columns an owner may change on an approved build, by exclusion from the
-- list above: name, description, activities. Plus updated_at and
-- edit_history, which have guards of their own (builds_updated_at and
-- trg_prevent_owner_edit_history_change).
--
-- `tier` is on the blocked list and is easy to miss from the UI side: it is
-- derived from the parts count, and the pre-existing edit payload recomputed
-- and sent it on every save. Sending the old value unchanged is not a way
-- around that either — the comparison is IS DISTINCT FROM against jsonb for
-- parts_snapshot, so a re-serialised copy differing only in key order reads
-- as a change. gunforma-post-build.html therefore sends the three permitted
-- columns and nothing else on a live build.
--
-- Cascades on delete, all five, unchanged by this file: build_photos,
-- build_comments, build_fires, notifications and saved_builds are all
-- ON DELETE CASCADE, so an owner delete takes them with it. Storage objects
-- are not covered — nothing in the database knows about them — and are
-- removed by the client before the row goes.
-- ============================================================
