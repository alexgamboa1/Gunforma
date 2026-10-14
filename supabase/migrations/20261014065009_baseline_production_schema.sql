-- Baseline: production schema of Gunforma-v2 (lagjjcpclvzrjlrswojt), dumped 2026-10-14.
--
-- This file is the floor. Production already has everything in it, so it is
-- recorded there as applied and MUST NEVER BE RUN THERE. A fresh database (a
-- Supabase branch, `supabase db reset` locally, the check-migrations
-- workflow) runs it first, then every later file in this folder, then
-- supabase/seed.sql. See MIGRATIONS.md.
--
-- Produced with the Supabase CLI's `db dump --schema public` recipe
-- (pkg/migration/scripts/dump_schema.sh at v2.115.0: pg_dump --schema-only
-- --quote-all-identifier --role postgres --schema=public, then the CLI's sed
-- substitutions), executed with a local pg_dump 18.6 because this machine has
-- no Docker. Nothing in the dump itself was edited.
--
-- The section after the dump, "Outside the public schema", carries the three
-- things Gunforma owns that a public-only dump cannot reach: the storage
-- buckets, the eleven policies on storage.objects, and the trigger on
-- auth.users that creates a profile. Each is pg_dump's own output for that
-- object (pg_dump --schema-only -t storage.objects -t auth.users, and
-- --data-only --column-inserts -t storage.buckets), copied verbatim; the
-- bucket rows are reduced to the columns every storage version has.
--
-- Replaced on production: 223 history rows, 2026-07-30 .. 2026-10-13. Their
-- SQL is kept in supabase/migrations_archive/production_history_before_repair.sql.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."barrel_type" AS ENUM (
    'standard',
    'threaded',
    'ported',
    'threaded-and-ported'
);


ALTER TYPE "public"."barrel_type" OWNER TO "postgres";


CREATE TYPE "public"."fitment_confidence" AS ENUM (
    'verified',
    'likely',
    'unverified'
);


ALTER TYPE "public"."fitment_confidence" OWNER TO "postgres";


CREATE TYPE "public"."footprint_fit" AS ENUM (
    'direct',
    'via-plate'
);


ALTER TYPE "public"."footprint_fit" OWNER TO "postgres";


CREATE TYPE "public"."install_difficulty" AS ENUM (
    'easy',
    'moderate',
    'hard',
    'gunsmith'
);


ALTER TYPE "public"."install_difficulty" OWNER TO "postgres";


CREATE TYPE "public"."light_fitment_type" AS ENUM (
    'direct',
    'adapter-included',
    'adapter-required',
    'no-fit',
    'adapter-separate'
);


ALTER TYPE "public"."light_fitment_type" OWNER TO "postgres";


CREATE TYPE "public"."optic_mounting" AS ENUM (
    'direct',
    'plate',
    'plate-system',
    'none'
);


ALTER TYPE "public"."optic_mounting" OWNER TO "postgres";


CREATE TYPE "public"."product_category" AS ENUM (
    'slide',
    'barrel',
    'frame',
    'trigger',
    'compensator',
    'light',
    'optic',
    'mag_release',
    'magwell',
    'magazine',
    'basepad',
    'slide_release',
    'safety_selector',
    'takedown_lever',
    'slide_plate',
    'recoil_spring',
    'sight',
    'other'
);


ALTER TYPE "public"."product_category" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_variants"("p_product_slug" "text", "p_variants" "jsonb", "p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."add_variants"("p_product_slug" "text", "p_variants" "jsonb", "p_dry_run" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_part_ids"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and new.parts_snapshot is not distinct from old.parts_snapshot then
    return new;
  end if;
  new.parts_snapshot := public.with_part_ids(
    new.parts_snapshot,
    case when tg_op = 'UPDATE' then old.parts_snapshot end);
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_part_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_comment_votes_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_c   public.build_comments%rowtype;
begin
  if v_uid is null or new.user_id <> v_uid then
    raise exception 'Vote must be cast as yourself';
  end if;
  select * into v_c from public.build_comments where id = new.comment_id;
  if not found or v_c.deleted_at is not null then
    raise exception 'Comment not found';
  end if;
  if v_c.user_id = v_uid then
    raise exception 'You cannot vote on your own comment';
  end if;
  new.created_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."build_comment_votes_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_comments_guard_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_recent int;
  v_parent public.build_comments%rowtype;
begin
  if v_uid is null or new.user_id <> v_uid then
    raise exception 'Comment must be posted as yourself';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.username is not null and btrim(p.username) <> ''
  ) then
    raise exception 'Complete your profile before commenting';
  end if;

  if not exists (
    select 1 from public.builds b where b.id = new.build_id and b.status = 'approved'
  ) then
    raise exception 'Comments are only allowed on approved builds';
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.build_comments where id = new.parent_id;
    if not found then
      raise exception 'Parent comment not found';
    end if;
    if v_parent.build_id <> new.build_id then
      raise exception 'Reply must be on the same build as its parent';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'Replies can only be one level deep';
    end if;
    if v_parent.deleted_at is not null then
      raise exception 'Cannot reply to a deleted comment';
    end if;
  end if;

  select count(*) into v_recent
  from public.build_comments c
  where c.user_id = v_uid and c.created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'Slow down — try again in a few minutes';
  end if;

  new.body       := btrim(new.body);
  new.created_at := now();
  new.edited_at  := null;
  new.deleted_at := null;
  return new;
end;
$$;


ALTER FUNCTION "public"."build_comments_guard_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_comments_guard_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid   uuid    := auth.uid();
  v_owner boolean := (v_uid is not null and v_uid = old.user_id);
  v_admin boolean := public.is_admin();
begin
  if new.id         <> old.id
  or new.build_id   <> old.build_id
  or new.user_id    <> old.user_id
  or new.created_at <> old.created_at
  or new.parent_id is distinct from old.parent_id then
    raise exception 'Cannot move a comment';
  end if;

  if old.deleted_at is not null then
    raise exception 'Comment is deleted';
  end if;

  if new.body <> old.body then
    if not v_owner then
      raise exception 'Only the author can edit a comment';
    end if;
    new.body      := btrim(new.body);
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  if new.deleted_at is not null then
    if not (v_owner or v_admin) then
      raise exception 'Not allowed to delete this comment';
    end if;
    new.deleted_at := now();
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."build_comments_guard_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cascade_builder_agreement_to_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.content_license_confirmed then
    perform set_config('app.bypass_consent_guard', 'true', true);
    update public.profiles
    set builder_agreement_accepted = true,
        builder_agreement_version = new.builder_agreement_version,
        builder_agreement_accepted_at = new.confirmed_at
    where id = new.user_id
      and builder_agreement_accepted = false;
    perform set_config('app.bypass_consent_guard', 'false', true);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."cascade_builder_agreement_to_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."contest_build_part"("p_build_id" "uuid", "p_part_index" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  target_idx int;
  uid uuid := auth.uid();
  v_pid text;
begin
  if uid is null then
    raise exception 'must be signed in to flag';
  end if;
  if p_part_index is null or p_part_index < 0 then
    raise exception 'contest_build_part: part index must be 0 or more';   -- jsonb -> -1 reads from the end
  end if;

  select b.parts_snapshot -> p_part_index ->> 'partId' into v_pid
    from public.builds b where b.id = p_build_id;

  insert into public.build_part_flags (build_id, part_index, part_id, user_id)
  values (p_build_id, p_part_index, v_pid, uid)
  on conflict (build_id, part_index, user_id) do nothing;

  select (ord - 1) into target_idx
  from public.builds b, jsonb_array_elements(b.edit_history) with ordinality as e(elem, ord)
  where b.id = p_build_id
    and b.status = 'approved'
    and case when (e.elem ->> 'part_id') ~ '^[0-9a-f]{12}$'
             then (e.elem ->> 'part_id') = v_pid
             else (e.elem ->> 'part_index') ~ '^[0-9]+$' and (e.elem ->> 'part_index')::int = p_part_index
        end
  order by ord desc
  limit 1;

  if target_idx is null then
    return;
  end if;

  update public.builds
  set edit_history = jsonb_set(edit_history, array[target_idx::text, 'status'], '"contested"'::jsonb)
  where id = p_build_id and status = 'approved';
end;
$_$;


ALTER FUNCTION "public"."contest_build_part"("p_build_id" "uuid", "p_part_index" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_product"("p_product" "jsonb", "p_variants" "jsonb", "p_specs" "jsonb" DEFAULT NULL::"jsonb", "p_fits" "jsonb" DEFAULT NULL::"jsonb", "p_build_id" "uuid" DEFAULT NULL::"uuid", "p_part_index" integer DEFAULT NULL::integer, "p_dry_run" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  c_awin_affid   constant text   := '2959345';   -- Gunforma's Awin publisher id; public, it is in every live link
  c_product_keys constant text[] := array['brand','name','category','platforms','slug','url','description','family','material','material_family','fitment_notes','build_warning','build_notes','weight_oz','fitment_confidence','internal_notes','part_type','restricted_states'];
  c_variant_keys constant text[] := array['color','finish','sku','upc','msrp','image_url','gallery','variant_label','optic_cut','handedness','notes','is_default','manual_safety_variant','reticle','reticle_color','battery_type','mount_system','bundle','clamp_style','clamp_rail_type','clamp','partner_slug','url','affiliate_url','links','use_in_build'];
  c_link_keys    constant text[] := array['partner_slug','url','affiliate_url','op_mpn','op_gtin','op_merchant_product_id','notes'];
  -- the 50 states and DC, as USPS writes them: what products.restricted_states
  -- may hold (the table's products_restricted_states_codes CHECK is the same list)
  c_state_codes  constant text[] := array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
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
  v_allowed text;
  v_states text[];
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

  -- Capacity-restricted states: the two-letter codes of states this part
  -- cannot ship to, on any category (a 20-round magazine today). Upper-cased
  -- and de-duplicated; anything that is not one of the 50 states or DC is
  -- refused by name. An empty list is no restriction at all (NULL).
  if p ? 'restricted_states' then
    if jsonb_typeof(p->'restricted_states') <> 'array' then
      raise exception 'create_product: restricted_states must be a list of two-letter US state codes, e.g. ["CA", "NY"]';
    end if;
    v_states := array(select distinct upper(btrim(x)) from jsonb_array_elements_text(p->'restricted_states') x
                       where btrim(x) <> '' order by 1);
    select string_agg(x, ', ' order by x) into v_bad from unnest(v_states) x where x <> all (c_state_codes);
    if v_bad is not null then
      raise exception 'create_product: restricted_states: % is not a US state. Use the two-letter postal codes (CA, NY, …), or DC.', v_bad;
    end if;
    if cardinality(v_states) = 0 then v_states := null; end if;
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
                               fitment_notes, build_warning, build_notes, weight_oz, fitment_confidence, part_type, restricted_states)
  values (v_slug, v_category, v_brand_id, v_name, p->>'family', p->>'url', p->>'description', p->>'material', p->>'material_family',
          p->>'fitment_notes', p->>'build_warning', p->>'build_notes', (p->>'weight_oz')::numeric, 'unverified', btrim(p->>'part_type'), v_states)
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

    -- a sight's three fixed lists. Checked here so an admin reads the
    -- allowed values, not the name of a sight_specs CHECK constraint. The
    -- same lists are those CHECKs (supabase/add_categories.sql) and
    -- SIGHT_CHOICES in gunforma-admin-part.html; change all three together.
    if v_category::text = 'sight' then
      foreach v_key in array array['sight_position', 'height', 'sight_type'] loop
        v_allowed := case v_key when 'sight_position' then 'front, rear, set'
                                when 'height'         then 'standard, suppressor'
                                else                       'night, fiber, night-fiber, plain' end;
        if s ? v_key and not (s->>v_key = any (string_to_array(v_allowed, ', '))) then
          raise exception 'create_product: a sight''s % must be one of: %. "%" is not one of them.',
            case v_key when 'sight_position' then 'position' when 'height' then 'height' else 'type' end,
            v_allowed, s->>v_key;
        end if;
      end loop;
    end if;

    -- a magazine's style is one of three, and its capacity is a count of
    -- rounds. Both refused here in words; the style list is also
    -- magazine_specs' CHECK and MAG_CHOICES in gunforma-admin-part.html.
    -- Compared as text so nothing here casts 'magazine' to the enum.
    if v_category::text = 'magazine' then
      if s ? 'mag_style' and not (s->>'mag_style' = any (array['Flush', 'Finger Extension', 'Extended'])) then
        raise exception 'create_product: a magazine''s style must be one of: Flush, Finger Extension, Extended. "%" is not one of them.', s->>'mag_style';
      end if;
      if s ? 'capacity' and not ((s->>'capacity') ~ '^[1-9][0-9]*$') then
        raise exception 'create_product: a magazine''s capacity is a whole number of rounds, as the maker states it ("17"). "%" is not one.', s->>'capacity';
      end if;
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
         or (v_category::text = 'magazine' and v_key = 'frames')
         or (v_category = 'frame'   and v_key = 'magwells')) then
      raise exception 'create_product: fits-with rule "%" does not apply to a %. (light: light_compatibility; optic: adapter_footprints; barrel: slides; slide: barrels; magwell: frames; magazine: frames; frame: magwells)', v_key, v_category;
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
        elsif v_category::text = 'magazine' then
          -- a magazine's frames: its own table, the same shape as a magwell's
          insert into public.magazine_frame_requirements (magazine_product_id, frame_product_id, source, compatibility_note)
          values (v_product_id, v_other_id, coalesce(l->>'source', 'manufacturer'), l->>'compatibility_note');
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
    'restricted_states', to_jsonb(v_states),
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
$_$;


