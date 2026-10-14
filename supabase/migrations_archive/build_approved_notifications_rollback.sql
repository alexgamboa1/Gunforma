-- ============================================================
-- Rollback for build_approved_notifications.sql
-- Leaves profiles.email_notifications in place deliberately: dropping it
-- would discard opt-outs people have actually made, which is not reversible
-- by re-running the forward migration.
-- ============================================================

begin;

drop trigger if exists trg_notify_build_approved on public.builds;
drop function if exists public.notify_build_approved();

delete from public.notifications where kind = 'approved';

alter table public.notifications drop constraint if exists notifications_actor_required;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment', 'reply', 'like'));

alter table public.notifications alter column actor_id set not null;

drop index if exists public.idx_notifications_unsent;
alter table public.notifications drop column if exists email_sent_at;

commit;
