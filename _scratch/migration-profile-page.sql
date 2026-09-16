-- ============================================================
-- Gunforma — Profile page support
-- Run this in the Supabase SQL editor (or as a new migration file)
-- BEFORE deploying gunforma-profile.html.
-- ============================================================

-- 1. Extra profile fields (bio, avatar, social links). Nullable, backward-compatible.
alter table public.profiles
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists instagram_url text,
  add column if not exists youtube_url text;

-- 1b. Avatar storage — a real photo upload, not a pasted link. Mirrors the
-- build-photos bucket's shape: public read (avatars are meant to be seen),
-- owner-only write, one folder per user so paths can't collide.
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)   -- 5MB cap; avatars are small, single-size images
on conflict (id) do nothing;

create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_owner_write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_owner_delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Saved builds (the "bookmark/star" feature — separate from build_fires,
--    which is a public like-count; saved_builds is a private reading list,
--    same shape/pattern as build_fires).
create table if not exists public.saved_builds (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  build_id   uuid not null references public.builds(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, build_id)
);

alter table public.saved_builds enable row level security;

create policy "saved_builds_select_own"
  on public.saved_builds for select
  using (auth.uid() = user_id);

create policy "saved_builds_insert_own"
  on public.saved_builds for insert
  with check (auth.uid() = user_id);

create policy "saved_builds_delete_own"
  on public.saved_builds for delete
  using (auth.uid() = user_id);

-- 3. Favorite parts (catalog-level, not build-level — "I like this part,
--    regardless of what build it ends up in"). References products directly;
--    if you want to favorite a specific variant/color, add variant_id later.
create table if not exists public.favorite_parts (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.favorite_parts enable row level security;

create policy "favorite_parts_select_own"
  on public.favorite_parts for select
  using (auth.uid() = user_id);

create policy "favorite_parts_insert_own"
  on public.favorite_parts for insert
  with check (auth.uid() = user_id);

create policy "favorite_parts_delete_own"
  on public.favorite_parts for delete
  using (auth.uid() = user_id);

-- 4. Helpful indexes for the profile page's queries.
create index if not exists idx_builds_user_id on public.builds(user_id);
create index if not exists idx_build_fires_build_id on public.build_fires(build_id);
create index if not exists idx_saved_builds_user_id on public.saved_builds(user_id);
create index if not exists idx_favorite_parts_user_id on public.favorite_parts(user_id);

-- ============================================================
-- NOTE ON RLS FOR builds.status ON OWN ROWS
-- gunforma-profile.html's "My Builds" tab needs the signed-in user to be
-- able to SELECT their own draft/pending/rejected builds, not just
-- 'approved' ones. If your current builds SELECT policy only allows
-- status = 'approved', add this (skip if an equivalent policy already
-- exists — check policies on public.builds first):
--
-- create policy "builds_select_own_any_status"
--   on public.builds for select
--   using (auth.uid() = user_id);
-- ============================================================
