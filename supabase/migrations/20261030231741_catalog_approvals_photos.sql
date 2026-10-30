-- Catalog data fixes from the 2026-10-30 data report. Every change here is
-- Alex's ruling of 2026-10-30, item by item; nothing else on these products
-- changes, and no product's approval moves except the eight approved below.
--
--   1. Approve seven parts held back only by options with no maker photo,
--      with the per-option waiver PR #221 introduced (no_photo_ok: the
--      colour swatch is that option's picture):
--        Armory Craft P365 Compensator          Gold
--        ECM Precision Carry base pad           Blue, Green, Purple, Red
--        ECM Precision R11 Macro                FDE, Midnight Bronze
--        ECM Precision Standard Magwell (R11)   Blue, Purple, Red
--        True Precision Flat P365 trigger       Blue, FDE
--        True Precision slide cap back plate    Blue, FDE
--        Zaffiri Precision P365 threaded barrel Copper, Stealth Gray
--   2. True Precision P365-FUSE: Black · Nitride loses the Black · DLC photo
--      it was borrowing (the file name says TP-P365FSS-BC, the DLC SKU).
--   3. Tyrant CNC P365 slide cap: Blue, Gray and Red lose the shared
--      multi-colour OpticsPlanet image. Black and Gold keep their own.
--   4. True Precision P365-FUSE: the Spectrum photo leaves Black · DLC's
--      gallery (the Spectrum option has its own primary).
--   5. Anarchy Outdoors slide plate: the five-colour composite stays on
--      Black (the default) only, which is what check-routes' allowlist note
--      always said. Blue, Gold and Red lose it. Purple gets its own photo:
--      OpticsPlanet's shot of the purple plate on a P365 (SKU 791617481541
--      in the file name; looked at 2026-10-30), which sat as a 200px
--      thumbnail in BLACK's gallery. It leaves that gallery and becomes
--      Purple's primary, at the 640px size the other OpticsPlanet primaries
--      use (the same image, 299x640).
--   6. ECM Precision Standard Magwell (R11): Blue, Purple and Red shared one
--      SKU ("Standard-Magwell-Custom-Ano", ECM's custom-anodize line item,
--      not a per-colour number). Cleared; a SKU nobody can order by is not a
--      SKU.
--   7. Icarus Precision AXG FUSE, Black / Gold, no manual safety: $584.99,
--      the price of every other Gold option without a safety, and its
--      "no price is fine" waiver from PR #221 turned off, so the approval
--      rule checks its price like every other option's.
--   8. Zaffiri Precision ZPS.P Ported P365XL slide: 2 ports (Alex
--      confirmed). That was its only missing fact; it approves, and the
--      Zaffiri P365XL ported barrel locked to it lists it again.
--  10. Streamlight TLR-7 X Contour Remote: products.url pointed at the
--      TLR-7 X Sub page. Streamlight has its own Contour Remote page
--      (read 2026-10-30, 200, titled for the Contour Remote).
--
-- (Item 9, the retired TLR-7 Sub, changes nothing: it stays discontinued.)
--
-- Every option left with no photo (items 2, 3, and 5 but Purple) takes the same
-- no_photo_ok waiver as item 1 — otherwise removing a wrong photo would
-- un-approve a part that was approved with it.
--
-- On a fresh database (supabase db reset, the check-migrations runner) the
-- catalog is empty and this file does nothing but say so. On a database that
-- has the catalog, every row below must be exactly as described or the whole
-- file stops.
--
-- Rollback: supabase/catalog_approvals_photos_rollback.sql.

do $$
declare
  n integer;
  r record;
  c_tp_fuse       constant text := 'true-precision-p365-fuse';
  c_tyrant        constant text := 'tyrant-cnc-slide-cap-p365';
  c_anarchy       constant text := 'anarchy-outdoors-slide-plate-p365';
  c_magwell       constant text := 'ecm-precision-standard-magwell-r11';
  c_axg           constant text := 'icarus-precision-axg-fuse';
  c_zps           constant text := 'zaffiri-zpsp-p365-xl';
  c_zps_barrel    constant text := 'zaffiri-p365-xl-ported';
  c_contour       constant text := 'streamlight-tlr-7-x-contour-remote';
  c_tp_dlc_photo  constant text := 'https://op1.0ps.us/640-640/opplanet-true-precision-true-precision-sig-p365-fuse-9mm-rms-cut-cover-plate-pistol-slide-tp-p365fss-bc-rms-main.jpg';
  c_tp_spectrum   constant text := 'https://cdn11.bigcommerce.com/s-c7qzuakk7l/products/5629/images/7041/True-Precision-Sig-Sauer-P365-FUSE-Axiom-Slide-Spectrum-TP-P365FSS-S-RMS__20292.1775849936.386.513.jpg?c=1';
  c_tyrant_multi  constant text := 'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg';
  c_anarchy_multi constant text := 'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg';
  c_purple_thumb  constant text := 'https://www.opticsplanet.com/i/200-200-ffffff/opplanet-anarchy-outdoors-slide-plate-for-sig-365-purple-791617481541-main.jpg';
  c_purple_photo  constant text := 'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-purple-791617481541-main.jpg';
  c_contour_old   constant text := 'https://www.streamlight.com/products/detail/tlr-7-x-sub';
  c_contour_new   constant text := 'https://www.streamlight.com/products/detail/tlr-7-x-contour-remote';