ALTER FUNCTION "public"."create_product"("p_product" "jsonb", "p_variants" "jsonb", "p_specs" "jsonb", "p_fits" "jsonb", "p_build_id" "uuid", "p_part_index" integer, "p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_product"("p_product" "jsonb", "p_variants" "jsonb", "p_specs" "jsonb", "p_fits" "jsonb", "p_build_id" "uuid", "p_part_index" integer, "p_dry_run" boolean) IS 'Admin / service_role only. Creates one product in one transaction: brand (found or created), product, platforms, spec sheet (keys from spec_field_rules; a sight''s three lists and a magazine''s style and capacity refused in words), variants with photos and retailer links (Awin links built), fits-with rules (magazine: frames), restricted_states (two-letter codes, checked), and optionally re-links a build''s pending custom part. Returns product_data_status(); p_dry_run raises P0DRY with the result in DETAIL.';



CREATE OR REPLACE FUNCTION "public"."create_variant"("p_product_slug" "text", "p_color" "text", "p_finish" "text" DEFAULT NULL::"text", "p_sku" "text" DEFAULT NULL::"text", "p_upc" "text" DEFAULT NULL::"text", "p_msrp" numeric DEFAULT NULL::numeric, "p_image_url" "text" DEFAULT NULL::"text", "p_partner_slug" "text" DEFAULT NULL::"text", "p_url" "text" DEFAULT NULL::"text", "p_affiliate_url" "text" DEFAULT NULL::"text", "p_street_price" numeric DEFAULT NULL::numeric, "p_in_stock" boolean DEFAULT NULL::boolean, "p_variant_label" "text" DEFAULT NULL::"text", "p_optic_cut" "text" DEFAULT NULL::"text", "p_handedness" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_make_default" boolean DEFAULT NULL::boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_product_id uuid; v_variant_id uuid; v_partner_id uuid;
  v_slug text; v_base_slug text; v_n int := 1; v_is_default boolean;
begin
  if not (public.is_admin() or public.is_trusted_backend()) then
    raise exception 'create_variant: admin or service_role only' using errcode = '42501';
  end if;
  select id into v_product_id from public.products where slug = p_product_slug;
  if v_product_id is null then
    raise exception 'create_variant: no product with slug "%"', p_product_slug using errcode = 'foreign_key_violation';
  end if;
  if p_color is null or btrim(p_color) = '' then
    raise exception 'create_variant: color is required';
  end if;
  if not exists (select 1 from public.colors c where c.color = p_color) then
    raise exception 'create_variant: "%" is not in public.colors. Add it there first (with a color_family) so the filter stays clean.',
      p_color using errcode = 'foreign_key_violation';
  end if;
  if (p_url is not null) <> (p_partner_slug is not null) then
    raise exception 'create_variant: p_url and p_partner_slug must be supplied together';
  end if;
  if p_partner_slug is not null then
    select id into v_partner_id from public.partners where slug = p_partner_slug;
    if v_partner_id is null then
      raise exception 'create_variant: no partner with slug "%"', p_partner_slug using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- slug: <product-slug>-<color>[-<finish>], de-duped with -2, -3 ...
  v_base_slug := public.slugify(p_product_slug || '-' || p_color || coalesce('-' || p_finish, ''));
  v_slug := v_base_slug;
  while exists (select 1 from public.product_variants where slug = v_slug) loop
    v_n := v_n + 1; v_slug := v_base_slug || '-' || v_n;
  end loop;

  -- first variant of a product becomes the default
  v_is_default := coalesce(p_make_default,
    not exists (select 1 from public.product_variants where product_id = v_product_id and is_default));
  if v_is_default then
    update public.product_variants set is_default = false where product_id = v_product_id and is_default;
  end if;

  insert into public.product_variants
    (slug, product_id, color, finish, sku, upc, msrp, is_default, primary_image_url, variant_label, optic_cut, handedness, notes)
  values
    (v_slug, v_product_id, p_color, p_finish, p_sku, p_upc, p_msrp, v_is_default, p_image_url,
     coalesce(p_variant_label, p_color || coalesce(' · ' || p_finish, '')), p_optic_cut, p_handedness, p_notes)
  returning id into v_variant_id;

  if p_image_url is not null then
    insert into public.variant_images (variant_id, url, position, alt_text)
    values (v_variant_id, p_image_url, 1,
            (select name from public.products where id = v_product_id) || ' — ' || p_color || coalesce(' ' || p_finish, ''));
  end if;

  -- price_history row is written by the existing record_price_change trigger
  if p_url is not null then
    insert into public.affiliate_links (variant_id, partner_id, url, affiliate_url, street_price, in_stock, last_checked)
    values (v_variant_id, v_partner_id, p_url, p_affiliate_url, p_street_price, p_in_stock,
            case when p_street_price is not null or p_in_stock is not null then current_date end);
  end if;

  return v_variant_id;
end;
$$;


ALTER FUNCTION "public"."create_variant"("p_product_slug" "text", "p_color" "text", "p_finish" "text", "p_sku" "text", "p_upc" "text", "p_msrp" numeric, "p_image_url" "text", "p_partner_slug" "text", "p_url" "text", "p_affiliate_url" "text", "p_street_price" numeric, "p_in_stock" boolean, "p_variant_label" "text", "p_optic_cut" "text", "p_handedness" "text", "p_notes" "text", "p_make_default" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_variant"("p_product_slug" "text", "p_color" "text", "p_finish" "text", "p_sku" "text", "p_upc" "text", "p_msrp" numeric, "p_image_url" "text", "p_partner_slug" "text", "p_url" "text", "p_affiliate_url" "text", "p_street_price" numeric, "p_in_stock" boolean, "p_variant_label" "text", "p_optic_cut" "text", "p_handedness" "text", "p_notes" "text", "p_make_default" boolean) IS 'Admin-only. Creates a product variant + primary image + affiliate link in one atomic call. Enforces colors vocab, slug format, one-default-per-product.';



CREATE OR REPLACE FUNCTION "public"."create_variants_for_product"("p_product_id" "uuid", "p_product_slug" "text", "p_variants" "jsonb", "p_caller" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."create_variants_for_product"("p_product_id" "uuid", "p_product_slug" "text", "p_variants" "jsonb", "p_caller" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_build_photo_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (select count(*) from public.build_photos where build_id = new.build_id) >= 4 then
    raise exception 'A build can have at most 4 photos';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_build_photo_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profile"() RETURNS TABLE("id" "uuid", "username" "text", "onboarding_complete" boolean, "role" "text", "marketing_consent" boolean, "builder_agreement_accepted" boolean, "builder_agreement_accepted_at" timestamp with time zone, "builder_agreement_version" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id,
         p.username,
         p.onboarding_complete,
         p.role,
         p.marketing_consent,
         p.builder_agreement_accepted,
         p.builder_agreement_accepted_at,
         p.builder_agreement_version
  from public.profiles p
  where p.id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_profile"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_my_profile"() IS 'Returns the calling user''s own profile row only, including columns not readable table-wide. Hard-scoped to auth.uid(); takes no arguments so it cannot be aimed at another user.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, username, marketing_consent, onboarding_complete)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    CASE 
      WHEN new.raw_user_meta_data ->> 'username' IS NOT NULL THEN true
      ELSE false
    END
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_trusted_backend"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case
    -- A PostgREST request. Decide only on the role claim.
    when nullif(current_setting('request.jwt.claims', true), '') is not null
      then (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
    -- No request context: a direct database session (psql, the SQL editor,
    -- the MCP connection), which is superuser-ish by definition.
    -- session_user, NOT current_user: SECURITY DEFINER rewrites current_user
    -- to the function owner and would make this true for every caller.
    else session_user in ('postgres', 'supabase_admin')
  end;
$$;


ALTER FUNCTION "public"."is_trusted_backend"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_trusted_backend"() IS 'True for the service_role key, or a direct superuser database session. A PostgREST request is judged solely by its JWT role claim, so anon/authenticated can never reach the superuser branch. Never use current_user here: SECURITY DEFINER rewrites it to the owner.';



CREATE OR REPLACE FUNCTION "public"."jsonb_strip_blank"("j" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  -- Anything that is not an object — SQL NULL, JSON null, an array, a string —
  -- is an empty section. jsonb_each() raises on a non-object, and a form or a
  -- PostgREST caller can send JSON null for a section it left out.
  select case when jsonb_typeof(j) = 'object'
              then coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(j) e
                              where e.value not in ('""'::jsonb, 'null'::jsonb, '[]'::jsonb)), '{}'::jsonb)
              else '{}'::jsonb end;
$$;


ALTER FUNCTION "public"."jsonb_strip_blank"("j" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notifications_guard_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.read_at is null and old.read_at is not null then
    raise exception 'Cannot mark a notification unread';
  end if;
  if new.read_at is not null then
    new.read_at := coalesce(old.read_at, now());
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notifications_guard_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_build_approved"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.user_id is not null then
    insert into public.notifications (user_id, actor_id, kind, build_id)
    values (new.user_id, null, 'approved', new.id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_build_approved"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_build_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_hist jsonb := coalesce(new.edit_history, '[]'::jsonb);
  v_len int;
  v_from int;
  v_e jsonb;
  v_lines text[] := '{}';
  v_text text;
  v_preview text;
begin
  if tg_op = 'INSERT' then
    if not public.is_trusted_backend() then
      new.changes_notified_count := 0;
    end if;
    return new;
  end if;
  if jsonb_typeof(v_hist) <> 'array' then
    new.changes_notified_count := old.changes_notified_count;
    return new;
  end if;
  v_len := jsonb_array_length(v_hist);

  -- Only a reviewer or the backend moves the counter.
  if not (public.is_admin() or public.is_trusted_backend()) then
    new.changes_notified_count := old.changes_notified_count;
    return new;
  end if;

  -- Nobody to tell. Moving the counter means a build claimed later does
  -- not announce changes made before its builder had it.
  if new.user_id is null then
    new.changes_notified_count := v_len;
    return new;
  end if;

  -- Held until the build is live: the builder hears once, with the
  -- approval, not once per correction during review.
  if new.status is distinct from 'approved' then
    new.changes_notified_count := least(greatest(coalesce(old.changes_notified_count, 0), 0), v_len);
    return new;
  end if;

  v_from := least(greatest(coalesce(old.changes_notified_count, 0), 0), v_len);
  new.changes_notified_count := v_len;
  if v_from >= v_len then
    return new;
  end if;

  for v_e in
    select e from jsonb_array_elements(v_hist) with ordinality as t(e, ord)
     where ord > v_from order by ord
  loop
    continue when jsonb_typeof(v_e) <> 'object';
    if v_e ->> 'kind' in ('part_added', 'part_removed') then
      v_text := case when v_e ->> 'kind' = 'part_added' then 'Added ' else 'Removed ' end
        || coalesce(nullif(btrim(concat_ws(' ', v_e -> 'part' ->> 'brand', v_e -> 'part' ->> 'name')), ''), 'a part');
    elsif v_e ? 'field' and (v_e ? 'part_id' or v_e ? 'part_index') then
      v_text := 'Corrected the '
        || case v_e ->> 'field' when 'variant' then 'variant note' when 'category' then 'section' else v_e ->> 'field' end
        || case when coalesce(v_e ->> 'to_value', '') = '' then '' else ' to “' || (v_e ->> 'to_value') || '”' end;
    else
      continue;   -- the 'resubmit' marker, a contested flag, anything else
    end if;
    v_lines := v_lines || v_text;
  end loop;

  if coalesce(array_length(v_lines, 1), 0) = 0 then
    return new;
  end if;
  -- A reviewer changing their own build has nothing to be told.
  if auth.uid() is not distinct from new.user_id then
    return new;
  end if;

  v_preview := array_to_string(v_lines, ' · ');
  if length(v_preview) > 280 then
    v_preview := left(v_preview, 279) || '…';
  end if;

  insert into public.notifications (user_id, actor_id, kind, build_id, preview, email_sent_at)
  values (new.user_id, null, 'changes', new.id, v_preview, now());   -- see EMAIL above
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_build_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_on_comment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_owner  uuid;
  v_parent uuid;
  v_prev   text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 140);
begin
  select user_id into v_owner from public.builds where id = new.build_id and status = 'approved';
  if v_owner is null then return new; end if;

  if new.parent_id is not null then
    select user_id into v_parent from public.build_comments where id = new.parent_id;
    if v_parent is not null and v_parent <> new.user_id then
      insert into public.notifications (user_id, actor_id, kind, build_id, comment_id, preview)
      values (v_parent, new.user_id, 'reply', new.build_id, new.id, v_prev);
    end if;
    if v_owner <> new.user_id and v_owner is distinct from v_parent then
      insert into public.notifications (user_id, actor_id, kind, build_id, comment_id, preview)
      values (v_owner, new.user_id, 'comment', new.build_id, new.id, v_prev);
    end if;
  elsif v_owner <> new.user_id then
    insert into public.notifications (user_id, actor_id, kind, build_id, comment_id, preview)
    values (v_owner, new.user_id, 'comment', new.build_id, new.id, v_prev);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_on_comment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_on_like"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_owner uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.notifications
      where kind = 'like' and build_id = old.build_id and actor_id = old.user_id and read_at is null;
    return old;
  end if;
  select user_id into v_owner from public.builds where id = new.build_id and status = 'approved';
  if v_owner is null or v_owner = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, kind, build_id)
  values (v_owner, new.user_id, 'like', new.build_id)
  on conflict do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_on_like"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_build_consent_tampering"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (new.content_license_confirmed is distinct from old.content_license_confirmed
      or new.legal_confirmed is distinct from old.legal_confirmed
      or new.confirmed_at is distinct from old.confirmed_at
      or new.builder_agreement_version is distinct from old.builder_agreement_version)
     and not public.is_admin()
  then
    raise exception 'Consent fields cannot be edited after submission';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_build_consent_tampering"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_build_photo_path_tampering"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  jwt_role text;
begin
  begin
    jwt_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  exception when others then
    jwt_role := '';
  end;
  if (new.storage_path is distinct from old.storage_path
      or new.thumb_path  is distinct from old.thumb_path
      or new.build_id    is distinct from old.build_id
      or new.user_id     is distinct from old.user_id)
     and jwt_role <> 'service_role'
     and not public.is_admin()
  then
    raise exception 'storage_path, thumb_path, build_id, and user_id cannot be changed after upload';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_build_photo_path_tampering"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_owner_edit_history_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Admins log corrections; the service role and a direct session (the SQL
  -- editor, a migration) are trusted. See is_trusted_backend().
  if public.is_admin() or public.is_trusted_backend() then
    return new;
  end if;
  if new.edit_history is not distinct from old.edit_history then
    return new;
  end if;
  -- A flag: only statuses changed, only to 'contested', on a live build.
  if old.status = 'approved' and new.status = 'approved'
     and jsonb_typeof(old.edit_history) = 'array' and jsonb_typeof(new.edit_history) = 'array'
     and jsonb_array_length(old.edit_history) = jsonb_array_length(new.edit_history)
     and not exists (
       select 1
         from jsonb_array_elements(old.edit_history) with ordinality as o(oe, oi)
         join jsonb_array_elements(new.edit_history) with ordinality as n(ne, ni) on ni = oi
        where not (
          ne = oe
          or (jsonb_typeof(ne) = 'object' and jsonb_typeof(oe) = 'object'
              and (ne - 'status') = (oe - 'status')
              and ne ->> 'status' = 'contested')
        ))
  then
    return new;
  end if;
  raise exception 'Only admins can modify edit_history'
    using errcode = '42501';   -- insufficient_privilege
end;
$$;


ALTER FUNCTION "public"."prevent_owner_edit_history_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_role_self_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  jwt_role text;
begin
  -- The CALLER's role. Do NOT use current_user here: in a SECURITY DEFINER
  -- function it is the owner, which is exactly what broke this guard.
  jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );

  if jwt_role = 'service_role' or jwt_role = '' then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change role';
  end if;

  if (new.builder_agreement_accepted    is distinct from old.builder_agreement_accepted
      or new.builder_agreement_version     is distinct from old.builder_agreement_version
      or new.builder_agreement_accepted_at is distinct from old.builder_agreement_accepted_at)
     and not public.is_admin()
     and coalesce(current_setting('app.bypass_consent_guard', true), 'false') <> 'true'
     and not (new.id = auth.uid()
              and old.builder_agreement_accepted = false
              and new.builder_agreement_accepted = true)
  then
    raise exception 'Builder agreement fields can only be set by accepting the agreement or submitting a build';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_role_self_escalation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_data_status"("p_product_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."product_data_status"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_price_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into public.price_history
      (link_id, old_price, new_price, old_in_stock, new_in_stock)
    values
      (new.id, null, new.street_price, null, new.in_stock);

  elsif new.street_price is distinct from old.street_price
     or new.in_stock    is distinct from old.in_stock then
    insert into public.price_history
      (link_id, old_price, new_price, old_in_stock, new_in_stock)
    values
      (old.id, old.street_price, new.street_price, old.in_stock, new.in_stock);
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."record_price_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."relink_build_part"("p_build_id" "uuid", "p_part_index" integer, "p_product_id" "uuid", "p_variant_id" "uuid", "p_variant_specs" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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

  -- CHANGED (part_ids.sql): by the part's own id when the entry has one,
  -- else by position, as every entry used to be.
  select count(*) into v_corrections from jsonb_array_elements(v_history) e
   where case when (e->>'part_id') ~ '^[0-9a-f]{12}$'
              then (e->>'part_id') = (v_part->>'partId')
              else (e->>'part_index') ~ '^[0-9]+$' and (e->>'part_index')::int = p_part_index
         end;
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
$_$;


ALTER FUNCTION "public"."relink_build_part"("p_build_id" "uuid", "p_part_index" integer, "p_product_id" "uuid", "p_variant_id" "uuid", "p_variant_specs" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."relink_build_part"("p_build_id" "uuid", "p_part_index" integer, "p_product_id" "uuid", "p_variant_id" "uuid", "p_variant_specs" "text") IS 'Admin / service_role only. Swaps a build''s pending custom part (by its original index) for an existing catalog product and variant, as create_product()''s re-link does, plus variantSpecs when given. A part stored under misc (Other Parts) takes the product''s category. Refuses a part that is not pending or carries corrections.';



CREATE OR REPLACE FUNCTION "public"."restrict_build_status_to_reviewers"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  -- IS DISTINCT FROM, not NOT IN: status is NOT NULL today, but `x not in
  -- (...)` is NULL for a NULL x and an IF treats NULL as false, which would
  -- make a guard that passes exactly the value nobody thought about.
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' and new.status is distinct from 'pending' then
      raise exception 'A new build starts as a draft or goes into review. Only a reviewer can approve or reject it.'
        using errcode = '42501';   -- insufficient_privilege -> HTTP 403
    end if;
  elsif new.status is distinct from old.status
        and new.status is distinct from 'draft'
        and new.status is distinct from 'pending' then
    raise exception 'Only a reviewer can approve or reject a build.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."restrict_build_status_to_reviewers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restrict_owner_edits_on_approved_build"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare claims text; jwt_role text;
begin
  claims := current_setting('request.jwt.claims', true);
  -- NULL on a direct SQL connection, which already requires credentials
  -- nobody but the owner holds. This guard is for API callers.
  if claims is null then return new; end if;
  begin jwt_role := coalesce(claims::jsonb ->> 'role',''); exception when others then jwt_role := ''; end;

  if old.status = 'approved' and jwt_role <> 'service_role' and not public.is_admin() then
    if new.platform_id is distinct from old.platform_id
       or new.gun_id is distinct from old.gun_id
       or new.fcu_only is distinct from old.fcu_only
       or new.parts_snapshot is distinct from old.parts_snapshot
       or new.status is distinct from old.status
       or new.tier is distinct from old.tier
       or new.user_id is distinct from old.user_id
       or new.legal_confirmed is distinct from old.legal_confirmed
       or new.content_license_confirmed is distinct from old.content_license_confirmed
       or new.builder_agreement_version is distinct from old.builder_agreement_version
       or new.confirmed_at is distinct from old.confirmed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.created_at is distinct from old.created_at
    then
      raise exception 'On a live build you can change the name, description and activity. To change the gun itself, delete this build and post the new one.';
    end if;
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."restrict_owner_edits_on_approved_build"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."retire_links_with_variant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.retired_at is not null and old.retired_at is null then
    update public.affiliate_links
       set retired_at = new.retired_at
     where variant_id = new.id
       and retired_at is null;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."retire_links_with_variant"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."retire_links_with_variant"() IS 'Retires a variant''s affiliate_links when the variant is retired. Only ever sets retired_at; never clears it.';



CREATE OR REPLACE FUNCTION "public"."set_part_class"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_len numeric(4,2);
  v_kind text;
  v_class text;
  v_platform text;
begin
  if tg_table_name = 'slide_specs' then
    v_len := new.slide_length_in; v_kind := 'slide';
  else
    v_len := new.barrel_length_in; v_kind := 'barrel';
  end if;

  -- No length yet: nothing to look up, leave the class empty.
  if v_len is null then
    if tg_table_name = 'slide_specs' then new.slide_class := null;
    else new.barrel_class := null; end if;
    return new;
  end if;

  select ppl.part_class into v_class
  from platform_part_lengths ppl
  where ppl.platform_id = new.platform_id
    and ppl.part_kind = v_kind
    and ppl.length_in = v_len;

  if v_class is null then
    select name into v_platform from platforms where id = new.platform_id;
    raise exception
      'No % class registered for platform "%" at % in. Add a row to platform_part_lengths first (Runbook Step 1).',
      v_kind, coalesce(v_platform,'unknown'), v_len
      using errcode = 'foreign_key_violation';
  end if;

  if tg_table_name = 'slide_specs' then new.slide_class := v_class;
  else new.barrel_class := v_class; end if;
  return new;
end $$;


ALTER FUNCTION "public"."set_part_class"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."slugify"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  select trim(both '-' from regexp_replace(regexp_replace(lower(p_text), '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g'));
$$;


ALTER FUNCTION "public"."slugify"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_build_consent"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.content_license_confirmed or new.legal_confirmed then
    new.confirmed_at := now();
  else
    new.confirmed_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."stamp_build_consent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_build_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  if new.status = 'pending' and old.status in ('approved','rejected') then
    if old.status = 'rejected' and not public.is_admin() then
      new.edit_history := coalesce(old.edit_history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'kind', 'resubmit',
          'resubmit', true,
          'at', now(),
          'from_status', old.status,
          'previous_rejection_reason', old.rejection_reason,
          'previous_reviewed_at', old.reviewed_at,
          'previous_reviewed_by', old.reviewed_by
        )
      );
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.rejection_reason := null;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."stamp_build_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."url_encode"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $_$
  select coalesce(string_agg(
    case when ch ~ '^[A-Za-z0-9_.~-]$' then ch
         else upper(regexp_replace(encode(convert_to(ch, 'UTF8'), 'hex'), '(..)', '%\1', 'g')) end,
    '' order by ord), '')
  from regexp_split_to_table(p, '') with ordinality as t(ch, ord);
$_$;


ALTER FUNCTION "public"."url_encode"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."variant_identity"("p_color" "text", "p_finish" "text", "p_optic_cut" "text", "p_handedness" "text", "p_manual_safety" boolean, "p_reticle" "text", "p_reticle_color" "text", "p_battery_type" "text", "p_mount_system" "text", "p_bundle" "text", "p_clamp" "text", "p_clamp_style" "text", "p_clamp_rail_type" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."variant_identity"("p_color" "text", "p_finish" "text", "p_optic_cut" "text", "p_handedness" "text", "p_manual_safety" boolean, "p_reticle" "text", "p_reticle_color" "text", "p_battery_type" "text", "p_mount_system" "text", "p_bundle" "text", "p_clamp" "text", "p_clamp_style" "text", "p_clamp_rail_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."with_part_ids"("p_new" "jsonb", "p_old" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  v_out      jsonb  := '[]'::jsonb;
  v_reserved text[] := '{}';   -- valid ids NEW already carries (first use of each)
  v_used     text[] := '{}';   -- ids handed out so far, in this call
  v_el jsonb; v_old jsonb; v_id text; i int; j int;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'array' then
    return p_new;
  end if;

  -- First pass: the ids NEW already has. A part that brought its own id must
  -- keep it, so no other part may be given it in the second pass.
  for i in 0 .. jsonb_array_length(p_new) - 1 loop
    v_id := p_new -> i ->> 'partId';
    if jsonb_typeof(p_new -> i) = 'object' and v_id ~ '^[0-9a-f]{12}$' and not v_id = any (v_reserved) then
      v_reserved := v_reserved || v_id;
    end if;
  end loop;

  for i in 0 .. jsonb_array_length(p_new) - 1 loop
    v_el := p_new -> i;
    if jsonb_typeof(v_el) <> 'object' then
      v_out := v_out || jsonb_build_array(v_el);
      continue;
    end if;

    v_id := v_el ->> 'partId';
    -- Its own valid id, first time it is seen: kept.
    if v_id ~ '^[0-9a-f]{12}$' and not v_id = any (v_used) then
      v_used := v_used || v_id;
      v_out  := v_out || jsonb_build_array(v_el);
      continue;
    end if;

    -- No id (or an invalid or duplicate one). An identical part on OLD gives
    -- it that part's id, if nothing else here has it.
    v_id := null;
    if jsonb_typeof(p_old) = 'array' then
      for j in 0 .. jsonb_array_length(p_old) - 1 loop
        v_old := p_old -> j;
        if jsonb_typeof(v_old) = 'object'
           and (v_old ->> 'partId') ~ '^[0-9a-f]{12}$'
           and not (v_old ->> 'partId') = any (v_reserved)
           and not (v_old ->> 'partId') = any (v_used)
           and (v_old - 'partId') = (v_el - 'partId') then
          v_id := v_old ->> 'partId';
          exit;
        end if;
      end loop;
    end if;

    -- Otherwise a new one.
    while v_id is null or v_id = any (v_reserved) or v_id = any (v_used) loop
      v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    end loop;

    v_used := v_used || v_id;
    v_out  := v_out || jsonb_build_array(v_el || jsonb_build_object('partId', v_id));
  end loop;

  return v_out;
end;
$_$;


ALTER FUNCTION "public"."with_part_ids"("p_new" "jsonb", "p_old" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_archive_products_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "specs" "jsonb" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."_archive_products_specs" OWNER TO "postgres";


COMMENT ON TABLE "public"."_archive_products_specs" IS 'Archive of the retired products.specs jsonb column (migration 001). Safe to drop after one release cycle.';



CREATE TABLE IF NOT EXISTS "public"."adapter_part_types" (
    "part_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."adapter_part_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."adapter_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "brand_id" "uuid",
    "sku_or_source" "text",
    "part_type" "text" NOT NULL,
    "light_product_id" "uuid",
    "fits_lights_text" "text",
    "enables" "text",
    "approx_price_low" numeric(10,2),
    "approx_price_high" numeric(10,2),
    "notes" "text",
    CONSTRAINT "adapter_price_order" CHECK ((("approx_price_high" IS NULL) OR ("approx_price_low" IS NULL) OR ("approx_price_high" >= "approx_price_low"))),
    CONSTRAINT "adapter_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text"))
);


ALTER TABLE "public"."adapter_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "variant_id" "uuid" NOT NULL,
    "partner_id" "uuid",
    "url" "text" NOT NULL,
    "affiliate_url" "text",
    "street_price" numeric(10,2),
    "in_stock" boolean,
    "last_checked" "date",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "op_mpn" "text",
    "op_gtin" "text",
    "op_merchant_product_id" "text",
    "op_last_matched_by" "text",
    "retired_at" timestamp with time zone,
    CONSTRAINT "affiliate_street_price_positive" CHECK ((("street_price" IS NULL) OR ("street_price" >= (0)::numeric)))
);


ALTER TABLE "public"."affiliate_links" OWNER TO "postgres";


COMMENT ON COLUMN "public"."affiliate_links"."op_mpn" IS 'MPN as reported by the vendor feed. May differ from product_variants.sku when the vendor uses their own SKU normalization. Captured on match; not authoritative.';



COMMENT ON COLUMN "public"."affiliate_links"."op_gtin" IS 'GTIN/EAN/UPC as reported by the vendor feed. Leading zeros preserved from feed.';



COMMENT ON COLUMN "public"."affiliate_links"."op_merchant_product_id" IS 'Vendor internal product ID (e.g. OpticsPlanet numeric product ID).';



COMMENT ON COLUMN "public"."affiliate_links"."op_last_matched_by" IS 'How this row was matched to the feed last run. Values: stored_op_mpn, stored_op_gtin, url+mpn, url+gtin, url_only, strict_id_only, fuzzy_mpn_needs_review.';



COMMENT ON COLUMN "public"."affiliate_links"."retired_at" IS 'When this listing stopped being offered. Retired links keep their price_history, are skipped by the nightly sync, and are hidden from buy rows. Never hard-delete a link.';



CREATE TABLE IF NOT EXISTS "public"."affiliate_links_is_primary_archive" (
    "link_id" "uuid" NOT NULL,
    "archived_at" timestamp with time zone
);


ALTER TABLE "public"."affiliate_links_is_primary_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."barrel_slide_requirements" (
    "barrel_product_id" "uuid" NOT NULL,
    "slide_product_id" "uuid" NOT NULL,
    "source" "text",
    "compatibility_note" "text"
);


ALTER TABLE "public"."barrel_slide_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."barrel_slide_requirements" IS 'Whitelist. If a barrel has ANY row here, it fits ONLY those slides.';



COMMENT ON COLUMN "public"."barrel_slide_requirements"."compatibility_note" IS 'User-facing text explaining why this barrel+slide pairing works or what to be aware of.';



CREATE TABLE IF NOT EXISTS "public"."barrel_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'barrel'::"public"."product_category" NOT NULL,
    "barrel_length_in" numeric(3,1) NOT NULL,
    "caliber" "text" DEFAULT '9mm'::"text" NOT NULL,
    "barrel_type" "public"."barrel_type" NOT NULL,
    "thread_pitch" "text",
    "port_style" "text",
    "is_lci" boolean,
    "ballistic_loss" "text",
    "requires_slide_text" "text",
    "pairs_with_comp_id" "uuid",
    "platform_id" "uuid" NOT NULL,
    "barrel_class" "text",
    CONSTRAINT "barrel_length_valid" CHECK (("barrel_length_in" = ANY (ARRAY[3.1, 3.7, 4.3]))),
    CONSTRAINT "barrel_specs_category" CHECK (("category" = 'barrel'::"public"."product_category")),
    CONSTRAINT "barrel_thread_consistency" CHECK ((("barrel_type" <> ALL (ARRAY['threaded'::"public"."barrel_type", 'threaded-and-ported'::"public"."barrel_type"])) OR ("thread_pitch" IS NOT NULL)))
);


ALTER TABLE "public"."barrel_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."basepad_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'basepad'::"public"."product_category" NOT NULL,
    "basepad_type" "text",
    "fits_mag_type" "text",
    "capacity_change" integer DEFAULT 0
);


ALTER TABLE "public"."basepad_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."basepad_types" (
    "basepad_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."basepad_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."build_comment_votes" (
    "comment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "value" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "build_comment_votes_value_check" CHECK (("value" = ANY (ARRAY['-1'::integer, 1])))
);


ALTER TABLE "public"."build_comment_votes" OWNER TO "postgres";


COMMENT ON TABLE "public"."build_comment_votes" IS 'One vote per user per comment, +1 or -1. Who voted is private; only the sum is exposed, via build_comments_public.';



CREATE TABLE IF NOT EXISTS "public"."build_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "build_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "build_comments_body_len" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 2000)))
);


