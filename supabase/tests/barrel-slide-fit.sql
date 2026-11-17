-- v_barrel_slide_fit: the fit rule itself, driven over created fixtures on
-- the database check-migrations just replayed (Alex, 2026-11-17 — the
-- fit-rules follow-up to #251). The view is SQL, so this is where its
-- logic is actually exercised: every new refusal, both fits-variant
-- verdicts, and the precedence that keeps existing pairs' statuses
-- byte-identical. Everything rolls back.
--
-- Fixtures are created through the real create_product(), then the ported
-- facts (port_style + port_count + comp_style together, ported_barrel_ok,
-- bore_profile) land in one UPDATE per slide: comp_style and
-- ported_barrel_ok have no spec_field_rules row, so the function refuses
-- the keys, and the #251 CHECK constraints demand the port trio changes
-- as one.
--
-- The shapes mirror the live cases the change was approved on:
--   fv-comp-slide    the Spectre shape  (3.7 slide / 3.1 barrel, thr FALSE, prt FALSE)
--   fv-open-slide    a plain slide, threaded fit NOT stated (NULL)
--   fv-ported-slide  the C-Port shape   (ported_barrel, prt TRUE, thr FALSE, barrel included)
--   fv-bull-slide    the Bull Set shape (ported_barrel, bore bull, barrel included)

begin;

do $$
begin
  -- ── slides, minimal through the function ──────────────────────────────
  -- created with equal lengths, then turned into the Spectre shape in one
  -- UPDATE: the #251 CHECK demands comp_style 'short_barrel' the moment the
  -- slide outruns its barrel, and create_product() has no comp_style key
  -- (no spec_field_rules row), so the function cannot write that row shape.
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Comp Slide","category":"slide","platforms":["p365"],"url":"https://example.com/fv-comp-slide","slug":"fv-comp-slide"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/1.jpg","is_default":true}]'::jsonb,
    '{"slide_length_in":3.7,"barrel_length_in":3.7,"barrel_included":false,"comes_with_sights":false,"integrated_comp":true,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Open Slide","category":"slide","platforms":["p365"],"url":"https://example.com/fv-open-slide","slug":"fv-open-slide"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/2.jpg","is_default":true}]'::jsonb,
    '{"slide_length_in":3.1,"barrel_length_in":3.1,"barrel_included":false,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365 Recoil Spring Assembly"}'::jsonb);
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Ported Slide","category":"slide","platforms":["p365"],"url":"https://example.com/fv-ported-slide","slug":"fv-ported-slide"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/3.jpg","is_default":true}]'::jsonb,
    '{"slide_length_in":3.7,"barrel_length_in":3.7,"barrel_included":true,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Bull Slide","category":"slide","platforms":["p365"],"url":"https://example.com/fv-bull-slide","slug":"fv-bull-slide"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/4.jpg","is_default":true}]'::jsonb,
    '{"slide_length_in":3.7,"barrel_length_in":3.7,"barrel_included":true,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":false}'::jsonb);

  -- the ported facts, trio together so the #251 CHECKs judge a complete row
  update public.slide_specs s
     set port_style = 'c-port', port_count = 2, comp_style = 'ported_barrel', ported_barrel_ok = true
    from public.products p where p.id = s.product_id and p.slug = 'fv-ported-slide';
  update public.slide_specs s
     set port_style = 'geo-port', port_count = 1, comp_style = 'ported_barrel', ported_barrel_ok = true,
         bore_profile = 'bull'
    from public.products p where p.id = s.product_id and p.slug = 'fv-bull-slide';
  update public.slide_specs s
     set barrel_length_in = 3.1, comp_style = 'short_barrel', ported_barrel_ok = false
    from public.products p where p.id = s.product_id and p.slug = 'fv-comp-slide';

  -- ── barrels ───────────────────────────────────────────────────────────
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Standard Barrel 31","category":"barrel","platforms":["p365"],"url":"https://example.com/fv-std-31","slug":"fv-std-31"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/5.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.1,"barrel_type":"standard","caliber":"9mm","is_lci":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Threaded Barrel 31","category":"barrel","platforms":["p365"],"url":"https://example.com/fv-thr-31","slug":"fv-thr-31"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/6.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.1,"barrel_type":"threaded","thread_pitch":"1/2x28","caliber":"9mm","is_lci":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Standard Barrel 37","category":"barrel","platforms":["p365"],"url":"https://example.com/fv-std-37","slug":"fv-std-37"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/7.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.7,"barrel_type":"standard","caliber":"9mm","is_lci":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Bull Barrel 37","category":"barrel","platforms":["p365"],"url":"https://example.com/fv-bull-37","slug":"fv-bull-37"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/8.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.7,"barrel_type":"standard","caliber":"9mm","is_lci":false,"bore_profile":"bull"}'::jsonb);
  -- locked elsewhere: locked to the ported slide, judged against others
  perform public.create_product(
    '{"brand":"Fitview","name":"FV Locked Barrel 37","category":"barrel","platforms":["p365"],"url":"https://example.com/fv-locked-37","slug":"fv-locked-37"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/9.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.7,"barrel_type":"ported","port_style":"c-port","caliber":"9mm","is_lci":false}'::jsonb,
    '{"slides":["fv-ported-slide"]}'::jsonb);
