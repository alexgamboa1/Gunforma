-- create_product.sql
-- APPLIED 2026-10-03. See the record at the bottom of this file.
-- Dry-run first the same day inside one transaction that was rolled back (a
-- DO block ending in RAISE EXCEPTION); the results are in #131.
-- spec_field_rules.sql was applied FIRST: every function here reads it.
--
-- product_data_status() below is SUPERSEDED by
-- fix_product_data_status_url.sql, which moves a blank url from
-- optional_blank to missing. Read that file for the live definition.
--
-- WHY. There was no way to add ONE product. Every product arrived in a bulk
-- load, create_variant() only adds to a product that already exists, and the
-- catalog tables carry SELECT policies only, so a signed-in admin cannot
-- write them from the site.
--
-- WHAT. One atomic call that writes everything an admin enters for a part:
--   p_product   brand (find-or-create), name, category, platforms[], slug, url,
--               description, family, material, material_family, fitment_notes,
--               build_warning, build_notes, weight_oz, fitment_confidence,
--               internal_notes
--   p_variants  one object per variant: colour/finish/sku/upc/msrp/label/notes,
--               every option column, image_url + gallery[], and links[]
--               (zero or more retailers; partner_slug + url on the variant
--               itself is shorthand for one)
--   p_specs     the category's <category>_specs row. Accepted keys are exactly
--               the category's spec_field_rules fields; `platform` and
--               `footprint` take slugs.
--   p_fits      light: light_compatibility[] · optic: adapter_footprints[] ·
--               barrel: slides[] · slide: barrels[] · magwell: frames[] ·
--               frame: magwells[]
--   p_build_id + p_part_index  swap a build's pending custom part for this
--               product (the variant flagged use_in_build, else the default)
--   p_dry_run   do everything, then raise P0DRY with the result in DETAIL so
--               nothing is written. The form's "Check" button uses it, and it
--               is the only safe way to try a part against production:
--               affiliate_links and price_history are ON DELETE RESTRICT, so a
--               real test product that got a link can never be deleted.
--
-- SAVING needs only: brand, name, category, at least one platform, the source
-- URL (the product page the data came from — a reference, rendered nowhere),
-- one variant, and a photo and MSRP on the default variant. Retailer links
-- are optional. A part can be saved unapproved; it cannot be saved silently
-- unapproved — the result always carries product_data_status().
--
-- APPROVED (product_data_status): description, material and material_family;
-- every required spec_field_rules field for the category (only-when fields
-- where their condition holds); a photo and an MSRP on every live variant;
-- at least one platform; and for a light, at least one light_compatibility
-- row. A retailer link is reported but never blocks approval.
-- fitment_confidence other than 'unverified' is refused unless approved.
--
-- PLATFORM IS EXPLICIT. Nothing defaults to P365. A slide or barrel belongs to
-- exactly one platform, and its spec row's platform is that one. A not-yet-
-- live platform is accepted (parts go in ahead of launch) with a warning.
--
-- NEVER ENTERED: the sync's columns (street_price, in_stock, last_checked,
-- op_last_matched_by), trigger-owned slide_class / barrel_class, any spec
-- column with no spec_field_rules row (including the ten no product has ever
-- filled), and products.pros / cons / editor_rating / installation_difficulty
-- / best_for. Existing values in those columns are untouched.
--
-- TRACKED LINKS ARE BUILT, NOT TYPED, for partners with an awin_merchant_id.
-- A supplied Awin link whose merchant id disagrees with the partner is
-- refused: 17 of 25 live Olight links carry OpticsPlanet's id.
--
-- WARNINGS, not errors: a new slide that is not added to the barrels that
-- carry a slide whitelist, and a new frame not added to the whitelisted
-- magwells, will show as NOT fitting them. The result names them.
--
-- The spec vocabulary and the variant vocabulary are different on purpose
-- (optic_specs.reticle "2 MOA Dot & 32 MOA Circle (MRS)" vs variant "MRS";
-- light_specs.battery_type vs variant "Rechargeable"), so nothing is copied
-- between them. Material IS one fact: products.material fills
-- optic_specs.housing_material / mag_release_specs.material, and the reverse
-- when only the spec side is given. A disagreement is refused.
--
-- Never use current_user in the guard: SECURITY DEFINER rewrites it to the
-- owner. See create_variant_backend_callable.sql.

