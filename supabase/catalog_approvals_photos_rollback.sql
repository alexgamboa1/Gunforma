-- Rollback for supabase/migrations/20261030231741_catalog_approvals_photos.sql.
-- Puts every row it touched back to what it held on 2026-10-30, including the
-- borrowed and shared photos it removed — so check-routes' "one colour, one
-- photo" assertion fails again after this runs, as it did before.

-- 10. Contour Remote back on the TLR-7 X Sub page
update public.products set url = 'https://www.streamlight.com/products/detail/tlr-7-x-sub'
 where slug = 'streamlight-tlr-7-x-contour-remote'
   and url = 'https://www.streamlight.com/products/detail/tlr-7-x-contour-remote';

-- 8. ZPS.P port count unknown again
update public.slide_specs s set port_count = null
  from public.products p
 where p.id = s.product_id and p.slug = 'zaffiri-zpsp-p365-xl' and s.port_count = 2;

-- 7. AXG Black / Gold, no safety: unpriced, waiver on
update public.product_variants set msrp = null, no_msrp_ok = true
 where slug = 'icarus-precision-axg-fuse-black-gold-anodized' and msrp = 584.99;

-- 6. ECM magwell custom colours: the shared SKU back
update public.product_variants set sku = 'Standard-Magwell-Custom-Ano'
 where slug in ('ecm-precision-standard-magwell-r11-blue-anodized',
                'ecm-precision-standard-magwell-r11-purple-anodized',
                'ecm-precision-standard-magwell-r11-red-anodized')
   and sku is null;

-- 5. Anarchy: the composite back on all four colours
update public.product_variants
   set primary_image_url = 'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg',
       no_photo_ok = false
 where slug in ('anarchy-outdoors-slide-plate-p365-blue', 'anarchy-outdoors-slide-plate-p365-gold',
                'anarchy-outdoors-slide-plate-p365-purple', 'anarchy-outdoors-slide-plate-p365-red')
   and primary_image_url is null;

-- 4. TP P365-FUSE Black · DLC: the Spectrum gallery row, by its old id
insert into public.variant_images (id, variant_id, url, position, alt_text)
select '63f90ebf-d315-40b5-8fe3-23ddec47480b', v.id,
       'https://cdn11.bigcommerce.com/s-c7qzuakk7l/products/5629/images/7041/True-Precision-Sig-Sauer-P365-FUSE-Axiom-Slide-Spectrum-TP-P365FSS-S-RMS__20292.1775849936.386.513.jpg?c=1',
       1, null
  from public.product_variants v
 where v.slug = 'true-precision-p365-fuse-black-dl-rmsc'
on conflict (id) do nothing;

-- 3. Tyrant: the composite back on Blue, Gray, Red
update public.product_variants
   set primary_image_url = 'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg',
       no_photo_ok = false
 where slug in ('tyrant-cnc-slide-cap-p365-blue', 'tyrant-cnc-slide-cap-p365-grey', 'tyrant-cnc-slide-cap-p365-red')
   and primary_image_url is null;

-- 2. TP P365-FUSE Black · Nitride: the DLC photo back
update public.product_variants
   set primary_image_url = 'https://op1.0ps.us/640-640/opplanet-true-precision-true-precision-sig-p365-fuse-9mm-rms-cut-cover-plate-pistol-slide-tp-p365fss-bc-rms-main.jpg',
       no_photo_ok = false
 where slug = 'true-precision-p365-fuse-black-n-rmsc' and primary_image_url is null;

-- 1. The sixteen waivers on the seven parts
update public.product_variants set no_photo_ok = false
 where no_photo_ok and primary_image_url is null and slug in (
   'armory-craft-p365-comp-gold',
   'ecm-precision-carry-basepad-p365xmacro-blue-anodized', 'ecm-precision-carry-basepad-p365xmacro-green-anodized',
   'ecm-precision-carry-basepad-p365xmacro-purple-anodized', 'ecm-precision-carry-basepad-p365xmacro-red-anodized',
   'ecm-precision-r11-macro-fde-ns', 'ecm-precision-r11-macro-mb-ns',
   'ecm-precision-standard-magwell-r11-blue-anodized', 'ecm-precision-standard-magwell-r11-purple-anodized',
   'ecm-precision-standard-magwell-r11-red-anodized',
   'true-precision-flat-p365-blue', 'true-precision-flat-p365-fde',
   'true-precision-slide-cap-p365-blue', 'true-precision-slide-cap-p365-fde',
   'zaffiri-p365-threaded-copper', 'zaffiri-p365-threaded-stealth-grey');
