-- ============================================================
-- Rollback for retire_is_primary.sql
--
-- Restores the column, its 201 hand-set values from the archive table, and
-- the unique partial index. Re-deploy the previous front-end alongside it if
-- you want the flag to affect ordering again — the readers no longer look at
-- it, so on its own this only restores the data.
-- ============================================================
alter table public.affiliate_links
  add column if not exists is_primary boolean not null default false;

update public.affiliate_links l
   set is_primary = true
  from public.affiliate_links_is_primary_archive a
 where a.link_id = l.id;

create unique index if not exists affiliate_one_primary_per_variant
  on public.affiliate_links (variant_id) where is_primary;

-- Verify: expect 201 primaries and 0 variants carrying more than one.
--   select count(*) from affiliate_links where is_primary;
--   select count(*) from (
--     select variant_id from affiliate_links
--      where is_primary group by variant_id having count(*) > 1) x;

-- Leave the archive table in place until the rollback is confirmed good.
-- drop table public.affiliate_links_is_primary_archive;
