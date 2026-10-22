-- slide_specs.threaded_barrel_ok becomes three answers: true, false, and
-- NULL = "not stated by the maker". 14 slides that said false with nothing
-- behind it move to NULL. Also revokes the write grants authenticated held
-- on v_barrel_slide_fit.
--
-- Why. The add-a-part form forced Yes or No, and the rule row made a blank
-- un-approve the part, so false stood in for "unknown". Product pages then
-- said "Fits Threaded Barrel: No" with nothing behind it. A read-only audit
-- on 2026-10-22 read every maker page for the 20 live slides holding false:
--   maker says no   6  Norsso's N365DG slides, each page saying "Threaded
--                      barrels are not compatible with this slide". They
--                      stay false.
--   not stated     13  the maker page never mentions threaded barrels.
--   not verified    1  Zaffiri ZPS.P: the page is behind a bot check.
-- The 13 and the Zaffiri slide go to NULL below, named by slug.
--
-- 1. spec_field_rules (slide, threaded_barrel_ok): 'required' -> 'optional'.
--    product_data_status() puts a blank required field in `missing`, which
--    un-approves the part; a blank optional one goes in `optional_blank`, so
--    a NULL stays findable on Needs data without holding up approval. The
--    function itself is unchanged. The add-a-part page still makes the admin
--    choose one of Yes / No / Not stated by maker before Save
--    (NOT_STATED_FIELDS), and sends "Not stated" as no key, so the column
--    stays NULL. That page change is in the same PR and works with either
--    rule: until this file is applied, a "Not stated" slide saves unapproved,
--    which is what the dry run says.
--
-- 2. 14 slides: threaded_barrel_ok false -> NULL. Only those rows, only that
--    column. The product page drops a NULL spec row, as it does for every
--    unknown spec, so these pages stop saying "No". Exactly 14 rows must
--    change on the first run; a rerun finds all 14 already NULL and changes
--    nothing; any other state raises. The six N365DG slides must still read
--    false afterwards.
--
-- 3. revoke insert, update, delete on v_barrel_slide_fit from authenticated.
--    The view is a cross join and cannot be written through, so the grants
--    did nothing, but they are the drift CLAUDE.md asks us to sweep for.
--    SELECT stays: anon and authenticated can still read it. Nothing reads it
--    today.
--
-- Fresh database: spec_field_rules is loaded by supabase/seed.sql after
-- migrations (and the seed already says 'optional'), and there are no
-- products, so blocks 1 and 2 are NOTICEs. Block 3 runs everywhere.

do $$
declare
  n_rules   integer;
  cur_req   text;
  n_updated integer;
begin
  select count(*) into n_rules from public.spec_field_rules;
  if n_rules = 0 then
    raise notice 'spec_field_rules is empty (fresh database): seed.sql carries threaded_barrel_ok as optional';
    return;
  end if;

  select requirement into cur_req
    from public.spec_field_rules
   where category = 'slide' and field = 'threaded_barrel_ok';

  if not found then
    raise exception 'spec_field_rules has no (slide, threaded_barrel_ok) row to change';
  end if;
  if cur_req = 'optional' then
    raise notice 'spec_field_rules: slide.threaded_barrel_ok is already optional, nothing to do';
    return;
  end if;

  update public.spec_field_rules
     set requirement = 'optional'
   where category = 'slide' and field = 'threaded_barrel_ok' and requirement = 'required';

  get diagnostics n_updated = row_count;
  if n_updated <> 1 then
    raise exception 'expected to change exactly 1 spec_field_rules row, changed %', n_updated;
  end if;
  raise notice 'spec_field_rules: slide.threaded_barrel_ok required -> optional';
end $$;

