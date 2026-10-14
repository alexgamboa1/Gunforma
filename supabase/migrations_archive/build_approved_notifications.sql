-- ============================================================
-- Gunforma — "your build is live" notification + email
-- Run in the Supabase SQL editor for project lagjjcpclvzrjlrswojt.
-- Rollback: supabase/build_approved_notifications_rollback.sql
--
-- READ STEP 3 BEFORE RUNNING IT. It stamps every existing notification as
-- already-emailed. Skip it and the first run of send-build-approved mails
-- every user about every comment and like since the table was created.
-- ============================================================

begin;

-- 1. a fourth kind ------------------------------------------------------
-- 'approved' has no actor: the sender is Gunforma, not a person. actor_id
-- therefore becomes nullable, with a check keeping it mandatory for the
-- three social kinds that do have one — so a future bug cannot write a
-- comment notification with no author and have it silently accepted.
alter table public.notifications alter column actor_id drop not null;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment', 'reply', 'like', 'approved'));

alter table public.notifications add constraint notifications_actor_required
  check (kind = 'approved' or actor_id is not null);

-- 2. the outbox column --------------------------------------------------
-- NULL = not yet emailed. The sender stamps it after a successful send.
-- This column is the only thing making a repeat run idempotent.
alter table public.notifications add column if not exists email_sent_at timestamptz;

create index if not exists idx_notifications_unsent
  on public.notifications (kind, email_sent_at)
  where email_sent_at is null;

-- 3. BACKFILL — DO NOT SKIP ---------------------------------------------
update public.notifications set email_sent_at = now() where email_sent_at is null;

-- 4. per-user opt-out ---------------------------------------------------
alter table public.profiles
  add column if not exists email_notifications boolean not null default true;

-- 5. the trigger --------------------------------------------------------
-- On the TABLE, not in the admin page. Approving through the admin UI, through
-- SQL, or through anything built later all pass through here. An unclaimed
-- build has nobody to notify, so a null user_id is skipped rather than raised.
create or replace function public.notify_build_approved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.user_id is not null then
    insert into public.notifications (user_id, actor_id, kind, build_id)
    values (new.user_id, null, 'approved', new.id);
  end if;
  return new;
end;
$$;

-- Not an API endpoint. Postgres grants EXECUTE to PUBLIC by default on every
-- new function; see CLAUDE.md on default privileges re-granting.
revoke execute on function public.notify_build_approved() from public, anon, authenticated;

drop trigger if exists trg_notify_build_approved on public.builds;
create trigger trg_notify_build_approved
  after update of status on public.builds
  for each row
  execute function public.notify_build_approved();

commit;

-- Verify, after committing:
--   select kind, count(*), count(*) filter (where email_sent_at is null) as unsent
--   from public.notifications group by kind;
-- 'unsent' must be 0 on every row. Anything else means step 3 did not run.
