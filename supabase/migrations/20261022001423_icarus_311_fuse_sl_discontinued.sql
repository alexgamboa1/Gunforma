-- Icarus Precision "311 FUSE SL": discontinued, never deleted.
--
-- The row (created 2026-10-01 in a bulk load of eleven Icarus products, url
-- the 311 series page, one variant with no SKU, no photo, no listing, in no
-- build and no fit row) describes a product Icarus does not sell: its site
-- offers the 311, the 311 SL and the 311 FUSE and nothing else, its search
-- and every retailer carrying the line know no FUSE SL, and the image URL
-- Icarus's naming would give one is the Missing_Photo placeholder byte for
-- byte. Its $399.99 is the 311 SL's price, not the FUSE's $449.99. Ruled on
-- 2026-10-22: option (b), discontinue.
--
-- products.is_discontinued = true takes it off every browse surface and the
-- sitemap (CLAUDE.md, "Discontinued parts"); the product page still answers
-- 200, and netlify.toml (same PR) 301s its path to the real product it
-- described, /parts/frames/icarus-precision-311-fuse. Nothing is deleted.
--
-- Refuses unless the row is exactly as described. On a fresh database (no
-- catalog) it is a NOTICE and a no-op.

do $$
declare n integer;
begin
  if not exists (select 1 from public.products) then
    raise notice 'icarus 311 fuse sl: products is empty (fresh database), nothing to do';
    return;
  end if;

  update public.products
     set is_discontinued = true
   where id = 'cda18ea3-8ef5-44e1-a171-e07302b37399'
     and slug = 'icarus-precision-311-fuse-sl'
     and name = 'Icarus Precision 311 Series 311 FUSE SL'
     and is_discontinued = false;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'icarus-precision-311-fuse-sl: expected one live row by id, slug and name, matched %', n;
  end if;

  -- the successor it 301s to must be live
  if not exists (select 1 from public.products where slug = 'icarus-precision-311-fuse' and is_discontinued = false) then
    raise exception 'icarus-precision-311-fuse (the 301 target) is not a live product';
  end if;

  raise notice 'icarus-precision-311-fuse-sl discontinued; /parts/frames/icarus-precision-311-fuse-sl now 301s to icarus-precision-311-fuse';
end $$;
