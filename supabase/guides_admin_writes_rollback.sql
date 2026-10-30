-- Rollback for supabase/migrations/20261030200231_guides_admin_writes.sql.
-- Puts guides and gun_guides back to their pre-migration policies and the
-- four-theme CHECK. Refuses (the CHECK fails to add) if any guide carries a
-- theme outside the original four — reassign those first. gun_id is dropped,
-- and with it any model a guide was saved with.
--
-- The leftover grants are NOT restored: they had no policy behind them, and
-- restoring drift is not a rollback anyone needs.

drop policy if exists gun_guides_admin_delete on public.gun_guides;
drop policy if exists gun_guides_admin_update on public.gun_guides;

drop policy if exists guides_admin_delete on public.guides;
drop policy if exists guides_admin_update on public.guides;
drop policy if exists guides_admin_insert on public.guides;
drop policy if exists guides_admin_read   on public.guides;

revoke insert, update, delete on table public.guides from authenticated;

alter table public.guides drop constraint if exists guides_title_length;
alter table public.guides drop constraint if exists guides_gun_platform_fkey;
alter table public.guides drop column if exists gun_id;

alter table public.guides drop constraint if exists guides_category_fkey;
alter table public.guides
  add constraint guides_category_check
  check (category = any (array['home_defense', 'concealed_carry', 'range_competition', 'duty']));

drop table if exists public.guide_themes;
