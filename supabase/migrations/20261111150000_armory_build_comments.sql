-- Comments on Armory builds (PR 4 of the 2026-11-10/11 Armory design).
--
-- A NEW table, not build_comments: build_comments.build_id is a foreign
-- key to builds, so it cannot hold a gun_guides row — reusing it would
-- mean widening that FK under the Community Builds thread, a change with
-- blast radius far beyond this feature. Same shape where it fits (body
-- length, profiles FKs), minus what Armory comments don't have (no
-- replies, no edits — the thread is flat and append-only; the only write
-- after insert is a delete).
--
-- Who may do what (signed-in only — the comment box opens sign-in):
--   * anyone signed in comments, as themselves
--   * a commenter deletes their own comment; the LIST'S OWNER deletes any
--     comment on their list; admins delete any
--   * any signed-in reader reports a comment (once); admins read reports
--   * the list's owner is notified through the existing notifications
--     table — an anonymous list has no account, so no notification
--
-- House rules: RLS + explicit revoke; no inline table reads in a policy —
-- the owner check goes through a SECURITY DEFINER reader, the is_admin()
-- pattern; definer functions pinned and handed to postgres (db push runs
-- as cli_login_postgres, which neither owns the tables nor bypasses RLS).

create table public.armory_build_comments (
  id              uuid primary key default gen_random_uuid(),
  armory_build_id uuid not null references public.gun_guides (id) on delete cascade,
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index idx_armory_build_comments_build on public.armory_build_comments (armory_build_id, created_at);

alter table public.armory_build_comments enable row level security;
revoke all on table public.armory_build_comments from anon, authenticated;
grant select on table public.armory_build_comments to anon, authenticated;
grant insert, delete on table public.armory_build_comments to authenticated;
-- No UPDATE grant and no update policy: a comment is never edited.

-- The list's owner, read through a definer function so the delete policy
-- never reads gun_guides inline (CLAUDE.md: a policy's table reads are
-- checked even when the policy doesn't apply — an inline read here would
-- demand SELECT on gun_guides from every caller the table is planned for).
create or replace function public.armory_build_owner(p_build_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from gun_guides where id = p_build_id;
$$;
alter function public.armory_build_owner(uuid) owner to postgres;
revoke execute on function public.armory_build_owner(uuid) from public;
grant execute on function public.armory_build_owner(uuid) to authenticated;

create policy armory_comments_public_read on public.armory_build_comments
  for select
  using (true);

create policy armory_comments_signed_in_insert on public.armory_build_comments
  for insert to authenticated
  with check (user_id = auth.uid());

create policy armory_comments_delete on public.armory_build_comments
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.armory_build_owner(armory_build_id) = auth.uid()
    or public.is_admin()
  );

-- ── reports ────────────────────────────────────────────────────────────────
-- One row per (comment, reporter): the Report button is idempotent by
-- primary key. Readers never see reports; admins read them to act.
create table public.armory_comment_reports (
  comment_id uuid not null references public.armory_build_comments (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.armory_comment_reports enable row level security;
revoke all on table public.armory_comment_reports from anon, authenticated;
grant insert on table public.armory_comment_reports to authenticated;
grant select on table public.armory_comment_reports to authenticated;

create policy armory_comment_reports_insert on public.armory_comment_reports
  for insert to authenticated
  with check (user_id = auth.uid());

create policy armory_comment_reports_admin_read on public.armory_comment_reports
  for select to authenticated
  using (public.is_admin());

-- ── the owner's notification ───────────────────────────────────────────────
-- Through the existing notifications table: a new kind and a column naming
-- the Armory build (build_id stays builds', comment_id stays
-- build_comments' — neither FK can hold these rows). The row is stamped
-- email_sent_at at insert, the admin_part_changes convention, so an email
-- sender added later starts from new rows.
alter table public.notifications add column if not exists armory_build_id uuid references public.gun_guides (id) on delete cascade;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['comment'::text, 'reply'::text, 'like'::text, 'approved'::text, 'changes'::text, 'armory_comment'::text]));
-- build_id was NOT NULL (every old kind points at a build); an Armory
-- comment points at a gun_guides row instead, so the column relaxes and a
-- constraint keeps BOTH shapes exact — the old kinds still always carry
-- their build, the new one always carries its Armory build and never a
-- builds row. Found by the branch-database battery, not in review: the
-- trigger's insert failed 23502 before this.
alter table public.notifications alter column build_id drop not null;
alter table public.notifications drop constraint if exists notifications_target;
alter table public.notifications add constraint notifications_target check (
  (kind = 'armory_comment' and armory_build_id is not null and build_id is null)
  or (kind <> 'armory_comment' and build_id is not null and armory_build_id is null)
);

create or replace function public.notify_armory_build_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from gun_guides where id = new.armory_build_id;
  -- An anonymous list has no account to notify; nobody is told about
  -- their own comment.
  if v_owner is not null and v_owner <> new.user_id then
    insert into notifications (user_id, actor_id, kind, armory_build_id, preview, email_sent_at)
    values (v_owner, new.user_id, 'armory_comment', new.armory_build_id, left(new.body, 140), now());
  end if;
  return new;
end;
$$;
alter function public.notify_armory_build_comment() owner to postgres;
revoke execute on function public.notify_armory_build_comment() from public, anon, authenticated;

create trigger trg_notify_armory_build_comment
  after insert on public.armory_build_comments
  for each row execute function public.notify_armory_build_comment();
