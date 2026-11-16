-- Slide comp/porting cleanup — the DATA half. Every value here was
-- verified by Alex on 2026-11-15/16 and approved as one table; the schema
-- half is 20261116200000_slide_port_schema.sql and the constraints that
-- depend on these corrections are 20261116200200_slide_port_guards.sql.
--
-- Fresh database: each block NOTICEs and returns when its table is empty —
-- seed.sql (loaded after the migrations) carries the reference tables'
-- post-change rows, and there is no catalog to correct. Drifted rows
-- refuse rather than being overwritten, the house rule for data
-- migrations.

-- ─── port_styles: geometry for every row, geo-port in, slide-matched out ───
do $$
declare
  n integer;
begin
  select count(*) into n from public.port_styles;
  if n = 0 then
    raise notice 'slide_port_data: port_styles is empty (fresh database) — seed.sql carries the post-change rows.';
    return;
  end if;

  if exists (select 1 from public.port_styles where port_style = 'geo-port') then
    raise exception 'port_styles already holds geo-port; this migration expected to introduce it';
  end if;
  if not exists (select 1 from public.port_styles where port_style = 'slide-matched') then
    raise exception 'port_styles no longer holds slide-matched; expected to retire it here';
  end if;

  -- The maker's word stays exactly as the maker writes it: E Port loses
  -- its hyphen (Norsso's own wording), C-Port keeps its hyphen. Do not
  -- normalise display_name.
  update public.port_styles set
    geometry = 'Two Openings',
    notes    = 'Vents on the top side of the barrel. Norsso, Zaffiri. (Alex 2026-11-15)'
   where port_style = 'c-port';

  update public.port_styles set
    display_name = 'E Port',
    geometry = 'Straight Port',
    notes    = 'A straight line of ports along the top of the barrel. Norsso''s name for a straight port. (Alex 2026-11-15)'
   where port_style = 'e-port';

  update public.port_styles set geometry = 'V-Shaped'   where port_style = 'v-port';
  update public.port_styles set geometry = 'Front Port' where port_style = 'chunk-port';
  update public.port_styles set geometry = 'Top + Front' where port_style = 'top-and-chunk';

  -- geo-port takes slide-matched's sort slot (30).
  insert into public.port_styles (port_style, display_name, sort_order, geometry, notes)
  values ('geo-port', 'GEO Port', 30, 'Straight Port',
          'Norsso''s name for the straight port on the N365XL Bull Barrel set. (Alex 2026-11-16)');

  -- slide-matched is still referenced by the two set slides until the next
  -- block moves them, so it is deleted there, not here — and it is the one
  -- row allowed to sit without a geometry in between.
  select count(*) into n from public.port_styles
   where geometry is null and port_style <> 'slide-matched';
  if n <> 0 then
    raise exception 'port_styles: % rows left without a geometry', n;
  end if;
end $$;

-- ─── slide_specs + the two set products ────────────────────────────────────
do $$
declare
  n integer;
  comp_13 text[] := array[
    'norsso-piranha-cport-p365-fuse',  'norsso-rail-cport-p365-xl',
    'norsso-rail-edc-cport-p365',      'norsso-rail-edc-cport-p365-xl',
    'norsso-reptile-cport-p365',       'norsso-reptile-cport-p365-fuse',
    'norsso-reptile-cport-p365-xl',    'norsso-spec-ops-cport-p365',
    'norsso-spec-ops-cport-p365-xl',   'zaffiri-zpsp-p365-xl',
    'norsso-rail-kp-p365-fuse',        'norsso-reptile-kp-p365-fuse',
    'norsso-spec-ops-bull-barrel-ported-set-p365-xl'];
  -- threaded_barrel_ok NULL -> FALSE: each row's own fitment_notes says
  -- "Threaded barrels are NOT compatible" (verified on all 12 on
  -- 2026-11-16; spec-ops-cport-p365-xl says it lowercase). The bull set is
  -- the 12th by Alex's 2026-11-16 ruling: same notes, and a matched set
  -- that must be used together.
  tbo_false text[] := array[
    'norsso-piranha-cport-p365-fuse',  'norsso-rail-cport-p365-xl',
    'norsso-rail-edc-cport-p365',      'norsso-rail-edc-cport-p365-xl',
    'norsso-rail-kp-p365-fuse',        'norsso-reptile-cport-p365',
    'norsso-reptile-cport-p365-fuse',  'norsso-reptile-cport-p365-xl',
    'norsso-reptile-kp-p365-fuse',     'norsso-spec-ops-cport-p365',
    'norsso-spec-ops-cport-p365-xl',   'norsso-spec-ops-bull-barrel-ported-set-p365-xl'];
  -- ported_barrel_ok FALSE: the maker says so — SIG's Spectre Comp build
  -- warning ("Not compatible with ported barrels"), and Alex 2026-11-16
  -- for the four N365DG non-XP slides.
  pbo_false text[] := array[
    'sig-sauer-p365-xl-spectre-comp-slide', 'norsso-rail-n365dg-p365-xl',
    'norsso-rail-edc-n365dg-p365-xl',       'norsso-reptile-og-n365dg-p365-xl',
    'norsso-spec-ops-n365dg-p365-xl'];
  c_mcarbo constant text := 'mcarbo-stainless-slide-ported-barrel-p365xl';
  c_bull   constant text := 'norsso-spec-ops-bull-barrel-ported-set-p365-xl';
begin
  select count(*) into n from public.slide_specs;
  if n = 0 then
    raise notice 'slide_port_data: no slide rows (fresh database) — nothing to correct.';
    return;
  end if;

  -- Preconditions: refuse drifted rows rather than overwrite them.
  select count(*) into n from public.slide_specs s join public.products p on p.id = s.product_id
   where s.comp_style = 'none' and s.port_style is not null;
  if n <> 13 then
    raise exception 'expected exactly 13 slides with comp_style=none and a port_style, found %', n;
  end if;
  select count(*) into n from public.slide_specs s join public.products p on p.id = s.product_id
   where s.comp_style = 'none' and s.port_style is not null and p.slug <> all (comp_13);
  if n <> 0 then
    raise exception '% comp_style=none ported slides are not in the approved list; refusing', n;
  end if;
  if not exists (select 1 from public.slide_specs s join public.products p on p.id = s.product_id
                  where p.slug = c_mcarbo and s.port_style = 'slide-matched' and s.port_count = 6
                    and s.comp_style = 'short_barrel') then
    raise exception 'MCARBO row is not in the expected pre-change state (slide-matched, 6 ports, short_barrel)';
  end if;
  if not exists (select 1 from public.slide_specs s join public.products p on p.id = s.product_id
                  where p.slug = c_bull and s.port_style = 'slide-matched' and s.port_count = 4) then
    raise exception 'Norsso bull-barrel set row is not in the expected pre-change state (slide-matched, 4 ports)';
  end if;
  select count(*) into n from public.slide_specs s join public.products p on p.id = s.product_id
   where p.slug = any (tbo_false) and s.threaded_barrel_ok is not null;
  if n <> 0 then
    raise exception '% of the threaded_barrel_ok targets are no longer NULL; refusing', n;
  end if;

  -- 1. The 13 ported slides whose comp_style said 'none': mechanically
  -- identical to the 8 rows already recorded as ported_barrel — the split
  -- was data-entry drift along maker lines. Classify by mechanism, not
  -- the maker's marketing word. (Alex 2026-11-15; slide_length_in =
  -- barrel_length_in and port_style set on all 13.)
  update public.slide_specs s set comp_style = 'ported_barrel'
    from public.products p
   where p.id = s.product_id and p.slug = any (comp_13);
  get diagnostics n = row_count;
  if n <> 13 then raise exception 'comp_style update touched % rows, expected 13', n; end if;

  -- 2. MCARBO: internally ported into the comp chamber over its included
  -- 3.1in barrel — there are no external slide ports, so port_style and
  -- port_count come off. comp_style stays short_barrel (3.7 slide over a
  -- 3.1 barrel). Verified by Alex 2026-11-15.
  update public.slide_specs s
     set port_style = null, port_count = null, threaded_barrel_ok = false
    from public.products p
   where p.id = s.product_id and p.slug = c_mcarbo;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'MCARBO slide_specs update touched % rows', n; end if;

  update public.products set
    material = '17-4 PH Stainless Steel',
    fitment_confidence = 'verified',
    fitment_notes = coalesce(fitment_notes || ' ', '') ||
      'Verified by Alex 2026-11-15: this is the 3.7in XL slide; MCARBO''s own page labeling is wrong. Internally ported over its included 3.1in barrel.',
    -- "Not sold individually. Must be purchased with a slide order"
    -- applied to the add-ons, not the slide; same meaning, no ambiguity.
    build_warning =
      'Slide and barrel only — the extractor, striker safety and sights are not included. MCARBO sells those add-ons only with a slide order; contact them by email or phone to add them to your order.'
   where slug = c_mcarbo;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'MCARBO products update touched % rows', n; end if;

  -- 3. Norsso bull-barrel set: the slide has ONE straight cutout; the 4
  -- holes are in the barrel. Norsso's own name for the pattern is GEO
  -- Port. (Alex 2026-11-16.)
  update public.slide_specs s set port_style = 'geo-port', port_count = 1
    from public.products p
   where p.id = s.product_id and p.slug = c_bull;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'bull-set slide_specs update touched % rows', n; end if;

  update public.products set
    fitment_confidence = 'verified',
    fitment_notes = coalesce(fitment_notes || ' ', '') ||
      'Matched barrel: Norsso''s N365XL BB 3.7in GEO PORT Bull Barrel — 4 holes venting into the slide''s single cutout. (Verified by Alex 2026-11-16.)'
   where slug = c_bull;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'bull-set products update touched % rows', n; end if;

  -- slide-matched is now unreferenced (both tables carry a port_style FK).
  if exists (select 1 from public.slide_specs where port_style = 'slide-matched')
     or exists (select 1 from public.barrel_specs where port_style = 'slide-matched') then
    raise exception 'slide-matched is still referenced; refusing to delete it';
  end if;
  delete from public.port_styles where port_style = 'slide-matched';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'slide-matched delete removed % rows', n; end if;

  -- 4. threaded_barrel_ok. Zaffiri: intended for ZP ported barrels but
  -- will take a threaded barrel (Alex 2026-11-15).
  update public.slide_specs s set threaded_barrel_ok = true
    from public.products p
   where p.id = s.product_id and p.slug = 'zaffiri-zpsp-p365-xl' and s.threaded_barrel_ok is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'zaffiri threaded_barrel_ok update touched % rows', n; end if;

  update public.slide_specs s set threaded_barrel_ok = false
    from public.products p
   where p.id = s.product_id and p.slug = any (tbo_false) and s.threaded_barrel_ok is null;
  get diagnostics n = row_count;
  if n <> 12 then raise exception 'threaded_barrel_ok=false update touched % rows, expected 12', n; end if;

  -- 5. ported_barrel_ok: TRUE on every ported slide (they are built for —
  -- or sold with — their matched ported barrel) and on the MCARBO set;
  -- FALSE only where the maker says no; NULL elsewhere (not stated).
  update public.slide_specs s set ported_barrel_ok = true
    from public.products p
   where p.id = s.product_id and (s.port_style is not null or p.slug = c_mcarbo);
  get diagnostics n = row_count;
  if n <> 24 then raise exception 'ported_barrel_ok=true update touched % rows, expected 24', n; end if;

  update public.slide_specs s set ported_barrel_ok = false
    from public.products p
   where p.id = s.product_id and p.slug = any (pbo_false);
  get diagnostics n = row_count;
  if n <> 5 then raise exception 'ported_barrel_ok=false update touched % rows, expected 5', n; end if;

  select count(*) into n from public.slide_specs where ported_barrel_ok is null;
  if n <> 22 then raise exception '% slides left with ported_barrel_ok null, expected 22', n; end if;