ALTER TABLE "public"."build_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."build_comments" IS 'Comments on approved builds, one level of replies. Soft-deleted via deleted_at. Read through build_comments_public, never directly.';



CREATE TABLE IF NOT EXISTS "public"."builds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "platform_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "tier" "text" DEFAULT 'minimum'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "activities" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "description" "text",
    "rejection_reason" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "content_license_confirmed" boolean DEFAULT false NOT NULL,
    "legal_confirmed" boolean DEFAULT false NOT NULL,
    "confirmed_at" timestamp with time zone,
    "builder_agreement_version" "text",
    "parts_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "edit_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "gun_id" "uuid",
    "fcu_only" boolean DEFAULT false NOT NULL,
    "changes_notified_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "builds_builder_agreement_version_not_blank" CHECK ((("builder_agreement_version" IS NULL) OR ("length"("builder_agreement_version") > 0))),
    CONSTRAINT "builds_consent_required_unless_draft" CHECK ((("status" = 'draft'::"text") OR ("content_license_confirmed" AND "legal_confirmed"))),
    CONSTRAINT "builds_fcu_xor_gun" CHECK ((NOT ("fcu_only" AND ("gun_id" IS NOT NULL)))),
    CONSTRAINT "builds_parts_snapshot_is_array" CHECK (("jsonb_typeof"("parts_snapshot") = 'array'::"text")),
    CONSTRAINT "builds_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "builds_tier_check" CHECK (("tier" = ANY (ARRAY['minimum'::"text", 'full'::"text"])))
);


ALTER TABLE "public"."builds" OWNER TO "postgres";


COMMENT ON COLUMN "public"."builds"."edit_history" IS 'Append-only admin correction log. Each entry: {part_index, field, from_value, to_value, edited_by, edited_at, status: active|contested}. Never overwrite parts_snapshot.';



COMMENT ON COLUMN "public"."builds"."gun_id" IS 'Which factory model this build is (guns.id). NULL = not asked, not listed, or an FCU build (see fcu_only). Must belong to platform_id — builds_gun_fkey is composite.';



COMMENT ON COLUMN "public"."builds"."fcu_only" IS 'TRUE = built from a bare fire control unit: no factory slide, barrel or grip module to assume. Never true together with a gun_id (builds_fcu_xor_gun).';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text",
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "marketing_consent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "builder_agreement_accepted" boolean DEFAULT false NOT NULL,
    "builder_agreement_version" "text",
    "builder_agreement_accepted_at" timestamp with time zone,
    "onboarding_complete" boolean DEFAULT false NOT NULL,
    "bio" "text",
    "avatar_url" "text",
    "instagram_url" "text",
    "youtube_url" "text",
    "email_notifications" boolean DEFAULT true NOT NULL,
    CONSTRAINT "builder_agreement_version_not_blank" CHECK ((("builder_agreement_version" IS NULL) OR ("length"("builder_agreement_version") > 0))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text"]))),
    CONSTRAINT "profiles_username_check" CHECK (("username" ~ '^[a-zA-Z0-9_]{3,24}$'::"text"))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."build_comments_public" AS
 SELECT "c"."id",
    "c"."build_id",
    "c"."parent_id",
    "c"."user_id",
        CASE
            WHEN ("c"."deleted_at" IS NULL) THEN "c"."body"
            ELSE NULL::"text"
        END AS "body",
    "c"."created_at",
    "c"."edited_at",
    ("c"."deleted_at" IS NOT NULL) AS "is_deleted",
    "p"."username",
    "p"."avatar_url",
    ( SELECT ("count"(*))::integer AS "count"
           FROM "public"."builds" "b"
          WHERE (("b"."user_id" = "c"."user_id") AND ("b"."status" = 'approved'::"text"))) AS "author_build_count",
    COALESCE(( SELECT ("sum"("v"."value"))::integer AS "sum"
           FROM "public"."build_comment_votes" "v"
          WHERE ("v"."comment_id" = "c"."id")), 0) AS "score",
    ( SELECT "v"."value"
           FROM "public"."build_comment_votes" "v"
          WHERE (("v"."comment_id" = "c"."id") AND ("v"."user_id" = "auth"."uid"()))) AS "my_vote"
   FROM ("public"."build_comments" "c"
     JOIN "public"."profiles" "p" ON (("p"."id" = "c"."user_id")))
  WHERE (EXISTS ( SELECT 1
           FROM "public"."builds" "b"
          WHERE (("b"."id" = "c"."build_id") AND ("b"."status" = 'approved'::"text"))));


ALTER VIEW "public"."build_comments_public" OWNER TO "postgres";


COMMENT ON VIEW "public"."build_comments_public" IS 'Public read model for build comments. Owner-run on purpose: sums votes without exposing them and enforces approved-builds-only itself.';



CREATE TABLE IF NOT EXISTS "public"."build_fires" (
    "build_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."build_fires" OWNER TO "postgres";


COMMENT ON TABLE "public"."build_fires" IS 'Community "fires" (likes) per build. Composite PK enforces one fire per user per build.';



CREATE TABLE IF NOT EXISTS "public"."build_part_flags" (
    "id" bigint NOT NULL,
    "build_id" "uuid" NOT NULL,
    "part_index" integer NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "part_id" "text"
);


ALTER TABLE "public"."build_part_flags" OWNER TO "postgres";


ALTER TABLE "public"."build_part_flags" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."build_part_flags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."build_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "build_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "is_hero" boolean DEFAULT false NOT NULL,
    "position" smallint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "thumb_path" "text" NOT NULL,
    CONSTRAINT "build_photos_position_check" CHECK (("position" > 0))
);


ALTER TABLE "public"."build_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calibers" (
    "caliber" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."calibers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clamp_styles" (
    "clamp_style" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."clamp_styles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."colors" (
    "color" "text" NOT NULL,
    "color_family" "text" NOT NULL,
    "sort_order" smallint DEFAULT 100 NOT NULL,
    "notes" "text",
    CONSTRAINT "colors_family_chk" CHECK (("color_family" = ANY (ARRAY['Black'::"text", 'Gray'::"text", 'Tan/FDE'::"text", 'Green'::"text", 'Bronze/Copper'::"text", 'Gold'::"text", 'Silver/Stainless'::"text", 'Blue'::"text", 'Red'::"text", 'Rose'::"text", 'Purple'::"text", 'Multi'::"text", 'Clear'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."colors" OWNER TO "postgres";


COMMENT ON TABLE "public"."colors" IS 'Controlled vocabulary for product_variants.color. color_family drives the storefront filter; color is the exact shade shown on the card.';



CREATE TABLE IF NOT EXISTS "public"."compensator_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'compensator'::"public"."product_category" NOT NULL,
    "caliber" "text" DEFAULT '9mm'::"text" NOT NULL,
    "mounting_type" "text",
    "requires_threaded_barrel" boolean DEFAULT false NOT NULL,
    "thread_pitch" "text",
    "comes_with_barrel" boolean DEFAULT false NOT NULL,
    "included_barrel" "text",
    "barrel_length_in" numeric(3,1),
    "port_design" "text",
    "muzzle_flip_reduction" "text",
    "length_in" numeric(4,2),
    CONSTRAINT "comp_barrel_length_consistency" CHECK (("comes_with_barrel" OR ("barrel_length_in" IS NULL))),
    CONSTRAINT "comp_specs_category" CHECK (("category" = 'compensator'::"public"."product_category")),
    CONSTRAINT "comp_thread_consistency" CHECK (((NOT "requires_threaded_barrel") OR ("thread_pitch" IS NOT NULL)))
);


ALTER TABLE "public"."compensator_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."footprints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "common_name" "text" NOT NULL,
    "also_known_as" "text",
    "originating_optic" "text",
    "notes" "text"
);


ALTER TABLE "public"."footprints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."frame_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'frame'::"public"."product_category" NOT NULL,
    "housing_class" "text" NOT NULL,
    "has_rail" boolean,
    "grip_rail_type" "text",
    "has_beaver_tail" boolean,
    "undercut_trigger_guard" boolean,
    "palm_swell" boolean,
    "magwell_type" "text",
    "grip_texture" "text",
    "finger_grooves" boolean,
    "thumb_rest" boolean,
    "thumb_stippling" boolean,
    "includes_hardware" boolean,
    "hardware_notes" "text",
    CONSTRAINT "frame_rail_consistency" CHECK (((("has_rail" IS NOT TRUE) OR ("grip_rail_type" IS NOT NULL)) AND (("has_rail" IS NOT FALSE) OR ("grip_rail_type" IS NULL) OR ("grip_rail_type" = 'none'::"text")))),
    CONSTRAINT "frame_specs_category" CHECK (("category" = 'frame'::"public"."product_category"))
);


ALTER TABLE "public"."frame_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grip_rail_types" (
    "grip_rail_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."grip_rail_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "category" "text" NOT NULL,
    "platform_id" "uuid" NOT NULL,
    "description" "text",
    "hero_image_path" "text",
    "parts_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    CONSTRAINT "guides_category_check" CHECK (("category" = ANY (ARRAY['home_defense'::"text", 'concealed_carry'::"text", 'range_competition'::"text", 'duty'::"text"])))
);


ALTER TABLE "public"."guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gun_optic_cuts" (
    "gun_id" "uuid" NOT NULL,
    "optic_cut" "text" NOT NULL,
    "applies_to" "text" NOT NULL,
    "confidence" "text" DEFAULT 'verified'::"text" NOT NULL,
    "source_url" "text",
    "notes" "text",
    CONSTRAINT "gun_optic_cuts_confidence_check" CHECK (("confidence" = ANY (ARRAY['verified'::"text", 'likely'::"text"])))
);


ALTER TABLE "public"."gun_optic_cuts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "housing_class" "text" NOT NULL,
    "frame_material" "text",
    "slide_length_in" numeric,
    "barrel_length_in" numeric,
    "oem_capacity" "text",
    "integrated_comp" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "platform_id" "uuid" NOT NULL
);


ALTER TABLE "public"."guns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."handedness_types" (
    "handedness" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."handedness_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."housing_classes" (
    "housing_class" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "magazine_family" "text" NOT NULL,
    "grip_length" "text",
    "typical_slide_length_in" numeric(3,1),
    "min_slide_length_in" numeric(3,1),
    "notes" "text"
);


ALTER TABLE "public"."housing_classes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."housing_classes"."typical_slide_length_in" IS 'Buyer recognition only. Does NOT gate fit. Use min_slide_length_in for fit logic.';



COMMENT ON COLUMN "public"."housing_classes"."min_slide_length_in" IS 'Fit gate: a slide shorter than this leaves the grip overhanging. Slide longer is fine (intentional overhang).';



CREATE TABLE IF NOT EXISTS "public"."light_compatibility" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "light_product_id" "uuid" NOT NULL,
    "rail_type" "text" NOT NULL,
    "fitment_type" "public"."light_fitment_type" NOT NULL,
    "key_or_adapter" "text",
    "gun_make" "text",
    "gun_id" "uuid",
    "gun_model_text" "text",
    "confirmed" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "light_compat_adapter_named" CHECK ((("fitment_type" <> 'adapter-required'::"public"."light_fitment_type") OR ("key_or_adapter" IS NOT NULL))),
    CONSTRAINT "light_compat_target_present" CHECK ((("gun_id" IS NOT NULL) OR ("gun_model_text" IS NOT NULL)))
);


ALTER TABLE "public"."light_compatibility" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."light_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'light'::"public"."product_category" NOT NULL,
    "series" "text",
    "config_note" "text",
    "mount_system" "text",
    "lumens_max" integer,
    "candela_max" integer,
    "beam_type" "text",
    "has_laser" boolean DEFAULT false NOT NULL,
    "laser_color" "text",
    "rechargeable" boolean,
    "length_in" numeric(4,2),
    "ipx_rating" "text",
    "multiple_light_settings" boolean,
    "has_strobe" boolean,
    "has_infrared" boolean,
    "battery_type" "text",
    CONSTRAINT "light_candela_positive" CHECK ((("candela_max" IS NULL) OR ("candela_max" > 0))),
    CONSTRAINT "light_laser_consistency" CHECK (("has_laser" OR ("laser_color" IS NULL))),
    CONSTRAINT "light_lumens_positive" CHECK ((("lumens_max" IS NULL) OR ("lumens_max" > 0))),
    CONSTRAINT "light_specs_category" CHECK (("category" = 'light'::"public"."product_category"))
);


