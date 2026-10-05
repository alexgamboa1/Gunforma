-- add_variants.sql
-- NOT YET APPLIED. Dry-run 2026-10-04 against Gunforma-v2 inside one
-- rolled-back transaction; results, and the A/B comparison of
-- create_product() before and after, in the PR. Apply AFTER the page that
-- calls add_variants() is merged and live.
--
-- WHY. gunforma-admin-part.html only creates new parts and create_product()
-- refuses an existing one. create_variant() exists but cannot set the option
-- columns (reticle, dot colour, battery, mount, bundle, clamp, manual
-- safety), builds no tracked link and has no page. 161 of 243 parts have
-- more than one variant, and a builder's colour is often the one we lack.
--
-- WHAT.
--   variant_identity()            what makes two variants the same, normalised
--   create_variants_for_product() THE ONE COPY of "a variant object becomes a
--                                 variant", moved out of create_product()
--   create_product()              restated from fix_strip_blank_and_link_result.sql
--                                 with its variant loop replaced by one call;
--                                 nothing else in it changes
--   add_variants()                new variants on an existing part
--
-- create_product() BEHAVES AS BEFORE, with two intended differences that come
-- from the shared duplicate rule (ruled): identical variants are now caught
-- trimmed and case-insensitively, and the refusal names the match instead of
-- "two variants are identical on every option". The PR's A/B table runs every
-- PR 1 case through the old and new function in one transaction and compares
-- the returned JSON and the rows written per table.

-- ── what makes two variants the same ────────────────────────────────────────
-- Every column that tells two variants of one part apart, normalised:
-- trimmed, case-folded, blank = null. optic_cut 'none' = no cut, and a
-- missing manual-safety flag = false (bulk-loaded rows say false, rows from
-- create_product() leave it null; both mean "no manual safety").
-- "anodized" and "Anodized " are the same finish.
create or replace function public.variant_identity(
  p_color text, p_finish text, p_optic_cut text, p_handedness text, p_manual_safety boolean,
  p_reticle text, p_reticle_color text, p_battery_type text, p_mount_system text, p_bundle text,
  p_clamp text, p_clamp_style text, p_clamp_rail_type text)
returns text language sql immutable set search_path = '' as $vi$
  select concat_ws(chr(31),
    coalesce(nullif(lower(btrim(p_color)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_finish)), ''), '∅'),
    coalesce(nullif(nullif(lower(btrim(p_optic_cut)), ''), 'none'), '∅'),
    coalesce(nullif(lower(btrim(p_handedness)), ''), '∅'),
    coalesce(p_manual_safety, false)::text,
    coalesce(nullif(lower(btrim(p_reticle)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_reticle_color)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_battery_type)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_mount_system)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_bundle)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_clamp)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_clamp_style)), ''), '∅'),
    coalesce(nullif(lower(btrim(p_clamp_rail_type)), ''), '∅'));
$vi$;

-- ── one copy of "a variant object becomes a variant" ────────────────────────
-- Shared by create_product() and add_variants(). Unknown keys refused;
-- colour vocabulary, slug, default flag and the first photo are
-- create_variant()'s rules; the option columns it cannot carry are written
-- here and folded into the slug; gallery photos; retailer links with the Awin
-- link built and a wrong merchant id refused.
--
-- Checked BEFORE anything is written: unknown keys, and that no new variant
-- is identical on every option (variant_identity) to a live variant of the
-- part — discontinued ones included — or to another new one. The refusal
-- names the match.
--
-- Not callable from the API: SECURITY INVOKER with EXECUTE revoked from
-- everyone but the owner, so only the two SECURITY DEFINER callers reach it.
-- It repeats their guard anyway. p_caller only prefixes messages, so each
-- caller's refusals read as its own.
create or replace function public.create_variants_for_product(
  p_product_id uuid, p_product_slug text, p_variants jsonb, p_caller text)
