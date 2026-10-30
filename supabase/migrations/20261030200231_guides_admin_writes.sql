-- Gunforma guides become editable from the site, by admins, through the
-- Armory (Alex, 2026-10-30, "the Armory as the guide editor").
--
-- BEFORE. `guides` — the curated "Gunforma guides" tab on
-- gunforma-gun-guides.html — had one policy, "Public reads published
-- guides", and nothing that admitted a write: four rows typed in by hand
-- when the old Armory was built, editable only from the dashboard. Its
-- theme was a CHECK over four literals, so a fifth theme was a migration.
-- And `authenticated` still held INSERT / UPDATE / DELETE / REFERENCES /
-- TRIGGER on it (anon REFERENCES / TRIGGER) with no policy behind any of
-- them: harmless while RLS refuses every write, but exactly the drift
-- CLAUDE.md's "A revoke is not permanent" says to sweep.
--
-- AFTER.
--   * guide_themes — the theme list, one row per theme, seeded with the four
--     that exist. guides.category is a foreign key to it instead of the
--     CHECK, so a new theme is a row (the Armory's "New theme…" inserts one,
--     admins only), not a schema change. ON UPDATE CASCADE so renaming a key
--     carries the guides with it; ON DELETE RESTRICT so a theme in use cannot
--     vanish under its guides.
--   * guides.gun_id — the model the guide was built for, optional, the same
--     composite FK as builds and gun_guides ("The model travels with the
--     platform"), so reopening a guide in the Armory restores its model and
--     the grip tags with it. NULL is "Custom / FCU", which every existing
--     row is.
--   * Writes on guides are admin-only, through is_admin(): insert, update,
--     delete, plus a read of UNPUBLISHED rows so an admin can find and
--     publish a draft. The public read policy is unchanged.
--   * gun_guides (community guides): admins may also edit and delete any
--     row. Owners keep exactly the policies they had.
--   * Grants on guides are reset to what the policies use: SELECT for anon
--     and authenticated; INSERT / UPDATE / DELETE for authenticated, which is
--     the role an admin's request arrives as — every one of those now has an
--     is_admin() policy behind it. REFERENCES, TRIGGER and TRUNCATE go.
--
-- Every new policy is scoped TO authenticated: anon cannot execute
-- is_admin(), and Postgres permission-checks a policy's functions at plan
-- time, so a public-role policy calling it would break every anonymous read
-- of the gallery. is_admin() is SECURITY DEFINER with a pinned search_path
-- and reads profiles itself, so no policy here reads a table inline.
--
-- House order: the code that writes these (gunforma-armory.html,
-- gunforma-gun-guides.html) merged and deployed BEFORE this file is
-- applied. Until then the editor's save is refused by RLS and says
-- "Saving Gunforma guides isn't switched on yet"; the gallery's Edit link on
-- a Gunforma guide shows only to admins and leads to the same message.
--
-- Rollback: supabase/guides_admin_writes_rollback.sql.

-- ── guide_themes ────────────────────────────────────────────────────────────
create table public.guide_themes (
  key        text primary key check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(key) <= 40),
  label      text not null unique check (char_length(btrim(label)) between 1 and 40),
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

comment on table public.guide_themes is
  'Themes a Gunforma guide (public.guides) can carry. A new theme is a row; admins add them from the Armory''s save step.';

insert into public.guide_themes (key, label, sort_order) values
  ('concealed_carry',   'Concealed carry',     10),
  ('home_defense',      'Home defense',        20),
  ('range_competition', 'Range / competition', 30),
  ('duty',              'Duty',                40);

alter table public.guide_themes enable row level security;
revoke all on table public.guide_themes from anon, authenticated;
grant select on table public.guide_themes to anon, authenticated;
grant insert on table public.guide_themes to authenticated;

create policy guide_themes_public_read on public.guide_themes
  for select using (true);

create policy guide_themes_admin_insert on public.guide_themes
  for insert to authenticated
  with check (public.is_admin());

-- ── guides: theme FK, model, title bound ────────────────────────────────────
alter table public.guides drop constraint guides_category_check;
alter table public.guides
  add constraint guides_category_fkey
  foreign key (category) references public.guide_themes (key)
  on update cascade on delete restrict;

alter table public.guides add column gun_id uuid;
alter table public.guides
  add constraint guides_gun_platform_fkey
  foreign key (gun_id, platform_id) references public.guns (id, platform_id);

alter table public.guides
  add constraint guides_title_length check (char_length(btrim(title)) between 1 and 120);

-- ── guides: grants and admin policies ───────────────────────────────────────
revoke all on table public.guides from anon, authenticated;
grant select on table public.guides to anon, authenticated;
grant insert, update, delete on table public.guides to authenticated;

create policy guides_admin_read on public.guides
  for select to authenticated
  using (public.is_admin());

create policy guides_admin_insert on public.guides
  for insert to authenticated
  with check (public.is_admin());

create policy guides_admin_update on public.guides
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy guides_admin_delete on public.guides
  for delete to authenticated
  using (public.is_admin());

-- ── gun_guides: admins edit and delete any community guide ──────────────────
-- The owner policies stay as they are. An admin's edit keeps the row's
-- user_id (the Armory never sends it on an update), so the guide stays its
-- owner's.
create policy gun_guides_admin_update on public.gun_guides
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy gun_guides_admin_delete on public.gun_guides
  for delete to authenticated
  using (public.is_admin());
