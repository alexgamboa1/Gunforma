-- add_categories.sql
-- APPLIED 2026-10-05 as migration add_categories (20261005024538), BEFORE
-- #140 was merged, after add_categories_enum.sql (20261005020804): Postgres
-- refuses to use an enum value in the transaction that added it. See the
-- record at the foot of this file. Dry-run the same day inside one
-- rolled-back transaction; results, and the A/B comparison of
-- create_product() and relink_build_part() before and after, in #140.
-- create_product() has since been restated by sight_values_in_words.sql.
--
-- WHAT.
--   recoil_spring_specs, sight_specs   the two new spec sheets
--   spec_field_rules                   their rules (approved field lists)
--   products.part_type                 an Other Part's one extra fact
--   create_product()                   part_type; recoil-spring slide length;
--                                      guide rod material is the material;
--                                      a misc part re-linked takes the
--                                      product's category
--   relink_build_part()                the same misc rule
--
-- product_data_status() does not change: it finds a spec sheet by name
-- (<category>_specs) and its rules in spec_field_rules, and an Other Part
-- cannot exist without a part type (the table rule below).
--
-- Both spec tables follow frame_specs/optic_specs: a category column held to
-- its one value, and the (product_id, category) FK into products, so a spec
-- row can only ever belong to a product of that category. Unlike the older
-- spec tables they arrive with grants revoked: SELECT only, to anon and
-- authenticated, behind a read policy (CLAUDE.md, "every new public table
-- needs RLS and an explicit revoke"). The older tables' broad grants are
-- logged, not fixed here.

-- ── recoil springs ──────────────────────────────────────────────────────────
-- A different spring weight or slide length is a different PRODUCT, not a
-- variant: neither is one of the option columns variant_identity() compares,
-- so two weights as variants would be refused as identical.
create table public.recoil_spring_specs (
  product_id         uuid primary key,
  category           public.product_category not null default 'recoil_spring',
  slide_length_in    numeric(3,2),   -- the slide length it fits; registered in platform_part_lengths
  spring_weight      text,           -- as the maker writes it: "13 lb", "Reduced (Soft)"
  captured           boolean,
  spring_type        text,           -- flat-wire, round-wire, dual
  guide_rod_material text,           -- filled from products.material ("material is one fact")
  constraint recoil_spring_specs_category check (category = 'recoil_spring'),
  constraint recoil_spring_specs_product_fkey foreign key (product_id, category)
    references public.products (id, category) on delete cascade
);

-- ── sights ──────────────────────────────────────────────────────────────────
-- The front dot colour is a VARIANT option (product_variants.reticle_color,
-- labelled "Front dot colour" for sights), so green and orange fronts are
-- variants of one product.
create table public.sight_specs (
  product_id     uuid primary key,
  category       public.product_category not null default 'sight',
  sight_position text,   -- front | rear | set
  height         text,   -- standard | suppressor (makers' "co-witness")
  sight_type     text,   -- night (tritium) | fiber | night-fiber | plain
  dovetail       text,   -- the slide cut, as makers write it; optional
  rear_notch     text,   -- U-notch, square, …; optional
  constraint sight_specs_category check (category = 'sight'),
  constraint sight_specs_sight_position check (sight_position in ('front', 'rear', 'set')),
  constraint sight_specs_height check (height in ('standard', 'suppressor')),
  constraint sight_specs_sight_type check (sight_type in ('night', 'fiber', 'night-fiber', 'plain')),
  constraint sight_specs_product_fkey foreign key (product_id, category)
    references public.products (id, category) on delete cascade
);

alter table public.recoil_spring_specs enable row level security;
alter table public.sight_specs enable row level security;
revoke all on public.recoil_spring_specs, public.sight_specs from public, anon, authenticated;
grant select on public.recoil_spring_specs, public.sight_specs to anon, authenticated;
create policy recoil_spring_specs_public_read on public.recoil_spring_specs for select to anon, authenticated using (true);
create policy sight_specs_public_read on public.sight_specs for select to anon, authenticated using (true);

-- ── rules (the approved field lists) ────────────────────────────────────────
insert into public.spec_field_rules (category, field, requirement, only_when_field, only_when_values, label, sort_order) values
  ('recoil_spring', 'slide_length_in',    'required', null, null, 'Slide length (in)',    10),
  ('recoil_spring', 'spring_weight',      'required', null, null, 'Spring weight',        20),
  ('recoil_spring', 'captured',           'required', null, null, 'Captured',             30),
  ('recoil_spring', 'spring_type',        'optional', null, null, 'Spring type',          40),
  ('recoil_spring', 'guide_rod_material', 'optional', null, null, 'Guide rod material',   50),
  ('sight',         'sight_position',     'required', null, null, 'Front, rear or set',   10),
  ('sight',         'height',             'required', null, null, 'Height',               20),
  ('sight',         'sight_type',         'required', null, null, 'Sight type',           30),
  ('sight',         'dovetail',           'optional', null, null, 'Dovetail / slide cut', 40),
  ('sight',         'rear_notch',         'optional', null, null, 'Rear notch',           50);

-- ── Other Parts: part_type ──────────────────────────────────────────────────
-- Two or three words saying what the part is ("thumb ledge"). An Other Part
-- must have one and no other category may: the rule compares the category as
-- TEXT, so it does not depend on the enum value at plan time. anon reads
-- products through column grants, so the new column is granted explicitly.
alter table public.products add column part_type text;
alter table public.products add constraint products_part_type_other
  check ((category::text = 'other') = (coalesce(btrim(part_type), '') <> ''));
grant select (part_type) on public.products to anon, authenticated;
comment on column public.products.part_type is
  'Other Parts only: what the part is, in two or three words ("thumb ledge"). Required there, absent everywhere else (products_part_type_other).';

-- ── create_product(): restated from add_variants.sql (applied) ──────────────
-- Changes, and nothing else: part_type accepted, required for and only for
-- Other Parts; a recoil spring's slide length must be registered for one of
-- its platforms; guide_rod_material is filled from the material, like an
-- optic's housing_material; a re-linked part stored under misc takes the
-- product's category.
create or replace function public.create_product(
  p_product jsonb, p_variants jsonb, p_specs jsonb default null, p_fits jsonb default null,
  p_build_id uuid default null, p_part_index integer default null, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  c_awin_affid   constant text   := '2959345';   -- Gunforma's Awin publisher id; public, it is in every live link
  c_product_keys constant text[] := array['brand','name','category','platforms','slug','url','description','family','material','material_family','fitment_notes','build_warning','build_notes','weight_oz','fitment_confidence','internal_notes','part_type'];
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

  -- Other Parts: what the part is, in two or three words, is its one extra
  -- fact (products.part_type). Only that category carries one; the table
  -- rule products_part_type_other says the same, and this says it in words.
  if v_category::text = 'other' and coalesce(btrim(p->>'part_type'), '') = '' then
    raise exception 'create_product: an Other Part needs a part type: two or three words saying what it is (e.g. "thumb ledge")';
  elsif v_category::text <> 'other' and p ? 'part_type' then
    raise exception 'create_product: a part type is only for Other Parts; a % is its own category', v_category;
  end if;

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
                               fitment_notes, build_warning, build_notes, weight_oz, fitment_confidence, part_type)
  values (v_slug, v_category, v_brand_id, v_name, p->>'family', p->>'url', p->>'description', p->>'material', p->>'material_family',
          p->>'fitment_notes', p->>'build_warning', p->>'build_notes', (p->>'weight_oz')::numeric, 'unverified', btrim(p->>'part_type'))
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
    foreach v_key in array array['housing_material', 'material', 'guide_rod_material'] loop
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

    -- a recoil spring fits one slide length. It has no platform rule of its
    -- own, so the length must be registered for one of the part's platforms.
    if v_category::text = 'recoil_spring' and s ? 'slide_length_in' then
      v_len := (s ->> 'slide_length_in')::numeric;
      if not exists (select 1 from public.platform_part_lengths ppl join public.platforms pl on pl.id = ppl.platform_id
                      where pl.slug = any (v_platforms) and ppl.part_kind = 'slide' and ppl.length_in = v_len) then
        select string_agg(distinct ppl.length_in::text, ', ' order by ppl.length_in::text) into v_lengths
          from public.platform_part_lengths ppl join public.platforms pl on pl.id = ppl.platform_id
         where pl.slug = any (v_platforms) and ppl.part_kind = 'slide';
        raise exception 'create_product: no slide length of % in is registered for %. Registered slide lengths: %.',
          v_len, array_to_string(v_platforms, ', '), coalesce(v_lengths, 'none');
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
        || jsonb_build_object('pending', false)
        -- Other Parts (stored as `misc`) is the catch-all: a part typed there
        -- takes the product's own category, so it renders in its real section
        -- (the DMP recoil spring under Recoil Springs). Every other section
        -- keeps the category it was saved under.
        || case when v_part->>'category' = 'misc' then jsonb_build_object('category', v_category::text) else '{}'::jsonb end)
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

-- ── relink_build_part(): restated from relink_build_part.sql (applied) ──────
-- One change: a part stored under misc (Other Parts, the catch-all) takes the
-- product's own category. Every other section keeps its category.
create or replace function public.relink_build_part(
  p_build_id uuid, p_part_index integer, p_product_id uuid, p_variant_id uuid,
  p_variant_specs text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $rl$
declare
  v_part jsonb; v_history jsonb; v_corrections int; v_entry jsonb;
  pr record; pv record;
begin
  if not (public.is_admin() or public.is_trusted_backend()) then
    raise exception 'relink_build_part: admin or service_role only' using errcode = '42501';
  end if;
  if p_build_id is null or p_part_index is null or p_product_id is null or p_variant_id is null then
    raise exception 'relink_build_part: build, part index, product and variant are all required';
  end if;
  if p_part_index < 0 then
    raise exception 'relink_build_part: part index must be 0 or more';   -- jsonb -> -1 would read from the end
  end if;

  select b.parts_snapshot -> p_part_index, coalesce(b.edit_history, '[]'::jsonb)
    into v_part, v_history
    from public.builds b where b.id = p_build_id for update;
  if not found then raise exception 'relink_build_part: no build %', p_build_id; end if;
  if v_part is null then raise exception 'relink_build_part: that build has no part at index %', p_part_index; end if;
  if (v_part->>'pending')::boolean is not true or v_part->>'refId' is not null then
    raise exception 'relink_build_part: part % ("%") on that build is not a pending custom part', p_part_index, v_part->>'name';
  end if;

  select count(*) into v_corrections from jsonb_array_elements(v_history) e
   where (e->>'part_index') ~ '^[0-9]+$' and (e->>'part_index')::int = p_part_index;
  if v_corrections > 0 then
    raise exception 'relink_build_part: part % ("%") has % correction% in the review queue. The build page shows those over the part, so a linked part would read as the correction. Not linked.',
      p_part_index, v_part->>'name', v_corrections, case when v_corrections = 1 then '' else 's' end;
  end if;

  select p.id, p.name, p.category, m.name as brand into pr
    from public.products p join public.manufacturers m on m.id = p.brand_id
   where p.id = p_product_id;
  if not found then raise exception 'relink_build_part: no product %', p_product_id; end if;

  select v.id, v.product_id, v.retired_at, v.primary_image_url, v.color, v.variant_label, v.finish into pv
    from public.product_variants v where v.id = p_variant_id;
  if not found or pv.product_id is distinct from p_product_id then
    raise exception 'relink_build_part: that variant is not one of "%"''s variants', pr.name;
  end if;
  if pv.retired_at is not null then
    raise exception 'relink_build_part: that variant of "%" is retired. Pick a live one.', pr.name;
  end if;

  v_entry := v_part
    || jsonb_strip_nulls(jsonb_build_object('name', pr.name, 'brand', pr.brand, 'refId', pr.id,
         'imageUrl', pv.primary_image_url, 'variantId', pv.id, 'variantColor', pv.color,
         'variantLabel', pv.variant_label, 'variantFinish', pv.finish,
         'variantSpecs', nullif(btrim(coalesce(p_variant_specs, '')), '')))
    || jsonb_build_object('pending', false)
    -- Other Parts (stored as `misc`) is the catch-all: a linked part takes the
    -- product's own category and renders in its real section. Every other
    -- section keeps the category it was saved under.
    || case when v_part->>'category' = 'misc' then jsonb_build_object('category', pr.category::text) else '{}'::jsonb end;

  update public.builds b set parts_snapshot = jsonb_set(b.parts_snapshot, array[p_part_index::text], v_entry)
   where b.id = p_build_id;

  return jsonb_build_object('build_id', p_build_id, 'part_index', p_part_index, 'entry', v_entry);
end;
$rl$;

comment on function public.relink_build_part(uuid, integer, uuid, uuid, text) is
  'Admin / service_role only. Swaps a build''s pending custom part (by its original index) for an existing catalog product and variant, as create_product()''s re-link does, plus variantSpecs when given. A part stored under misc (Other Parts) takes the product''s category. Refuses a part that is not pending or carries corrections.';

revoke all on function public.relink_build_part(uuid, integer, uuid, uuid, text) from public, anon;
grant execute on function public.relink_build_part(uuid, integer, uuid, uuid, text) to authenticated, service_role;

-- grants: create or replace keeps them; restated so this file says the whole
-- of what is live.
revoke all on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) from public, anon;
grant execute on function public.create_product(jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean) to authenticated, service_role;

-- ============================================================
-- APPLIED 2026-10-05 as migration add_categories (20261005024538) to project
-- lagjjcpclvzrjlrswojt, from this file as committed in #140 (5ecdbd9),
-- BEFORE #140 was merged. Verified live after the change:
--
--   md5(pg_proc.prosrc), against the body between each function's quotes:
--     create_product     c240b7860d823bdb4ec4dd606f97a54a
--     relink_build_part  ace62b6572b1935d324b32709fbc0ebc
--   recoil_spring_specs, sight_specs: RLS on; SELECT only, for anon and
--     authenticated, behind a read policy; anon INSERT refused (42501)
--   10 spec_field_rules rows (5 recoil_spring, 5 sight)
--   products.part_type (text) with products_part_type_other; anon can read it
--
-- Done-checks on the deploy preview passed. First parts: the DMP Soft RSA
-- (dmp-springs-soft-rsa-p365, a recoil spring, 2026-10-05 03:07 UTC), linked
-- to "P365 Complete Build" part 5, which now reads category recoil_spring;
-- and the Tactical Development Pro Ledge
-- (tactical-development-pro-ledge-tlr7-sub-1913-p365, an Other Part, part
-- type "Thumb Ledge", 03:13 UTC). Both approved.
-- ============================================================
