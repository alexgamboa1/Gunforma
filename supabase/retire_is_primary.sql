-- ============================================================
-- Gunforma-v2 — drop affiliate_links.is_primary
-- NOT YET APPLIED. Rollback: retire_is_primary_rollback.sql
--
-- ORDER MATTERS. Run this ONLY after the code that stops selecting
-- is_primary is merged AND deployed. All three readers name the column in
-- their select (js/affiliate.js, gunforma-build-detail.html,
-- netlify/functions/product-page.mjs); dropping it under the old code makes
-- PostgREST reject the WHOLE query with 42703, which empties the buy rows on
-- the catalog, the armory and build pages, and breaks /parts/:category/:slug.
--
-- WHY
-- is_primary was the first sort key, so the hero button pointed at the
-- curated listing while the price shown came from the cheapest fresh one —
-- two different rows (27 of 160 products). The sort fix demoted it to a
-- tiebreak; this removes it. Nothing in the repo ever wrote it: the sync
-- doesn't select or patch it, and no page inserts into affiliate_links. The
-- 201 flags were set by hand through the CSV import.
--
-- AFTER THIS RUNS, the CSV import template must no longer carry an
-- is_primary column or the import fails. See CLAUDE.md, "Adding an affiliate
-- link".
-- ============================================================

-- The flags are hand-set data, not derived — archive them so the rollback
-- restores the DATA and not just the column shape. DROP COLUMN is the one
-- irreversible step here.
create table if not exists public.affiliate_links_is_primary_archive as
  select id as link_id, now() as archived_at
    from public.affiliate_links
   where is_primary;

alter table public.affiliate_links_is_primary_archive
  add primary key (link_id);

-- Supabase's default ACL hands anon and authenticated full privileges on
-- every new public table, so RLS alone would leave those grants sitting
-- underneath it. Revoke explicitly — same reasoning as price_history.
alter table public.affiliate_links_is_primary_archive enable row level security;
revoke all on public.affiliate_links_is_primary_archive from anon, authenticated;

-- The column's only dependent object.
drop index if exists public.affiliate_one_primary_per_variant;

alter table public.affiliate_links drop column is_primary;