ALTER TABLE "public"."light_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."link_clicks" (
    "id" bigint NOT NULL,
    "link_id" "uuid",
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "referrer_path" "text",
    "product_id" "uuid",
    CONSTRAINT "link_clicks_exactly_one_target" CHECK ((("link_id" IS NULL) <> ("product_id" IS NULL)))
);


ALTER TABLE "public"."link_clicks" OWNER TO "postgres";


COMMENT ON TABLE "public"."link_clicks" IS 'Outbound click log. Written by the /go/ edge function as service_role. One row per click, on exactly one target: link_id for /go/<affiliate link> (a partner listing), product_id for /go/part/<product> (the part''s own products.url — a maker''s or seller''s store, unpaid). RLS on, no policies, no grants — private by design, same as price_history. No personal data: target id, timestamp, and the on-site path the click came from.';



ALTER TABLE "public"."link_clicks" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."link_clicks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."mag_release_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" NOT NULL,
    "caliber" "text" NOT NULL,
    "style" "text",
    "texture" "text",
    "material" "text",
    "length_added_in" numeric,
    "includes_spring_stop" boolean
);


ALTER TABLE "public"."mag_release_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mag_types" (
    "mag_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."mag_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."magazine_families" (
    "magazine_family" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "notes" "text",
    "capacity_note" "text"
);


ALTER TABLE "public"."magazine_families" OWNER TO "postgres";


COMMENT ON COLUMN "public"."magazine_families"."display_name" IS 'Shopper-facing label. Shown on grip-module cards and product pages via housing_classes.magazine_family.';



CREATE TABLE IF NOT EXISTS "public"."magazine_frame_requirements" (
    "magazine_product_id" "uuid" NOT NULL,
    "frame_product_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manufacturer'::"text",
    "compatibility_note" "text"
);


ALTER TABLE "public"."magazine_frame_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."magazine_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'magazine'::"public"."product_category" NOT NULL,
    "capacity" integer,
    "caliber" "text",
    "mag_style" "text",
    "fits_models" "text",
    "not_compatible_with" "text",
    "body_material" "text",
    "witness_holes" "text",
    "included_extras" "text",
    CONSTRAINT "magazine_specs_capacity" CHECK ((("capacity" IS NULL) OR ("capacity" > 0))),
    CONSTRAINT "magazine_specs_category" CHECK (("category" = 'magazine'::"public"."product_category")),
    CONSTRAINT "magazine_specs_mag_style" CHECK ((("mag_style" IS NULL) OR ("mag_style" = ANY (ARRAY['Flush'::"text", 'Finger Extension'::"text", 'Extended'::"text"]))))
);


ALTER TABLE "public"."magazine_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."magwell_frame_requirements" (
    "magwell_product_id" "uuid" NOT NULL,
    "frame_product_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manufacturer'::"text",
    "compatibility_note" "text"
);


ALTER TABLE "public"."magwell_frame_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."magwell_frame_requirements" IS 'Whitelist: which frames a magwell fits. If a magwell has rows here, it ONLY fits those frames.';



COMMENT ON COLUMN "public"."magwell_frame_requirements"."compatibility_note" IS 'User-facing text about this magwell+frame pairing.';



CREATE TABLE IF NOT EXISTS "public"."magwell_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'magwell'::"public"."product_category" NOT NULL,
    "attachment_method" "text",
    "is_combo" boolean DEFAULT false NOT NULL,
    "includes_hardware" boolean
);


ALTER TABLE "public"."magwell_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manufacturers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "website_url" "text",
    "logo_url" "text",
    "is_oem" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "manufacturers_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text"))
);


ALTER TABLE "public"."manufacturers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."materials" (
    "material_family" "text" NOT NULL,
    "sort_order" smallint DEFAULT 100 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."materials" OWNER TO "postgres";


COMMENT ON TABLE "public"."materials" IS 'Filterable material family. The verbose vendor description lives in products.material.';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "kind" "text" NOT NULL,
    "build_id" "uuid" NOT NULL,
    "comment_id" "uuid",
    "preview" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "email_sent_at" timestamp with time zone,
    CONSTRAINT "notifications_actor_required" CHECK ((("kind" = ANY (ARRAY['approved'::"text", 'changes'::"text"])) OR ("actor_id" IS NOT NULL))),
    CONSTRAINT "notifications_kind_check" CHECK (("kind" = ANY (ARRAY['comment'::"text", 'reply'::"text", 'like'::"text", 'approved'::"text", 'changes'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'In-app inbox. Written by triggers on build_comments and build_fires only; recipients read their own rows and set read_at.';



ALTER TABLE "public"."notifications" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."optic_adapter_footprints" (
    "optic_product_id" "uuid" NOT NULL,
    "footprint_id" "uuid" NOT NULL,
    "plate_included" boolean DEFAULT false NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."optic_adapter_footprints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."optic_cut_footprints" (
    "optic_cut" "text" NOT NULL,
    "footprint_id" "uuid" NOT NULL,
    "fit" "public"."footprint_fit" DEFAULT 'direct'::"public"."footprint_fit" NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."optic_cut_footprints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."optic_cuts" (
    "optic_cut" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "mounting" "public"."optic_mounting" NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."optic_cuts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."optic_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'optic'::"public"."product_category" NOT NULL,
    "footprint_id" "uuid" NOT NULL,
    "optic_type" "text",
    "mount_height" "text",
    "reticle" "text",
    "selectable_reticle" boolean,
    "reticle_type" "text",
    "dot_size_moa" numeric(4,1),
    "magnification" "text",
    "window_size" "text",
    "emitter" "text",
    "enclosed_emitter" boolean,
    "brightness_settings" "text",
    "auto_on_off" boolean,
    "shake_awake" boolean,
    "adjustment_per_click" "text",
    "battery_type" "text",
    "battery_location" "text",
    "removable_battery" boolean,
    "battery_life" "text",
    "solar_power" boolean,
    "housing_material" "text",
    CONSTRAINT "optic_dot_size_positive" CHECK ((("dot_size_moa" IS NULL) OR ("dot_size_moa" > (0)::numeric))),
    CONSTRAINT "optic_specs_category" CHECK (("category" = 'optic'::"public"."product_category"))
);


ALTER TABLE "public"."optic_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."part_classes" (
    "part_class" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."part_classes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."part_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."part_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "base_url" "text",
    "commission_pct" numeric(5,2),
    "tracking_param" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "awin_merchant_id" "text",
    CONSTRAINT "partners_awin_merchant_id_numeric" CHECK ((("awin_merchant_id" IS NULL) OR ("awin_merchant_id" ~ '^[0-9]+$'::"text"))),
    CONSTRAINT "partners_commission_range" CHECK ((("commission_pct" IS NULL) OR (("commission_pct" >= (0)::numeric) AND ("commission_pct" <= (100)::numeric)))),
    CONSTRAINT "partners_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text"))
);


ALTER TABLE "public"."partners" OWNER TO "postgres";


COMMENT ON COLUMN "public"."partners"."awin_merchant_id" IS 'AWIN advertiser/merchant ID (awinmid param in AWIN cread.php links). Null for non-AWIN partners.';



CREATE TABLE IF NOT EXISTS "public"."platform_part_lengths" (
    "platform_id" "uuid" NOT NULL,
    "part_kind" "text" NOT NULL,
    "length_in" numeric(4,2) NOT NULL,
    "part_class" "text" NOT NULL,
    "notes" "text",
    CONSTRAINT "platform_part_lengths_part_kind_check" CHECK (("part_kind" = ANY (ARRAY['slide'::"text", 'barrel'::"text"])))
);


ALTER TABLE "public"."platform_part_lengths" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_skus" (
    "gun_id" "uuid" NOT NULL,
    "gun_db_platform_id" "text" NOT NULL
);


ALTER TABLE "public"."platform_skus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platforms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "notes" "text",
    "make" "text",
    "description" "text",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_live" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."platforms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."port_styles" (
    "port_style" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."port_styles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_history" (
    "id" bigint NOT NULL,
    "link_id" "uuid" NOT NULL,
    "old_price" numeric,
    "new_price" numeric,
    "old_in_stock" boolean,
    "new_in_stock" boolean,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."price_history" IS 'Append-only log of affiliate_links street_price / in_stock changes. Written only by the trigger below; no direct writers.';



ALTER TABLE "public"."price_history" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."price_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."product_internal" (
    "product_id" "uuid" NOT NULL,
    "internal_notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_internal" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_internal" IS 'Staff-only. RLS enabled with no policies, so anon and authenticated cannot read it.';



CREATE TABLE IF NOT EXISTS "public"."product_platforms" (
    "product_id" "uuid" NOT NULL,
    "platform_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_platforms" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_platforms" IS 'Many-to-many: which gun platforms (P320, P365, …) each product fits. Drives the "P365-only" builder picker filter and admin-side catalog scoping.';



CREATE TABLE IF NOT EXISTS "public"."product_variants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "color" "text",
    "finish" "text",
    "optic_cut" "text",
    "manual_safety_variant" boolean,
    "bundle" "text",
    "mount_system" "text",
    "sku" "text",
    "upc" "text",
    "msrp" numeric(10,2),
    "is_default" boolean DEFAULT false NOT NULL,
    "is_discontinued" boolean DEFAULT false NOT NULL,
    "primary_image_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handedness" "text",
    "battery_type" "text",
    "reticle" "text",
    "reticle_color" "text",
    "variant_label" "text",
    "clamp_style" "text",
    "clamp_rail_type" "text",
    "clamp" "text",
    "retired_at" timestamp with time zone,
    CONSTRAINT "variants_msrp_positive" CHECK ((("msrp" IS NULL) OR ("msrp" >= (0)::numeric))),
    CONSTRAINT "variants_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text")),
    CONSTRAINT "variants_upc_digits" CHECK ((("upc" IS NULL) OR ("upc" ~ '^[0-9]{8,14}$'::"text")))
);


ALTER TABLE "public"."product_variants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."product_variants"."variant_label" IS 'Human-readable variant differentiator (e.g. "2 MOA Red Dot"). Overrides the computed axis label in the UI when non-empty.';



COMMENT ON COLUMN "public"."product_variants"."clamp" IS 'LEGACY. Superseded by clamp_style + clamp_rail_type. Still selected by gunforma-parts-catalog.html, js/affiliate.js and gunforma-build-detail.html. Do not drop until those are updated.';



COMMENT ON COLUMN "public"."product_variants"."retired_at" IS 'When this variant stopped being sold. Retiring a variant auto-retires its affiliate_links via trg_retire_links_with_variant.';



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "category" "public"."product_category" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "family" "text",
    "url" "text",
    "fitment_confidence" "public"."fitment_confidence" DEFAULT 'unverified'::"public"."fitment_confidence" NOT NULL,
    "build_warning" "text",
    "fitment_notes" "text",
    "build_notes" "text",
    "installation_difficulty" "public"."install_difficulty",
    "material" "text",
    "weight_oz" numeric(6,2),
    "description" "text",
    "best_for" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "pros" "text",
    "cons" "text",
    "editor_rating" numeric(2,1),
    "is_discontinued" boolean DEFAULT false NOT NULL,
    "lowest_price" numeric(10,2),
    "lowest_price_variant_id" "uuid",
    "lowest_price_updated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ((("setweight"("to_tsvector"('"english"'::"regconfig", COALESCE("name", ''::"text")), 'A'::"char") || "setweight"("to_tsvector"('"english"'::"regconfig", COALESCE("family", ''::"text")), 'B'::"char")) || "setweight"("to_tsvector"('"english"'::"regconfig", COALESCE("description", ''::"text")), 'C'::"char"))) STORED,
    "material_family" "text",
    "part_type" "text",
    "restricted_states" "text"[],
    CONSTRAINT "products_part_type_other" CHECK (((("category")::"text" = 'other'::"text") = (COALESCE("btrim"("part_type"), ''::"text") <> ''::"text"))),
    CONSTRAINT "products_rating_range" CHECK ((("editor_rating" IS NULL) OR (("editor_rating" >= (0)::numeric) AND ("editor_rating" <= (5)::numeric)))),
    CONSTRAINT "products_restricted_states_codes" CHECK ((("restricted_states" IS NULL) OR (("cardinality"("restricted_states") > 0) AND ("array_position"("restricted_states", NULL::"text") IS NULL) AND ("restricted_states" <@ ARRAY['AL'::"text", 'AK'::"text", 'AZ'::"text", 'AR'::"text", 'CA'::"text", 'CO'::"text", 'CT'::"text", 'DE'::"text", 'DC'::"text", 'FL'::"text", 'GA'::"text", 'HI'::"text", 'ID'::"text", 'IL'::"text", 'IN'::"text", 'IA'::"text", 'KS'::"text", 'KY'::"text", 'LA'::"text", 'ME'::"text", 'MD'::"text", 'MA'::"text", 'MI'::"text", 'MN'::"text", 'MS'::"text", 'MO'::"text", 'MT'::"text", 'NE'::"text", 'NV'::"text", 'NH'::"text", 'NJ'::"text", 'NM'::"text", 'NY'::"text", 'NC'::"text", 'ND'::"text", 'OH'::"text", 'OK'::"text", 'OR'::"text", 'PA'::"text", 'RI'::"text", 'SC'::"text", 'SD'::"text", 'TN'::"text", 'TX'::"text", 'UT'::"text", 'VT'::"text", 'VA'::"text", 'WA'::"text", 'WV'::"text", 'WI'::"text", 'WY'::"text"])))),
    CONSTRAINT "products_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text")),
    CONSTRAINT "products_weight_positive" CHECK ((("weight_oz" IS NULL) OR ("weight_oz" > (0)::numeric)))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."material" IS 'Verbose vendor material description for display only. Filter on material_family.';



COMMENT ON COLUMN "public"."products"."lowest_price" IS 'Machine-written by the repricing job. Do not hand-edit.';



COMMENT ON COLUMN "public"."products"."part_type" IS 'Other Parts only: what the part is, in two or three words ("thumb ledge"). Required there, absent everywhere else (products_part_type_other).';



COMMENT ON COLUMN "public"."products"."restricted_states" IS 'Two-letter codes of the US states (or DC) this part cannot be shipped to. NULL = no restriction. The part page prints "Not available in: …" above the buy button.';



