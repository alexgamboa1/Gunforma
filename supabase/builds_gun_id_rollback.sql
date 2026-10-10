-- ============================================================
-- Rollback for builds_gun_id.sql.
--
-- Drops builds.gun_id and builds.fcu_only (the foreign key, the check, the
-- index and the column grants go with the columns), drops the unique key on
-- guns that the foreign key pointed at, and puts
-- restrict_owner_edits_on_approved_build() back to the body it had before —
-- the same function without the gun_id and fcu_only lines.
--
-- THIS LOSES DATA: every build's chosen model, and which builds are FCU
-- builds. There is no other copy. If the
-- reason for rolling back is a problem with the pages and not with the
-- column, leave the column and revert the pages instead — js/gun-model.js
-- cannot be made to stop asking while the column exists, but reverting the
-- two builder pages and the queue removes every reader and writer.
--
-- ORDER. The reverse of the forward one: run this FIRST only if the pages are
-- already tolerant of the column being absent, which they are — the probe in
-- js/gun-model.js fails and the model question disappears on the next page
-- load. A builder who had the form open across the rollback still has gun_id
-- in their payload, and that one save fails with PostgREST's "Could not find
-- the 'gun_id' column"; reloading the page clears it.
-- ============================================================

begin;

-- The function first: the current body names new.gun_id and new.fcu_only, and a function body
-- is only checked when it runs, so dropping the column under it would leave a
-- trigger that raises "record new has no field gun_id" on every UPDATE of
-- builds — every save, every approval.
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

alter table public.builds drop column if exists gun_id;
alter table public.builds drop column if exists fcu_only;

alter table public.guns drop constraint if exists guns_id_platform_key;

commit;