begin
  if not exists (select 1 from public.products) then
    raise notice 'catalog_approvals_photos: empty catalog (fresh database) — nothing to change';
    return;
  end if;

  -- ── 1. seven parts: their photo-less options show a swatch ───────────────
  for r in select * from (values
             ('armory-craft-comp-p365',                 1),
             ('ecm-precision-carry-basepad-p365xmacro', 4),
             ('ecm-precision-r11-macro',                2),
             (c_magwell,                                3),
             ('true-precision-flat-p365',               2),
             ('true-precision-slide-cap-p365',          2),
             ('zaffiri-p365-threaded',                  2)) as t(slug, expected) loop
    update public.product_variants v set no_photo_ok = true
      from public.products p
     where p.id = v.product_id and p.slug = r.slug and not p.is_discontinued
       and v.retired_at is null and v.primary_image_url is null and not v.no_photo_ok;
    get diagnostics n = row_count;
    if n <> r.expected then
      raise exception 'catalog_approvals_photos: expected % photo-less live variants on %, matched %', r.expected, r.slug, n;
    end if;
  end loop;

  -- ── 2. TP P365-FUSE Black · Nitride: not the DLC photo ────────────────────
  update public.product_variants v set primary_image_url = null, no_photo_ok = true
    from public.products p
   where p.id = v.product_id and p.slug = c_tp_fuse and v.retired_at is null
     and v.slug = c_tp_fuse || '-black-n-rmsc' and v.color = 'Black' and v.finish = 'Nitride'
     and v.primary_image_url = c_tp_dlc_photo
     and not exists (select 1 from public.variant_images vi where vi.variant_id = v.id);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected %-black-n-rmsc on the DLC photo with no gallery, matched %', c_tp_fuse, n; end if;

  perform 1 from public.product_variants
   where slug = c_tp_fuse || '-black-dl-rmsc' and primary_image_url = c_tp_dlc_photo and is_default and retired_at is null;
  if not found then raise exception 'catalog_approvals_photos: %-black-dl-rmsc is not the default holding its own DLC photo', c_tp_fuse; end if;

  -- ── 3. Tyrant CNC slide cap: Blue, Gray, Red lose the composite ───────────
  update public.product_variants v set primary_image_url = null, no_photo_ok = true
    from public.products p
   where p.id = v.product_id and p.slug = c_tyrant and v.retired_at is null
     and v.slug in (c_tyrant || '-blue', c_tyrant || '-grey', c_tyrant || '-red')
     and not v.is_default and v.primary_image_url = c_tyrant_multi
     and not exists (select 1 from public.variant_images vi where vi.variant_id = v.id);
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'catalog_approvals_photos: expected Blue, Gray and Red % on the composite with no gallery, matched %', c_tyrant, n; end if;

  select count(*) into n from public.product_variants
   where slug in (c_tyrant || '-black', c_tyrant || '-gold') and retired_at is null
     and primary_image_url like 'https://www.tyrantcnc.com/%';
  if n <> 2 then raise exception 'catalog_approvals_photos: expected Black and Gold % on their own Tyrant photos, matched %', c_tyrant, n; end if;

  -- ── 4. TP P365-FUSE Black · DLC: the Spectrum photo leaves its gallery ────
  -- variant_images is derived and cascades; the rollback restores the row by id.
  delete from public.variant_images vi
   using public.product_variants v
   where v.id = vi.variant_id and v.slug = c_tp_fuse || '-black-dl-rmsc'
     and vi.id = '63f90ebf-d315-40b5-8fe3-23ddec47480b' and vi.url = c_tp_spectrum;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected the one Spectrum gallery photo on %-black-dl-rmsc, matched %', c_tp_fuse, n; end if;

  -- ── 5. Anarchy Outdoors: the composite stays on Black alone ───────────────
  update public.product_variants v set primary_image_url = null, no_photo_ok = true
    from public.products p
   where p.id = v.product_id and p.slug = c_anarchy and v.retired_at is null
     and v.slug in (c_anarchy || '-blue', c_anarchy || '-gold', c_anarchy || '-red')
     and not v.is_default and v.primary_image_url = c_anarchy_multi
     and not exists (select 1 from public.variant_images vi where vi.variant_id = v.id);
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'catalog_approvals_photos: expected Blue, Gold and Red % on the composite with no gallery, matched %', c_anarchy, n; end if;

  perform 1 from public.product_variants
   where slug = c_anarchy || '-black' and is_default and retired_at is null and primary_image_url = c_anarchy_multi;
  if not found then raise exception 'catalog_approvals_photos: %-black is not the default holding the composite', c_anarchy; end if;

  -- Purple's own photo leaves Black's gallery (the rollback restores the row
  -- by id) and becomes Purple's primary; Purple keeps no waiver.
  delete from public.variant_images vi
   using public.product_variants v
   where v.id = vi.variant_id and v.slug = c_anarchy || '-black'
     and vi.id = 'e4178d55-0158-42e1-8e9b-2387128d06cb' and vi.url = c_purple_thumb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected the purple thumbnail in %-black''s gallery, matched %', c_anarchy, n; end if;

  update public.product_variants v set primary_image_url = c_purple_photo
    from public.products p
   where p.id = v.product_id and p.slug = c_anarchy and v.retired_at is null
     and v.slug = c_anarchy || '-purple' and v.color = 'Purple' and v.sku = '791617481541'
     and not v.is_default and not v.no_photo_ok and v.primary_image_url = c_anarchy_multi
     and not exists (select 1 from public.variant_images vi where vi.variant_id = v.id);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected %-purple (SKU 791617481541) on the composite with no gallery, matched %', c_anarchy, n; end if;

  -- ── 6. ECM Standard Magwell: no shared SKU on the custom colours ──────────
  update public.product_variants v set sku = null
    from public.products p
   where p.id = v.product_id and p.slug = c_magwell and v.retired_at is null
     and v.slug in (c_magwell || '-blue-anodized', c_magwell || '-purple-anodized', c_magwell || '-red-anodized')
     and v.sku = 'Standard-Magwell-Custom-Ano';
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'catalog_approvals_photos: expected Blue, Purple and Red % on the shared SKU, matched %', c_magwell, n; end if;

  -- ── 7. AXG FUSE Black / Gold, no safety: priced, waiver off ───────────────
  select count(*) into n from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = c_axg and v.retired_at is null and v.color like '%/Gold'
     and not v.manual_safety_variant and v.msrp = 584.99;
  if n <> 3 then raise exception 'catalog_approvals_photos: expected the three other % Gold options without a safety at $584.99, matched %', c_axg, n; end if;

  update public.product_variants
     set msrp = 584.99, no_msrp_ok = false
   where slug = c_axg || '-black-gold-anodized' and retired_at is null
     and color = 'Black/Gold' and not manual_safety_variant
     and msrp is null and no_msrp_ok;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected %-black-gold-anodized unpriced with its waiver on, matched %', c_axg, n; end if;

  -- ── 8. Zaffiri ZPS.P: two ports ───────────────────────────────────────────
  update public.slide_specs s set port_count = 2
    from public.products p
   where p.id = s.product_id and p.slug = c_zps and s.internally_ported and s.port_count is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected % internally ported with no port count, matched %', c_zps, n; end if;

  perform 1 from public.barrel_slide_requirements bsr
    join public.products b on b.id = bsr.barrel_product_id
    join public.products s on s.id = bsr.slide_product_id
   where b.slug = c_zps_barrel and s.slug = c_zps;
  if not found then raise exception 'catalog_approvals_photos: % is not locked to %', c_zps_barrel, c_zps; end if;

  -- ── 10. TLR-7 X Contour Remote: its own page ──────────────────────────────
  update public.products set url = c_contour_new
   where slug = c_contour and url = c_contour_old and not is_discontinued;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'catalog_approvals_photos: expected % pointing at the TLR-7 X Sub page, matched %', c_contour, n; end if;

  -- ── the outcome, read back ────────────────────────────────────────────────
  for r in select p.slug, public.product_data_status(p.id) as st from public.products p
            where p.slug in ('armory-craft-comp-p365', 'ecm-precision-carry-basepad-p365xmacro',
                             'ecm-precision-r11-macro', c_magwell, 'true-precision-flat-p365',
                             'true-precision-slide-cap-p365', 'zaffiri-p365-threaded', c_zps,
                             c_zps_barrel, c_tp_fuse, c_tyrant, c_anarchy, c_axg, c_contour) loop
    if not coalesce((r.st ->> 'approved')::boolean, false) then
      raise exception 'catalog_approvals_photos: % is not approved: %', r.slug, r.st -> 'missing';
    end if;
  end loop;
  select count(*) into n from public.products
   where slug in ('armory-craft-comp-p365', 'ecm-precision-carry-basepad-p365xmacro',
                  'ecm-precision-r11-macro', c_magwell, 'true-precision-flat-p365',
                  'true-precision-slide-cap-p365', 'zaffiri-p365-threaded', c_zps,
                  c_zps_barrel, c_tp_fuse, c_tyrant, c_anarchy, c_axg, c_contour);
  if n <> 14 then raise exception 'catalog_approvals_photos: expected 14 products to read back, found %', n; end if;
end $$;