CREATE OR REPLACE VIEW "public"."products_needing_data" WITH ("security_invoker"='true') AS
 SELECT "p"."id" AS "product_id",
    "p"."slug",
    "p"."name",
    "m"."name" AS "brand",
    "p"."category",
    ARRAY( SELECT "jsonb_array_elements_text"(("st"."s" -> 'platforms'::"text")) AS "jsonb_array_elements_text") AS "platforms",
    ARRAY( SELECT "jsonb_array_elements_text"(("st"."s" -> 'missing'::"text")) AS "jsonb_array_elements_text") AS "missing"
   FROM (("public"."products" "p"
     JOIN "public"."manufacturers" "m" ON (("m"."id" = "p"."brand_id")))
     CROSS JOIN LATERAL ( SELECT "public"."product_data_status"("p"."id") AS "s") "st")
  WHERE (("public"."is_admin"() OR "public"."is_trusted_backend"()) AND (NOT (("st"."s" ->> 'approved'::"text"))::boolean));


ALTER VIEW "public"."products_needing_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rail_bridge" (
    "grip_housing_class" "text" NOT NULL,
    "grip_rail_type" "text" NOT NULL,
    "light_rail_type" "text" NOT NULL,
    "fit_confidence" "public"."fitment_confidence" DEFAULT 'unverified'::"public"."fitment_confidence" NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."rail_bridge" OWNER TO "postgres";


COMMENT ON TABLE "public"."rail_bridge" IS 'Grip rail vocabulary -> light rail vocabulary. Absence of a row means that housing/rail combination has no known light fitment.';



CREATE TABLE IF NOT EXISTS "public"."rail_types" (
    "rail_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "spec" "text",
    "description" "text",
    "example_guns" "text"
);


ALTER TABLE "public"."rail_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recoil_spring_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'recoil_spring'::"public"."product_category" NOT NULL,
    "slide_length_in" numeric(3,2),
    "spring_weight" "text",
    "captured" boolean,
    "spring_type" "text",
    "guide_rod_material" "text",
    CONSTRAINT "recoil_spring_specs_category" CHECK (("category" = 'recoil_spring'::"public"."product_category"))
);


ALTER TABLE "public"."recoil_spring_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safety_selector_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'safety_selector'::"public"."product_category" NOT NULL,
    "is_ambidextrous" boolean,
    "includes_detent_spring" boolean,
    "kit_contents" "text"
);


ALTER TABLE "public"."safety_selector_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_builds" (
    "user_id" "uuid" NOT NULL,
    "build_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_builds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sight_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'sight'::"public"."product_category" NOT NULL,
    "sight_position" "text",
    "height" "text",
    "sight_type" "text",
    "dovetail" "text",
    "rear_notch" "text",
    CONSTRAINT "sight_specs_category" CHECK (("category" = 'sight'::"public"."product_category")),
    CONSTRAINT "sight_specs_height" CHECK (("height" = ANY (ARRAY['standard'::"text", 'suppressor'::"text"]))),
    CONSTRAINT "sight_specs_sight_position" CHECK (("sight_position" = ANY (ARRAY['front'::"text", 'rear'::"text", 'set'::"text"]))),
    CONSTRAINT "sight_specs_sight_type" CHECK (("sight_type" = ANY (ARRAY['night'::"text", 'fiber'::"text", 'night-fiber'::"text", 'plain'::"text"])))
);


ALTER TABLE "public"."sight_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slide_release_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'slide_release'::"public"."product_category" NOT NULL,
    "texture" "text",
    "uses_oem_spring" boolean
);


ALTER TABLE "public"."slide_release_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slide_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'slide'::"public"."product_category" NOT NULL,
    "slide_length_in" numeric(3,1) NOT NULL,
    "barrel_length_in" numeric(3,1),
    "comes_with_sights" boolean,
    "barrel_included" boolean,
    "window_cuts" boolean,
    "internally_ported" boolean,
    "port_style" "text",
    "port_count" smallint,
    "integrated_comp" boolean,
    "threaded_barrel_ok" boolean,
    "required_spring_weight" "text",
    "platform_id" "uuid" NOT NULL,
    "slide_class" "text",
    CONSTRAINT "slide_barrel_not_longer" CHECK ((("barrel_length_in" IS NULL) OR ("barrel_length_in" <= "slide_length_in"))),
    CONSTRAINT "slide_length_valid" CHECK (("slide_length_in" = ANY (ARRAY[3.1, 3.7, 4.3]))),
    CONSTRAINT "slide_specs_category" CHECK (("category" = 'slide'::"public"."product_category"))
);


ALTER TABLE "public"."slide_specs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."slide_specs"."slide_length_in" IS 'Published slide body length. A comp slide is 3.7 even when its internal barrel is 3.1.';



CREATE TABLE IF NOT EXISTS "public"."spec_field_rules" (
    "category" "public"."product_category" NOT NULL,
    "field" "text" NOT NULL,
    "requirement" "text" NOT NULL,
    "only_when_field" "text",
    "only_when_values" "text"[],
    "label" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    CONSTRAINT "spec_field_rules_only_when_pair" CHECK ((("only_when_field" IS NULL) = ("only_when_values" IS NULL))),
    CONSTRAINT "spec_field_rules_requirement_check" CHECK (("requirement" = ANY (ARRAY['required'::"text", 'optional'::"text"])))
);


ALTER TABLE "public"."spec_field_rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."spec_field_rules" IS 'What each category''s spec sheet needs: required / optional / only-when. Read by create_product(), product_data_status() and the add-a-part form.';



CREATE TABLE IF NOT EXISTS "public"."sync_drift_review" (
    "id" bigint NOT NULL,
    "run_at" timestamp with time zone NOT NULL,
    "partner_id" "uuid",
    "link_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "field" "text",
    "stored_value" "text",
    "feed_value" "text",
    "feed_product_name" "text",
    "matched_by" "text",
    "link_url" "text",
    "resolved_at" timestamp with time zone,
    "resolution_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sync_drift_review_kind_check" CHECK (("kind" = ANY (ARRAY['identifier_drift'::"text", 'candidate_conflict'::"text"])))
);


ALTER TABLE "public"."sync_drift_review" OWNER TO "postgres";


COMMENT ON TABLE "public"."sync_drift_review" IS 'Things the nightly affiliate sync refused to write: a feed row contradicting a stored op_* identifier, or several feed rows claiming the same link. Nothing was written for these links on that run. Review, then either correct the link by hand or clear the stored identifier so the next run can refill it.';



ALTER TABLE "public"."sync_drift_review" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sync_drift_review_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."takedown_lever_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'takedown_lever'::"public"."product_category" NOT NULL,
    "takedown_type" "text",
    "has_thumb_rest" boolean,
    "optic_compatibility_notes" "text"
);


ALTER TABLE "public"."takedown_lever_specs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trigger_specs" (
    "product_id" "uuid" NOT NULL,
    "category" "public"."product_category" DEFAULT 'trigger'::"public"."product_category" NOT NULL,
    "profile" "text",
    "pull_weight_lb" numeric(4,2),
    "pull_weight_text" "text",
    "adjustable" boolean DEFAULT false NOT NULL,
    "adjustment_type" "text",
    "safety_type" "text",
    "drop_in" boolean DEFAULT true NOT NULL,
    CONSTRAINT "trigger_pull_range" CHECK ((("pull_weight_lb" IS NULL) OR (("pull_weight_lb" >= (1)::numeric) AND ("pull_weight_lb" <= (15)::numeric)))),
    CONSTRAINT "trigger_specs_category" CHECK (("category" = 'trigger'::"public"."product_category"))
);


ALTER TABLE "public"."trigger_specs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_barrel_slide_fit" WITH ("security_invoker"='true') AS
 SELECT "b"."product_id" AS "barrel_product_id",
    "s"."product_id" AS "slide_product_id",
    "b"."barrel_length_in",
    "s"."barrel_length_in" AS "slide_barrel_length_in",
    "b"."barrel_type",
        CASE
            WHEN ("s"."barrel_length_in" IS NULL) THEN 'unknown'::"text"
            WHEN ((EXISTS ( SELECT 1
               FROM "public"."barrel_slide_requirements" "r"
              WHERE ("r"."barrel_product_id" = "b"."product_id"))) AND (NOT (EXISTS ( SELECT 1
               FROM "public"."barrel_slide_requirements" "r"
              WHERE (("r"."barrel_product_id" = "b"."product_id") AND ("r"."slide_product_id" = "s"."product_id")))))) THEN 'blocked'::"text"
            WHEN ("b"."barrel_length_in" <> "s"."barrel_length_in") THEN 'length-mismatch'::"text"
            ELSE 'fits'::"text"
        END AS "fit_status",
        CASE
            WHEN ("s"."barrel_length_in" IS NULL) THEN 'Slide barrel length not recorded. Verify before building.'::"text"
            WHEN ((EXISTS ( SELECT 1
               FROM "public"."barrel_slide_requirements" "r"
              WHERE ("r"."barrel_product_id" = "b"."product_id"))) AND (NOT (EXISTS ( SELECT 1
               FROM "public"."barrel_slide_requirements" "r"
              WHERE (("r"."barrel_product_id" = "b"."product_id") AND ("r"."slide_product_id" = "s"."product_id")))))) THEN 'Maker specifies this barrel for other slides only. Do not build.'::"text"
            WHEN ("b"."barrel_length_in" <> "s"."barrel_length_in") THEN 'Barrel length does not match the slide.'::"text"
            ELSE 'Compatible.'::"text"
        END AS "verdict"
   FROM ("public"."barrel_specs" "b"
     CROSS JOIN "public"."slide_specs" "s");


ALTER VIEW "public"."v_barrel_slide_fit" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_comp_barrel_fit" WITH ("security_invoker"='true') AS
 SELECT "c"."product_id" AS "comp_product_id",
    "b"."product_id" AS "barrel_product_id",
    "c"."thread_pitch" AS "comp_thread_pitch",
    "b"."thread_pitch" AS "barrel_thread_pitch",
        CASE
            WHEN ("b"."pairs_with_comp_id" = "c"."product_id") THEN 'fits-proprietary'::"text"
            WHEN ("b"."pairs_with_comp_id" IS NOT NULL) THEN 'blocked-proprietary'::"text"
            WHEN (NOT "c"."requires_threaded_barrel") THEN 'fits'::"text"
            WHEN ("b"."barrel_type" <> ALL (ARRAY['threaded'::"public"."barrel_type", 'threaded-and-ported'::"public"."barrel_type"])) THEN 'needs-threaded-barrel'::"text"
            WHEN ("c"."thread_pitch" IS DISTINCT FROM "b"."thread_pitch") THEN 'thread-mismatch'::"text"
            ELSE 'fits'::"text"
        END AS "fit_status"
   FROM ("public"."compensator_specs" "c"
     CROSS JOIN "public"."barrel_specs" "b");


ALTER VIEW "public"."v_comp_barrel_fit" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_frame_fitment" WITH ("security_invoker"='true') AS
 SELECT "f"."product_id",
    "p"."slug",
    "p"."name",
    "f"."housing_class",
    "hc"."display_name" AS "housing_display_name",
    "hc"."magazine_family",
    "hc"."min_slide_length_in",
    "f"."has_rail",
    "f"."grip_rail_type",
    "rb"."light_rail_type",
    "rb"."fit_confidence" AS "rail_bridge_confidence"
   FROM ((("public"."frame_specs" "f"
     JOIN "public"."products" "p" ON (("p"."id" = "f"."product_id")))
     JOIN "public"."housing_classes" "hc" ON (("hc"."housing_class" = "f"."housing_class")))
     LEFT JOIN "public"."rail_bridge" "rb" ON ((("rb"."grip_housing_class" = "f"."housing_class") AND ("rb"."grip_rail_type" = "f"."grip_rail_type"))));


ALTER VIEW "public"."v_frame_fitment" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_frame_light_fit" WITH ("security_invoker"='true') AS
 SELECT "f"."product_id" AS "frame_product_id",
    "lc"."light_product_id",
    "f"."housing_class",
    "f"."grip_rail_type",
    "rb"."light_rail_type",
    "lc"."fitment_type",
    "lc"."key_or_adapter",
        CASE
            WHEN (("rb"."fit_confidence" = 'verified'::"public"."fitment_confidence") AND "lc"."confirmed") THEN 'verified'::"text"
            ELSE 'likely'::"text"
        END AS "confidence",
    "rb"."notes" AS "bridge_notes",
    "lc"."notes" AS "compatibility_notes"
   FROM (("public"."frame_specs" "f"
     JOIN "public"."rail_bridge" "rb" ON ((("rb"."grip_housing_class" = "f"."housing_class") AND ("rb"."grip_rail_type" = "f"."grip_rail_type"))))
     JOIN "public"."light_compatibility" "lc" ON (("lc"."rail_type" = "rb"."light_rail_type")))
  WHERE ("lc"."fitment_type" <> 'no-fit'::"public"."light_fitment_type");


ALTER VIEW "public"."v_frame_light_fit" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_optic_slide_variant_fit" WITH ("security_invoker"='true') AS
 SELECT DISTINCT "o"."product_id" AS "optic_product_id",
    "v"."id" AS "slide_variant_id",
    "v"."product_id" AS "slide_product_id",
    "v"."optic_cut",
    "oc"."mounting",
    "fp"."slug" AS "footprint_slug",
        CASE
            WHEN (("ocf"."footprint_id" = "o"."footprint_id") AND ("ocf"."fit" = 'direct'::"public"."footprint_fit")) THEN 'direct'::"text"
            ELSE 'plate'::"text"
        END AS "mount_method",
    ("ocf"."footprint_id" <> "o"."footprint_id") AS "uses_optic_adapter"
   FROM (((("public"."optic_specs" "o"
     JOIN "public"."product_variants" "v" ON (("v"."optic_cut" IS NOT NULL)))
     JOIN "public"."optic_cuts" "oc" ON (("oc"."optic_cut" = "v"."optic_cut")))
     JOIN "public"."optic_cut_footprints" "ocf" ON (("ocf"."optic_cut" = "v"."optic_cut")))
     JOIN "public"."footprints" "fp" ON (("fp"."id" = "ocf"."footprint_id")))
  WHERE (("oc"."mounting" <> 'none'::"public"."optic_mounting") AND (("ocf"."footprint_id" = "o"."footprint_id") OR (EXISTS ( SELECT 1
           FROM "public"."optic_adapter_footprints" "oaf"
          WHERE (("oaf"."optic_product_id" = "o"."product_id") AND ("oaf"."footprint_id" = "ocf"."footprint_id"))))));


ALTER VIEW "public"."v_optic_slide_variant_fit" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_product_pricing" WITH ("security_invoker"='true') AS
 SELECT "p"."id" AS "product_id",
    "p"."slug",
    "p"."category",
    "min"("al"."street_price") FILTER (WHERE "al"."in_stock") AS "lowest_in_stock_price",
    "min"("al"."street_price") AS "lowest_any_price",
    "min"("v"."msrp") AS "lowest_msrp",
    "count"(DISTINCT "v"."id") FILTER (WHERE (NOT "v"."is_discontinued")) AS "active_variant_count",
    "max"("al"."last_checked") AS "price_last_checked"
   FROM (("public"."products" "p"
     LEFT JOIN "public"."product_variants" "v" ON (("v"."product_id" = "p"."id")))
     LEFT JOIN "public"."affiliate_links" "al" ON (("al"."variant_id" = "v"."id")))
  GROUP BY "p"."id", "p"."slug", "p"."category";


ALTER VIEW "public"."v_product_pricing" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_slide_frame_fit" WITH ("security_invoker"='true') AS
 SELECT "sl"."product_id" AS "slide_product_id",
    "fr"."product_id" AS "frame_product_id",
    "sl"."slide_length_in",
    "sl"."slide_class",
    "fr"."housing_class",
    "hc"."min_slide_length_in",
    ("sl"."slide_length_in" >= "hc"."min_slide_length_in") AS "fits",
        CASE
            WHEN ("sl"."slide_length_in" < "hc"."min_slide_length_in") THEN 'Grip module extends past the slide. Not a usable build.'::"text"
            WHEN ("sl"."slide_length_in" > "hc"."min_slide_length_in") THEN 'Slide overhangs the grip. Intentional and fine.'::"text"
            ELSE 'Flush fit.'::"text"
        END AS "verdict"
   FROM (("public"."slide_specs" "sl"
     CROSS JOIN "public"."frame_specs" "fr")
     JOIN "public"."housing_classes" "hc" ON (("hc"."housing_class" = "fr"."housing_class")));


ALTER VIEW "public"."v_slide_frame_fit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."variant_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "variant_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "position" smallint DEFAULT 1 NOT NULL,
    "alt_text" "text",
    CONSTRAINT "variant_images_position_positive" CHECK (("position" > 0))
);


ALTER TABLE "public"."variant_images" OWNER TO "postgres";


ALTER TABLE ONLY "public"."_archive_products_specs"
    ADD CONSTRAINT "_archive_products_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."adapter_part_types"
    ADD CONSTRAINT "adapter_part_types_pkey" PRIMARY KEY ("part_type");



ALTER TABLE ONLY "public"."adapter_parts"
    ADD CONSTRAINT "adapter_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."adapter_parts"
    ADD CONSTRAINT "adapter_parts_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."affiliate_links_is_primary_archive"
    ADD CONSTRAINT "affiliate_links_is_primary_archive_pkey" PRIMARY KEY ("link_id");



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."barrel_slide_requirements"
    ADD CONSTRAINT "barrel_slide_requirements_pkey" PRIMARY KEY ("barrel_product_id", "slide_product_id");



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."basepad_specs"
    ADD CONSTRAINT "basepad_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."basepad_types"
    ADD CONSTRAINT "basepad_types_pkey" PRIMARY KEY ("basepad_type");



ALTER TABLE ONLY "public"."build_comment_votes"
    ADD CONSTRAINT "build_comment_votes_pkey" PRIMARY KEY ("comment_id", "user_id");



ALTER TABLE ONLY "public"."build_comments"
    ADD CONSTRAINT "build_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."build_fires"
    ADD CONSTRAINT "build_fires_pkey" PRIMARY KEY ("build_id", "user_id");



