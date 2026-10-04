-- material_optional.sql
-- APPLIED 2026-10-04, after #133 was merged and live. See the record at the
-- bottom of this file. Dry-run first the same day; results in #133.
--
-- The material rule, as ruled:
--   * material_family stays REQUIRED for approval. 'Unspecified' (a row in
--     public.materials) is a valid answer. When it is the answer,
--     optional_blank carries "material family unspecified" so those parts can
--     be found later. It does not block approval.
--   * material, the exact wording, becomes OPTIONAL: a blank one moves from
--     missing[] to optional_blank[].
--
-- Only product_data_status() changes. create_product() still fills
-- optic_specs.housing_material and mag_release_specs.material from the
-- product's material when one is given, and leaves them alone when it is
-- blank, exactly as before.
--
-- ONE CONSEQUENCE, deliberately left as it is: the optic rule row
-- housing_material is 'required' in spec_field_rules. An optic with no
-- material therefore still reads missing "spec.housing_material" — blank
-- material stops blocking approval for every category except optics. Making
-- that row optional would be a one-row change to spec_field_rules; it is not
-- made here.
--
-- Restated from fix_product_data_status_url.sql (applied), with only the two
-- material lines changed; diff the two to see it.

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
$ds$;

revoke all on function public.product_data_status(uuid) from public, anon;
grant execute on function public.product_data_status(uuid) to authenticated, service_role;

-- ============================================================
-- APPLIED 2026-10-04 as migration material_optional (20261004032852) to
-- project lagjjcpclvzrjlrswojt, from this file as merged in #133. Verified
-- live after the change:
--
--   md5(pg_proc.prosrc) 56c7ad2360970334584d7e0179c7d6b3, identical to the
--     body between this file's $ds$ quotes
--   search_path = '', stable, not SECURITY DEFINER; EXECUTE for
--     authenticated and service_role only
--   approved: 232 of 243 before, 233 of 243 after. The one that moved is
--     springer-precision-3-mag-extension-p365xmacro (family Unspecified,
--     material wording blank): now approved, optional_blank carries
--     "material" and "material family unspecified". The 10 unapproved
--     products are the same 10 as before.
-- ============================================================
