-- Rollback for supabase/migrations/20261030041802_approve_fuse_grips.sql.
-- Run by hand only if these rulings have to come back out. It restores every
-- value that file changed, to what it read on 2026-10-30, then the previous
-- product_data_status() and drops the two waiver columns — which un-approves
-- the R11 Fuse, the R11 Fuse Comp and the AXG FUSE again.
--
-- The deployed code needs nothing first: it never reads the waiver columns,
-- and its swatch / no-borrowed-price fixes are right in either state.

begin;

-- ── the rulings, reversed ───────────────────────────────────────────────────
update public.product_variants
   set msrp = 549.99, notes = 'Non-Safety FCU. Brass panel price adder not confirmed.'
 where slug = 'icarus-precision-axg-fuse-black-gold-anodized' and msrp is null;

update public.products set fitment_confidence = 'verified'
 where slug = 'ecm-precision-r11-edge-fuse-comp';
update public.frame_specs fs set fit_tier = 'fuse'
  from public.products p
 where p.id = fs.product_id and p.slug = 'ecm-precision-r11-edge-fuse-comp' and fs.fit_tier is null;

update public.product_variants
   set primary_image_url = 'https://cdn11.bigcommerce.com/s-ngyasv1rfx/products/129/images/537/Fuse_Updated__56900.1761708587.386.513.JPG?c=1'
 where slug = 'ecm-precision-r11-fuse-comp-black-ns' and primary_image_url is null;
insert into public.variant_images (id, variant_id, url, alt_text, position)
select '1d7ef7be-2c2b-4a77-a47e-a053907e9812', v.id,
       'https://cdn11.bigcommerce.com/s-ngyasv1rfx/products/129/images/537/Fuse_Updated__56900.1761708587.386.513.JPG?c=1',
       null, 1
  from public.product_variants v
 where v.slug = 'ecm-precision-r11-fuse-comp-black-ns'
on conflict (id) do nothing;

update public.products
   set fitment_confidence = 'verified', weight_oz = 7.95, installation_difficulty = null,
       fitment_notes = 'P365 FUSE or P365 Fuse extended slide with comp'
 where slug = 'ecm-precision-r11-fuse-comp';
update public.frame_specs fs set fit_tier = 'fuse'
  from public.products p
 where p.id = fs.product_id and p.slug = 'ecm-precision-r11-fuse-comp' and fs.fit_tier is null;

-- ── product_data_status(), as it was before the waivers ─────────────────────
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
  v_missing := v_missing || array(select 'variant ' || pv.slug || ': photo' from public.product_variants pv
                                   where pv.product_id = p_product_id and pv.retired_at is null and pv.primary_image_url is null order by pv.slug);
  v_missing := v_missing || array(select 'variant ' || pv.slug || ': msrp' from public.product_variants pv
                                   where pv.product_id = p_product_id and pv.retired_at is null and pv.msrp is null order by pv.slug);

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

alter table public.product_variants
  drop column if exists no_photo_ok,
  drop column if exists no_msrp_ok;

commit;