ALTER TABLE ONLY "public"."build_part_flags"
    ADD CONSTRAINT "build_part_flags_build_id_part_index_user_id_key" UNIQUE ("build_id", "part_index", "user_id");



ALTER TABLE ONLY "public"."build_part_flags"
    ADD CONSTRAINT "build_part_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."build_photos"
    ADD CONSTRAINT "build_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."build_photos"
    ADD CONSTRAINT "build_photos_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."build_photos"
    ADD CONSTRAINT "build_photos_thumb_path_unique" UNIQUE ("thumb_path");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calibers"
    ADD CONSTRAINT "calibers_pkey" PRIMARY KEY ("caliber");



ALTER TABLE ONLY "public"."clamp_styles"
    ADD CONSTRAINT "clamp_styles_pkey" PRIMARY KEY ("clamp_style");



ALTER TABLE ONLY "public"."colors"
    ADD CONSTRAINT "colors_pkey" PRIMARY KEY ("color");



ALTER TABLE ONLY "public"."compensator_specs"
    ADD CONSTRAINT "compensator_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."footprints"
    ADD CONSTRAINT "footprints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."footprints"
    ADD CONSTRAINT "footprints_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."frame_specs"
    ADD CONSTRAINT "frame_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."grip_rail_types"
    ADD CONSTRAINT "grip_rail_types_pkey" PRIMARY KEY ("grip_rail_type");



ALTER TABLE ONLY "public"."guides"
    ADD CONSTRAINT "guides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gun_optic_cuts"
    ADD CONSTRAINT "gun_optic_cuts_pkey" PRIMARY KEY ("gun_id", "optic_cut", "applies_to");



ALTER TABLE ONLY "public"."guns"
    ADD CONSTRAINT "guns_id_platform_key" UNIQUE ("id", "platform_id");



ALTER TABLE ONLY "public"."guns"
    ADD CONSTRAINT "guns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guns"
    ADD CONSTRAINT "guns_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."handedness_types"
    ADD CONSTRAINT "handedness_types_pkey" PRIMARY KEY ("handedness");



ALTER TABLE ONLY "public"."housing_classes"
    ADD CONSTRAINT "housing_classes_pkey" PRIMARY KEY ("housing_class");



ALTER TABLE ONLY "public"."light_compatibility"
    ADD CONSTRAINT "light_compatibility_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."light_specs"
    ADD CONSTRAINT "light_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."link_clicks"
    ADD CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mag_release_specs"
    ADD CONSTRAINT "mag_release_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."mag_types"
    ADD CONSTRAINT "mag_types_pkey" PRIMARY KEY ("mag_type");



ALTER TABLE ONLY "public"."magazine_families"
    ADD CONSTRAINT "magazine_families_pkey" PRIMARY KEY ("magazine_family");



ALTER TABLE ONLY "public"."magazine_frame_requirements"
    ADD CONSTRAINT "magazine_frame_requirements_pkey" PRIMARY KEY ("magazine_product_id", "frame_product_id");



ALTER TABLE ONLY "public"."magazine_specs"
    ADD CONSTRAINT "magazine_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."magwell_frame_requirements"
    ADD CONSTRAINT "magwell_frame_requirements_pkey" PRIMARY KEY ("magwell_product_id", "frame_product_id");



ALTER TABLE ONLY "public"."magwell_specs"
    ADD CONSTRAINT "magwell_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."manufacturers"
    ADD CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manufacturers"
    ADD CONSTRAINT "manufacturers_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_pkey" PRIMARY KEY ("material_family");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."optic_adapter_footprints"
    ADD CONSTRAINT "optic_adapter_footprints_pkey" PRIMARY KEY ("optic_product_id", "footprint_id");



ALTER TABLE ONLY "public"."optic_cut_footprints"
    ADD CONSTRAINT "optic_cut_footprints_pkey" PRIMARY KEY ("optic_cut", "footprint_id");



ALTER TABLE ONLY "public"."optic_cuts"
    ADD CONSTRAINT "optic_cuts_pkey" PRIMARY KEY ("optic_cut");



ALTER TABLE ONLY "public"."optic_specs"
    ADD CONSTRAINT "optic_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."part_classes"
    ADD CONSTRAINT "part_classes_pkey" PRIMARY KEY ("part_class");



ALTER TABLE ONLY "public"."part_favorites"
    ADD CONSTRAINT "part_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."part_favorites"
    ADD CONSTRAINT "part_favorites_user_id_product_id_key" UNIQUE ("user_id", "product_id");



ALTER TABLE ONLY "public"."partners"
    ADD CONSTRAINT "partners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partners"
    ADD CONSTRAINT "partners_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."platform_part_lengths"
    ADD CONSTRAINT "platform_part_lengths_pkey" PRIMARY KEY ("platform_id", "part_kind", "length_in");



ALTER TABLE ONLY "public"."platform_skus"
    ADD CONSTRAINT "platform_skus_pkey" PRIMARY KEY ("gun_id", "gun_db_platform_id");



ALTER TABLE ONLY "public"."platforms"
    ADD CONSTRAINT "platforms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platforms"
    ADD CONSTRAINT "platforms_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."port_styles"
    ADD CONSTRAINT "port_styles_pkey" PRIMARY KEY ("port_style");



ALTER TABLE ONLY "public"."price_history"
    ADD CONSTRAINT "price_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_internal"
    ADD CONSTRAINT "product_internal_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."product_platforms"
    ADD CONSTRAINT "product_platforms_pkey" PRIMARY KEY ("product_id", "platform_id");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_unique" UNIQUE ("username");



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_pkey" PRIMARY KEY ("grip_housing_class", "grip_rail_type");



ALTER TABLE ONLY "public"."rail_types"
    ADD CONSTRAINT "rail_types_pkey" PRIMARY KEY ("rail_type");



ALTER TABLE ONLY "public"."recoil_spring_specs"
    ADD CONSTRAINT "recoil_spring_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."safety_selector_specs"
    ADD CONSTRAINT "safety_selector_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."saved_builds"
    ADD CONSTRAINT "saved_builds_pkey" PRIMARY KEY ("user_id", "build_id");



ALTER TABLE ONLY "public"."sight_specs"
    ADD CONSTRAINT "sight_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."slide_release_specs"
    ADD CONSTRAINT "slide_release_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."slide_specs"
    ADD CONSTRAINT "slide_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."spec_field_rules"
    ADD CONSTRAINT "spec_field_rules_pkey" PRIMARY KEY ("category", "field");



ALTER TABLE ONLY "public"."sync_drift_review"
    ADD CONSTRAINT "sync_drift_review_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."takedown_lever_specs"
    ADD CONSTRAINT "takedown_lever_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."trigger_specs"
    ADD CONSTRAINT "trigger_specs_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."variant_images"
    ADD CONSTRAINT "variant_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."variant_images"
    ADD CONSTRAINT "variant_images_variant_id_position_key" UNIQUE ("variant_id", "position");



CREATE INDEX "adapter_parts_light_idx" ON "public"."adapter_parts" USING "btree" ("light_product_id");



CREATE INDEX "affiliate_partner_idx" ON "public"."affiliate_links" USING "btree" ("partner_id");



CREATE INDEX "affiliate_variant_idx" ON "public"."affiliate_links" USING "btree" ("variant_id");



CREATE INDEX "barrel_slide_req_slide_idx" ON "public"."barrel_slide_requirements" USING "btree" ("slide_product_id");



CREATE INDEX "barrel_specs_pairs_comp_idx" ON "public"."barrel_specs" USING "btree" ("pairs_with_comp_id");



CREATE INDEX "build_fires_build_idx" ON "public"."build_fires" USING "btree" ("build_id");



CREATE INDEX "build_fires_user_idx" ON "public"."build_fires" USING "btree" ("user_id");



CREATE INDEX "build_photos_build_idx" ON "public"."build_photos" USING "btree" ("build_id");



CREATE UNIQUE INDEX "build_photos_one_hero_per_build" ON "public"."build_photos" USING "btree" ("build_id") WHERE "is_hero";



CREATE INDEX "builds_gun_id_idx" ON "public"."builds" USING "btree" ("gun_id") WHERE ("gun_id" IS NOT NULL);



CREATE INDEX "builds_platform_idx" ON "public"."builds" USING "btree" ("platform_id");



CREATE INDEX "builds_user_idx" ON "public"."builds" USING "btree" ("user_id");



CREATE INDEX "frame_specs_housing_idx" ON "public"."frame_specs" USING "btree" ("housing_class");



CREATE INDEX "guides_category_idx" ON "public"."guides" USING "btree" ("category") WHERE "is_published";



CREATE INDEX "guns_platform_idx" ON "public"."guns" USING "btree" ("platform_id");



CREATE INDEX "idx_affiliate_links_live" ON "public"."affiliate_links" USING "btree" ("variant_id") WHERE ("retired_at" IS NULL);



CREATE INDEX "idx_build_comments_build" ON "public"."build_comments" USING "btree" ("build_id", "created_at");



CREATE INDEX "idx_build_comments_parent" ON "public"."build_comments" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "idx_build_comments_user_time" ON "public"."build_comments" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_link_clicks_link_ts" ON "public"."link_clicks" USING "btree" ("link_id", "ts" DESC);



CREATE INDEX "idx_link_clicks_product_ts" ON "public"."link_clicks" USING "btree" ("product_id", "ts" DESC);



CREATE INDEX "idx_link_clicks_ts" ON "public"."link_clicks" USING "btree" ("ts" DESC);



CREATE INDEX "idx_notifications_unread" ON "public"."notifications" USING "btree" ("user_id") WHERE ("read_at" IS NULL);



CREATE INDEX "idx_notifications_unsent" ON "public"."notifications" USING "btree" ("kind", "email_sent_at") WHERE ("email_sent_at" IS NULL);



CREATE INDEX "idx_notifications_user_time" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_price_history_drops" ON "public"."price_history" USING "btree" ("changed_at" DESC) WHERE (("old_price" IS NOT NULL) AND ("new_price" IS NOT NULL) AND ("new_price" < "old_price"));



CREATE INDEX "idx_price_history_link_time" ON "public"."price_history" USING "btree" ("link_id", "changed_at" DESC);



CREATE INDEX "idx_product_variants_live" ON "public"."product_variants" USING "btree" ("product_id") WHERE ("retired_at" IS NULL);



CREATE INDEX "idx_saved_builds_user_id" ON "public"."saved_builds" USING "btree" ("user_id");



CREATE INDEX "idx_sync_drift_review_link" ON "public"."sync_drift_review" USING "btree" ("link_id", "run_at" DESC);



