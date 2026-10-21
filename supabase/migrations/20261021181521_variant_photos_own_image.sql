-- Variant photos: every buyable option shows ITS OWN photo or nothing.
-- From the 2026-10-21 variant-photo audit, approved by AG row by row.
-- No schema change. Nothing deleted except variant_images rows that mirror
-- a primary_image_url this file clears or replaces (derived data, CASCADE).
--
-- THE RULE. A photo is on a variant only if it is the maker's (or a listed
-- retailer's) image of that exact colour and finish. Never a sibling's
-- photo, never a group shot of every colour. A variant with no real photo
-- carries none and every surface draws its colour swatch instead
-- (js/variant-swatch.js, netlify/functions/_variant-swatch.mjs).
--
-- Measured on 2026-10-21 against what the pages read (primary_image_url):
-- 30 live variants had no photo, 35 showed a photo a sibling of a DIFFERENT
-- colour or finish also showed, and by eye several more showed a photo of
-- the wrong colour or a multi-colour composite that no rule could see.
-- 135 option-only cases (same colour and finish, different reticle or
-- battery, optics) are left as they are by decision.
--
-- WHAT THIS FILE DOES, in two kinds of row, every one named below:
--   to_url set   — 11 variants get the maker's own image of that colour
--                  (Grayguns' and Norsso's per-variant images, Tyrant's
--                  gold and black slide-cap photos).
--   to_url null  — 24 variants lose a photo that was not theirs: ECM's
--                  group shots and Cerakote line-up, OpticsPlanet's
--                  composites, Sig Guy's palette image, a black lever on the
--                  gold variant, a gold trigger on the black one, ECM's
--                  "Burnt Bronze" file on the FDE module, and the DLC slide
--                  photo on the Nitride variant.
-- No product ends with zero photos: Anarchy Outdoors' five-plate composite
-- stays on its default (Black) variant only, and every other product keeps
-- at least one variant with a real photo.
--
-- KNOWN EFFECT, reported in the PR: product_data_status() lists every live
-- variant without a photo under `missing`, so seven products that read
-- "approved" today read unapproved after this (they appear on the admin
-- Needs-data page; nothing public changes). That is the function telling
-- the truth about missing photos, not a regression this file hides.
--
-- Every row refuses when the variant's current photo is not the one this
-- file expects — a changed row, a re-run or a half-applied run stops the
-- whole file. On a fresh database (no catalog) it is a NOTICE and a no-op,
-- the shape every data migration here takes (check-migrations replays
-- from zero).

do $$
declare
  r record;
  n integer;
  n_set integer := 0; n_cleared integer := 0; n_img_deleted integer := 0; n_img_added integer := 0;