returns jsonb
language plpgsql set search_path = ''
as $cv$
declare
  c_awin_affid   constant text   := '2959345';   -- Gunforma's Awin publisher id; public, it is in every live link
  c_variant_keys constant text[] := array['color','finish','sku','upc','msrp','image_url','gallery','variant_label','optic_cut','handedness','notes','is_default','manual_safety_variant','reticle','reticle_color','battery_type','mount_system','bundle','clamp_style','clamp_rail_type','clamp','partner_slug','url','affiliate_url','links','use_in_build'];
  c_link_keys    constant text[] := array['partner_slug','url','affiliate_url','op_mpn','op_gtin','op_merchant_product_id','notes'];
  v jsonb; l jsonb; v_i int := 0; v_j int; v_bad text;
  v_variant_id uuid; v_build_variant uuid; v_links jsonb; v_partner_id uuid;
  v_mid text; v_aff text; v_aff_mid text;
  v_axes text; v_vslug text; v_vbase text; v_n int;
  v_ids uuid[] := '{}'; v_new text[] := '{}'; v_ident text; v_match record;
begin
  if not (public.is_admin() or public.is_trusted_backend()) then
    raise exception '%: admin or service_role only', p_caller using errcode = '42501';
  end if;

  -- pass 1: refuse before writing anything
  for v in select value from jsonb_array_elements(p_variants) loop
    v_i := v_i + 1;
    if jsonb_typeof(v) <> 'object' then raise exception '%: variant % is not an object', p_caller, v_i; end if;
    v := public.jsonb_strip_blank(v);
    select string_agg(k, ', ') into v_bad from jsonb_object_keys(v) k where k <> all (c_variant_keys);
    if v_bad is not null then
      raise exception '%: variant %: unknown field(s): %', p_caller, v_i, v_bad;
    end if;
    v_ident := public.variant_identity(v->>'color', v->>'finish', v->>'optic_cut', v->>'handedness', (v->>'manual_safety_variant')::boolean,
                 v->>'reticle', v->>'reticle_color', v->>'battery_type', v->>'mount_system', v->>'bundle',
                 v->>'clamp', v->>'clamp_style', v->>'clamp_rail_type');
    select pv.slug, pv.variant_label into v_match from public.product_variants pv
     where pv.product_id = p_product_id and pv.retired_at is null
       and public.variant_identity(pv.color, pv.finish, pv.optic_cut, pv.handedness, pv.manual_safety_variant,
             pv.reticle, pv.reticle_color, pv.battery_type, pv.mount_system, pv.bundle,
             pv.clamp, pv.clamp_style, pv.clamp_rail_type) = v_ident
     order by pv.slug limit 1;
    if found then
      raise exception '%: variant % is identical on every option to the existing variant "%" (%). Change its colour, finish or an option, or edit that variant instead.',
        p_caller, v_i, coalesce(v_match.variant_label, v_match.slug), v_match.slug;
    end if;
    v_j := array_position(v_new, v_ident);
    if v_j is not null then
      raise exception '%: variants % and % are identical on every option. Each one must differ by colour, finish or another option.', p_caller, v_j, v_i;
    end if;
    v_new := v_new || v_ident;
  end loop;

  -- pass 2: write
  v_i := 0;
  for v in select value from jsonb_array_elements(p_variants) loop
    v_i := v_i + 1;
    v := public.jsonb_strip_blank(v);

    v_variant_id := public.create_variant(
      p_product_slug => p_product_slug, p_color => v->>'color', p_finish => v->>'finish', p_sku => v->>'sku', p_upc => v->>'upc',
      p_msrp => (v->>'msrp')::numeric, p_image_url => v->>'image_url', p_variant_label => v->>'variant_label',
      p_optic_cut => v->>'optic_cut', p_handedness => v->>'handedness', p_notes => v->>'notes',
      p_make_default => case when (v->>'is_default')::boolean then true end);

    -- the options create_variant does not carry; when present they also go into the slug
    v_axes := concat_ws('-', nullif(v->>'optic_cut','none'), v->>'reticle_color', v->>'reticle', v->>'clamp', v->>'bundle',
                        case when (v->>'manual_safety_variant')::boolean then 'ms' end,
                        case when v->>'handedness' in ('left','right') then v->>'handedness' end);
    v_vslug := null;
    if v_axes <> '' then
      v_vbase := public.slugify(p_product_slug || '-' || v_axes || '-' || (v->>'color') || coalesce('-' || (v->>'finish'), ''));
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
        raise exception '%: variant %: gallery photos need a main photo first', p_caller, v_i;
      end if;
      insert into public.variant_images (variant_id, url, position)
      select v_variant_id, g.url, (g.ord + 1)::smallint
        from jsonb_array_elements_text(v->'gallery') with ordinality g(url, ord);
    end if;

    -- retailer links: zero or more per variant. street_price / in_stock /
    -- last_checked / op_last_matched_by are never set — the sync owns them.
    v_links := coalesce(v->'links', '[]'::jsonb);
    if jsonb_typeof(v_links) <> 'array' then raise exception '%: variant %: links must be a list', p_caller, v_i; end if;
    if v ? 'url' or v ? 'partner_slug' or v ? 'affiliate_url' then
      v_links := v_links || jsonb_build_array(jsonb_build_object('partner_slug', v->>'partner_slug', 'url', v->>'url', 'affiliate_url', v->>'affiliate_url'));
    end if;
    for l in select value from jsonb_array_elements(v_links) loop
      l := public.jsonb_strip_blank(l);
      select string_agg(k, ', ') into v_bad from jsonb_object_keys(l) k where k <> all (c_link_keys);
      if v_bad is not null then raise exception '%: variant %: retailer link: unknown field(s): %', p_caller, v_i, v_bad; end if;
      if l->>'partner_slug' is null or l->>'url' is null then
        raise exception '%: variant %: each retailer link needs a retailer and a URL', p_caller, v_i;
      end if;
      select pa.id, pa.awin_merchant_id into v_partner_id, v_mid from public.partners pa where pa.slug = l->>'partner_slug';
      if v_partner_id is null then
        raise exception '%: variant %: no partner with slug "%"', p_caller, v_i, l->>'partner_slug' using errcode = 'foreign_key_violation';
      end if;
      v_aff := l->>'affiliate_url';
      if v_mid is not null then
        if v_aff is null then
          v_aff := 'https://www.awin1.com/cread.php?awinmid=' || v_mid || '&awinaffid=' || c_awin_affid
                || '&clickref=' || public.url_encode('build-detail_' || p_product_slug)
                || '&ued=' || public.url_encode(l->>'url');
        elsif v_aff ~ 'awin1\.com' then
          v_aff_mid := coalesce(substring(v_aff from '[?&]awinmid=(\d+)'), substring(v_aff from '[?&]m=(\d+)'));
          if v_aff_mid is distinct from v_mid then
            raise exception '%: variant %: the tracked link carries Awin merchant % but partner "%" is merchant %', p_caller, v_i, coalesce(v_aff_mid,'(none)'), l->>'partner_slug', v_mid;
          end if;
        end if;
      end if;
      insert into public.affiliate_links (variant_id, partner_id, url, affiliate_url, notes, op_mpn, op_gtin, op_merchant_product_id)
      values (v_variant_id, v_partner_id, l->>'url', v_aff, l->>'notes', l->>'op_mpn', l->>'op_gtin', l->>'op_merchant_product_id');
    end loop;

    v_ids := v_ids || v_variant_id;
    if (v->>'use_in_build')::boolean then v_build_variant := v_variant_id; end if;
  end loop;

  return jsonb_build_object('variant_ids', to_jsonb(v_ids), 'build_variant', v_build_variant);