CREATE INDEX "idx_sync_drift_review_open" ON "public"."sync_drift_review" USING "btree" ("run_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "light_compat_light_idx" ON "public"."light_compatibility" USING "btree" ("light_product_id");



CREATE INDEX "light_compat_platform_idx" ON "public"."light_compatibility" USING "btree" ("gun_id");



CREATE INDEX "light_compat_rail_idx" ON "public"."light_compatibility" USING "btree" ("rail_type");



CREATE UNIQUE INDEX "light_compat_unique_fit" ON "public"."light_compatibility" USING "btree" ("light_product_id", "rail_type", "gun_id", "gun_model_text") NULLS NOT DISTINCT;



CREATE INDEX "magazine_frame_requirements_frame_idx" ON "public"."magazine_frame_requirements" USING "btree" ("frame_product_id");



CREATE INDEX "optic_specs_footprint_idx" ON "public"."optic_specs" USING "btree" ("footprint_id");



CREATE INDEX "part_favorites_user_id_idx" ON "public"."part_favorites" USING "btree" ("user_id");



CREATE UNIQUE INDEX "partners_awin_merchant_id_key" ON "public"."partners" USING "btree" ("awin_merchant_id") WHERE ("awin_merchant_id" IS NOT NULL);



CREATE INDEX "product_platforms_platform_idx" ON "public"."product_platforms" USING "btree" ("platform_id");



CREATE INDEX "product_variants_color_idx" ON "public"."product_variants" USING "btree" ("color") WHERE ("retired_at" IS NULL);



CREATE INDEX "products_best_for_idx" ON "public"."products" USING "gin" ("best_for");



CREATE INDEX "products_brand_idx" ON "public"."products" USING "btree" ("brand_id");



CREATE INDEX "products_category_idx" ON "public"."products" USING "btree" ("category") WHERE (NOT "is_discontinued");



CREATE INDEX "products_confidence_idx" ON "public"."products" USING "btree" ("fitment_confidence");



CREATE UNIQUE INDEX "products_id_category_key" ON "public"."products" USING "btree" ("id", "category");



CREATE INDEX "products_material_family_idx" ON "public"."products" USING "btree" ("material_family");



CREATE INDEX "products_search_idx" ON "public"."products" USING "gin" ("search_vector");



CREATE UNIQUE INDEX "uq_notifications_like" ON "public"."notifications" USING "btree" ("user_id", "actor_id", "build_id") WHERE ("kind" = 'like'::"text");



CREATE UNIQUE INDEX "variants_one_default_per_product" ON "public"."product_variants" USING "btree" ("product_id") WHERE "is_default";



CREATE INDEX "variants_product_idx" ON "public"."product_variants" USING "btree" ("product_id");



CREATE OR REPLACE TRIGGER "affiliate_links_price_history_ins" AFTER INSERT ON "public"."affiliate_links" FOR EACH ROW EXECUTE FUNCTION "public"."record_price_change"();



CREATE OR REPLACE TRIGGER "affiliate_links_price_history_upd" AFTER UPDATE ON "public"."affiliate_links" FOR EACH ROW EXECUTE FUNCTION "public"."record_price_change"();



CREATE OR REPLACE TRIGGER "affiliate_updated_at" BEFORE UPDATE ON "public"."affiliate_links" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "barrel_specs_set_class" BEFORE INSERT OR UPDATE OF "barrel_length_in", "platform_id" ON "public"."barrel_specs" FOR EACH ROW EXECUTE FUNCTION "public"."set_part_class"();



CREATE OR REPLACE TRIGGER "builds_updated_at" BEFORE UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "guns_updated_at" BEFORE UPDATE ON "public"."guns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "manufacturers_updated_at" BEFORE UPDATE ON "public"."manufacturers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "partners_updated_at" BEFORE UPDATE ON "public"."partners" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platforms_updated_at" BEFORE UPDATE ON "public"."platforms" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "product_internal_updated_at" BEFORE UPDATE ON "public"."product_internal" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "slide_specs_set_class" BEFORE INSERT OR UPDATE OF "slide_length_in", "platform_id" ON "public"."slide_specs" FOR EACH ROW EXECUTE FUNCTION "public"."set_part_class"();



CREATE OR REPLACE TRIGGER "trg_assign_part_ids" BEFORE INSERT OR UPDATE OF "parts_snapshot" ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."assign_part_ids"();



CREATE OR REPLACE TRIGGER "trg_build_comment_votes_guard" BEFORE INSERT OR UPDATE ON "public"."build_comment_votes" FOR EACH ROW EXECUTE FUNCTION "public"."build_comment_votes_guard"();



CREATE OR REPLACE TRIGGER "trg_build_comments_guard_insert" BEFORE INSERT ON "public"."build_comments" FOR EACH ROW EXECUTE FUNCTION "public"."build_comments_guard_insert"();



CREATE OR REPLACE TRIGGER "trg_build_comments_guard_update" BEFORE UPDATE ON "public"."build_comments" FOR EACH ROW EXECUTE FUNCTION "public"."build_comments_guard_update"();



CREATE OR REPLACE TRIGGER "trg_cascade_builder_agreement" AFTER INSERT ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_builder_agreement_to_profile"();



CREATE OR REPLACE TRIGGER "trg_enforce_build_photo_limit" BEFORE INSERT ON "public"."build_photos" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_build_photo_limit"();



CREATE OR REPLACE TRIGGER "trg_notifications_guard_update" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."notifications_guard_update"();



CREATE OR REPLACE TRIGGER "trg_notify_build_approved" AFTER UPDATE OF "status" ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."notify_build_approved"();



CREATE OR REPLACE TRIGGER "trg_notify_on_comment" AFTER INSERT ON "public"."build_comments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_on_comment"();



CREATE OR REPLACE TRIGGER "trg_notify_on_like" AFTER INSERT OR DELETE ON "public"."build_fires" FOR EACH ROW EXECUTE FUNCTION "public"."notify_on_like"();



CREATE OR REPLACE TRIGGER "trg_prevent_build_consent_tampering" BEFORE UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_build_consent_tampering"();



CREATE OR REPLACE TRIGGER "trg_prevent_build_photo_path_tampering" BEFORE UPDATE ON "public"."build_photos" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_build_photo_path_tampering"();



CREATE OR REPLACE TRIGGER "trg_prevent_owner_edit_history_change" BEFORE UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_owner_edit_history_change"();



CREATE OR REPLACE TRIGGER "trg_prevent_role_self_escalation" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_role_self_escalation"();



CREATE OR REPLACE TRIGGER "trg_restrict_build_status" BEFORE INSERT OR UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_build_status_to_reviewers"();



CREATE OR REPLACE TRIGGER "trg_restrict_owner_edits_on_approved" BEFORE UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_owner_edits_on_approved_build"();



CREATE OR REPLACE TRIGGER "trg_retire_links_with_variant" AFTER UPDATE OF "retired_at" ON "public"."product_variants" FOR EACH ROW EXECUTE FUNCTION "public"."retire_links_with_variant"();



CREATE OR REPLACE TRIGGER "trg_stamp_build_consent" BEFORE INSERT ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_build_consent"();



CREATE OR REPLACE TRIGGER "trg_stamp_build_review" BEFORE UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_build_review"();



CREATE OR REPLACE TRIGGER "trg_zz_notify_build_changes" BEFORE INSERT OR UPDATE ON "public"."builds" FOR EACH ROW EXECUTE FUNCTION "public"."notify_build_changes"();



CREATE OR REPLACE TRIGGER "variants_updated_at" BEFORE UPDATE ON "public"."product_variants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."_archive_products_specs"
    ADD CONSTRAINT "_archive_products_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."adapter_parts"
    ADD CONSTRAINT "adapter_parts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."manufacturers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."adapter_parts"
    ADD CONSTRAINT "adapter_parts_light_product_id_fkey" FOREIGN KEY ("light_product_id") REFERENCES "public"."light_specs"("product_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."adapter_parts"
    ADD CONSTRAINT "adapter_parts_part_type_fk" FOREIGN KEY ("part_type") REFERENCES "public"."adapter_part_types"("part_type");



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."barrel_slide_requirements"
    ADD CONSTRAINT "barrel_slide_requirements_barrel_product_id_fkey" FOREIGN KEY ("barrel_product_id") REFERENCES "public"."barrel_specs"("product_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."barrel_slide_requirements"
    ADD CONSTRAINT "barrel_slide_requirements_slide_product_id_fkey" FOREIGN KEY ("slide_product_id") REFERENCES "public"."slide_specs"("product_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_barrel_class_fk" FOREIGN KEY ("barrel_class") REFERENCES "public"."part_classes"("part_class");



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_caliber_fk" FOREIGN KEY ("caliber") REFERENCES "public"."calibers"("caliber");



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_pairs_with_comp_id_fkey" FOREIGN KEY ("pairs_with_comp_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id");



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_port_style_fk" FOREIGN KEY ("port_style") REFERENCES "public"."port_styles"("port_style");



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."barrel_specs"
    ADD CONSTRAINT "barrel_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."basepad_specs"
    ADD CONSTRAINT "basepad_specs_mag_type_fk" FOREIGN KEY ("fits_mag_type") REFERENCES "public"."mag_types"("mag_type");



ALTER TABLE ONLY "public"."basepad_specs"
    ADD CONSTRAINT "basepad_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."basepad_specs"
    ADD CONSTRAINT "basepad_specs_type_fk" FOREIGN KEY ("basepad_type") REFERENCES "public"."basepad_types"("basepad_type");



ALTER TABLE ONLY "public"."build_comment_votes"
    ADD CONSTRAINT "build_comment_votes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."build_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_comment_votes"
    ADD CONSTRAINT "build_comment_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_comments"
    ADD CONSTRAINT "build_comments_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_comments"
    ADD CONSTRAINT "build_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."build_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_comments"
    ADD CONSTRAINT "build_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_fires"
    ADD CONSTRAINT "build_fires_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_fires"
    ADD CONSTRAINT "build_fires_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_part_flags"
    ADD CONSTRAINT "build_part_flags_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_part_flags"
    ADD CONSTRAINT "build_part_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_photos"
    ADD CONSTRAINT "build_photos_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_photos"
    ADD CONSTRAINT "build_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_gun_fkey" FOREIGN KEY ("gun_id", "platform_id") REFERENCES "public"."guns"("id", "platform_id") ON DELETE SET NULL ("gun_id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compensator_specs"
    ADD CONSTRAINT "comp_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."compensator_specs"
    ADD CONSTRAINT "compensator_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."frame_specs"
    ADD CONSTRAINT "frame_specs_grip_rail_fkey" FOREIGN KEY ("grip_rail_type") REFERENCES "public"."grip_rail_types"("grip_rail_type");



ALTER TABLE ONLY "public"."frame_specs"
    ADD CONSTRAINT "frame_specs_housing_class_fkey" FOREIGN KEY ("housing_class") REFERENCES "public"."housing_classes"("housing_class");



ALTER TABLE ONLY "public"."frame_specs"
    ADD CONSTRAINT "frame_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."frame_specs"
    ADD CONSTRAINT "frame_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guides"
    ADD CONSTRAINT "guides_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gun_optic_cuts"
    ADD CONSTRAINT "gun_optic_cuts_gun_id_fkey" FOREIGN KEY ("gun_id") REFERENCES "public"."guns"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."guns"
    ADD CONSTRAINT "guns_housing_class_fk" FOREIGN KEY ("housing_class") REFERENCES "public"."housing_classes"("housing_class");



ALTER TABLE ONLY "public"."guns"
    ADD CONSTRAINT "guns_housing_class_fkey" FOREIGN KEY ("housing_class") REFERENCES "public"."housing_classes"("housing_class");



ALTER TABLE ONLY "public"."guns"
    ADD CONSTRAINT "guns_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id");



ALTER TABLE ONLY "public"."housing_classes"
    ADD CONSTRAINT "housing_classes_magazine_family_fkey" FOREIGN KEY ("magazine_family") REFERENCES "public"."magazine_families"("magazine_family");



ALTER TABLE ONLY "public"."light_compatibility"
    ADD CONSTRAINT "light_compatibility_gun_id_fkey" FOREIGN KEY ("gun_id") REFERENCES "public"."guns"("id");



ALTER TABLE ONLY "public"."light_compatibility"
    ADD CONSTRAINT "light_compatibility_light_product_id_fkey" FOREIGN KEY ("light_product_id") REFERENCES "public"."light_specs"("product_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."light_compatibility"
    ADD CONSTRAINT "light_compatibility_rail_type_fk" FOREIGN KEY ("rail_type") REFERENCES "public"."rail_types"("rail_type");



ALTER TABLE ONLY "public"."light_compatibility"
    ADD CONSTRAINT "light_compatibility_rail_type_fkey" FOREIGN KEY ("rail_type") REFERENCES "public"."rail_types"("rail_type");



ALTER TABLE ONLY "public"."light_specs"
    ADD CONSTRAINT "light_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."light_specs"
    ADD CONSTRAINT "light_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."link_clicks"
    ADD CONSTRAINT "link_clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."link_clicks"
    ADD CONSTRAINT "link_clicks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mag_release_specs"
    ADD CONSTRAINT "mag_release_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."magazine_frame_requirements"
    ADD CONSTRAINT "magazine_frame_requirements_frame_product_id_fkey" FOREIGN KEY ("frame_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magazine_frame_requirements"
    ADD CONSTRAINT "magazine_frame_requirements_magazine_product_id_fkey" FOREIGN KEY ("magazine_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magazine_specs"
    ADD CONSTRAINT "magazine_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magwell_frame_requirements"
    ADD CONSTRAINT "magwell_frame_requirements_frame_product_id_fkey" FOREIGN KEY ("frame_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magwell_frame_requirements"
    ADD CONSTRAINT "magwell_frame_requirements_magwell_product_id_fkey" FOREIGN KEY ("magwell_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magwell_specs"
    ADD CONSTRAINT "magwell_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."build_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."optic_adapter_footprints"
    ADD CONSTRAINT "optic_adapter_footprints_footprint_id_fkey" FOREIGN KEY ("footprint_id") REFERENCES "public"."footprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."optic_adapter_footprints"
    ADD CONSTRAINT "optic_adapter_footprints_optic_product_id_fkey" FOREIGN KEY ("optic_product_id") REFERENCES "public"."optic_specs"("product_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."optic_cut_footprints"
    ADD CONSTRAINT "optic_cut_footprints_footprint_id_fkey" FOREIGN KEY ("footprint_id") REFERENCES "public"."footprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."optic_cut_footprints"
    ADD CONSTRAINT "optic_cut_footprints_optic_cut_fkey" FOREIGN KEY ("optic_cut") REFERENCES "public"."optic_cuts"("optic_cut") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."optic_specs"
    ADD CONSTRAINT "optic_specs_footprint_id_fkey" FOREIGN KEY ("footprint_id") REFERENCES "public"."footprints"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."optic_specs"
    ADD CONSTRAINT "optic_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."optic_specs"
    ADD CONSTRAINT "optic_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."part_favorites"
    ADD CONSTRAINT "part_favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."part_favorites"
    ADD CONSTRAINT "part_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_part_lengths"
    ADD CONSTRAINT "platform_part_lengths_part_class_fkey" FOREIGN KEY ("part_class") REFERENCES "public"."part_classes"("part_class");



ALTER TABLE ONLY "public"."platform_part_lengths"
    ADD CONSTRAINT "platform_part_lengths_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_skus"
    ADD CONSTRAINT "platform_skus_gun_id_fkey" FOREIGN KEY ("gun_id") REFERENCES "public"."guns"("id");



ALTER TABLE ONLY "public"."price_history"
    ADD CONSTRAINT "price_history_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_internal"
    ADD CONSTRAINT "product_internal_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_platforms"
    ADD CONSTRAINT "product_platforms_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_platforms"
    ADD CONSTRAINT "product_platforms_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_clamp_rail_type_fkey" FOREIGN KEY ("clamp_rail_type") REFERENCES "public"."rail_types"("rail_type");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_clamp_style_fkey" FOREIGN KEY ("clamp_style") REFERENCES "public"."clamp_styles"("clamp_style");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_color_fkey" FOREIGN KEY ("color") REFERENCES "public"."colors"("color") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_handedness_fk" FOREIGN KEY ("handedness") REFERENCES "public"."handedness_types"("handedness");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_optic_cut_fk" FOREIGN KEY ("optic_cut") REFERENCES "public"."optic_cuts"("optic_cut");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_optic_cut_fkey" FOREIGN KEY ("optic_cut") REFERENCES "public"."optic_cuts"("optic_cut");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."manufacturers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_lowest_price_variant_fkey" FOREIGN KEY ("lowest_price_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_material_family_fkey" FOREIGN KEY ("material_family") REFERENCES "public"."materials"("material_family") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_grip_housing_class_fkey" FOREIGN KEY ("grip_housing_class") REFERENCES "public"."housing_classes"("housing_class") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_grip_rail_type_fk" FOREIGN KEY ("grip_rail_type") REFERENCES "public"."grip_rail_types"("grip_rail_type");



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_grip_rail_type_fkey" FOREIGN KEY ("grip_rail_type") REFERENCES "public"."grip_rail_types"("grip_rail_type") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_housing_class_fk" FOREIGN KEY ("grip_housing_class") REFERENCES "public"."housing_classes"("housing_class");



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_light_rail_type_fk" FOREIGN KEY ("light_rail_type") REFERENCES "public"."rail_types"("rail_type");



ALTER TABLE ONLY "public"."rail_bridge"
    ADD CONSTRAINT "rail_bridge_light_rail_type_fkey" FOREIGN KEY ("light_rail_type") REFERENCES "public"."rail_types"("rail_type") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."recoil_spring_specs"
    ADD CONSTRAINT "recoil_spring_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."safety_selector_specs"
    ADD CONSTRAINT "safety_selector_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_builds"
    ADD CONSTRAINT "saved_builds_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_builds"
    ADD CONSTRAINT "saved_builds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sight_specs"
    ADD CONSTRAINT "sight_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slide_release_specs"
    ADD CONSTRAINT "slide_release_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slide_specs"
    ADD CONSTRAINT "slide_specs_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id");



ALTER TABLE ONLY "public"."slide_specs"
    ADD CONSTRAINT "slide_specs_port_style_fk" FOREIGN KEY ("port_style") REFERENCES "public"."port_styles"("port_style");



ALTER TABLE ONLY "public"."slide_specs"
    ADD CONSTRAINT "slide_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."slide_specs"
    ADD CONSTRAINT "slide_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slide_specs"
    ADD CONSTRAINT "slide_specs_slide_class_fk" FOREIGN KEY ("slide_class") REFERENCES "public"."part_classes"("part_class");



ALTER TABLE ONLY "public"."sync_drift_review"
    ADD CONSTRAINT "sync_drift_review_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."takedown_lever_specs"
    ADD CONSTRAINT "takedown_lever_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trigger_specs"
    ADD CONSTRAINT "trigger_specs_product_fkey" FOREIGN KEY ("product_id", "category") REFERENCES "public"."products"("id", "category");



ALTER TABLE ONLY "public"."trigger_specs"
    ADD CONSTRAINT "trigger_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."variant_images"
    ADD CONSTRAINT "variant_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can add photos to any build" ON "public"."build_photos" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can create any build" ON "public"."builds" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can delete any build" ON "public"."builds" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete any build photo" ON "public"."build_photos" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can edit any build photo" ON "public"."build_photos" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can review and edit any build" ON "public"."builds" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can view all build photos" ON "public"."build_photos" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can view all builds" ON "public"."builds" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Owners can add photos to their own unreviewed builds" ON "public"."build_photos" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."builds" "b"
  WHERE (("b"."id" = "build_photos"."build_id") AND ("b"."status" = ANY (ARRAY['draft'::"text", 'pending'::"text"])) AND ("b"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Owners can delete photos from their own unreviewed builds" ON "public"."build_photos" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."builds" "b"
  WHERE (("b"."id" = "build_photos"."build_id") AND ("b"."status" = ANY (ARRAY['draft'::"text", 'pending'::"text"])))))));



CREATE POLICY "Owners can delete their own builds" ON "public"."builds" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can edit photo metadata on their own unreviewed builds" ON "public"."build_photos" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."builds" "b"
  WHERE (("b"."id" = "build_photos"."build_id") AND ("b"."status" = ANY (ARRAY['draft'::"text", 'pending'::"text"]))))))) WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."builds" "b"
  WHERE (("b"."id" = "build_photos"."build_id") AND ("b"."status" = ANY (ARRAY['draft'::"text", 'pending'::"text"])))))));



CREATE POLICY "Owners can edit their own builds" ON "public"."builds" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can view their own build photos" ON "public"."build_photos" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can view their own builds" ON "public"."builds" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Public can view approved builds" ON "public"."builds" FOR SELECT TO "authenticated", "anon" USING (("status" = 'approved'::"text"));



CREATE POLICY "Public can view photos of approved builds" ON "public"."build_photos" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."builds" "b"
  WHERE (("b"."id" = "build_photos"."build_id") AND ("b"."status" = 'approved'::"text")))));



CREATE POLICY "Public reads published guides" ON "public"."guides" FOR SELECT USING (("is_published" = true));



CREATE POLICY "Users can create their own builds" ON "public"."builds" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users delete their own part favorites" ON "public"."part_favorites" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert their own part favorites" ON "public"."part_favorites" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read their own part favorites" ON "public"."part_favorites" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."_archive_products_specs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."adapter_part_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "adapter_part_types_public_read" ON "public"."adapter_part_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."adapter_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "adapter_parts_public_read" ON "public"."adapter_parts" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."affiliate_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."affiliate_links_is_primary_archive" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "affiliate_links_public_read" ON "public"."affiliate_links" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."barrel_slide_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "barrel_slide_requirements_public_read" ON "public"."barrel_slide_requirements" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."barrel_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "barrel_specs_public_read" ON "public"."barrel_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."basepad_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "basepad_specs_public_read" ON "public"."basepad_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."basepad_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "basepad_types_public_read" ON "public"."basepad_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."build_comment_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "build_comment_votes_own" ON "public"."build_comment_votes" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."build_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "build_comments_delete_admin" ON "public"."build_comments" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "build_comments_insert_own" ON "public"."build_comments" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "build_comments_select_own_or_admin" ON "public"."build_comments" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "build_comments_update_own_or_admin" ON "public"."build_comments" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."build_fires" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "build_fires_public_read" ON "public"."build_fires" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."build_part_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "build_part_flags_insert_own" ON "public"."build_part_flags" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."build_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."builds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calibers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calibers_public_read" ON "public"."calibers" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."clamp_styles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clamp_styles_public_read" ON "public"."clamp_styles" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."colors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "colors_admin_insert" ON "public"."colors" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "colors_public_read" ON "public"."colors" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."compensator_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compensator_specs_public_read" ON "public"."compensator_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."footprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "footprints_public_read" ON "public"."footprints" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."frame_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "frame_specs_public_read" ON "public"."frame_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."grip_rail_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "grip_rail_types_public_read" ON "public"."grip_rail_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."guides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gun_optic_cuts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gun_optic_cuts_public_read" ON "public"."gun_optic_cuts" FOR SELECT USING (true);