begin
  if not exists (select 1 from public.products) then
    raise notice 'variant photos: products is empty (fresh database), nothing to fix';
    return;
  end if;

  for r in
    select * from (values
      -- ── the 11 adds / replacements ─────────────────────────────────────
      ('grayguns-p365-xmacro-gm-black-ms',
       'https://grayguns.com/wp-content/uploads/2023/10/grayguns-p365-xmacro-laser-module-coyote-101.jpg',
       'https://grayguns.com/wp-content/uploads/2025/05/grayguns-p365-xmacro-grip-module-blk-103.webp'),
      ('grayguns-p365-xl-gm-black-ns',
       'https://grayguns.com/wp-content/uploads/2021/05/grayguns-p365xl-laser-module-gunmetal-gray-101.jpg',
       'https://grayguns.com/wp-content/uploads/2020/09/grayguns-p365xl-ls-mod-102.jpg'),
      ('tyrant-cnc-slide-cap-p365-gold',
       'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/s/i/sig_365_slide_cap_black.jpg',
       'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/s/i/sig_365_slide_cap_gold.jpg'),
      ('tyrant-cnc-slide-cap-p365-black',
       'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg',
       'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/s/i/sig_365_slide_cap_black.jpg'),
      ('norsso-n365-cport-black-dlc',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/products/2675/images/11536/N365_9mm_C_Port_Barrel_LVL1.5_Array_1__67116.1767142907.500.750.png?c=2',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/1480/5927/N365_9mm_Ported_Barrel_LVL1.5_Black_DLC_1__59466.1689872547.png?c=2'),
      ('norsso-n365-cport-gold-tin',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2675/11536/N365_9mm_C_Port_Barrel_LVL1.5_Array_1__67116.1767142907.png?c=2',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/1481/5935/N365_9mm_Ported_Barrel_LVL1.5_Gold_TiN_1__35057.1689873519.png?c=2'),
      ('norsso-n365-cport-copper-ticn',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2675/11536/N365_9mm_C_Port_Barrel_LVL1.5_Array_1__67116.1767142907.png?c=2',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2295/11499/N365_9mm_Ported_Barrel_LVL1.5_Copper_1__10614.1763424895.png?c=2'),
      ('norsso-n365-fuse-eport-satin-stainless-steel-satin',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/products/2679/images/12859/N365FUSE_E_Port_Barrel_Array_1__23414.1782344519.500.750.png?c=2',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2658/11438/N365FUSE_E_Port_Barrel_Satin_Stainless_LVL1.5__85572.1763168272.png?c=2'),
      ('norsso-n365-fuse-eport-black-dlc',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/original/products/2679/12859/N365FUSE_E_Port_Barrel_Array_1__23414.1782344519.png',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2779/12097/N365FUSE_E_Port_Barrel_Black_LVL1.5_1_New__45786.1773958255.png?c=2'),
      ('norsso-n365-fuse-eport-copper-ticn',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/original/products/2679/12859/N365FUSE_E_Port_Barrel_Array_1__23414.1782344519.png',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2780/12101/N365FUSE_E_Port_Barrel_Copper_LVL1.5_1_New__43772.1773958510.png?c=2'),
      ('norsso-n365-fuse-eport-gold-tin',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/original/products/2679/12859/N365FUSE_E_Port_Barrel_Array_1__23414.1782344519.png',
       'https://cdn11.bigcommerce.com/s-t13gqpo9l1/images/stencil/1280x1280/products/2914/12860/N365FUSE_E_Port_Barrel_Gold_LVL1.5_1__15000.1782344573.png?c=2'),
      -- ── the 24 clears: not that variant's photo, nothing better exists ──
      -- ECM: one four-colour group shot on its Custom Anodize page
      ('ecm-precision-standard-magwell-r11-blue-anodized',   'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/197/672/Photoroom_20260616_180007__76884.1783302214.JPG?c=1', null),
      ('ecm-precision-standard-magwell-r11-purple-anodized', 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/197/672/Photoroom_20260616_180007__76884.1783302214.JPG?c=1', null),
      ('ecm-precision-standard-magwell-r11-red-anodized',    'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/197/672/Photoroom_20260616_180007__76884.1783302214.JPG?c=1', null),
      -- ECM: one four-colour group shot on its anodized base pad page
      ('ecm-precision-carry-basepad-p365xmacro-blue-anodized',   'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/200/674/Photoroom_20260702_111947__72082.1783301640.JPG?c=1', null),
      ('ecm-precision-carry-basepad-p365xmacro-green-anodized',  'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/200/674/Photoroom_20260702_111947__72082.1783301640.JPG?c=1', null),
      ('ecm-precision-carry-basepad-p365xmacro-purple-anodized', 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/200/674/Photoroom_20260702_111947__72082.1783301640.JPG?c=1', null),
      ('ecm-precision-carry-basepad-p365xmacro-red-anodized',    'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/1280x1280/products/200/674/Photoroom_20260702_111947__72082.1783301640.JPG?c=1', null),
      -- ECM: the "Cerakote Colors" four-frame line-up, not a product photo
      ('ecm-precision-r11-fuse-fde-ns',      'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/960w/products/129/515/Cerakote_Colors__27927.1761708587.jpg?c=1', null),
      ('ecm-precision-r11-fuse-odg-ns',      'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/960w/products/129/515/Cerakote_Colors__27927.1761708587.jpg?c=1', null),
      ('ecm-precision-r11-fuse-comp-fde-ns', 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/960w/products/129/515/Cerakote_Colors__27927.1761708587.jpg?c=1', null),
      ('ecm-precision-r11-fuse-comp-odg-ns', 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/960w/products/129/515/Cerakote_Colors__27927.1761708587.jpg?c=1', null),
      -- ECM R11 Macro FDE: a file ECM names "Burnt Bronze" and maps to no option
      ('ecm-precision-r11-macro-fde-ns', 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/images/stencil/960w/products/118/422/R11_Macro_Grip_Module_-_Burnt_Bronze__65852.1752974738.jpg?c=1', null),
      -- Anarchy Outdoors: OpticsPlanet's five-plate composite; stays on Black (the default) only
      ('anarchy-outdoors-slide-plate-p365-blue',   'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg', null),
      ('anarchy-outdoors-slide-plate-p365-gold',   'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg', null),
      ('anarchy-outdoors-slide-plate-p365-purple', 'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg', null),
      ('anarchy-outdoors-slide-plate-p365-red',    'https://op1.0ps.us/640-640/opplanet-anarchy-outdoors-slide-plate-for-sig-365-image.jpg', null),
      -- True Precision slide cap: Sig Guy's grey plate + colour palette image, on two colours
      ('true-precision-slide-cap-p365-blue', 'https://www.sigguy.com/cdn/shop/files/BACCKPLATE.jpg?v=1768002039&width=713', null),
      ('true-precision-slide-cap-p365-fde',  'https://www.sigguy.com/cdn/shop/files/BACCKPLATE.jpg?v=1768002039&width=713', null),
      -- Tyrant slide cap: OpticsPlanet's five-colour composite; only gold and black have their own photo
      ('tyrant-cnc-slide-cap-p365-blue', 'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg', null),
      ('tyrant-cnc-slide-cap-p365-grey', 'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg', null),
      ('tyrant-cnc-slide-cap-p365-red',  'https://op1.0ps.us/640-640/opplanet-tyrant-designs-sig-sauer-p365-pistol-slide-cap-mcimage-spids-94567-94818-129215-94778-94814-vids.jpg', null),
      -- Tyrant takedown lever: Tyrant's one photo is the black lever; Black keeps it
      ('tyrant-cnc-takedown-lever-p365-gold', 'https://www.tyrantcnc.com/media/catalog/product/cache/396e9b786a9f10b2fddd4ef24bac9a10/p/3/p365-takedown-lever-2.jpg', null),
      -- True Precision flat trigger, Black DLC: TP's "Gold_12x" file is a gold trigger
      ('true-precision-flat-p365-black-pvd', 'https://cdn11.bigcommerce.com/s-c7qzuakk7l/products/2171/images/3781/True_precision-p36-drop-in--flat-triggerGold_12x__84802.1749133807.386.513.jpg?c=1', null),
      -- True Precision P365-FUSE, Black Nitride: showed the Black DLC SKU's OpticsPlanet photo
      ('true-precision-p365-fuse-black-n-rmsc', 'https://op1.0ps.us/640-640/opplanet-true-precision-true-precision-sig-p365-fuse-9mm-rms-cut-cover-plate-pistol-slide-tp-p365fss-bc-rms-main.jpg', null)
    ) as t (slug, from_url, to_url)
  loop
    update public.product_variants v
       set primary_image_url = r.to_url
     where v.slug = r.slug and v.retired_at is null
       and v.primary_image_url is not distinct from r.from_url;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'variant %: expected one live row whose photo is %, matched %', r.slug, coalesce(r.from_url, 'NULL'), n;
    end if;
    if r.to_url is null then n_cleared := n_cleared + 1; else n_set := n_set + 1; end if;

    -- variant_images mirrors primary_image_url where a row exists: the old
    -- photo's row goes, the new photo gets a row if it has none.
    delete from public.variant_images i
     using public.product_variants v
     where i.variant_id = v.id and v.slug = r.slug and i.url = r.from_url;
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

  if n_set <> 11 or n_cleared <> 24 then
    raise exception 'variant photos: expected 11 set and 24 cleared, got % and %', n_set, n_cleared;
  end if;

  -- No product may end with zero photos.
  perform 1
     from public.products p
    where not p.is_discontinued
      and exists (select 1 from public.product_variants v where v.product_id = p.id and v.retired_at is null)
      and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.retired_at is null and v.primary_image_url is not null)
      and p.slug in ('ecm-precision-standard-magwell-r11','ecm-precision-carry-basepad-p365xmacro','ecm-precision-r11-fuse',
                     'ecm-precision-r11-fuse-comp','ecm-precision-r11-macro','anarchy-outdoors-slide-plate-p365',
                     'true-precision-slide-cap-p365','tyrant-cnc-slide-cap-p365','tyrant-cnc-takedown-lever-p365',
                     'true-precision-flat-p365','true-precision-p365-fuse');
  if found then
    raise exception 'variant photos: a touched product would end with no photo at all';
  end if;

  raise notice 'variant photos: % set, % cleared, % variant_images rows removed, % added', n_set, n_cleared, n_img_deleted, n_img_added;
end $$;