end;
$cv$;

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
  v_vr jsonb;
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
  -- The loop lives in create_variants_for_product(), shared with
  -- add_variants(): one copy of how a variant object becomes a variant.
  v_vr := public.create_variants_for_product(v_product_id, v_slug, p_variants, 'create_product');
  v_build_variant := (v_vr->>'build_variant')::uuid;

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
                    'links', (select count(*) from public.affiliate_links al where al.variant_id = pv.id),
                    -- one entry per retailer link: tracked_url is the link the buy
                    -- button will use, null when none was built (no commission)
                    'retailers', coalesce((select jsonb_agg(jsonb_build_object('partner', pa.slug, 'partner_name', pa.name,
                                     'url', al.url, 'tracked_url', al.affiliate_url) order by pa.slug, al.url)
                                   from public.affiliate_links al join public.partners pa on pa.id = al.partner_id
                                  where al.variant_id = pv.id), '[]'::jsonb))
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

-- ── add_variants(): new variants on a part that already exists ──────────────
-- Same variant object, same rules and same dry run as create_product(), plus:
--   * every new variant needs a photo and an MSRP — adding a variant must
--     never unapprove a part (refused here, not only on the page)
--   * at most one new variant may say is_default. When one does, the old
--     default is unset in the same transaction (create_variant() does it,
--     and variants_one_default_per_product enforces it); otherwise the
--     current default stays the default
--   * existing variants are never changed
--   * an unknown or discontinued part is refused
-- Returns the new variants (with each retailer link's tracked URL) plus
-- product_data_status. p_dry_run raises P0DRY with that result in DETAIL.
create or replace function public.add_variants(
  p_product_slug text, p_variants jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $av$
declare
  pr record; v jsonb; v_i int := 0; v_defaults int := 0; v_vr jsonb; v_result jsonb;
begin
  if not (public.is_admin() or public.is_trusted_backend()) then
    raise exception 'add_variants: admin or service_role only' using errcode = '42501';
  end if;
  select p.id, p.slug, p.category, p.is_discontinued into pr from public.products p where p.slug = btrim(coalesce(p_product_slug, ''));
  if not found then
    raise exception 'add_variants: no product with slug "%"', p_product_slug using errcode = 'foreign_key_violation';
  end if;
  if pr.is_discontinued then
    raise exception 'add_variants: "%" is discontinued. New variants are not added to a discontinued part.', pr.slug;
  end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'add_variants: at least one variant is required';
  end if;
  for v in select value from jsonb_array_elements(p_variants) loop
    v_i := v_i + 1;
    if jsonb_typeof(v) <> 'object' then raise exception 'add_variants: variant % is not an object', v_i; end if;
    v := public.jsonb_strip_blank(v);
    if v->>'image_url' is null or v->>'msrp' is null then
      raise exception 'add_variants: variant % needs a photo and an MSRP. A new variant without them would leave the part unapproved.', v_i;
    end if;
    if (v->>'is_default')::boolean then v_defaults := v_defaults + 1; end if;
  end loop;
  if v_defaults > 1 then
    raise exception 'add_variants: % new variants say is_default. A part has one default; mark at most one.', v_defaults;
  end if;

  v_vr := public.create_variants_for_product(pr.id, pr.slug, p_variants, 'add_variants');

  v_result := jsonb_build_object(
    'product_id', pr.id, 'slug', pr.slug, 'category', pr.category, 'warnings', '[]'::jsonb,
    'defaults', (select count(*) from public.product_variants pv where pv.product_id = pr.id and pv.is_default and pv.retired_at is null),
    'variants', (select jsonb_agg(jsonb_build_object('id', pv.id, 'slug', pv.slug, 'label', pv.variant_label, 'default', pv.is_default,
                    'photos', (select count(*) from public.variant_images vi where vi.variant_id = pv.id),
                    'links', (select count(*) from public.affiliate_links al where al.variant_id = pv.id),
                    'retailers', coalesce((select jsonb_agg(jsonb_build_object('partner', pa.slug, 'partner_name', pa.name,
                                     'url', al.url, 'tracked_url', al.affiliate_url) order by pa.slug, al.url)
                                   from public.affiliate_links al join public.partners pa on pa.id = al.partner_id
                                  where al.variant_id = pv.id), '[]'::jsonb))
                  order by pv.is_default desc, pv.slug)
                 from public.product_variants pv
                where pv.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_vr->'variant_ids') x)))
    || public.product_data_status(pr.id);

  if p_dry_run then
    raise exception 'add_variants: dry run, nothing was written' using errcode = 'P0DRY', detail = v_result::text;
  end if;
  return v_result;
end;
$av$;

-- grants: create or replace keeps them; restated so this file says the whole
-- of what is live. The helper and the identity function are not callable
-- from the API at all.
revoke all on function public.variant_identity(text, text, text, text, boolean, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_variants_for_product(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) from public, anon;
grant execute on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) to authenticated, service_role;
revoke all on function public.add_variants(text, jsonb, boolean) from public, anon;
grant execute on function public.add_variants(text, jsonb, boolean) to authenticated, service_role;
