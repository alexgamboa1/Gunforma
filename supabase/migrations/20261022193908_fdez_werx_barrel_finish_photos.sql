-- Fdez Werx barrels: each finish carries the maker's own photo of that
-- finish. Ruled by Alex on 2026-10-22: the maker's per-finish photo for
-- each variant wherever Fdez shows one; the group shot only as a fallback
-- for a finish Fdez never photographs, and those listed for Alex before any
-- SHARED_PHOTO_ALLOWED entry is added.
--
-- Four products were created with one group shot on every finish, which is
-- what scripts/check-routes.mjs ("no two variants of different colour or
-- finish share a primary_image_url") flags. The source of each new photo is
-- Fdez's own option rule: on each product page, choosing a finish swaps the
-- main image to an `attribute_rule_images` file the store ties to that
-- option. Read 2026-10-22 from the page's own lookups
-- (/remote/v1/product-attributes/<id>, selected option -> sku, image), and
-- every image was looked at:
--
--   P365 3.1" flush (BigCommerce product 656), all four finishes:
--     Black DLC 7056, Gold 7058, Stainless 7055, Copper 7059 — single
--     barrels, each the named finish.
--   P365 FUSE 4.3" flush (804), all four:
--     Black DLC 7280, Stainless 7282, Gold 7283, Copper (rose) 7281 — the
--     barrel installed in a black slide, finish visible through the port.
--     The Black DLC barrel in a black slide cannot be told apart by eye; it
--     is still the image the maker ties to that finish.
--   P365 XL 3.7" flush (162), five of six:
--     Satin DLC 7276, Satin Gold 7246, Satin Copper 7274, Satin Blue 7062,
--     High Polished Stainless 7275 — single barrels.
--     Satin Stainless (SKU 365-BARREL-3.7-SA): the option has no image, and
--     the gallery holds only two five-barrel group shots. Keeps the group
--     shot; it is the only variant left on it, so nothing is shared.
--   P365 XL 3.0 / ACCS 3.7" ported (837), two of four:
--     Black DLC 7440 (single barrel), Stainless 7441 (two barrels side by
--     side; the gallery also has a single stainless barrel, 4461, should
--     Alex prefer it).
--     Gold and Copper: no option image, and no gallery photo shows either
--     alone. Both keep the four-barrel group shot, so they still share it:
--     check-routes stays red on this product until Alex rules on an
--     allowlist entry (Copper is the default variant, which the allowlist
--     requires).
--
-- 15 variants change; Satin Stainless, ported Gold and ported Copper do
-- not. Every row refuses unless the variant currently carries its product's
-- group shot. variant_images follow primary_image_url, as in
-- 20261022000559. On a fresh database (no catalog) it is a NOTICE and a
-- no-op.

do $$
declare
  r record;
  n integer;
  n_set integer := 0; n_img_deleted integer := 0; n_img_added integer := 0;
  rule constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/1280x1280/attribute_rule_images/';
  g_p365 constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/original/products/656/4749/FDEZ-Werx-P365-Non-LCI-Flush-Crown-31-Barrel_3918__39965.1787283812.JPG';
  g_fuse constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/original/products/804/4538/FDEZ-Werx-P365-FUSE-Non-LCI-Flush-Crown-43-Barrel_3948__81721.1787282950.JPG';
  g_xlf  constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/original/products/162/4065/FDEZ-Werx-P365-XL-Non-LCI-Flush-Crown-37-Barrel_3914__67225.1787203470.JPG';
  g_xlp  constant text := 'https://cdn11.bigcommerce.com/s-1nh4386ub1/images/stencil/original/products/837/4458/FDEZ-Werx-P365-XL-30-ACCS-Non-LCI-Ported-37-Barrel_3945__89522.1787282590.JPG';
begin
  if not exists (select 1 from public.products) then
    raise notice 'fdez werx barrel finish photos: products is empty (fresh database), nothing to fix';
    return;
  end if;

  for r in
    select * from (values
      ('fdez-werx-p365-flush-barrel-black-high-polished-black-dlc',                g_p365, rule || '7056_source_1715792758.jpg'),
      ('fdez-werx-p365-flush-barrel-gold-high-polished-gold',                      g_p365, rule || '7058_source_1715792165.jpg'),
      ('fdez-werx-p365-flush-barrel-stainless-steel-high-polished-stainless',      g_p365, rule || '7055_source_1715792874.jpg'),
      ('fdez-werx-p365-flush-barrel-copper-high-polished-copper',                  g_p365, rule || '7059_source_1715792165.jpg'),
      ('fdez-werx-p365-fuse-flush-barrel-black-high-polished-black-dlc',           g_fuse, rule || '7280_source_1718635328.jpg'),
      ('fdez-werx-p365-fuse-flush-barrel-stainless-steel-high-polished-stainless', g_fuse, rule || '7282_source_1718635333.jpg'),
      ('fdez-werx-p365-fuse-flush-barrel-gold-high-polished-gold',                 g_fuse, rule || '7283_source_1718635333.jpg'),
      ('fdez-werx-p365-fuse-flush-barrel-copper-high-polished-copper-rose',        g_fuse, rule || '7281_source_1718635333.jpg'),
      ('fdez-werx-p365-xl-flush-barrel-black-satin-dlc',                           g_xlf,  rule || '7276_source_1715789851.jpg'),
      ('fdez-werx-p365-xl-flush-barrel-gold-satin-gold',                           g_xlf,  rule || '7246_source_1715789851.jpg'),
      ('fdez-werx-p365-xl-flush-barrel-copper-satin-copper',                       g_xlf,  rule || '7274_source_1715789851.jpg'),
      ('fdez-werx-p365-xl-flush-barrel-blue-satin-blue',                           g_xlf,  rule || '7062_source_1715789851.jpg'),
      ('fdez-werx-p365-xl-flush-barrel-stainless-steel-high-polished-stainless',   g_xlf,  rule || '7275_source_1715789851.jpg'),
      ('fdez-werx-p365-xl-ported-barrel-black-high-polished-black-dlc',            g_xlp,  rule || '7440_source_1753745430.jpg'),
      ('fdez-werx-p365-xl-ported-barrel-stainless-steel-high-polished-stainless',  g_xlp,  rule || '7441_source_1728324226.jpg')
    ) as t (slug, from_url, to_url)
  loop
    update public.product_variants v
       set primary_image_url = r.to_url
     where v.slug = r.slug and v.retired_at is null and v.primary_image_url = r.from_url;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'variant %: expected one live row carrying its product''s group shot, matched %', r.slug, n;
    end if;
    n_set := n_set + 1;

    delete from public.variant_images i
     using public.product_variants v
     where i.variant_id = v.id and v.slug = r.slug and i.url = r.from_url;
    get diagnostics n = row_count;
    n_img_deleted := n_img_deleted + n;

    insert into public.variant_images (variant_id, url, position, alt_text)
    select v.id, r.to_url, 1, p.name || ' — ' || coalesce(v.variant_label, v.color)
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.slug = r.slug
       and not exists (select 1 from public.variant_images i where i.variant_id = v.id and i.url = r.to_url);
    get diagnostics n = row_count;
    n_img_added := n_img_added + n;
  end loop;

  if n_set <> 15 then
    raise exception 'fdez werx barrel finish photos: expected 15 variants set, got %', n_set;
  end if;

  -- The three finishes Fdez never photographs keep the group shot, untouched.
  select count(*) into n from public.product_variants v
   where v.retired_at is null and (
         (v.slug = 'fdez-werx-p365-xl-flush-barrel-satin-stainless-steel-satin-stainless' and v.primary_image_url = g_xlf)
      or (v.slug = 'fdez-werx-p365-xl-ported-barrel-gold-high-polished-gold-tin'          and v.primary_image_url = g_xlp)
      or (v.slug = 'fdez-werx-p365-xl-ported-barrel-copper-high-polished-copper'          and v.primary_image_url = g_xlp));
  if n <> 3 then
    raise exception 'fdez werx barrel finish photos: expected the 3 unphotographed finishes still on the group shot, found %', n;
  end if;

  -- No other variant of these four products is left on a group shot.
  select count(*) into n from public.product_variants v join public.products p on p.id = v.product_id
   where v.retired_at is null
     and p.slug in ('fdez-werx-p365-flush-barrel', 'fdez-werx-p365-fuse-flush-barrel',
                    'fdez-werx-p365-xl-flush-barrel', 'fdez-werx-p365-xl-ported-barrel')
     and v.primary_image_url in (g_p365, g_fuse, g_xlf, g_xlp);
  if n <> 3 then
    raise exception 'fdez werx barrel finish photos: expected exactly 3 variants on a group shot afterwards, found %', n;
  end if;

  raise notice 'fdez werx barrel finish photos: % set, % variant_images rows removed, % added', n_set, n_img_deleted, n_img_added;
end $$;
