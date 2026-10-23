-- Fdez Werx P365 FUSE ported barrel: record the photos production already
-- holds. Alex's choice, 2026-10-22: Black DLC, Copper (the default) and
-- Stainless show Fdez's group photo of all four finishes (image 4496:
-- copper, gold, stainless, black, top to bottom); Gold keeps its own (4500).
-- scripts/check-routes.mjs allowlists the shared photo (same PR).
--
-- Why a migration for something already live: after
-- 20261022000559_fdez_werx_ported_barrel_photos.sql, two changes were
-- written straight to the database, and no file recorded them:
--   - Black DLC: primary_image_url NULL -> 4496, plus a variant_images row
--     (position 1) for it. 000559 had left it with no photo.
--   - Copper and Stainless: their own photos (4502, 4503), primary and
--     variant_images row both, -> 4496.
-- A database built from the repo would show 000559's photos, not these.
--
-- Per variant this accepts exactly two states and refuses any other:
--   already 4496 (primary 4496, and one variant_images row: 4496 at
--     position 1)                                  -> nothing to do
--   000559's end state (Black DLC: no photo, no image rows; Copper: 4502
--     and one 4502 row; Stainless: 4503 and one 4503 row) -> moved to 4496
-- So on production, where all three already match, it is a NOTICE and
-- writes nothing. Gold is not touched. On a fresh database (no catalog) it
-- is a NOTICE and a no-op.

do $$
declare
  r record;
  n integer;
  n_rows integer;
  n_match integer;
  n_moved integer := 0;
  n_already integer := 0;
  g constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/original/products/812/4496/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3944__57998.1787282833.JPG';
begin
  if not exists (select 1 from public.products) then
    raise notice 'fdez werx fuse ported group photo: products is empty (fresh database), nothing to record';
    return;
  end if;

  for r in
    select t.slug, t.from_url, v.id as vid, v.primary_image_url as cur
      from (values
        ('fdez-werx-p365-fuse-ported-barrel-black-high-polished-black-dlc', null::text),
        ('fdez-werx-p365-fuse-ported-barrel-copper-high-polished-copper-rose',
         'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/1280x1280/products/812/4502/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3499__05040.1787282848.jpg?c=1'),
        ('fdez-werx-p365-fuse-ported-barrel-stainless-steel-high-polished-stainless',
         'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/1280x1280/products/812/4503/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3497__72281.1787282851.jpg?c=1')
      ) as t (slug, from_url)
      left join public.product_variants v on v.slug = t.slug and v.retired_at is null
  loop
    if r.vid is null then
      raise exception 'variant %: no live row', r.slug;
    end if;

    select count(*), count(*) filter (where i.url = g and i.position = 1)
      into n_rows, n_match
      from public.variant_images i where i.variant_id = r.vid;

    if r.cur = g and n_rows = 1 and n_match = 1 then
      n_already := n_already + 1;
      continue;
    end if;

    -- 000559's end state, and nothing else
    if r.cur is distinct from r.from_url then
      raise exception 'variant %: photo is neither 4496 nor the state 20261022000559 left (found %)', r.slug, coalesce(r.cur, 'none');
    end if;
    select count(*) into n from public.variant_images i
     where i.variant_id = r.vid and (r.from_url is null or i.url is distinct from r.from_url);
    if n <> 0 or n_rows <> (case when r.from_url is null then 0 else 1 end) then
      raise exception 'variant %: variant_images rows are neither 4496 alone nor what 20261022000559 left (% rows)', r.slug, n_rows;
    end if;

    update public.product_variants v set primary_image_url = g
     where v.id = r.vid and v.primary_image_url is not distinct from r.from_url;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'variant %: expected to move one row, moved %', r.slug, n;
    end if;
    delete from public.variant_images i where i.variant_id = r.vid;
    insert into public.variant_images (variant_id, url, position, alt_text)
    select v.id, g, 1, p.name || ' — ' || coalesce(v.variant_label, v.color)
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = r.vid;
    n_moved := n_moved + 1;
  end loop;

  if n_moved + n_already <> 3 then
    raise exception 'fdez werx fuse ported group photo: expected 3 variants handled, got %', n_moved + n_already;
  end if;

  raise notice 'fdez werx fuse ported group photo: % already on 4496, % moved', n_already, n_moved;
end $$;