create or replace function public.url_encode(p text) returns text
language sql immutable strict set search_path = '' as $ue$
  select coalesce(string_agg(
    case when ch ~ '^[A-Za-z0-9_.~-]$' then ch
         else upper(regexp_replace(encode(convert_to(ch, 'UTF8'), 'hex'), '(..)', '%\1', 'g')) end,
    '' order by ord), '')
  from regexp_split_to_table(p, '') with ordinality as t(ch, ord);
$ue$;

-- A form sends "" (or null, or []) for an untouched field. Treat it as absent.
create or replace function public.jsonb_strip_blank(j jsonb) returns jsonb
language sql immutable set search_path = '' as $sb$
  select coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(j) e
                    where e.value not in ('""'::jsonb, 'null'::jsonb, '[]'::jsonb)), '{}'::jsonb);
$sb$;

-- ── how complete a product is ───────────────────────────────────────────────
-- SUPERSEDED: see fix_product_data_status_url.sql (url is now missing[]).
-- { approved, missing[], optional_blank[], platforms[] }. Reads only catalog
-- data, as the caller. A field whose only-when condition is false is not
-- applicable and appears in neither list. Spec fields are reported as
-- "spec.<field>"; the form maps them to spec_field_rules.label.
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
  if coalesce(btrim(pr.url), '') = ''           then v_opt := v_opt || 'url'::text; end if;
  if pr.weight_oz is null                       then v_opt := v_opt || 'weight_oz'::text; end if;
  if coalesce(btrim(pr.fitment_notes), '') = '' then v_opt := v_opt || 'fitment_notes'::text; end if;

  return jsonb_build_object('approved', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing),
                            'optional_blank', to_jsonb(v_opt), 'platforms', to_jsonb(v_platforms));
end;
$ds$;

revoke all on function public.product_data_status(uuid) from public, anon;
grant execute on function public.product_data_status(uuid) to authenticated, service_role;

