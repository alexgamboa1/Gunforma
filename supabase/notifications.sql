-- ============================================================
-- Gunforma-v2 — notifications (in-app inbox)
-- Run in the Supabase SQL editor for project lagjjcpclvzrjlrswojt,
-- AFTER build_comments.sql (the comment trigger below references it).
--
-- One row per thing a user should hear about:
--   comment  someone commented on your build
--   reply    someone replied to your comment
--   like     someone liked your build          (build_fires — the table keeps
--                                               its old name; the UI says Like)
--
-- Written ONLY by the triggers below (security definer, caller from the
-- JWT). Recipients can read their own rows and mark them read; nothing
-- else. Rendered by gunforma-notifications.html; the unread count feeds the
-- nav bell in js/nav.js.
--
-- Rollback: notifications_rollback.sql.
-- ============================================================

begin;

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,  -- recipient
  actor_id    uuid not null references public.profiles(id) on delete cascade,  -- who did it
  kind        text not null check (kind in ('comment', 'reply', 'like')),
  build_id    uuid not null references public.builds(id) on delete cascade,
  comment_id  uuid references public.build_comments(id) on delete cascade,
  -- First ~140 chars of the comment, snapshotted so the inbox needs no join
  -- and a later edit/delete of the comment doesn't blank the inbox line.
  preview     text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

comment on table public.notifications is
  'In-app inbox. Written by triggers on build_comments and build_fires only; recipients read their own rows and set read_at.';

-- The inbox query: mine, newest first. Partial index for the bell count.
create index idx_notifications_user_time on public.notifications (user_id, created_at desc);
create index idx_notifications_unread    on public.notifications (user_id) where read_at is null;

-- A like can be toggled on/off/on; one notification per (actor, build) is
-- plenty. Comments and replies are distinct rows per comment, so they carry
-- comment_id and don't collide with this.
create unique index uq_notifications_like on public.notifications (user_id, actor_id, build_id)
  where kind = 'like';

-- ============================================================
-- ACCESS
-- ============================================================
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Only read_at is grantable (column grant above), and the trigger below
-- makes sure it only ever moves from null to a timestamp.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.read_at is null and old.read_at is not null then
    raise exception 'Cannot mark a notification unread';
  end if;
  if new.read_at is not null then
    new.read_at := coalesce(old.read_at, now());
  end if;
  return new;
end;
$$;
revoke all on function public.notifications_guard_update() from public;

create trigger trg_notifications_guard_update
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

-- ============================================================
-- WRITERS — triggers on the source tables.
-- Never notify yourself. Only approved builds (a comment can't exist on an
-- unapproved build anyway, but a like can — build_fires has no such guard).
-- ============================================================
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_parent uuid;
  v_prev   text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 140);
begin
  select user_id into v_owner from public.builds where id = new.build_id and status = 'approved';
  if v_owner is null then return new; end if;

  if new.parent_id is not null then
    select user_id into v_parent from public.build_comments where id = new.parent_id;
    -- Reply: tell the parent's author (unless they wrote the reply).
    if v_parent is not null and v_parent <> new.user_id then
      insert into public.notifications (user_id, actor_id, kind, build_id, comment_id, preview)
      values (v_parent, new.user_id, 'reply', new.build_id, new.id, v_prev);
    end if;
    -- And the build owner, if they are neither the replier nor already told.
    if v_owner <> new.user_id and v_owner is distinct from v_parent then
      insert into public.notifications (user_id, actor_id, kind, build_id, comment_id, preview)
      values (v_owner, new.user_id, 'comment', new.build_id, new.id, v_prev);
    end if;
  elsif v_owner <> new.user_id then
    insert into public.notifications (user_id, actor_id, kind, build_id, comment_id, preview)
    values (v_owner, new.user_id, 'comment', new.build_id, new.id, v_prev);
  end if;
  return new;
end;
$$;

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if tg_op = 'DELETE' then
    -- Un-like: withdraw the notification only if it was never seen. A read
    -- one is history; deleting it would make the inbox lie about the past.
    delete from public.notifications
      where kind = 'like' and build_id = old.build_id and actor_id = old.user_id and read_at is null;
    return old;
  end if;
  select user_id into v_owner from public.builds where id = new.build_id and status = 'approved';
  if v_owner is null or v_owner = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, kind, build_id)
  values (v_owner, new.user_id, 'like', new.build_id)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.notify_on_comment() from public;
revoke all on function public.notify_on_like()    from public;

create trigger trg_notify_on_comment
  after insert on public.build_comments
  for each row execute function public.notify_on_comment();

create trigger trg_notify_on_like
  after insert or delete on public.build_fires
  for each row execute function public.notify_on_like();

commit;
