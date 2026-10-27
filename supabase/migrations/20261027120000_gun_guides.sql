-- gun_guides — builds spec'd in the Armory, shown on gunforma-gun-guides.html.
-- A Gun Guide is the "loadout" object claude/loadouts-spec.md argued for: a
-- parts list someone is speccing, NOT a build someone owns. Its own table, not
-- a kind column on builds, for the reason in that spec §4 — a missed
-- discriminator filter returns wrong rows with no error.
--
-- Publishes instantly (no review): every part is already a catalog product, so
-- there is no photo to redact and no legal confirmation to collect. The title
-- is the one piece of user-typed text on a public surface; moderation is
-- report-and-takedown per spec §7.5, so is_removed exists for an admin to
-- flip without deleting the row.
--
-- House rules applied (CLAUDE.md, "Security conventions"):
--   * RLS on AND an explicit revoke — Supabase's default ACL grants anon and
--     authenticated full privileges on every new public table.
--   * No inline table reads in any policy.
--   * Owner identified by auth.uid(), public read.

create table public.gun_guides (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  platform_id    uuid not null references public.platforms (id),
  gun_id         uuid references public.guns (id),
  parts_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(parts_snapshot) = 'array'),
  is_removed     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.gun_guides is
  'Armory-spec''d parts lists ("Gun Guides"): catalog parts only, published instantly, shown on gunforma-gun-guides.html. Not real builds — those are rows in builds.';

-- The model must belong to the platform, same composite-FK trick as
-- builds_gun_fkey (see CLAUDE.md, "The model travels with the platform").
alter table public.gun_guides
  add constraint gun_guides_gun_platform_fkey
  foreign key (gun_id, platform_id) references public.guns (id, platform_id);

create index idx_gun_guides_created on public.gun_guides (created_at desc) where not is_removed;
create index idx_gun_guides_user    on public.gun_guides (user_id);

-- updated_at, same shape as the other tables' triggers.
create or replace function public.gun_guides_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_gun_guides_updated_at
  before update on public.gun_guides
  for each row execute function public.gun_guides_touch_updated_at();

-- ── RLS + grants ───────────────────────────────────────────────────────────
alter table public.gun_guides enable row level security;

revoke all on table public.gun_guides from anon, authenticated;
grant select on table public.gun_guides to anon, authenticated;
grant insert, update, delete on table public.gun_guides to authenticated;

-- Public read of what is not taken down. The owner still sees a removed row
-- of their own (so a takedown does not read as data loss).
create policy gun_guides_public_read on public.gun_guides
  for select
  using (not is_removed or user_id = auth.uid());

create policy gun_guides_owner_insert on public.gun_guides
  for insert to authenticated
  with check (user_id = auth.uid());

-- Owners may edit and delete their own rows, but never un-remove a row an
-- admin took down (is_removed can only stay what it was, for an owner).
create policy gun_guides_owner_update on public.gun_guides
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_removed = false);

create policy gun_guides_owner_delete on public.gun_guides
  for delete to authenticated
  using (user_id = auth.uid());
