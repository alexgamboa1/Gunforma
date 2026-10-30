-- Approve three P365 FUSE grip modules, and mark two FUSE Comp grips' fit
-- unconfirmed. Every value here is Alex's ruling of 2026-10-30; nothing else
-- on these products changes, and no other product's approval moves.
--
--   ECM Precision R11 Fuse            approved; fit_tier stays fuse
--   ECM Precision R11 Fuse Comp       approved; fit_tier NULL ("Fit not
--                                     confirmed"), fitment_confidence
--                                     unverified, no weight (with a note),
--                                     installation easy, and the R11 Fuse
--                                     photo it was borrowing is removed
--   ECM Precision R11 Edge Fuse Comp  fit_tier NULL, fitment_confidence
--                                     unverified (already approved)
--   Icarus Precision AXG FUSE         approved; Black/Gold (no safety) has
--                                     no confirmed price
--
-- WHY THE APPROVAL RULE CHANGES. is_approved is computed by
-- product_data_status(), which listed EVERY live variant without a photo or
-- an MSRP under `missing`. That alone held all three back: the ECM colours
-- other than Black and twenty-two of the AXG's twenty-four options have no
-- maker photo anywhere, and Alex's ruling is that those show a colour swatch
-- (js/variant-swatch.js) — "a swatch plus the label is a complete card".
-- Relaxing the rule for every product was measured first (2026-10-30): it
-- would also have approved seven other live parts blocked only on variant
-- photos (Armory Craft P365 comp, ECM carry basepad, ECM R11 Macro, ECM
-- standard magwell, two True Precision parts, Zaffiri threaded barrel). That
-- is not this ruling, so the relaxation is PER VARIANT and explicit:
--
--   product_variants.no_photo_ok  this variant has no maker photo; the
--                                 swatch is its picture
--   product_variants.no_msrp_ok   this variant's price is not confirmed;
--                                 it shows no price
--
-- Both default false, so every existing variant is judged exactly as before.
-- A waived gap is not hidden: product_data_status() reports it under
-- optional_blank, so the Needs-data page can still find it. Only this file
-- sets them; nothing in the add-a-part flow does.
--
-- The code that renders these products — swatches for every photo-less
-- variant, no borrowed price for a variant without an MSRP — merged and
-- deployed BEFORE this file is applied (house order: code first).
--
-- On a fresh database (supabase db reset, the check-migrations runner) the
-- catalog is empty: the schema change applies, and the data block says so in
-- a NOTICE and does nothing. On a database that has the catalog, every row
-- below must be exactly as described or the whole file stops.
--
-- Rollback: supabase/approve_fuse_grips_rollback.sql.

-- ── 1. The waivers ──────────────────────────────────────────────────────────

alter table public.product_variants
  add column no_photo_ok boolean not null default false,
  add column no_msrp_ok  boolean not null default false;

comment on column public.product_variants.no_photo_ok is
  'Ruled complete without a photo: no maker photo exists and the colour swatch stands in. product_data_status() reports the gap as optional, not missing.';
comment on column public.product_variants.no_msrp_ok is
  'Ruled complete without an MSRP: the price is not confirmed and the variant shows none. product_data_status() reports the gap as optional, not missing.';

-- ── 2. product_data_status(): a waived gap is optional, not missing ─────────
-- Identical to the live definition (read 2026-10-30) except the two variant
-- clauses, which now skip a waived variant under `missing` and list it under
-- `optional_blank` instead.

create or replace function public.product_data_status(p_product_id uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  pr record; j jsonb; v_tbl regclass; r record; v_col text; v_val text;
  v_missing text[] := '{}'; v_opt text[] := '{}'; v_platforms text[];
begin
  select p.id, p.category, p.description, p.material, p.material_family::text as material_family,
         p.url, p.weight_oz, p.fitment_notes
    into pr from public.products p where p.id = p_product_id;
  if not found then return null; end if;

  if coalesce(btrim(pr.description), '') = ''     then v_missing := v_missing || 'description'::text; end if;
  if coalesce(btrim(pr.material_family), '') = '' then v_missing := v_missing || 'material_family'::text; end if;
  -- the source page the data came from: create_product() requires it, so a
  -- product without one did not come through it and is not approved
  if coalesce(btrim(pr.url), '') = ''             then v_missing := v_missing || 'url'::text; end if;

  v_platforms := array(select pl.slug from public.product_platforms pp join public.platforms pl on pl.id = pp.platform_id
                        where pp.product_id = p_product_id order by pl.slug);
  if cardinality(v_platforms) = 0 then v_missing := v_missing || 'platform'::text; end if;

  v_tbl := to_regclass('public.' || quote_ident(pr.category::text || '_specs'));
  if v_tbl is not null then
    execute format('select to_jsonb(s) from %s s where s.product_id = $1', v_tbl) into j using p_product_id;
  end if;
  j := coalesce(j, '{}'::jsonb);   -- no spec row: every applicable required field is missing
  for r in select f.field, f.requirement, f.only_when_field, f.only_when_values
             from public.spec_field_rules f where f.category = pr.category order by f.sort_order loop
    if r.only_when_field is not null and not coalesce((j ->> r.only_when_field) = any (r.only_when_values), false) then
      continue;   -- not applicable
    end if;
    v_col := case r.field when 'platform' then 'platform_id' when 'footprint' then 'footprint_id' else r.field end;
    v_val := j ->> v_col;
    if coalesce(btrim(v_val), '') = '' then
      if r.requirement = 'required' then v_missing := v_missing || ('spec.' || r.field);
      else v_opt := v_opt || ('spec.' || r.field); end if;
    end if;
  end loop;

  if not exists (select 1 from public.product_variants pv where pv.product_id = p_product_id and pv.retired_at is null) then
    v_missing := v_missing || 'variant'::text;
  end if;
  -- a photo and an MSRP are required on every live variant unless that variant
  -- carries a waiver (no_photo_ok / no_msrp_ok); a waived gap is still listed,
  -- under optional_blank, so it stays findable
  v_missing := v_missing || array(select 'variant ' || pv.slug || ': photo' from public.product_variants pv
                                   where pv.product_id = p_product_id and pv.retired_at is null and pv.primary_image_url is null
                                     and not pv.no_photo_ok order by pv.slug);
  v_missing := v_missing || array(select 'variant ' || pv.slug || ': msrp' from public.product_variants pv
                                   where pv.product_id = p_product_id and pv.retired_at is null and pv.msrp is null
                                     and not pv.no_msrp_ok order by pv.slug);
  v_opt := v_opt || array(select 'variant ' || pv.slug || ': photo' from public.product_variants pv
                           where pv.product_id = p_product_id and pv.retired_at is null and pv.primary_image_url is null
                             and pv.no_photo_ok order by pv.slug);
  v_opt := v_opt || array(select 'variant ' || pv.slug || ': msrp' from public.product_variants pv
                           where pv.product_id = p_product_id and pv.retired_at is null and pv.msrp is null
                             and pv.no_msrp_ok order by pv.slug);

  if pr.category = 'light' and not exists (select 1 from public.light_compatibility lc where lc.light_product_id = p_product_id) then
    v_missing := v_missing || 'light compatibility'::text;
  end if;

  if not exists (select 1 from public.affiliate_links al join public.product_variants pv on pv.id = al.variant_id
                  where pv.product_id = p_product_id and pv.retired_at is null and al.retired_at is null) then
    v_opt := v_opt || 'retailer link'::text;
  end if;
  -- material (the exact wording) is optional; material_family stays required
  -- above, and 'Unspecified' answers it — reported here so those parts can be
  -- found later
  if coalesce(btrim(pr.material), '') = ''      then v_opt := v_opt || 'material'::text; end if;
  if pr.material_family = 'Unspecified'         then v_opt := v_opt || 'material family unspecified'::text; end if;
  if pr.weight_oz is null                       then v_opt := v_opt || 'weight_oz'::text; end if;
  if coalesce(btrim(pr.fitment_notes), '') = '' then v_opt := v_opt || 'fitment_notes'::text; end if;

  return jsonb_build_object('approved', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing),
                            'optional_blank', to_jsonb(v_opt), 'platforms', to_jsonb(v_platforms));
end;
$function$;

-- ── 3. The rulings ──────────────────────────────────────────────────────────

do $$
declare
  n integer;
  c_fuse      constant text := 'ecm-precision-r11-fuse';
  c_comp      constant text := 'ecm-precision-r11-fuse-comp';
  c_edge_comp constant text := 'ecm-precision-r11-edge-fuse-comp';
  c_axg       constant text := 'icarus-precision-axg-fuse';
  -- the R11 Fuse's own photo, which the Fuse Comp's Black variant was borrowing
  c_borrowed  constant text := 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/products/129/images/537/Fuse_Updated__56900.1761708587.386.513.JPG?c=1';
  c_comp_note constant text := 'P365 FUSE or P365 Fuse extended slide with comp';
  r record;
begin
  if not exists (select 1 from public.products) then
    raise notice 'approve_fuse_grips: empty catalog (fresh database) — schema only, no rulings';
    return;
  end if;

  -- ── what must already be true (confirmed by Alex; asserted, not written) ──
  perform 1 from public.products p join public.frame_specs fs on fs.product_id = p.id
   where p.slug = c_fuse and p.weight_oz = 7.95 and fs.fit_tier = 'fuse' and not p.is_discontinued;
  if not found then raise exception 'approve_fuse_grips: % is not the live 7.95 oz fuse-tier grip described', c_fuse; end if;

  select count(*) into n from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = c_fuse and v.retired_at is null
     and ((v.slug = c_fuse || '-black-ns' and v.msrp = 499 and v.primary_image_url is not null and v.is_default)
       or (v.slug in (c_fuse || '-mb-ns', c_fuse || '-odg-ns', c_fuse || '-fde-ns') and v.msrp = 559 and v.primary_image_url is null));
  if n <> 4 then raise exception 'approve_fuse_grips: % variants are not Black $499 (photo) + MB/ODG/FDE $559 (no photo); matched %', c_fuse, n; end if;

  select count(*) into n from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = c_comp and v.retired_at is null
     and ((v.slug = c_comp || '-black-ns' and v.msrp = 549 and v.primary_image_url = c_borrowed and v.is_default)
       or (v.slug in (c_comp || '-mb-ns', c_comp || '-odg-ns', c_comp || '-fde-ns') and v.msrp = 609 and v.primary_image_url is null));
  if n <> 4 then raise exception 'approve_fuse_grips: % variants are not Black $549 (borrowed photo) + MB/ODG/FDE $609; matched %', c_comp, n; end if;

  -- ── ECM R11 Fuse: its three photo-less colours show a swatch ──────────────
  update public.product_variants v set no_photo_ok = true
    from public.products p
   where p.id = v.product_id and p.slug = c_fuse and v.retired_at is null
     and v.primary_image_url is null and not v.no_photo_ok;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'approve_fuse_grips: expected 3 photo-less % variants, matched %', c_fuse, n; end if;

  -- ── ECM R11 Fuse Comp ─────────────────────────────────────────────────────
  update public.frame_specs fs set fit_tier = null
    from public.products p
   where p.id = fs.product_id and p.slug = c_comp and fs.fit_tier = 'fuse';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: expected % on fit_tier fuse, matched %', c_comp, n; end if;

  update public.products
     set fitment_confidence      = 'unverified',
         weight_oz               = null,
         installation_difficulty = 'easy',
         fitment_notes           = c_comp_note || '. ECM doesn''t publish a separate weight; same family as the R11 Fuse (7.95 oz).'
   where slug = c_comp and fitment_confidence = 'verified' and weight_oz = 7.95
     and installation_difficulty is null and fitment_notes = c_comp_note;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: % is not verified / 7.95 oz / no install difficulty / the expected note; matched %', c_comp, n; end if;

  -- The borrowed photo goes: the gallery row (variant_images is derived and
  -- cascades; the rollback restores it by id) and the primary.
  delete from public.variant_images vi
   using public.product_variants v
   where v.id = vi.variant_id and v.slug = c_comp || '-black-ns' and vi.url = c_borrowed;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: expected the one borrowed gallery photo on %-black-ns, matched %', c_comp, n; end if;

  update public.product_variants set primary_image_url = null
   where slug = c_comp || '-black-ns' and primary_image_url = c_borrowed;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: expected the borrowed primary photo on %-black-ns, matched %', c_comp, n; end if;

  update public.product_variants v set no_photo_ok = true
    from public.products p
   where p.id = v.product_id and p.slug = c_comp and v.retired_at is null
     and v.primary_image_url is null and not v.no_photo_ok;
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'approve_fuse_grips: expected all 4 % variants photo-less, matched %', c_comp, n; end if;

  -- ── ECM R11 Edge Fuse Comp: fit unconfirmed, nothing else ─────────────────
  update public.frame_specs fs set fit_tier = null
    from public.products p
   where p.id = fs.product_id and p.slug = c_edge_comp and fs.fit_tier = 'fuse';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: expected % on fit_tier fuse, matched %', c_edge_comp, n; end if;

  update public.products set fitment_confidence = 'unverified'
   where slug = c_edge_comp and fitment_confidence = 'verified';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: expected % verified, matched %', c_edge_comp, n; end if;

  -- ── Icarus AXG FUSE ───────────────────────────────────────────────────────
  -- The two Black/Hogue variants keep their photo; every other option shows
  -- a swatch (the frame colour — js/variant-swatch.js, FRAME_COLOUR_BRANDS).
  select count(*) into n from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = c_axg and v.retired_at is null and v.primary_image_url is not null
     and v.slug in (c_axg || '-black-hogue-anodized', c_axg || '-black-hogue-anodized-ms');
  if n <> 2 then raise exception 'approve_fuse_grips: expected the two Black/Hogue % variants with a photo, matched %', c_axg, n; end if;

  update public.product_variants v set no_photo_ok = true
    from public.products p
   where p.id = v.product_id and p.slug = c_axg and v.retired_at is null
     and v.primary_image_url is null and not v.no_photo_ok;
  get diagnostics n = row_count;
  if n <> 22 then raise exception 'approve_fuse_grips: expected 22 photo-less % variants, matched %', c_axg, n; end if;

  -- Black / Gold, no manual safety: the price is unconfirmed — no MSRP, and
  -- the note that said so goes (the FCU fact stays, as on its siblings).
  update public.product_variants
     set msrp = null, no_msrp_ok = true, notes = 'Non-Safety FCU'
   where slug = c_axg || '-black-gold-anodized' and msrp = 549.99
     and notes = 'Non-Safety FCU. Brass panel price adder not confirmed.'
     and not manual_safety_variant and handedness is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'approve_fuse_grips: expected % Black/Gold (no safety) at $549.99 with its note, matched %', c_axg, n; end if;

  -- ── the outcome, read back ────────────────────────────────────────────────
  for r in select p.slug, public.product_data_status(p.id) as st from public.products p
            where p.slug in (c_fuse, c_comp, c_edge_comp, c_axg) loop
    if not coalesce((r.st ->> 'approved')::boolean, false) then
      raise exception 'approve_fuse_grips: % is still not approved: %', r.slug, r.st -> 'missing';
    end if;
  end loop;
end $$;