create or replace function public.create_product(
  p_product jsonb, p_variants jsonb, p_specs jsonb default null, p_fits jsonb default null,
  p_build_id uuid default null, p_part_index integer default null, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  c_awin_affid   constant text   := '2959345';   -- Gunforma's Awin publisher id; public, it is in every live link
  c_product_keys constant text[] := array['brand','name','category','platforms','slug','url','description','family','material','material_family','fitment_notes','build_warning','build_notes','weight_oz','fitment_confidence','internal_notes'];
  c_variant_keys constant text[] := array['color','finish','sku','upc','msrp','image_url','gallery','variant_label','optic_cut','handedness','notes','is_default','manual_safety_variant','reticle','reticle_color','battery_type','mount_system','bundle','clamp_style','clamp_rail_type','clamp','partner_slug','url','affiliate_url','links','use_in_build'];
  c_link_keys    constant text[] := array['partner_slug','url','affiliate_url','op_mpn','op_gtin','op_merchant_product_id','notes'];
  p jsonb; s jsonb; f jsonb; v jsonb; l jsonb; r jsonb; v_result jsonb; v_status jsonb;
  v_category public.product_category; v_want public.product_category; v_platforms text[];
  v_platform_id uuid; v_platform_name text; v_kind text; v_len numeric; v_lengths text;
  v_brand_id uuid; v_brand_name text; v_brand_created boolean := false;
  v_product_id uuid; v_slug text; v_name text; v_confidence public.fitment_confidence;
  v_i int := 0; v_bad text; v_n int; v_key text;
  v_variant_id uuid; v_build_variant uuid; v_links jsonb; v_partner_id uuid; v_other_id uuid;
  v_mid text; v_aff text; v_aff_mid text;
  v_axes text; v_vslug text; v_vbase text; v_part jsonb;
  v_tbl regclass; v_rule_fields text[]; v_collist text; v_has_specs boolean := false;
  v_warn text[] := '{}';
begin
  if not (public.is_admin() or public.is_trusted_backend()) then
    raise exception 'create_product: admin or service_role only' using errcode = '42501';
  end if;
  if p_product is null or jsonb_typeof(p_product) <> 'object' then
    raise exception 'create_product: p_product must be an object';
  end if;
  p := public.jsonb_strip_blank(p_product);
  if p ? 'installation_difficulty' or p ? 'best_for' then
    raise exception 'create_product: installation_difficulty and best_for are no longer entered. Existing values stay where they are; leave these out.';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p) k where k <> all (c_product_keys);
  if v_bad is not null then raise exception 'create_product: unknown product field(s): %', v_bad; end if;
  v_name := btrim(coalesce(p->>'name', ''));
  if btrim(coalesce(p->>'brand', '')) = '' or v_name = '' then
    raise exception 'create_product: brand and name are required';
  end if;
  if p->>'category' is null then raise exception 'create_product: category is required'; end if;
  v_category := (p->>'category')::public.product_category;
  v_confidence := coalesce((p->>'fitment_confidence')::public.fitment_confidence, 'unverified');

  -- ── platform: explicit, never defaulted ───────────────────────────────────
  if jsonb_typeof(p->'platforms') is distinct from 'array' or jsonb_array_length(p->'platforms') = 0 then
    raise exception 'create_product: send at least one platform (e.g. "platforms": ["p365"]). Nothing defaults: without one the part never appears in the builder.';
  end if;
  v_platforms := array(select distinct x from jsonb_array_elements_text(p->'platforms') x order by x);
  select string_agg(x, ', ') into v_bad from unnest(v_platforms) x where not exists (select 1 from public.platforms pl where pl.slug = x);
  if v_bad is not null then
    raise exception 'create_product: unknown platform(s): %. Known: %', v_bad,
      (select string_agg(slug, ', ' order by slug) from public.platforms) using errcode = 'foreign_key_violation';
  end if;
  if v_category in ('slide', 'barrel') and cardinality(v_platforms) <> 1 then
    raise exception 'create_product: a % belongs to exactly one platform; this one names %: %. Send one.',
      v_category, cardinality(v_platforms), array_to_string(v_platforms, ', ');
  end if;
  select string_agg(pl.name, ', ' order by pl.name) into v_bad from public.platforms pl
   where pl.slug = any (v_platforms) and not pl.is_live;
  if v_bad is not null then
    v_warn := v_warn || ('Not live yet: ' || v_bad || '. The part is saved and appears when the platform launches.');
  end if;

  if p->>'url' is null then
    raise exception 'create_product: the source URL (the product page the data came from) is required';
  end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'create_product: at least one variant is required';
  end if;
  if (p_build_id is null) <> (p_part_index is null) or p_part_index < 0 then
    raise exception 'create_product: p_build_id and p_part_index must be supplied together';
  end if;

  select m.id, m.name into v_brand_id, v_brand_name from public.manufacturers m
   where lower(m.name) = lower(btrim(p->>'brand')) or m.slug = public.slugify(p->>'brand')
   order by m.created_at limit 1;
  if v_brand_id is null then
    insert into public.manufacturers (slug, name) values (public.slugify(p->>'brand'), btrim(p->>'brand'))
    returning id, name into v_brand_id, v_brand_name;
    v_brand_created := true;
  end if;

  -- The slug is the product's URL for good. Brand is prefixed unless the name
  -- already starts with it. Pass "slug" to choose it by hand.
  v_slug := coalesce(nullif(btrim(p->>'slug'), ''),
    public.slugify(case when left(lower(v_name), length(v_brand_name)) = lower(v_brand_name)
                        then v_name else v_brand_name || ' ' || v_name end));
  if exists (select 1 from public.products where slug = v_slug) then
    raise exception 'create_product: a product with slug "%" already exists. To add a colour or option to it, use create_variant.', v_slug using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.products where brand_id = v_brand_id and lower(name) = lower(v_name)) then
    raise exception 'create_product: % already has a product named "%". To add a colour or option to it, use create_variant.', v_brand_name, v_name using errcode = 'unique_violation';
  end if;

  insert into public.products (slug, category, brand_id, name, family, url, description, material, material_family,
                               fitment_notes, build_warning, build_notes, weight_oz, fitment_confidence)
  values (v_slug, v_category, v_brand_id, v_name, p->>'family', p->>'url', p->>'description', p->>'material', p->>'material_family',
          p->>'fitment_notes', p->>'build_warning', p->>'build_notes', (p->>'weight_oz')::numeric, 'unverified')
  returning id into v_product_id;
  -- fitment_confidence is set at the end, once the part is known to be approved

  if p ? 'internal_notes' then
    insert into public.product_internal (product_id, internal_notes) values (v_product_id, p->>'internal_notes');
  end if;

  insert into public.product_platforms (product_id, platform_id)
  select v_product_id, pl.id from public.platforms pl where pl.slug = any (v_platforms);

  -- ── spec sheet ────────────────────────────────────────────────────────────
  -- Accepted keys are the category's spec_field_rules fields and nothing else.
  -- Only supplied keys are named in the INSERT, so column defaults survive.
  s := public.jsonb_strip_blank(p_specs);
  v_tbl := to_regclass('public.' || quote_ident(v_category::text || '_specs'));
  v_rule_fields := array(select fr.field from public.spec_field_rules fr where fr.category = v_category order by fr.sort_order);
  if s <> '{}'::jsonb then
    if v_tbl is null then raise exception 'create_product: a % has no spec sheet; leave p_specs out', v_category; end if;
    select string_agg(k, ', ') into v_bad from jsonb_object_keys(s) k where k <> all (v_rule_fields);
    if v_bad is not null then
      raise exception 'create_product: spec sheet: no rule for field(s): %. Fields for a %: %', v_bad, v_category, array_to_string(v_rule_fields, ', ');
    end if;

    -- platform: the product's one platform. A disagreeing key is refused.
    if 'platform' = any (v_rule_fields) then
      if s ? 'platform' and s->>'platform' <> v_platforms[1] then
        raise exception 'create_product: spec sheet platform "%" disagrees with the product''s platform "%"', s->>'platform', v_platforms[1];
      end if;
      select pl.id, pl.name into v_platform_id, v_platform_name from public.platforms pl where pl.slug = v_platforms[1];
      s := (s - 'platform') || jsonb_build_object('platform_id', v_platform_id);
    end if;
    if s ? 'footprint' then
      select fp.id into v_other_id from public.footprints fp where fp.slug = s->>'footprint';
      if v_other_id is null then
        raise exception 'create_product: spec sheet: no footprint "%". Known: %', s->>'footprint',
          (select string_agg(slug, ', ' order by slug) from public.footprints);
      end if;
      s := (s - 'footprint') || jsonb_build_object('footprint_id', v_other_id);
    end if;

    -- material is one fact held in two places
    foreach v_key in array array['housing_material', 'material'] loop
      if v_key = any (v_rule_fields) then
        if s ? v_key and p ? 'material' and lower(btrim(s->>v_key)) <> lower(btrim(p->>'material')) then
          raise exception 'create_product: material is one fact: the product says "%" but the spec sheet''s % says "%"', p->>'material', v_key, s->>v_key;
        elsif not s ? v_key and p ? 'material' then
          s := s || jsonb_build_object(v_key, p->>'material');
        elsif s ? v_key and not p ? 'material' then
          update public.products set material = s->>v_key where id = v_product_id;
        end if;
      end if;
    end loop;

    -- only-when fields whose condition holds must come with the sheet
    select string_agg(fr.field, ', ' order by fr.sort_order) into v_bad from public.spec_field_rules fr
     where fr.category = v_category and fr.requirement = 'required' and fr.only_when_field is not null
       and (s ->> fr.only_when_field) = any (fr.only_when_values)
       and coalesce(btrim(s ->> fr.field), '') = '';
    if v_bad is not null then
      raise exception 'create_product: the % spec sheet needs % (it applies here because of %)', v_category, v_bad,
        (select string_agg(distinct fr.only_when_field || ' = ' || (s ->> fr.only_when_field), ', ') from public.spec_field_rules fr
          where fr.category = v_category and fr.only_when_field is not null and fr.field = any (string_to_array(v_bad, ', ')));
    end if;

    -- slide / barrel length must be registered for that platform. Checked
    -- here so an admin reads a sentence, not the class trigger's raw text.
    if v_category in ('slide', 'barrel') then
      v_kind := v_category::text;
      v_len  := (s ->> (v_kind || '_length_in'))::numeric;
      if v_len is not null then
        if not exists (select 1 from public.platform_part_lengths ppl where ppl.platform_id = v_platform_id and ppl.part_kind = v_kind) then
          raise exception 'create_product: % % lengths are not registered yet. Add them to platform_part_lengths before adding a % for it.',
            v_platform_name, v_kind, v_kind;
        end if;
        if not exists (select 1 from public.platform_part_lengths ppl
                        where ppl.platform_id = v_platform_id and ppl.part_kind = v_kind and ppl.length_in = v_len) then
          select string_agg(ppl.length_in::text, ', ' order by ppl.length_in) into v_lengths from public.platform_part_lengths ppl
           where ppl.platform_id = v_platform_id and ppl.part_kind = v_kind;
          raise exception 'create_product: no % % is registered at % in. Registered % lengths: %.', v_platform_name, v_kind, v_len, v_kind, v_lengths;
        end if;
      end if;
    end if;

    -- columns the table itself declares NOT NULL without a default
    select string_agg(a.attname::text, ', ') into v_bad from pg_catalog.pg_attribute a
     where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef
       and a.attname::text not in ('product_id', 'category') and not s ? (a.attname::text);
    if v_bad is not null then
      raise exception 'create_product: the % spec sheet needs: %', v_category, replace(replace(v_bad, 'footprint_id', 'footprint'), 'platform_id', 'platform');
    end if;

    s := s || jsonb_build_object('product_id', v_product_id, 'category', v_category);
    select string_agg(quote_ident(k), ', ') into v_collist from jsonb_object_keys(s) k;
    execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1)', v_tbl, v_collist, v_collist, v_tbl) using s;
    v_has_specs := true;
  end if;

  -- ── variants ──────────────────────────────────────────────────────────────
  for v in select value from jsonb_array_elements(p_variants) loop
    v_i := v_i + 1;
    if jsonb_typeof(v) <> 'object' then raise exception 'create_product: variant % is not an object', v_i; end if;
    v := public.jsonb_strip_blank(v);
    select string_agg(k, ', ') into v_bad from jsonb_object_keys(v) k where k <> all (c_variant_keys);
    if v_bad is not null then
      raise exception 'create_product: variant %: unknown field(s): %', v_i, v_bad;
    end if;

    -- colour vocabulary, slug, default flag and the position-1 image row are
    -- create_variant's rules; they are not restated here.
    v_variant_id := public.create_variant(
      p_product_slug => v_slug, p_color => v->>'color', p_finish => v->>'finish', p_sku => v->>'sku', p_upc => v->>'upc',
      p_msrp => (v->>'msrp')::numeric, p_image_url => v->>'image_url', p_variant_label => v->>'variant_label',
      p_optic_cut => v->>'optic_cut', p_handedness => v->>'handedness', p_notes => v->>'notes',
      p_make_default => case when (v->>'is_default')::boolean then true end);

    -- the options create_variant does not carry; when present they also go into the slug
    v_axes := concat_ws('-', nullif(v->>'optic_cut','none'), v->>'reticle_color', v->>'reticle', v->>'clamp', v->>'bundle',
                        case when (v->>'manual_safety_variant')::boolean then 'ms' end,
                        case when v->>'handedness' in ('left','right') then v->>'handedness' end);
    v_vslug := null;
    if v_axes <> '' then
      v_vbase := public.slugify(v_slug || '-' || v_axes || '-' || (v->>'color') || coalesce('-' || (v->>'finish'), ''));
      v_vslug := v_vbase; v_n := 1;
      while exists (select 1 from public.product_variants where slug = v_vslug and id <> v_variant_id) loop
        v_n := v_n + 1; v_vslug := v_vbase || '-' || v_n;
      end loop;
    end if;
    update public.product_variants set
      slug = coalesce(v_vslug, slug),
      manual_safety_variant = (v->>'manual_safety_variant')::boolean,
      reticle = v->>'reticle', reticle_color = v->>'reticle_color', battery_type = v->>'battery_type',
      mount_system = v->>'mount_system', bundle = v->>'bundle', clamp_style = v->>'clamp_style',
      clamp_rail_type = v->>'clamp_rail_type', clamp = v->>'clamp'
    where id = v_variant_id;

    if v ? 'gallery' then
      if v->>'image_url' is null then
        raise exception 'create_product: variant %: gallery photos need a main photo first', v_i;
      end if;
      insert into public.variant_images (variant_id, url, position)
      select v_variant_id, g.url, (g.ord + 1)::smallint
        from jsonb_array_elements_text(v->'gallery') with ordinality g(url, ord);
    end if;

    -- retailer links: zero or more per variant. street_price / in_stock /
    -- last_checked / op_last_matched_by are never set — the sync owns them.
    v_links := coalesce(v->'links', '[]'::jsonb);
    if jsonb_typeof(v_links) <> 'array' then raise exception 'create_product: variant %: links must be a list', v_i; end if;
    if v ? 'url' or v ? 'partner_slug' or v ? 'affiliate_url' then
      v_links := v_links || jsonb_build_array(jsonb_build_object('partner_slug', v->>'partner_slug', 'url', v->>'url', 'affiliate_url', v->>'affiliate_url'));
    end if;
    for l in select value from jsonb_array_elements(v_links) loop
      l := public.jsonb_strip_blank(l);
      select string_agg(k, ', ') into v_bad from jsonb_object_keys(l) k where k <> all (c_link_keys);
      if v_bad is not null then raise exception 'create_product: variant %: retailer link: unknown field(s): %', v_i, v_bad; end if;
      if l->>'partner_slug' is null or l->>'url' is null then
        raise exception 'create_product: variant %: each retailer link needs a retailer and a URL', v_i;
      end if;
      select pa.id, pa.awin_merchant_id into v_partner_id, v_mid from public.partners pa where pa.slug = l->>'partner_slug';
      if v_partner_id is null then
        raise exception 'create_product: variant %: no partner with slug "%"', v_i, l->>'partner_slug' using errcode = 'foreign_key_violation';
      end if;
      v_aff := l->>'affiliate_url';
      if v_mid is not null then
        if v_aff is null then
          v_aff := 'https://www.awin1.com/cread.php?awinmid=' || v_mid || '&awinaffid=' || c_awin_affid
                || '&clickref=' || public.url_encode('build-detail_' || v_slug)
                || '&ued=' || public.url_encode(l->>'url');
        elsif v_aff ~ 'awin1\.com' then
          v_aff_mid := coalesce(substring(v_aff from '[?&]awinmid=(\d+)'), substring(v_aff from '[?&]m=(\d+)'));
          if v_aff_mid is distinct from v_mid then
            raise exception 'create_product: variant %: the tracked link carries Awin merchant % but partner "%" is merchant %', v_i, coalesce(v_aff_mid,'(none)'), l->>'partner_slug', v_mid;
          end if;
        end if;
      end if;
      insert into public.affiliate_links (variant_id, partner_id, url, affiliate_url, notes, op_mpn, op_gtin, op_merchant_product_id)
      values (v_variant_id, v_partner_id, l->>'url', v_aff, l->>'notes', l->>'op_mpn', l->>'op_gtin', l->>'op_merchant_product_id');
    end loop;

    if (v->>'use_in_build')::boolean then v_build_variant := v_variant_id; end if;
  end loop;

  if exists (select 1 from public.product_variants where product_id = v_product_id
             group by color, finish, optic_cut, handedness, manual_safety_variant, reticle, reticle_color,
                      battery_type, mount_system, bundle, clamp, clamp_style, clamp_rail_type
             having count(*) > 1) then
    raise exception 'create_product: two variants are identical on every option. Each one must differ by colour, finish or another option.';
  end if;
  if exists (select 1 from public.product_variants pv where pv.product_id = v_product_id and pv.is_default
               and (pv.primary_image_url is null or pv.msrp is null)) then
    raise exception 'create_product: the default variant needs a photo and an MSRP';
  end if;

  -- ── fits-with rules ───────────────────────────────────────────────────────
  f := public.jsonb_strip_blank(p_fits);
  for v_key, r in select e.key, e.value from jsonb_each(f) e loop
    if not ((v_category = 'light'   and v_key = 'light_compatibility')
         or (v_category = 'optic'   and v_key = 'adapter_footprints')
         or (v_category = 'barrel'  and v_key = 'slides')
         or (v_category = 'slide'   and v_key = 'barrels')
         or (v_category = 'magwell' and v_key = 'frames')
         or (v_category = 'frame'   and v_key = 'magwells')) then
      raise exception 'create_product: fits-with rule "%" does not apply to a %. (light: light_compatibility; optic: adapter_footprints; barrel: slides; slide: barrels; magwell: frames; frame: magwells)', v_key, v_category;
    end if;
    if jsonb_typeof(r) <> 'array' then raise exception 'create_product: fits-with rule "%" must be a list', v_key; end if;
    -- these four reference the <category>_specs row, not products
    if v_key in ('light_compatibility','adapter_footprints','slides','barrels') and not v_has_specs then
      raise exception 'create_product: fits-with rules for a % need its spec sheet filled in first', v_category;
    end if;
    for l in select value from jsonb_array_elements(r) loop
      if jsonb_typeof(l) = 'string' then l := jsonb_build_object('product', l #>> '{}'); end if;
      l := public.jsonb_strip_blank(l);
      if v_key = 'light_compatibility' then
        select string_agg(k, ', ') into v_bad from jsonb_object_keys(l) k
         where k <> all (array['rail_type','fitment_type','key_or_adapter','gun_make','gun','gun_model_text','confirmed','notes']);
        if v_bad is not null then raise exception 'create_product: light_compatibility: unknown field(s): %', v_bad; end if;
        v_other_id := null;
        if l ? 'gun' then
          select g.id into v_other_id from public.guns g where g.slug = l->>'gun';
          if v_other_id is null then raise exception 'create_product: light_compatibility: no gun "%"', l->>'gun'; end if;
        end if;
        insert into public.light_compatibility (light_product_id, rail_type, fitment_type, key_or_adapter, gun_make, gun_id, gun_model_text, confirmed, notes)
        values (v_product_id, l->>'rail_type', (l->>'fitment_type')::public.light_fitment_type, l->>'key_or_adapter', l->>'gun_make',
                v_other_id, l->>'gun_model_text', coalesce((l->>'confirmed')::boolean, false), l->>'notes');
      elsif v_key = 'adapter_footprints' then
        select string_agg(k, ', ') into v_bad from jsonb_object_keys(l) k where k <> all (array['footprint','plate_included','notes']);
        if v_bad is not null then raise exception 'create_product: adapter_footprints: unknown field(s): %', v_bad; end if;
        if not l ? 'plate_included' then raise exception 'create_product: adapter_footprints: say whether the plate is included'; end if;
        select fp.id into v_other_id from public.footprints fp where fp.slug = l->>'footprint';
        if v_other_id is null then raise exception 'create_product: adapter_footprints: no footprint "%"', l->>'footprint'; end if;
        insert into public.optic_adapter_footprints (optic_product_id, footprint_id, plate_included, notes)
        values (v_product_id, v_other_id, (l->>'plate_included')::boolean, l->>'notes');
      else
        select string_agg(k, ', ') into v_bad from jsonb_object_keys(l) k where k <> all (array['product','source','compatibility_note']);
        if v_bad is not null then raise exception 'create_product: %: unknown field(s): %', v_key, v_bad; end if;
        v_want := case v_key when 'slides' then 'slide' when 'barrels' then 'barrel' when 'frames' then 'frame' else 'magwell' end;
        select pr.id into v_other_id from public.products pr where pr.slug = l->>'product' and pr.category = v_want;
        if v_other_id is null then
          raise exception 'create_product: %: there is no % with slug "%"', v_key, v_want, l->>'product';
        end if;
        if v_key in ('slides','barrels') then
          insert into public.barrel_slide_requirements (barrel_product_id, slide_product_id, source, compatibility_note)
          values (case when v_key = 'slides' then v_product_id else v_other_id end,
                  case when v_key = 'slides' then v_other_id else v_product_id end,
                  l->>'source', l->>'compatibility_note');
        elsif l ? 'source' then
          insert into public.magwell_frame_requirements (magwell_product_id, frame_product_id, source, compatibility_note)
          values (case when v_key = 'frames' then v_product_id else v_other_id end,
                  case when v_key = 'frames' then v_other_id else v_product_id end,
                  l->>'source', l->>'compatibility_note');
        else
          insert into public.magwell_frame_requirements (magwell_product_id, frame_product_id, compatibility_note)
          values (case when v_key = 'frames' then v_product_id else v_other_id end,
                  case when v_key = 'frames' then v_other_id else v_product_id end,
                  l->>'compatibility_note');
        end if;
      end if;
    end loop;
  end loop;

  -- ── things the admin should know, but that do not block ───────────────────
  if v_category = 'slide' and not f ? 'barrels' then
    select string_agg(distinct pr.slug, ', ') into v_bad
      from public.barrel_slide_requirements b join public.products pr on pr.id = b.barrel_product_id;
    if v_bad is not null then
      v_warn := v_warn || ('These barrels only fit the slides listed for them, so they will show as NOT fitting this slide: ' || v_bad);
    end if;
  end if;
  if v_category = 'frame' and not f ? 'magwells' then
    select string_agg(distinct pr.slug, ', ') into v_bad
      from public.magwell_frame_requirements b join public.products pr on pr.id = b.magwell_product_id;
    if v_bad is not null then
      v_warn := v_warn || ('These magwells only fit the frames listed for them, so they will show as NOT fitting this frame: ' || v_bad);
    end if;
  end if;

  -- ── swap the build's pending custom part for this product ─────────────────
  -- variantSpecs is not written into the snapshot here: its formula lives in
  -- js/variant-label.js and _variant-label.mjs, and a third copy in SQL would
  -- drift. The build page reads the spec line from the live variant.
  if p_build_id is not null then
    select b.parts_snapshot -> p_part_index into v_part from public.builds b where b.id = p_build_id for update;
    if not found then raise exception 'create_product: no build %', p_build_id; end if;
    if v_part is null then raise exception 'create_product: build has no part at index %', p_part_index; end if;
    if (v_part->>'pending')::boolean is not true or v_part->>'refId' is not null then
      raise exception 'create_product: part % ("%") on that build is not a pending custom part', p_part_index, v_part->>'name';
    end if;
    if v_build_variant is null then
      select pv.id into v_build_variant from public.product_variants pv where pv.product_id = v_product_id and pv.is_default;
    end if;
    update public.builds b set parts_snapshot = jsonb_set(b.parts_snapshot, array[p_part_index::text],
        v_part
        || jsonb_strip_nulls(jsonb_build_object('name', v_name, 'brand', v_brand_name, 'refId', v_product_id,
             'imageUrl', pv.primary_image_url, 'variantId', pv.id, 'variantColor', pv.color,
             'variantLabel', pv.variant_label, 'variantFinish', pv.finish))
        || jsonb_build_object('pending', false))
    from public.product_variants pv
    where b.id = p_build_id and pv.id = v_build_variant;
  end if;

  -- ── completeness, and the confidence it allows ────────────────────────────
  v_status := public.product_data_status(v_product_id);
  if v_confidence <> 'unverified' then
    if not (v_status->>'approved')::boolean then
      raise exception 'create_product: fitment confidence "%" needs an approved part. Still missing: %',
        v_confidence, (select string_agg(x, ', ') from jsonb_array_elements_text(v_status->'missing') x);
    end if;
    update public.products set fitment_confidence = v_confidence where id = v_product_id;
  end if;

  v_result := jsonb_build_object(
    'product_id', v_product_id, 'slug', v_slug, 'category', v_category,
    'brand', v_brand_name, 'brand_created', v_brand_created, 'build_relinked', p_build_id is not null,
    'has_spec_sheet', v_has_specs, 'fitment_confidence', v_confidence, 'warnings', to_jsonb(v_warn),
    'variants', (select jsonb_agg(jsonb_build_object('id', pv.id, 'slug', pv.slug, 'label', pv.variant_label, 'default', pv.is_default,
                    'photos', (select count(*) from public.variant_images vi where vi.variant_id = pv.id),
                    'links', (select count(*) from public.affiliate_links al where al.variant_id = pv.id))
                  order by pv.is_default desc, pv.slug)
                 from public.product_variants pv where pv.product_id = v_product_id))
    || v_status;

  if p_dry_run then
    raise exception 'create_product: dry run, nothing was written' using errcode = 'P0DRY', detail = v_result::text;
  end if;
  return v_result;
end;
$fn$;

comment on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) is
  'Admin / service_role only. Creates a product with its brand, platforms, spec sheet, every variant (photos + retailer links) and fits-with rules in one transaction, optionally re-links a build''s pending custom part, and returns product_data_status. p_dry_run raises P0DRY with the result instead of writing.';

