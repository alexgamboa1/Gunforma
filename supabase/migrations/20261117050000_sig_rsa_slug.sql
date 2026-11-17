-- The SIG factory recoil spring assembly's slug (Alex, 2026-11-17).
-- Added today as sig-sauer-xmacro-p365xl — a slug that names the guns, not
-- the part. Renamed to sig-sauer-recoil-spring-assembly-p365xl before
-- anything indexes it (created 2026-11-17, not yet indexed).
--
-- The slug is the shared address, so the old path gets an exact 301 in
-- netlify.toml (above the /parts/* rewrite) with its line in BOTH redirect
-- list copies and the pair in check-routes — the category-move steps, the
-- TTI magazine being the worked example. No RETIRED entry in
-- check-sitemap: the old URL was never in the pinned baseline.
--
-- Deploys-before-push window, same as the ARC Reactor rename: between the
-- code deploy and this file being applied, the old address 301s to a path
-- that still 404s, and the catalog surfaces drop the row (its stored slug
-- is in the redirect set until the rename lands). Minutes, on a part that
-- is hours old.
--
-- Fresh database: no products exist when migrations replay, so this
-- NOTICEs and returns. A drifted row refuses.

do $$
declare
  n integer;
  cur record;
begin
  select count(*) into n from public.products;
  if n = 0 then
    raise notice 'products is empty (fresh database) — nothing to rename';
    return;
  end if;

  if exists (select 1 from public.products where slug = 'sig-sauer-recoil-spring-assembly-p365xl') then
    raise notice 'new slug already in place — skipping';
    return;
  end if;

  select slug, category::text as category into cur
    from public.products where slug = 'sig-sauer-xmacro-p365xl';
  if not found then
    raise exception 'sig-sauer-xmacro-p365xl not found and the new slug does not exist either — refusing';
  end if;
  if cur.category is distinct from 'recoil_spring' then
    raise exception 'sig-sauer-xmacro-p365xl is a %, not the recoil spring this ruling was made about — refusing', cur.category;
  end if;

  update public.products
     set slug = 'sig-sauer-recoil-spring-assembly-p365xl'
   where slug = 'sig-sauer-xmacro-p365xl';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'slug rename touched % rows, expected 1', n;
  end if;
end $$;
