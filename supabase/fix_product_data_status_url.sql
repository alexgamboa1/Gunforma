-- fix_product_data_status_url.sql
-- NOT YET APPLIED. Dry-run 2026-10-03 against Gunforma-v2 inside one
-- rolled-back transaction; results in the PR.
--
-- A missing source URL is MISSING, not optional.
--
-- create_product() refuses a product without products.url: it is the page
-- the data came from, and without it nothing on the product can be checked
-- again. product_data_status() as applied in create_product.sql reported a
-- blank url under optional_blank, so a product with no source could still
-- read as approved, and the status disagreed with the rule the function that
-- creates products enforces. This moves it to missing[].
--
-- Only product_data_status() changes. create_product() never produces a
-- blank url, so its results are unaffected; the one live product affected is
-- streamlight-tlr-7-sub, which was already unapproved (no MSRP on one
-- variant) and now also reports url.
--
-- create or replace keeps the grants; they are restated so this file says
-- the whole of what is live.

create or replace function public.product_data_status(p_product_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $ds$
declare
  pr record; j jsonb; v_tbl regclass; r record; v_col text; v_val text;
  v_missing text[] := '{}'; v_opt text[] := '{}'; v_platforms text[];
begin
  select p.id, p.category, p.description, p.material, p.material_family::text as material_family,
         p.url, p.weight_oz, p.fitment_notes
    into pr from public.products p where p.id = p_product_id;
  if not found then return null; end if;

  if coalesce(btrim(pr.description), '') = ''     then v_missing := v_missing || 'description'::text; end if;
  if coalesce(btrim(pr.material), '') = ''        then v_missing := v_missing || 'material'::text; end if;
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
  if pr.weight_oz is null                       then v_opt := v_opt || 'weight_oz'::text; end if;
  if coalesce(btrim(pr.fitment_notes), '') = '' then v_opt := v_opt || 'fitment_notes'::text; end if;

  return jsonb_build_object('approved', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing),
                            'optional_blank', to_jsonb(v_opt), 'platforms', to_jsonb(v_platforms));
end;
$ds$;

revoke all on function public.product_data_status(uuid) from public, anon;
grant execute on function public.product_data_status(uuid) to authenticated, service_role;