end $$;

-- ─── barrel_slide_requirements provenance ──────────────────────────────────
-- 23 of the 24 rows carried no source ('barrel spreadsheet import' on the
-- 13 Norsso rows, NULL on the 10 Fdez rows) and no note. The Zaffiri row
-- is the template: source = where the claim can be re-read, note = what
-- the maker says. The barrel's own products.url is the page each claim
-- came from, and its requires_slide_text is the maker's wording.
do $$
declare n integer;
begin
  select count(*) into n from public.barrel_slide_requirements;
  if n = 0 then
    raise notice 'slide_port_data: no barrel_slide_requirements rows (fresh database).';
    return;
  end if;

  select count(*) into n from public.barrel_slide_requirements
   where source is null or source = 'barrel spreadsheet import';
  if n <> 23 then
    raise exception 'expected 23 unsourced barrel_slide_requirements rows, found %', n;
  end if;

  update public.barrel_slide_requirements r
     set source = p.url,
         compatibility_note = coalesce(r.compatibility_note,
           'Matched ported set — ' || bs.requires_slide_text)
    from public.products p
    join public.barrel_specs bs on bs.product_id = p.id
   where p.id = r.barrel_product_id
     and (r.source is null or r.source = 'barrel spreadsheet import');
  get diagnostics n = row_count;
  if n <> 23 then raise exception 'provenance update touched % rows, expected 23', n; end if;

  select count(*) into n from public.barrel_slide_requirements
   where source is null or compatibility_note is null;
  if n <> 0 then raise exception '% rows still missing source or note', n; end if;
