-- Per-colour photos for the six variants still sharing a group shot
-- (Alex, 2026-11-16: "if the retailer has a distinct photo per colour, use
-- it; if the retailer only has one photo, allowlist it with a note").
--
-- check-routes' "one colour, one photo" audit has failed on these since at
-- least 2026-11-14: three products, each with variants of different
-- colours sharing one primary_image_url. Probed 2026-11-16:
--
-- * anarchy-outdoors-slide-plate-p365 — Blue, Gold and Red sat on
--   OpticsPlanet's five-plate composite (the 2026-10-30 ruling kept the
--   composite on Black alone). OpticsPlanet DOES publish per-colour
--   photos, named by colour + UPC (the pattern Purple already uses), so
--   the three get their own; Black (the default) keeps the composite
--   under the existing allowlist ruling.
-- * tyrant-cnc-slide-cap-p365 — Blue, Red and Gray sat on OpticsPlanet's
--   multi-colour mcimage while Black and Gold already carried Tyrant's own
--   per-colour photos (sig_365_slide_cap_<colour>.jpg). The maker has the
--   other three at the same path; verified 200 image/jpeg, and the grey
--   eyeballed as the actual grey cap.
-- * true-precision-p365-fuse — Black DLC and Black Nitride share one
--   photo. OpticsPlanet photographs ONE black (every other colour has a
--   -<code>-rms-main.jpg; the BL code 404s on every pattern), so that pair
--   is allowlisted in check-routes.mjs instead — no data change.
--
-- Gallery rows: none of the six variants has a variant_images row, so the
-- primary is the whole change.
--
-- Fresh database: no products exist when migrations run (seed.sql carries
-- reference data only), so this NOTICEs and returns. Drifted rows refuse.

do $$
declare
  n integer;
  -- [product slug, variant slug, expected current (shared) url, new url]
  rows text[][] := array[
    ['anarchy-outdoors-slide-plate-p365', 'anarchy-outdoors-slide-plate-p365-blue',
     'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg',
     'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-blue-791617481527-main.jpg'],
    ['anarchy-outdoors-slide-plate-p365', 'anarchy-outdoors-slide-plate-p365-gold',
     'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg',
     'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-gold-791617481534-main.jpg'],
    ['anarchy-outdoors-slide-plate-p365', 'anarchy-outdoors-slide-plate-p365-red',
     'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg',
     'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-red-791617481503-main.jpg'],
    ['tyrant-cnc-slide-cap-p365', 'tyrant-cnc-slide-cap-p365-blue',
     'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg',
     'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/s/i/sig_365_slide_cap_blue.jpg'],
    ['tyrant-cnc-slide-cap-p365', 'tyrant-cnc-slide-cap-p365-red',
     'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg',
     'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/s/i/sig_365_slide_cap_red.jpg'],
    ['tyrant-cnc-slide-cap-p365', 'tyrant-cnc-slide-cap-p365-grey',
     'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg',
     'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/s/i/sig_365_slide_cap_grey.jpg']
  ];
  r text[];
begin
  select count(*) into n from public.product_variants;
  if n = 0 then
    raise notice 'variant_colour_photos: no variants (fresh database) — nothing to correct.';
    return;
  end if;

  foreach r slice 1 in array rows loop
    -- Refuse drift: the variant must still carry the shared group shot.
    if not exists (
      select 1 from public.product_variants v join public.products p on p.id = v.product_id
       where p.slug = r[1] and v.slug = r[2] and v.retired_at is null
         and v.primary_image_url = r[3]
    ) then
      raise exception 'variant_colour_photos: % is not on the expected shared photo; refusing', r[2];
    end if;

    update public.product_variants v
       set primary_image_url = r[4]
      from public.products p
     where p.id = v.product_id and p.slug = r[1] and v.slug = r[2] and v.retired_at is null;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'variant_colour_photos: % update touched % rows', r[2], n;
    end if;
  end loop;

  -- No two live variants of either updated product share a photo now.
  select count(*) into n
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where p.slug in ('anarchy-outdoors-slide-plate-p365', 'tyrant-cnc-slide-cap-p365')
     and v.retired_at is null
   group by p.id having count(*) <> count(distinct v.primary_image_url)
   limit 1;
  if found then
    raise exception 'variant_colour_photos: a shared photo survived the update';
  end if;
end $$;