end $$;

-- assertions: one row per (barrel, slide, expected status, expected
-- verdict; NULL skips the verdict check)
do $$
declare
  want record;
  got record;
begin
  for want in
    select * from (values
      -- the Spectre shape refuses threads, takes its standard barrel
      ('fv-thr-31',    'fv-comp-slide',   'threaded-not-allowed', 'This slide''s maker says threaded barrels don''t fit.'),
      ('fv-std-31',    'fv-comp-slide',   'fits',                 'Compatible.'),
      -- not stated is allowed, flagged in the verdict, never confirmed
      ('fv-thr-31',    'fv-open-slide',   'fits',                 'Compatible by length; the maker doesn''t state threaded fit.'),
      -- the asymmetry: a standard barrel on a ported slide fits, worded so
      ('fv-std-37',    'fv-ported-slide', 'fits',                 'Fits — no comp effect; designed for the matching ported barrel.'),
      -- bull takes bull, refuses standard; standard refuses bull
      ('fv-std-37',    'fv-bull-slide',   'profile-mismatch',     'Norsso bull-barrel slides take Norsso bull barrels only.'),
      ('fv-bull-37',   'fv-bull-slide',   'fits',                 null),
      ('fv-bull-37',   'fv-ported-slide', 'profile-mismatch',     null),
      -- existing precedence untouched: a lock outranks everything new, and
      -- a length mismatch outranks the thread refusal
      ('fv-locked-37', 'fv-bull-slide',   'blocked',              'Maker specifies this barrel for other slides only. Do not build.'),
      ('fv-thr-31',    'fv-ported-slide', 'length-mismatch',      'Barrel length does not match the slide.'),
      -- a locked ported barrel on its own slide, prt TRUE: fits
      ('fv-locked-37', 'fv-ported-slide', 'fits',                 null)
    ) as t(barrel_slug, slide_slug, status, verdict)
  loop
    select f.fit_status, f.verdict into got
      from public.v_barrel_slide_fit f
      join public.products b on b.id = f.barrel_product_id
      join public.products s on s.id = f.slide_product_id
     where b.slug = want.barrel_slug and s.slug = want.slide_slug;
    if not found then
      raise exception '% -> %: no view row at all', want.barrel_slug, want.slide_slug;
    end if;
    if got.fit_status is distinct from want.status then
      raise exception '% -> %: fit_status is %, expected %', want.barrel_slug, want.slide_slug, got.fit_status, want.status;
    end if;
    if want.verdict is not null and got.verdict is distinct from want.verdict then
      raise exception '% -> %: verdict is "%", expected "%"', want.barrel_slug, want.slide_slug, got.verdict, want.verdict;
    end if;
  end loop;

  raise notice 'barrel-slide fit view: all assertions passed';
end $$;

rollback;