do $$
declare
  -- the 13 "not stated" slides and the unverified Zaffiri ZPS.P
  v_slugs constant text[] := array[
    'mcarbo-stainless-slide-ported-barrel-p365xl',
    'norsso-piranha-cport-p365-fuse',
    'norsso-rail-cport-p365-xl',
    'norsso-rail-edc-cport-p365',
    'norsso-rail-edc-cport-p365-xl',
    'norsso-rail-kp-p365-fuse',
    'norsso-reptile-cport-p365',
    'norsso-reptile-cport-p365-fuse',
    'norsso-reptile-cport-p365-xl',
    'norsso-reptile-kp-p365-fuse',
    'norsso-spec-ops-bull-barrel-ported-set-p365-xl',
    'norsso-spec-ops-cport-p365',
    'norsso-spec-ops-cport-p365-xl',
    'zaffiri-zpsp-p365-xl'
  ];
  -- maker says no: these stay false
  v_keep_false constant text[] := array[
    'norsso-rail-edc-n365dg-p365-xl',
    'norsso-rail-edc-n365dg-xp-p365-xl',
    'norsso-rail-n365dg-p365-xl',
    'norsso-reptile-n365dg-xp-p365-xl',
    'norsso-reptile-og-n365dg-p365-xl',
    'norsso-spec-ops-n365dg-p365-xl'
  ];
  n_found   integer;
  n_false   integer;
  n_null    integer;
  n_updated integer;
  v_missing text;
  v_true    text;
  v_kept    integer;
begin
  if not exists (select 1 from public.products) then
    raise notice 'products is empty (fresh database): no slides to change';
    return;
  end if;

  if cardinality(v_slugs) <> 14 then
    raise exception 'expected 14 slugs in the list, found %', cardinality(v_slugs);
  end if;

  -- every slug must be a slide with a spec row
  select string_agg(u.slug, ', ' order by u.slug) into v_missing
    from unnest(v_slugs) as u(slug)
   where not exists (
     select 1 from public.products p
       join public.slide_specs s on s.product_id = p.id
      where p.slug = u.slug and p.category = 'slide');
  if v_missing is not null then
    raise exception 'not a slide with a spec row: %', v_missing;
  end if;

  select count(*),
         count(*) filter (where s.threaded_barrel_ok = false),
         count(*) filter (where s.threaded_barrel_ok is null),
         string_agg(p.slug, ', ' order by p.slug) filter (where s.threaded_barrel_ok = true)
    into n_found, n_false, n_null, v_true
    from public.products p
    join public.slide_specs s on s.product_id = p.id
   where p.slug = any (v_slugs);

  if n_found <> 14 then
    raise exception 'expected 14 slide spec rows for the listed slugs, found %', n_found;
  end if;
  if v_true is not null then
    raise exception 'refusing: these listed slides now say true, which nobody audited: %', v_true;
  end if;

  if n_null = 14 then
    raise notice 'slide_specs: all 14 listed slides already NULL, nothing to do';
  elsif n_false = 14 then
    update public.slide_specs s
       set threaded_barrel_ok = null
      from public.products p
     where p.id = s.product_id
       and p.slug = any (v_slugs)
       and s.threaded_barrel_ok = false;

    get diagnostics n_updated = row_count;
    if n_updated <> 14 then
      raise exception 'expected to change exactly 14 slide_specs rows, changed %', n_updated;
    end if;
    raise notice 'slide_specs: threaded_barrel_ok false -> NULL on 14 slides';
  else
    raise exception 'expected the 14 listed slides to be all false (first run) or all NULL (rerun); found % false, % NULL', n_false, n_null;
  end if;

  -- the six maker-says-no slides are untouched and still false
  select count(*) into v_kept
    from public.products p
    join public.slide_specs s on s.product_id = p.id
   where p.slug = any (v_keep_false) and s.threaded_barrel_ok = false;
  if v_kept <> 6 then
    raise exception 'expected the 6 N365DG slides to read false, % do', v_kept;
  end if;
end $$;

revoke insert, update, delete on public.v_barrel_slide_fit from authenticated;
