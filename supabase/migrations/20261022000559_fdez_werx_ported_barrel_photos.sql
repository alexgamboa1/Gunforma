-- Fdez Werx P365 Fuse Non-LCI Ported 4.3" barrel: each finish shows its own
-- photo. Approved by AG on 2026-10-22, same rule as 20261021181521: a photo
-- sits on a variant only if it is the maker's image of that exact finish; a
-- variant with no such photo carries none and the pages draw its swatch.
--
-- The product was created on 2026-10-21 with one image on all four finishes
-- — the maker's four-barrel group shot (copper, gold, stainless, black in
-- one frame), which shows no single finish. The maker's gallery
-- (https://fdezwerx.com/fdez-werxp365-fuse-non-lci-ported-4-3-barrel/)
-- labels nothing, so every image was looked at:
--   image 4500  the gold barrel alone: a clean single-finish photo
--   image 4502  the copper barrel installed in a slide, copper showing
--               through the window and hood
--   image 4503  the stainless barrel installed, stainless showing through
--               the window
--   image 4505  a black barrel in a black slide: the finish is not
--               distinguishable, so Black DLC carries no photo
-- The group shot ends up on no variant. Three of four variants keep a
-- photo, so the product does not end with zero.
--
-- Every row refuses when the variant's current photo is not the group shot
-- this file expects. On a fresh database (no catalog) it is a NOTICE and a
-- no-op. variant_images rows follow primary_image_url.

do $$
declare
  r record;
  n integer;
  n_set integer := 0; n_cleared integer := 0; n_img_deleted integer := 0; n_img_added integer := 0;
  c_group constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/original/products/812/4497/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3917__42057.1787282835.JPG';
begin
  if not exists (select 1 from public.products) then
    raise notice 'fdez werx ported barrel photos: products is empty (fresh database), nothing to fix';
    return;
  end if;

  for r in
    select * from (values
      ('fdez-werx-p365-fuse-ported-barrel-gold-high-polished-gold-tin',
       'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/1280x1280/products/812/4500/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3502__13933.1787282843.jpg?c=1'),
      ('fdez-werx-p365-fuse-ported-barrel-copper-high-polished-copper-rose',
       'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/1280x1280/products/812/4502/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3499__05040.1787282848.jpg?c=1'),
      ('fdez-werx-p365-fuse-ported-barrel-stainless-steel-high-polished-stainless',
       'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/1280x1280/products/812/4503/FDEZ-Werx-P365-Fuse-Non-LCI-Ported-43-Barrel_3497__72281.1787282851.jpg?c=1'),
      ('fdez-werx-p365-fuse-ported-barrel-black-high-polished-black-dlc', null)
    ) as t (slug, to_url)
  loop
    update public.product_variants v
       set primary_image_url = r.to_url
     where v.slug = r.slug and v.retired_at is null and v.primary_image_url = c_group;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'variant %: expected one live row carrying the group shot, matched %', r.slug, n;
    end if;
    if r.to_url is null then n_cleared := n_cleared + 1; else n_set := n_set + 1; end if;

    delete from public.variant_images i
     using public.product_variants v
     where i.variant_id = v.id and v.slug = r.slug and i.url = c_group;
    get diagnostics n = row_count;
    n_img_deleted := n_img_deleted + n;

    if r.to_url is not null then
      insert into public.variant_images (variant_id, url, position, alt_text)
      select v.id, r.to_url, 1, p.name || ' — ' || coalesce(v.variant_label, v.color)
        from public.product_variants v join public.products p on p.id = v.product_id
       where v.slug = r.slug
         and not exists (select 1 from public.variant_images i where i.variant_id = v.id and i.url = r.to_url);
      get diagnostics n = row_count;
      n_img_added := n_img_added + n;
    end if;
  end loop;

  if n_set <> 3 or n_cleared <> 1 then
    raise exception 'fdez werx ported barrel photos: expected 3 set and 1 cleared, got % and %', n_set, n_cleared;
  end if;

  -- The group shot sits on no variant of this product afterwards, and the
  -- product keeps at least one photo.
  if exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
              where p.slug = 'fdez-werx-p365-fuse-ported-barrel' and v.retired_at is null and v.primary_image_url = c_group) then
    raise exception 'fdez werx ported barrel photos: the group shot is still on a variant';
  end if;
  if not exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
                  where p.slug = 'fdez-werx-p365-fuse-ported-barrel' and v.retired_at is null and v.primary_image_url is not null) then
    raise exception 'fdez werx ported barrel photos: the product would end with no photo at all';
  end if;

  raise notice 'fdez werx ported barrel photos: % set, % cleared, % variant_images rows removed, % added', n_set, n_cleared, n_img_deleted, n_img_added;
end $$;