ALTER TABLE "public"."guns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guns_public_read" ON "public"."guns" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."handedness_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "handedness_types_public_read" ON "public"."handedness_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."housing_classes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "housing_classes_public_read" ON "public"."housing_classes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."light_compatibility" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "light_compatibility_public_read" ON "public"."light_compatibility" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."light_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "light_specs_public_read" ON "public"."light_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."link_clicks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mag_release_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mag_release_specs_public_read" ON "public"."mag_release_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."mag_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mag_types_public_read" ON "public"."mag_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."magazine_families" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "magazine_families_public_read" ON "public"."magazine_families" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."magazine_frame_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "magazine_frame_requirements_public_read" ON "public"."magazine_frame_requirements" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."magazine_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "magazine_specs_public_read" ON "public"."magazine_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."magwell_frame_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "magwell_frame_requirements_public_read" ON "public"."magwell_frame_requirements" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."magwell_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "magwell_specs_public_read" ON "public"."magwell_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."manufacturers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manufacturers_public_read" ON "public"."manufacturers" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materials_public_read" ON "public"."materials" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_own" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_own" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."optic_adapter_footprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "optic_adapter_footprints_public_read" ON "public"."optic_adapter_footprints" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."optic_cut_footprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "optic_cut_footprints_public_read" ON "public"."optic_cut_footprints" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."optic_cuts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "optic_cuts_public_read" ON "public"."optic_cuts" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."optic_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "optic_specs_public_read" ON "public"."optic_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."part_classes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "part_classes_public_read" ON "public"."part_classes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."part_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partners_public_read" ON "public"."partners" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."platform_part_lengths" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_part_lengths_public_read" ON "public"."platform_part_lengths" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."platform_skus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_skus_public_read" ON "public"."platform_skus" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."platforms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platforms_public_read" ON "public"."platforms" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."port_styles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "port_styles_public_read" ON "public"."port_styles" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."price_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_internal" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_internal_admin_delete" ON "public"."product_internal" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "product_internal_admin_insert" ON "public"."product_internal" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "product_internal_admin_read" ON "public"."product_internal" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "product_internal_admin_update" ON "public"."product_internal" FOR UPDATE TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."product_platforms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_platforms_public_read" ON "public"."product_platforms" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."product_variants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_variants_public_read" ON "public"."product_variants" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_public_read" ON "public"."products" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_public_read" ON "public"."profiles" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."rail_bridge" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rail_bridge_public_read" ON "public"."rail_bridge" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."rail_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rail_types_public_read" ON "public"."rail_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."recoil_spring_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recoil_spring_specs_public_read" ON "public"."recoil_spring_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."safety_selector_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "safety_selector_specs_public_read" ON "public"."safety_selector_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."saved_builds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "saved_builds_delete_own" ON "public"."saved_builds" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "saved_builds_insert_own" ON "public"."saved_builds" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "saved_builds_select_own" ON "public"."saved_builds" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."sight_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sight_specs_public_read" ON "public"."sight_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."slide_release_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "slide_release_specs_public_read" ON "public"."slide_release_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."slide_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "slide_specs_public_read" ON "public"."slide_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."spec_field_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "spec_field_rules_public_read" ON "public"."spec_field_rules" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."sync_drift_review" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."takedown_lever_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "takedown_lever_specs_public_read" ON "public"."takedown_lever_specs" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."trigger_specs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trigger_specs_public_read" ON "public"."trigger_specs" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "users_can_fire_builds" ON "public"."build_fires" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_can_unfire_builds" ON "public"."build_fires" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."variant_images" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "variant_images_public_read" ON "public"."variant_images" FOR SELECT TO "authenticated", "anon" USING (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_variants"("p_product_slug" "text", "p_variants" "jsonb", "p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_variants"("p_product_slug" "text", "p_variants" "jsonb", "p_dry_run" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_variants"("p_product_slug" "text", "p_variants" "jsonb", "p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_part_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_part_ids"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_comment_votes_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_comment_votes_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_comments_guard_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_comments_guard_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_comments_guard_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_comments_guard_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cascade_builder_agreement_to_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cascade_builder_agreement_to_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."contest_build_part"("p_build_id" "uuid", "p_part_index" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."contest_build_part"("p_build_id" "uuid", "p_part_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."contest_build_part"("p_build_id" "uuid", "p_part_index" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_product"("p_product" "jsonb", "p_variants" "jsonb", "p_specs" "jsonb", "p_fits" "jsonb", "p_build_id" "uuid", "p_part_index" integer, "p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_product"("p_product" "jsonb", "p_variants" "jsonb", "p_specs" "jsonb", "p_fits" "jsonb", "p_build_id" "uuid", "p_part_index" integer, "p_dry_run" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_product"("p_product" "jsonb", "p_variants" "jsonb", "p_specs" "jsonb", "p_fits" "jsonb", "p_build_id" "uuid", "p_part_index" integer, "p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_variant"("p_product_slug" "text", "p_color" "text", "p_finish" "text", "p_sku" "text", "p_upc" "text", "p_msrp" numeric, "p_image_url" "text", "p_partner_slug" "text", "p_url" "text", "p_affiliate_url" "text", "p_street_price" numeric, "p_in_stock" boolean, "p_variant_label" "text", "p_optic_cut" "text", "p_handedness" "text", "p_notes" "text", "p_make_default" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_variant"("p_product_slug" "text", "p_color" "text", "p_finish" "text", "p_sku" "text", "p_upc" "text", "p_msrp" numeric, "p_image_url" "text", "p_partner_slug" "text", "p_url" "text", "p_affiliate_url" "text", "p_street_price" numeric, "p_in_stock" boolean, "p_variant_label" "text", "p_optic_cut" "text", "p_handedness" "text", "p_notes" "text", "p_make_default" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_variant"("p_product_slug" "text", "p_color" "text", "p_finish" "text", "p_sku" "text", "p_upc" "text", "p_msrp" numeric, "p_image_url" "text", "p_partner_slug" "text", "p_url" "text", "p_affiliate_url" "text", "p_street_price" numeric, "p_in_stock" boolean, "p_variant_label" "text", "p_optic_cut" "text", "p_handedness" "text", "p_notes" "text", "p_make_default" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_variants_for_product"("p_product_id" "uuid", "p_product_slug" "text", "p_variants" "jsonb", "p_caller" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_variants_for_product"("p_product_id" "uuid", "p_product_slug" "text", "p_variants" "jsonb", "p_caller" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_build_photo_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_build_photo_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_trusted_backend"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_trusted_backend"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_trusted_backend"() TO "service_role";



GRANT ALL ON FUNCTION "public"."jsonb_strip_blank"("j" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."jsonb_strip_blank"("j" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."jsonb_strip_blank"("j" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notifications_guard_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notifications_guard_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_build_approved"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_build_approved"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_build_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_build_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_on_comment"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_on_comment"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_on_like"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_on_like"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_build_consent_tampering"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_build_consent_tampering"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_build_photo_path_tampering"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_build_photo_path_tampering"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_owner_edit_history_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_owner_edit_history_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_role_self_escalation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_role_self_escalation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."product_data_status"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."product_data_status"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_data_status"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_price_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_price_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."relink_build_part"("p_build_id" "uuid", "p_part_index" integer, "p_product_id" "uuid", "p_variant_id" "uuid", "p_variant_specs" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."relink_build_part"("p_build_id" "uuid", "p_part_index" integer, "p_product_id" "uuid", "p_variant_id" "uuid", "p_variant_specs" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relink_build_part"("p_build_id" "uuid", "p_part_index" integer, "p_product_id" "uuid", "p_variant_id" "uuid", "p_variant_specs" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_build_status_to_reviewers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_build_status_to_reviewers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_owner_edits_on_approved_build"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_owner_edits_on_approved_build"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."retire_links_with_variant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."retire_links_with_variant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_part_class"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_part_class"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_part_class"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."slugify"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."slugify"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."slugify"("p_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_build_consent"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_build_consent"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_build_review"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_build_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."url_encode"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."url_encode"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."url_encode"("p" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."variant_identity"("p_color" "text", "p_finish" "text", "p_optic_cut" "text", "p_handedness" "text", "p_manual_safety" boolean, "p_reticle" "text", "p_reticle_color" "text", "p_battery_type" "text", "p_mount_system" "text", "p_bundle" "text", "p_clamp" "text", "p_clamp_style" "text", "p_clamp_rail_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."variant_identity"("p_color" "text", "p_finish" "text", "p_optic_cut" "text", "p_handedness" "text", "p_manual_safety" boolean, "p_reticle" "text", "p_reticle_color" "text", "p_battery_type" "text", "p_mount_system" "text", "p_bundle" "text", "p_clamp" "text", "p_clamp_style" "text", "p_clamp_rail_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."with_part_ids"("p_new" "jsonb", "p_old" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."with_part_ids"("p_new" "jsonb", "p_old" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."with_part_ids"("p_new" "jsonb", "p_old" "jsonb") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."_archive_products_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."_archive_products_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."_archive_products_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."adapter_part_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."adapter_part_types" TO "authenticated";
GRANT ALL ON TABLE "public"."adapter_part_types" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."adapter_parts" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."adapter_parts" TO "authenticated";
GRANT ALL ON TABLE "public"."adapter_parts" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."affiliate_links" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."affiliate_links" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_links" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_links_is_primary_archive" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."barrel_slide_requirements" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."barrel_slide_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."barrel_slide_requirements" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."barrel_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."barrel_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."barrel_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."basepad_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."basepad_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."basepad_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."basepad_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."basepad_types" TO "authenticated";
GRANT ALL ON TABLE "public"."basepad_types" TO "service_role";



GRANT ALL ON TABLE "public"."build_comment_votes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."build_comment_votes" TO "authenticated";



GRANT ALL ON TABLE "public"."build_comments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."build_comments" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."builds" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."builds" TO "authenticated";
GRANT ALL ON TABLE "public"."builds" TO "service_role";



GRANT INSERT("gun_id"),UPDATE("gun_id") ON TABLE "public"."builds" TO "authenticated";



GRANT INSERT("fcu_only"),UPDATE("fcu_only") ON TABLE "public"."builds" TO "authenticated";



GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("username") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("username") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("onboarding_complete") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("onboarding_complete") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("bio") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("bio") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("avatar_url") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("instagram_url") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("instagram_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("youtube_url") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("youtube_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."build_comments_public" TO "service_role";
GRANT SELECT ON TABLE "public"."build_comments_public" TO "anon";
GRANT SELECT ON TABLE "public"."build_comments_public" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."build_fires" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."build_fires" TO "authenticated";
GRANT ALL ON TABLE "public"."build_fires" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."build_part_flags" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."build_part_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."build_part_flags" TO "service_role";



GRANT ALL ON SEQUENCE "public"."build_part_flags_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."build_part_flags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."build_part_flags_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."build_photos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."build_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."build_photos" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."calibers" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."calibers" TO "authenticated";
GRANT ALL ON TABLE "public"."calibers" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."clamp_styles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."clamp_styles" TO "authenticated";
GRANT ALL ON TABLE "public"."clamp_styles" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."colors" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."colors" TO "authenticated";
GRANT ALL ON TABLE "public"."colors" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."compensator_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."compensator_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."compensator_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."footprints" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."footprints" TO "authenticated";
GRANT ALL ON TABLE "public"."footprints" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."frame_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."frame_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."frame_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."grip_rail_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."grip_rail_types" TO "authenticated";
GRANT ALL ON TABLE "public"."grip_rail_types" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."guides" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."guides" TO "authenticated";
GRANT ALL ON TABLE "public"."guides" TO "service_role";



GRANT ALL ON TABLE "public"."gun_optic_cuts" TO "service_role";
GRANT SELECT ON TABLE "public"."gun_optic_cuts" TO "anon";
GRANT SELECT ON TABLE "public"."gun_optic_cuts" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."guns" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."guns" TO "authenticated";
GRANT ALL ON TABLE "public"."guns" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."handedness_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."handedness_types" TO "authenticated";
GRANT ALL ON TABLE "public"."handedness_types" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."housing_classes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."housing_classes" TO "authenticated";
GRANT ALL ON TABLE "public"."housing_classes" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."light_compatibility" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."light_compatibility" TO "authenticated";
GRANT ALL ON TABLE "public"."light_compatibility" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."light_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."light_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."light_specs" TO "service_role";



GRANT ALL ON TABLE "public"."link_clicks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."link_clicks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."link_clicks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."link_clicks_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."mag_release_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."mag_release_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."mag_release_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."mag_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."mag_types" TO "authenticated";
GRANT ALL ON TABLE "public"."mag_types" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."magazine_families" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."magazine_families" TO "authenticated";
GRANT ALL ON TABLE "public"."magazine_families" TO "service_role";



GRANT ALL ON TABLE "public"."magazine_frame_requirements" TO "service_role";
GRANT SELECT ON TABLE "public"."magazine_frame_requirements" TO "anon";
GRANT SELECT ON TABLE "public"."magazine_frame_requirements" TO "authenticated";



GRANT ALL ON TABLE "public"."magazine_specs" TO "service_role";
GRANT SELECT ON TABLE "public"."magazine_specs" TO "anon";
GRANT SELECT ON TABLE "public"."magazine_specs" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."magwell_frame_requirements" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."magwell_frame_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."magwell_frame_requirements" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."magwell_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."magwell_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."magwell_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."manufacturers" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."manufacturers" TO "authenticated";
GRANT ALL ON TABLE "public"."manufacturers" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."materials" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."materials" TO "authenticated";
GRANT ALL ON TABLE "public"."materials" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";
GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";



GRANT UPDATE("read_at") ON TABLE "public"."notifications" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."optic_adapter_footprints" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."optic_adapter_footprints" TO "authenticated";
GRANT ALL ON TABLE "public"."optic_adapter_footprints" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."optic_cut_footprints" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."optic_cut_footprints" TO "authenticated";
GRANT ALL ON TABLE "public"."optic_cut_footprints" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."optic_cuts" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."optic_cuts" TO "authenticated";
GRANT ALL ON TABLE "public"."optic_cuts" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."optic_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."optic_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."optic_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."part_classes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."part_classes" TO "authenticated";
GRANT ALL ON TABLE "public"."part_classes" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."part_favorites" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."part_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."part_favorites" TO "service_role";



GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."partners" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."partners" TO "authenticated";
GRANT ALL ON TABLE "public"."partners" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."partners" TO "anon";
GRANT SELECT("id") ON TABLE "public"."partners" TO "authenticated";



GRANT SELECT("slug") ON TABLE "public"."partners" TO "anon";
GRANT SELECT("slug") ON TABLE "public"."partners" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."partners" TO "anon";
GRANT SELECT("name") ON TABLE "public"."partners" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."platform_part_lengths" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."platform_part_lengths" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_part_lengths" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."platform_skus" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."platform_skus" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_skus" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."platforms" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."platforms" TO "authenticated";
GRANT ALL ON TABLE "public"."platforms" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."port_styles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."port_styles" TO "authenticated";
GRANT ALL ON TABLE "public"."port_styles" TO "service_role";



GRANT ALL ON TABLE "public"."price_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."price_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."price_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."price_history_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_internal" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."product_internal" TO "authenticated";
GRANT ALL ON TABLE "public"."product_internal" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_platforms" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."product_platforms" TO "authenticated";
GRANT ALL ON TABLE "public"."product_platforms" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_variants" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."product_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."product_variants" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT SELECT("part_type") ON TABLE "public"."products" TO "anon";
GRANT SELECT("part_type") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("restricted_states") ON TABLE "public"."products" TO "anon";
GRANT SELECT("restricted_states") ON TABLE "public"."products" TO "authenticated";



GRANT ALL ON TABLE "public"."products_needing_data" TO "service_role";
GRANT SELECT ON TABLE "public"."products_needing_data" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."rail_bridge" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."rail_bridge" TO "authenticated";
GRANT ALL ON TABLE "public"."rail_bridge" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."rail_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."rail_types" TO "authenticated";
GRANT ALL ON TABLE "public"."rail_types" TO "service_role";



GRANT ALL ON TABLE "public"."recoil_spring_specs" TO "service_role";
GRANT SELECT ON TABLE "public"."recoil_spring_specs" TO "anon";
GRANT SELECT ON TABLE "public"."recoil_spring_specs" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."safety_selector_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."safety_selector_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."safety_selector_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."saved_builds" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."saved_builds" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_builds" TO "service_role";



GRANT ALL ON TABLE "public"."sight_specs" TO "service_role";
GRANT SELECT ON TABLE "public"."sight_specs" TO "anon";
GRANT SELECT ON TABLE "public"."sight_specs" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."slide_release_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."slide_release_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."slide_release_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."slide_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."slide_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."slide_specs" TO "service_role";



GRANT ALL ON TABLE "public"."spec_field_rules" TO "service_role";
GRANT SELECT ON TABLE "public"."spec_field_rules" TO "anon";
GRANT SELECT ON TABLE "public"."spec_field_rules" TO "authenticated";



GRANT ALL ON TABLE "public"."sync_drift_review" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sync_drift_review_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sync_drift_review_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sync_drift_review_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."takedown_lever_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."takedown_lever_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."takedown_lever_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."trigger_specs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."trigger_specs" TO "authenticated";
GRANT ALL ON TABLE "public"."trigger_specs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_barrel_slide_fit" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_barrel_slide_fit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_barrel_slide_fit" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_comp_barrel_fit" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_comp_barrel_fit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_comp_barrel_fit" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_frame_fitment" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_frame_fitment" TO "authenticated";
GRANT ALL ON TABLE "public"."v_frame_fitment" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_frame_light_fit" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_frame_light_fit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_frame_light_fit" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_optic_slide_variant_fit" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_optic_slide_variant_fit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_optic_slide_variant_fit" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_product_pricing" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_product_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."v_product_pricing" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_slide_frame_fit" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."v_slide_frame_fit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_slide_frame_fit" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."variant_images" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."variant_images" TO "authenticated";
GRANT ALL ON TABLE "public"."variant_images" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";









--
-- Outside the public schema
--
-- Storage buckets (storage.buckets rows: id, name, public, size limit, mime
-- types — the columns every storage-api version has). Created on production
-- 2026-08-06, 2026-08-18 and 2026-09-16.
--

INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types") VALUES ('build-photos', 'build-photos', true, 8388608, '{image/jpeg,image/png,image/webp}') ON CONFLICT ("id") DO NOTHING;
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types") VALUES ('product-images', 'product-images', true, 5242880, '{image/jpeg,image/png,image/webp}') ON CONFLICT ("id") DO NOTHING;
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types") VALUES ('avatars', 'avatars', true, 5242880, '{image/jpeg}') ON CONFLICT ("id") DO NOTHING;

--
-- Policies on storage.objects (pg_dump output, verbatim). The three
-- product-images policies read is_admin() through a SECURITY DEFINER
-- function on purpose: see CLAUDE.md, "A policy's table reads are checked
-- even when the policy doesn't apply".
--


CREATE POLICY "Admin delete product images" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'product-images'::"text") AND "public"."is_admin"()));

CREATE POLICY "Admin update product images" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'product-images'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'product-images'::"text") AND "public"."is_admin"()));

CREATE POLICY "Admin upload product images" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'product-images'::"text") AND "public"."is_admin"()));

CREATE POLICY "Public read access for product images" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'product-images'::"text"));

CREATE POLICY "avatars_owner_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'avatars'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));

CREATE POLICY "avatars_owner_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'avatars'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));

CREATE POLICY "avatars_public_read" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'avatars'::"text"));

CREATE POLICY "build_photos_owner_insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'build-photos'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));

CREATE POLICY "build_photos_owner_or_admin_delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'build-photos'::"text") AND ((("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text") OR "public"."is_admin"())));

CREATE POLICY "build_photos_owner_update" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'build-photos'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text"))) WITH CHECK ((("bucket_id" = 'build-photos'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));

CREATE POLICY "build_photos_public_read" ON "storage"."objects" FOR SELECT TO "authenticated", "anon" USING (("bucket_id" = 'build-photos'::"text"));


--
-- Trigger on auth.users: a new auth user gets a profiles row
-- (public.handle_new_user is in the dump above). pg_dump output, verbatim.
--

CREATE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();


--
-- pg_dump set the session's search_path to '' and a handful of other
-- settings at the top of this file. Put the session back the way the next
-- file expects it.
--

RESET ALL;