end $$;

-- ─── part_classes display names ────────────────────────────────────────────
-- A single-gun label makes the other gun's owner think the part doesn't
-- fit. Size first, every model it serves in the parentheses.
do $$
declare n integer;
begin
  select count(*) into n from public.part_classes;
  if n = 0 then
    raise notice 'slide_port_data: part_classes is empty (fresh database) — seed.sql carries the new names.';
    return;
  end if;

  update public.part_classes set display_name = '3.1in (P365, P365 X)' where part_class = 'p365';
  update public.part_classes set display_name = '3.7in (P365 X, XL, XMacro, AXG)' where part_class = 'xl';
  update public.part_classes set display_name = '4.3in (P365 FUSE)' where part_class = 'fuse';
  update public.part_classes set notes =
    'Unused — no slides or barrels use this. Distinct from fit_tier=''xmacro'', which means the 3.7in slide tier. XMacro proper is a grip-module class — see housing_classes.'
   where part_class = 'xmacro';

  select count(*) into n from public.part_classes
   where (part_class = 'p365'  and display_name <> '3.1in (P365, P365 X)')
      or (part_class = 'xl'    and display_name <> '3.7in (P365 X, XL, XMacro, AXG)')
      or (part_class = 'fuse'  and display_name <> '4.3in (P365 FUSE)');
  if n <> 0 then raise exception 'part_classes display names did not land'; end if;
end $$;

-- ─── compensator thread_pitch: INTRA-LOK is a mounting, not a pitch ────────
-- The two Radian rows already carry mounting_type 'Intra-Lok' and
-- requires_threaded_barrel = false; a thread_pitch of 'INTRA-LOK' asserts
-- a pitch that does not exist.
do $$
declare n integer;
begin
  select count(*) into n from public.compensator_specs;
  if n = 0 then
    raise notice 'slide_port_data: no compensator rows (fresh database).';
    return;
  end if;

  update public.compensator_specs
     set thread_pitch = null
   where thread_pitch = 'INTRA-LOK';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'INTRA-LOK thread_pitch nulling touched % rows, expected 2', n; end if;
end $$;
