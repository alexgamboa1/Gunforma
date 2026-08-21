-- ============================================================
-- Gunforma-v2 — profiles + builds tables and RLS policies
-- Run this in the Supabase SQL editor for project lagjjcpclvzrjlrswojt
-- ============================================================

-- ============================================================
-- PROFILES TABLE
-- Columns match what gunforma-signin.html / gunforma-signup.html
-- already read/write: id, username, role, marketing_consent.
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  role text not null default 'user' check (role in ('user','admin')),
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now()
);

-- signUp() only passes username/marketing_consent as auth metadata —
-- something has to turn that into a profiles row. This trigger does it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, marketing_consent)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- BUILDS TABLE
-- Columns match what gunforma-post-build-v6.html collects and
-- gunforma-admin-queue.html reviews.
-- ============================================================
create table public.builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform_id uuid references public.platforms(id),
  name text not null,
  tier text not null default 'minimum' check (tier in ('minimum','full')),
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected')),
  activities text[] not null default '{}',
  description text,
  rejection_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- is_admin() — shared helper used by builds policies below.
-- security definer so it can read profiles.role regardless of the
-- caller's own RLS visibility (kept stable/search_path-locked per
-- Supabase's recommended pattern for RLS helper functions).
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- PROFILES RLS
-- ============================================================
alter table public.profiles enable row level security;

-- Public read: gunforma-signup.html checks username availability
-- before the visitor is signed in (anon role), and usernames are
-- already shown publicly on every build. Note this also exposes
-- `role` and `marketing_consent` to anyone who queries the table —
-- acceptable here, but split into a narrower public view later if
-- that becomes a concern.
create policy "Profiles are publicly readable"
on public.profiles for select
to anon, authenticated
using (true);

-- Defense-in-depth: the on_auth_user_created trigger is what actually
-- creates rows, but if the app ever inserts client-side, only allow
-- a user to insert their own row.
create policy "Users can insert their own profile"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

-- Regular users can only edit their own profile row.
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- "Own row" alone isn't enough — without this, a user could update
-- their own row and set role = 'admin'. Block any change to `role`
-- unless the person making the change is already an admin.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change role';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_self_escalation
before update on public.profiles
for each row execute function public.prevent_role_self_escalation();

-- ============================================================
-- BUILDS RLS
-- ============================================================
alter table public.builds enable row level security;

-- SELECT — three additive policies (Postgres OR's policies for the
-- same command together):

-- 1. Everyone (including signed-out visitors) can see live builds.
create policy "Public can view approved builds"
on public.builds for select
to anon, authenticated
using (status = 'approved');

-- 2. Owners can always see their own builds (draft/pending/rejected too),
--    so their Armory page works.
create policy "Owners can view their own builds"
on public.builds for select
to authenticated
using (auth.uid() = user_id);

-- 3. Only admins can see other users' pending/draft/rejected builds —
--    this is the review queue requirement.
create policy "Admins can view all builds"
on public.builds for select
to authenticated
using (public.is_admin());

-- INSERT — users can only create builds under their own user_id, and
-- can't submit something pre-marked as approved/rejected.
create policy "Users can create their own builds"
on public.builds for insert
to authenticated
with check (auth.uid() = user_id and status in ('draft','pending'));

-- UPDATE (owner path) — owners can edit their own build only while it's
-- still draft/pending. The WITH CHECK keeps `status` inside that same
-- whitelist, so an owner can never flip their own build to 'approved'
-- no matter what they send in the request — only the admin policy below
-- can do that.
create policy "Owners can edit their own unreviewed builds"
on public.builds for update
to authenticated
using (auth.uid() = user_id and status in ('draft','pending'))
with check (auth.uid() = user_id and status in ('draft','pending'));

-- UPDATE (admin path) — this is what "only admins can approve" maps to:
-- only rows visible/writable under is_admin() can transition status to
-- approved/rejected, or be edited once already reviewed.
create policy "Admins can review and edit any build"
on public.builds for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- DELETE — owners can remove their own unsubmitted drafts; admins can
-- remove anything.
create policy "Owners can delete their own draft builds"
on public.builds for delete
to authenticated
using (auth.uid() = user_id and status = 'draft');

create policy "Admins can delete any build"
on public.builds for delete
to authenticated
using (public.is_admin());
