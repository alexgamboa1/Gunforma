-- ============================================================
-- Rollback for supabase/admin_part_changes.sql
--
-- Removes the 'changes' notifications, the trigger, its function and the
-- counter, and restores the two notification constraints.
--
-- It does NOT un-write corrections from parts_snapshot (step 3 of the
-- forward file). Those are the corrected parts lists the builders and the
-- public now see, and the pages after this change read parts_snapshot as
-- the truth; putting the old values back would show the wrong parts again.
-- The log in edit_history still says what each part was before.
-- ============================================================

begin;

drop trigger if exists trg_zz_notify_build_changes on public.builds;
drop function if exists public.notify_build_changes();

delete from public.notifications where kind = 'changes';

alter table public.notifications drop constraint notifications_actor_required;
alter table public.notifications add constraint notifications_actor_required
  check (kind = 'approved' or actor_id is not null);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment', 'reply', 'like', 'approved'));

alter table public.builds drop column if exists changes_notified_count;

commit;
