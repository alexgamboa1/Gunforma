-- Discontinued parts stay visible: a "replaced by" link, and an approval rule
-- that does not ask a discontinued part for a price or a buy link.
-- Alex's policy of 2026-10-30, confirmed 2026-10-31.
--
-- A discontinued part is never hidden or deleted. Owners still have it, builds
-- still list it, and its page keeps its search traffic. The page now says
-- "Discontinued", shows no buy button, and sends the reader on: to the part
-- that replaced it when the MAKER names one, otherwise to similar parts. This
-- file holds the data half; the pages merged and deployed BEFORE it is applied
-- (house order: code first) and read the new column in a query of their own,
-- so until then every discontinued page shows "Similar parts".
--
--   1. products.replaced_by_id  the successor the maker names. Nullable — most
--      discontinued parts have none, and then the page shows similar parts.
--      No second flag: is_discontinued stays the one state, and a successor
--      may only be set on a discontinued part (products_replaced_by_discontinued).
--   2. product_data_status()    for a discontinued part, a variant with no
--      MSRP and a blank products.url move from `missing` to `optional_blank`
--      (the price and the maker's buy page are exactly what a discontinued
--      part loses). Every other product is judged exactly as before.
--   3. The first successor: Streamlight TLR-7 Sub -> TLR-7 X Sub USB.
--
-- The three Olight Valkyrie lights are untouched here: whether Olight still
-- sells them is Alex's call, pending.
--
-- On a fresh database (supabase db reset, the check-migrations runner) the
-- catalog is empty: the schema change applies, and the data block says so in
-- a NOTICE and does nothing. On a database that has the catalog, every row
-- below must be exactly as described or the whole file stops.
--
-- Rollback: supabase/discontinued_replaced_by_rollback.sql.

-- ── 1. The successor link ──────────────────────────────────────────────────

alter table public.products
  add column replaced_by_id uuid references public.products (id) on delete restrict;

alter table public.products
  add constraint products_replaced_by_not_self
    check (replaced_by_id is null or replaced_by_id <> id),
  add constraint products_replaced_by_discontinued
    check (replaced_by_id is null or is_discontinued);

create index idx_products_replaced_by on public.products (replaced_by_id)
  where replaced_by_id is not null;

comment on column public.products.replaced_by_id is
  'The product the maker names as this discontinued part''s successor. Only on a discontinued part. NULL: no named successor — the product page shows similar parts instead.';

-- anon and authenticated read products through the table-level SELECT grant
-- (information_schema, 2026-10-31), so the column is readable with no grant of
-- its own. Writes stay where they were: RLS admits none from either role.

-- ── 2. product_data_status(): no price or buy link asked of a discontinued part
-- Identical to the live definition (20261030041802_approve_fuse_grips.sql)
-- except that it reads is_discontinued, and for a discontinued part reports a
-- blank url and an un-waived missing MSRP under optional_blank, not missing.

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
         p.url, p.weight_oz, p.fitment_notes, p.is_discontinued
    into pr from public.products p where p.id = p_product_id;
  if not found then return null; end if;

  if coalesce(btrim(pr.description), '') = ''     then v_missing := v_missing || 'description'::text; end if;
  if coalesce(btrim(pr.material_family), '') = '' then v_missing := v_missing || 'material_family'::text; end if;
  -- the source page the data came from: create_product() requires it, so a
  -- product without one did not come through it and is not approved — unless
  -- the part is discontinued, when the maker's page is often gone with it
  if coalesce(btrim(pr.url), '') = '' then
    if pr.is_discontinued then v_opt := v_opt || 'url'::text;
    else v_missing := v_missing || 'url'::text; end if;
  end if;

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
  -- under optional_blank, so it stays findable. A discontinued part is never
  -- asked for a price: its MSRP gaps are optional too.
  v_missing := v_missing || array(select 'variant ' || pv.slug || ': photo' from public.product_variants pv
                                   where pv.product_id = p_product_id and pv.retired_at is null and pv.primary_image_url is null
                                     and not pv.no_photo_ok order by pv.slug);
  v_missing := v_missing || array(select 'variant ' || pv.slug || ': msrp' from public.product_variants pv
                                   where pv.product_id = p_product_id and pv.retired_at is null and pv.msrp is null
                                     and not pv.no_msrp_ok and not pr.is_discontinued order by pv.slug);
  v_opt := v_opt || array(select 'variant ' || pv.slug || ': photo' from public.product_variants pv
                           where pv.product_id = p_product_id and pv.retired_at is null and pv.primary_image_url is null
                             and pv.no_photo_ok order by pv.slug);
  v_opt := v_opt || array(select 'variant ' || pv.slug || ': msrp' from public.product_variants pv
                           where pv.product_id = p_product_id and pv.retired_at is null and pv.msrp is null
                             and (pv.no_msrp_ok or pr.is_discontinued) order by pv.slug);

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

-- ── 3. The first successor ─────────────────────────────────────────────────

do $$
declare
  n integer;
  c_old constant text := 'streamlight-tlr-7-sub';
  c_new constant text := 'streamlight-tlr-7-x-sub-usb';
  st jsonb;
begin
  if not exists (select 1 from public.products) then
    raise notice 'discontinued_replaced_by: empty catalog (fresh database) — schema only, no successor';
    return;
  end if;

  perform 1 from public.products where slug = c_new and not is_discontinued and public.is_approved(products);
  if not found then raise exception 'discontinued_replaced_by: % is not a live, approved product', c_new; end if;

  update public.products o set replaced_by_id = s.id
    from public.products s
   where o.slug = c_old and o.is_discontinued and o.replaced_by_id is null
     and s.slug = c_new and o.category = s.category;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'discontinued_replaced_by: expected discontinued % with no successor, same category as %; matched %', c_old, c_new, n; end if;

  -- read back: under the new rule the TLR-7 Sub (no url, one variant with no
  -- MSRP) approves, and both gaps stay findable under optional_blank
  select public.product_data_status(id) into st from public.products where slug = c_old;
  if not coalesce((st ->> 'approved')::boolean, false) then
    raise exception 'discontinued_replaced_by: % is still not approved: %', c_old, st -> 'missing';
  end if;
end $$;