-- CREATE re-grants EXECUTE to anon through default privileges; take it back.
revoke all on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) from public, anon;
grant execute on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) to authenticated, service_role;

-- ── the needs-data list (PR 3) ──────────────────────────────────────────────
-- Unapproved products and what each is missing. Admins (and the service role)
-- see rows; everyone else sees none. security_invoker so it reads as the
-- caller, and the filter is in the view itself.
create or replace view public.products_needing_data with (security_invoker = true) as
select p.id as product_id, p.slug, p.name, m.name as brand, p.category,
       array(select jsonb_array_elements_text(st.s -> 'platforms')) as platforms,
       array(select jsonb_array_elements_text(st.s -> 'missing'))   as missing
  from public.products p
  join public.manufacturers m on m.id = p.brand_id
  cross join lateral (select public.product_data_status(p.id) as s) st
 where (public.is_admin() or public.is_trusted_backend())
   and not (st.s ->> 'approved')::boolean;

revoke all on public.products_needing_data from public, anon, authenticated;
grant select on public.products_needing_data to authenticated, service_role;

-- ============================================================
-- APPLIED 2026-10-03 as migration create_product (20261003223355) to
-- project lagjjcpclvzrjlrswojt, from this file as merged in #131, after
-- spec_field_rules (20261003223210).
-- Verified live after the change — md5(pg_proc.prosrc) against the body
-- between each function's dollar quotes in this file, all identical:
--
--   create_product        ddc77c90ef658b914f7adb285e4b15ff
--   product_data_status   6d89efbeb72d7de5a6506d5c3cdb6a4b
--   url_encode            7cf7c7bb7025f85b8fc653b7465a0fbc
--   jsonb_strip_blank     e84ec6d60424e3846ddc575d17cfab81
--
--   signatures, search_path = '', SECURITY DEFINER on create_product only,
--     volatility (create_product v, product_data_status s, helpers i) match
--   EXECUTE on create_product / product_data_status: authenticated and
--     service_role only; anon through PostgREST gets 42501
--   products_needing_data: security_invoker=true; SELECT for authenticated
--     and service_role only; anon through PostgREST gets 42501
--   232 of 242 products approved; the 10 unapproved are all 'verified'
-- ============================================================
