-- ============================================================
-- Gunforma-v2 — build comments + votes
-- Run in the Supabase SQL editor for project lagjjcpclvzrjlrswojt
--
-- Threaded comments on approved builds, one level deep (a comment and its
-- replies — no reply-to-a-reply), with per-user up/down votes. Rendered by
-- gunforma-build-detail.html, which is the page a builder shares (/b/:id).
--
-- Shape, in one line each:
--   build_comments         one row per comment; soft-deleted via deleted_at
--   build_comment_votes    one row per (comment, user); value is -1 or +1
--   build_comments_public  the ONLY read path for the page — a view that
--                          joins username, score, and the caller's own vote
--
-- Security posture follows CLAUDE.md "Security conventions": RLS on, explicit
-- REVOKE, then only the grants a policy needs. Cross-row rules that RLS cannot
-- express (approved build only, one nesting level, no self-votes, rate limit,
-- who may edit what) live in BEFORE triggers that identify the caller with
-- auth.uid() — never current_user, which inside SECURITY DEFINER is the owner.
--
-- Everything runs in ONE transaction. Rollback: build_comments_rollback.sql.
-- ============================================================

begin;

-- ============================================================
-- TABLES
-- ============================================================
create table public.build_comments (
  id          uuid primary key default gen_random_uuid(),
  build_id    uuid not null references public.builds(id)   on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- null = top-level. A reply's parent must itself be top-level (trigger).
  parent_id   uuid references public.build_comments(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  -- Soft delete, same idea as retired_at on affiliate_links: the row stays so
  -- replies keep their place; the view blanks the body.
  deleted_at  timestamptz,
  constraint build_comments_body_len check (char_length(body) between 1 and 2000)
);

comment on table public.build_comments is
  'Comments on approved builds, one level of replies. Soft-deleted via deleted_at. Read through build_comments_public, never directly.';

create index idx_build_comments_build   on public.build_comments (build_id, created_at);
create index idx_build_comments_parent  on public.build_comments (parent_id) where parent_id is not null;
-- Rate-limit lookup: "how many has this user posted in the last N minutes".
create index idx_build_comments_user_time on public.build_comments (user_id, created_at desc);

create table public.build_comment_votes (
  comment_id  uuid not null references public.build_comments(id) on delete cascade,
  user_id     uuid not null references public.profiles(id)       on delete cascade,
  value       smallint not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

comment on table public.build_comment_votes is
  'One vote per user per comment, +1 or -1. Who voted is private; only the sum is exposed, via build_comments_public.';

-- ============================================================
-- ACCESS
-- Close both tables first, then open exactly what the page needs.
-- ============================================================
alter table public.build_comments      enable row level security;
alter table public.build_comment_votes enable row level security;

revoke all on public.build_comments      from anon, authenticated;
revoke all on public.build_comment_votes from anon, authenticated;

-- Comments: authors and admins can see raw rows (their own / everything);
-- the public reads through the view below, not the table.
grant select, insert, update on public.build_comments to authenticated;
grant delete on public.build_comments to authenticated;   -- policy limits to admins

create policy build_comments_select_own_or_admin on public.build_comments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy build_comments_insert_own on public.build_comments
  for insert to authenticated
  with check (user_id = auth.uid());

-- Owners edit/soft-delete their own; admins can soft-delete anyone's. The
-- trigger below decides WHICH columns each of them may change.
create policy build_comments_update_own_or_admin on public.build_comments
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy build_comments_delete_admin on public.build_comments
  for delete to authenticated
  using (public.is_admin());

-- Votes: a user sees, casts, changes and removes only their own. Nobody can
-- list who voted on what.
grant select, insert, update, delete on public.build_comment_votes to authenticated;

create policy build_comment_votes_own on public.build_comment_votes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- GUARDS — cross-row rules RLS cannot express.
-- SECURITY DEFINER so they can read builds/profiles regardless of the
-- caller's row visibility; caller identity comes from auth.uid() (the JWT).
-- ============================================================
create or replace function public.build_comments_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_recent int;
  v_parent public.build_comments%rowtype;
begin
  if v_uid is null or new.user_id <> v_uid then
    raise exception 'Comment must be posted as yourself';
  end if;

  -- A username is what the comment is attributed to; no username, no comment.
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.username is not null and btrim(p.username) <> ''
  ) then
    raise exception 'Complete your profile before commenting';
  end if;

  -- Only approved builds take comments. A draft/pending build is invisible to
  -- the public, and a comment on it would be too — until it wasn't.
  if not exists (
    select 1 from public.builds b where b.id = new.build_id and b.status = 'approved'
  ) then
    raise exception 'Comments are only allowed on approved builds';
  end if;

  -- One level of nesting: parent must be top-level, on the same build, alive.
  if new.parent_id is not null then
    select * into v_parent from public.build_comments where id = new.parent_id;
    if not found then
      raise exception 'Parent comment not found';
    end if;
    if v_parent.build_id <> new.build_id then
      raise exception 'Reply must be on the same build as its parent';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'Replies can only be one level deep';
    end if;
    if v_parent.deleted_at is not null then
      raise exception 'Cannot reply to a deleted comment';
    end if;
  end if;

  -- Rate limit: 10 comments per 10 minutes per user. Crude, but it is the
  -- difference between "someone spammed 10 links" and "someone spammed 10,000".
  select count(*) into v_recent
  from public.build_comments c
  where c.user_id = v_uid and c.created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'Slow down — try again in a few minutes';
  end if;

  new.body       := btrim(new.body);
  new.created_at := now();
  new.edited_at  := null;
  new.deleted_at := null;
  return new;
end;
$$;

create or replace function public.build_comments_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid    := auth.uid();
  v_owner boolean := (v_uid is not null and v_uid = old.user_id);
  v_admin boolean := public.is_admin();
begin
  -- Identity columns are frozen.
  if new.id         <> old.id
  or new.build_id   <> old.build_id
  or new.user_id    <> old.user_id
  or new.created_at <> old.created_at
  or new.parent_id is distinct from old.parent_id then
    raise exception 'Cannot move a comment';
  end if;

  -- Nobody un-deletes; a deleted comment is frozen entirely.
  if old.deleted_at is not null then
    raise exception 'Comment is deleted';
  end if;

  -- Body edits: owner only. Admins moderate (soft-delete), they do not rewrite.
  if new.body <> old.body then
    if not v_owner then
      raise exception 'Only the author can edit a comment';
    end if;
    new.body      := btrim(new.body);
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;   -- not a client-settable column
  end if;

  -- Soft delete: owner or admin.
  if new.deleted_at is not null then
    if not (v_owner or v_admin) then
      raise exception 'Not allowed to delete this comment';
    end if;
    new.deleted_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.build_comment_votes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.build_comments%rowtype;
begin
  if v_uid is null or new.user_id <> v_uid then
    raise exception 'Vote must be cast as yourself';
  end if;
  select * into v_c from public.build_comments where id = new.comment_id;
  if not found or v_c.deleted_at is not null then
    raise exception 'Comment not found';
  end if;
  if v_c.user_id = v_uid then
    raise exception 'You cannot vote on your own comment';
  end if;
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.build_comments_guard_insert()  from public;
revoke all on function public.build_comments_guard_update()  from public;
revoke all on function public.build_comment_votes_guard()    from public;

create trigger trg_build_comments_guard_insert
  before insert on public.build_comments
  for each row execute function public.build_comments_guard_insert();

create trigger trg_build_comments_guard_update
  before update on public.build_comments
  for each row execute function public.build_comments_guard_update();

create trigger trg_build_comment_votes_guard
  before insert or update on public.build_comment_votes
  for each row execute function public.build_comment_votes_guard();

-- ============================================================
-- READ PATH — build_comments_public
--
-- A view WITHOUT security_invoker, deliberately: it runs as its owner, so it
-- can sum votes without exposing vote rows, and it carries its own visibility
-- rule (approved builds only) instead of leaning on the caller's RLS. That
-- makes it the one place the "who can read comments" answer lives.
--
-- auth.uid() still reflects the caller inside an owner-run view — it reads
-- the request JWT claims, which the definer context does not disturb — so
-- my_vote is per viewer.
--
-- Deleted comments are returned with body = null so the page can keep a
-- "[deleted]" placeholder where replies hang off it.
-- ============================================================
create view public.build_comments_public as
select
  c.id,
  c.build_id,
  c.parent_id,
  c.user_id,
  case when c.deleted_at is null then c.body else null end as body,
  c.created_at,
  c.edited_at,
  (c.deleted_at is not null)                              as is_deleted,
  p.username,
  p.avatar_url,
  (select count(*)::int from public.builds b
     where b.user_id = c.user_id and b.status = 'approved') as author_build_count,
  coalesce((select sum(v.value)::int from public.build_comment_votes v
     where v.comment_id = c.id), 0)                        as score,
  (select v.value from public.build_comment_votes v
     where v.comment_id = c.id and v.user_id = auth.uid()) as my_vote
from public.build_comments c
join public.profiles p on p.id = c.user_id
where exists (select 1 from public.builds b where b.id = c.build_id and b.status = 'approved');

comment on view public.build_comments_public is
  'Public read model for build comments. Owner-run on purpose: sums votes without exposing them and enforces approved-builds-only itself.';

revoke all on public.build_comments_public from anon, authenticated;
grant select on public.build_comments_public to anon, authenticated;

commit;
