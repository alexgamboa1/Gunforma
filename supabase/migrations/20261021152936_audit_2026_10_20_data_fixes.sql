-- Data fixes from the 2026-10-20 catalog audit, approved by AG row by row
-- on 2026-10-21. No schema change. Every statement names the row it
-- expects and REFUSES when that row has drifted — a changed row, a
-- half-applied earlier run, or a re-run stops the whole file instead of
-- landing on the wrong row. Nothing here deletes.
--
-- Item 1 (Sig P365 Fuse/X-Macro OEM, housing_class xmacro) is deliberately
-- NOT here: Sig's own listing for SKU 8901773 calls it "Factory grip module
-- of the P365-FUSE" and lists XL/XMACRO-length slides as compatible, so the
-- class is right by housing_classes' own definition. The wrong "May not fit
-- P365 FUSE" badge is the catalog's class-equality rule, a separate PR.
--
-- Item 2 — brand "DMP Springs" is DPM Systems (dpmsystems.com, "DPM Systems
--   Technologies Ltd"; the Sig Guy listing our url points at says the same).
--   Brand name + website; the product "DMP Soft RSA" -> "Soft RSA" (a one-off
--   typo fix, the naming convention stays parked); and the one approved build
--   carrying the part gets its frozen snapshot corrected the way the review
--   queue would do it — the stored row is updated AND two correction entries
--   go into edit_history, so the builder sees "What Gunforma changed" and
--   trg_zz_notify_build_changes tells them once. Slugs are untouched: the
--   product URL keeps the typo on purpose (URLs do not move).
-- Item 3 — "P365 MANUAL SAFETY PARTS KIT - BLACK" (added 2026-10-14) is the
--   same Sig kit as "SIG SAUER P365X Manual Safety Controls Parts Kit": Sig
--   sells each colour on its own page, and every one of the newer product's
--   photos is the Sig image of a SKU the older product already holds. The
--   older product survives (SKUs, 9 live listings, verified fitment). The one
--   build on the newer product is re-pointed in place as a catalog merge —
--   same partId, no edit_history entry, no notification — and the newer
--   product is discontinued, never deleted; its path 301s to the survivor in
--   netlify.toml. Its four photos move onto the survivor's photo-less
--   variants, matched by the SKU in the image URL.
-- Item 4 — Herrington Arms titles its magwell "HA MAGWELL FOR P365 X MACRO";
--   "HA" is the brand's initials, so the stored "Herrington Arms HA Magwell …"
--   printed the brand twice. The name becomes the maker's title minus the
--   brand, and displayProductName() puts "Herrington Arms" in front once.
--
-- On a fresh database (supabase db reset, the check-migrations runner)
-- there is no catalog at all — seed.sql carries lookup tables only — so
-- there is nothing to fix and nothing to refuse: the file says so in a
-- NOTICE and does nothing, the same shape as 20261020161643. On any database
-- that HAS a catalog, every row below must be exactly as described or the
-- whole file stops.
--
-- Sitemap: this file changes the sitemap in exactly two ways — the
-- discontinued kit's URL leaves /sitemap-parts.xml, and lastmod moves on the
-- rows touched here (products_updated_at / builds_updated_at set updated_at
-- = now()): the DPM part, the Herrington magwell, the two builds, and the
-- profile lastmods those builds drive. Nothing else.

do $$
declare
  n          integer;
  v_idx      integer;
  v_ts       text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- item 2
  c_brand      constant uuid := 'ce580cd7-42fa-485c-b0b9-afc7f15c1a9d';  -- manufacturers dmp-springs
  c_dpm_part   constant uuid := '9e69b463-c58e-4f14-903c-0c58a60777fd';  -- products dmp-springs-soft-rsa-p365
  c_dpm_build  constant uuid := '2e980fc8-3a9f-42c9-af15-efcf99584536';  -- "P365 Complete Build", approved
  c_dpm_partid constant text := '93b20145fd33';
  -- item 3
  c_a          constant uuid := '6fac57ea-14d3-4ec5-9a06-393fc27a3894';  -- sig-sauer-manual-safety-parts-kit-black-p365 (goes)
  c_a_gold     constant uuid := 'deb00a02-dac5-47bc-9cfd-8448b50844f4';
  c_b          constant uuid := 'c0928335-4521-5a87-809d-e751750f12f3';  -- sig-sauer-manual-safety-kit-p365 (survives)
  c_b_gold     constant uuid := '03de626e-453c-52d5-97e9-d2a0a8b87adc';  -- SKU 8901339
  c_b_name     constant text := 'SIG SAUER P365X Manual Safety Controls Parts Kit';
  c_kit_build  constant uuid := '792a8808-2b82-44c0-aa31-dd1e65d6ef26';  -- "ECM R11 RIPPER", approved
  c_kit_partid constant text := '99ef7b1ce157';
  -- item 4
  c_ha         constant uuid := '90305239-5a83-5f86-aac0-9e3918f7385f';  -- herrington-arms-magwell-p365xmacro
begin
  -- fresh database: no catalog, nothing to do (see the header)
  if not exists (select 1 from public.products) then
    raise notice 'audit 2026-10-20 data fixes: products is empty (fresh database), nothing to fix';
    return;
  end if;

  -- ── item 2a: the brand row ──────────────────────────────────────────
  update public.manufacturers
     set name = 'DPM Systems', website_url = 'https://www.dpmsystems.com'
   where id = c_brand and slug = 'dmp-springs' and name = 'DMP Springs' and website_url is null;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'manufacturers %: expected the one row slug dmp-springs / name "DMP Springs" / no website, matched %', c_brand, n;
  end if;

  -- ── item 2b: the product name (slug unchanged) ──────────────────────
  update public.products set name = 'Soft RSA'
   where id = c_dpm_part and slug = 'dmp-springs-soft-rsa-p365' and brand_id = c_brand
     and name = 'DMP Soft RSA' and is_discontinued = false;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'products %: expected "DMP Soft RSA" on slug dmp-springs-soft-rsa-p365, matched %', c_dpm_part, n;
  end if;

  -- ── item 2c: the approved build's frozen snapshot, as a queue correction ──
  select e.ord - 1 into v_idx
    from public.builds b, jsonb_array_elements(b.parts_snapshot) with ordinality as e(part, ord)
   where b.id = c_dpm_build and b.status = 'approved'
     and e.part ->> 'partId' = c_dpm_partid
     and e.part ->> 'refId'  = c_dpm_part::text
     and e.part ->> 'brand'  = 'DMP Springs'
     and e.part ->> 'name'   = 'DMP Soft RSA';
  if v_idx is null then
    raise exception 'build %: no approved part % holding refId % as "DMP Springs" / "DMP Soft RSA"', c_dpm_build, c_dpm_partid, c_dpm_part;
  end if;
  update public.builds
     set parts_snapshot = jsonb_set(parts_snapshot, array[v_idx::text],
                                    (parts_snapshot -> v_idx) || jsonb_build_object('brand', 'DPM Systems', 'name', 'Soft RSA')),
         edit_history   = coalesce(edit_history, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object('part_id', c_dpm_partid, 'part_index', v_idx, 'field', 'brand',
                              'from_value', 'DMP Springs', 'to_value', 'DPM Systems',
                              'edited_by', 'alexg', 'edited_at', v_ts, 'status', 'active',
                              'reason', 'The maker is DPM Systems (dpmsystems.com); the catalog had the letters swapped.'),
           jsonb_build_object('part_id', c_dpm_partid, 'part_index', v_idx, 'field', 'name',
                              'from_value', 'DMP Soft RSA', 'to_value', 'Soft RSA',
                              'edited_by', 'alexg', 'edited_at', v_ts, 'status', 'active',
                              'reason', 'Catalog name corrected with the brand.'))
   where id = c_dpm_build and status = 'approved'
     and jsonb_array_length(coalesce(edit_history, '[]'::jsonb)) = 0;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'build %: expected one approved row with an empty edit_history, matched %', c_dpm_build, n;
  end if;

  -- ── item 3a: re-point the one build on the duplicate kit (catalog merge) ──
  v_idx := null;
  select e.ord - 1 into v_idx
    from public.builds b, jsonb_array_elements(b.parts_snapshot) with ordinality as e(part, ord)
   where b.id = c_kit_build and b.status = 'approved'
     and e.part ->> 'partId'    = c_kit_partid
     and e.part ->> 'refId'     = c_a::text
     and e.part ->> 'variantId' = c_a_gold::text
     and e.part ->> 'name'      = 'P365 MANUAL SAFETY PARTS KIT - BLACK';
  if v_idx is null then
    raise exception 'build %: no approved part % on the duplicate kit % / variant %', c_kit_build, c_kit_partid, c_a, c_a_gold;
  end if;
  -- the survivor's Gold variant must be what we say it is before anything points at it
  perform 1 from public.product_variants v
    where v.id = c_b_gold and v.product_id = c_b and v.sku = '8901339' and v.color = 'Gold' and v.retired_at is null;
  if not found then
    raise exception 'variant %: expected the live Gold SKU 8901339 of product %', c_b_gold, c_b;
  end if;
  update public.builds
     set parts_snapshot = jsonb_set(parts_snapshot, array[v_idx::text],
                                    (parts_snapshot -> v_idx) || jsonb_build_object('refId', c_b::text, 'variantId', c_b_gold::text, 'name', c_b_name))
   where id = c_kit_build and status = 'approved';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'build %: expected one approved row, matched %', c_kit_build, n;
  end if;

  -- ── item 3b: the duplicate leaves the catalog (never deleted) ────────
  update public.products set is_discontinued = true
   where id = c_a and slug = 'sig-sauer-manual-safety-parts-kit-black-p365'
     and name = 'P365 MANUAL SAFETY PARTS KIT - BLACK' and is_discontinued = false;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'products %: expected the live duplicate kit sig-sauer-manual-safety-parts-kit-black-p365, matched %', c_a, n;
  end if;

  -- ── item 3c: its photos move onto the survivor's photo-less variants ──
  -- Matched by the Sig SKU in the image URL, so a photo can only land on the
  -- variant of the colour it shows. The survivor's Gold already carries the
  -- same 8901339 image and is left alone.
  perform 1 from public.variant_images i join public.product_variants v on v.id = i.variant_id
    where v.product_id = c_b and v.sku in ('8901427', '8901335', '8901337', '8901336');
  if found then
    raise exception 'product %: a target variant already has a photo; not overwriting', c_b;
  end if;
  insert into public.variant_images (variant_id, url, position, alt_text)
  select bv.id, ai.url, 1, c_b_name || ' — ' || bv.variant_label
    from public.product_variants bv
    join public.product_variants av on av.product_id = c_a and av.retired_at is null
    join public.variant_images ai on ai.variant_id = av.id
   where bv.product_id = c_b and bv.retired_at is null
     and bv.sku in ('8901427', '8901335', '8901337', '8901336')
     and position(bv.sku in ai.url) > 0;
  get diagnostics n = row_count;
  if n <> 4 then
    raise exception 'product %: expected to copy exactly 4 photos (8901427, 8901335, 8901337, 8901336), copied %', c_b, n;
  end if;

  -- ── item 4: the Herrington magwell, the maker's title minus the brand ──
  update public.products set name = 'Magwell for P365 X Macro'
   where id = c_ha and slug = 'herrington-arms-magwell-p365xmacro'
     and name = 'Herrington Arms HA Magwell for P365 X Macro' and is_discontinued = false;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'products %: expected "Herrington Arms HA Magwell for P365 X Macro", matched %', c_ha, n;
  end if;

  raise notice 'audit 2026-10-20 data fixes applied: brand DPM Systems, Soft RSA (+ build % corrected), kit merged into % (build % re-pointed, duplicate discontinued, 4 photos copied), Herrington magwell renamed',
    c_dpm_build, c_b, c_kit_build;
end $$;
