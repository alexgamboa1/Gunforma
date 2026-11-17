-- The lock-provenance contract (Alex, 2026-11-16): a barrel/slide lock
-- written by create_product() carries its source — defaulted from the
-- BARREL's own row (source = products.url, compatibility_note =
-- barrel_specs.requires_slide_text) when the fit object does not say,
-- in both directions (p_fits.slides on a new barrel, p_fits.barrels on
-- a new slide), with an explicit value still winning.
--
-- Run by .github/workflows/check-migrations.yml against the database the
-- job just replayed from zero, so it drives the REAL function under the
-- REAL spec_field_rules — not a copy of either. psql -v ON_ERROR_STOP=1
-- turns any raise here into a red job. Everything is rolled back.
--
-- Watched failing first: this file ran against the pre-fix function
-- (baseline 20261014065009) and failed exactly here — "lock B→A: source
-- is <NULL>, expected the barrel's url" — before
-- 20261117030000_create_product_lock_source.sql existed.

begin;

do $$
declare
  lock_row record;
begin
  -- a slide to lock onto (no fits of its own)
  perform public.create_product(
    '{"brand":"Locktest","name":"Lock Test Slide A","category":"slide","platforms":["p365"],"url":"https://example.com/slide-a","slug":"lock-test-slide-a"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/a.jpg","is_default":true}]'::jsonb,
    '{"slide_length_in":3.7,"barrel_length_in":3.7,"barrel_included":false,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":true}'::jsonb);

  -- ── direction 1: a new BARREL locks onto the slide (p_fits.slides),
  --    nothing typed → source and note default from the barrel's own row ──
  perform public.create_product(
    '{"brand":"Locktest","name":"Lock Test Barrel B","category":"barrel","platforms":["p365"],"url":"https://example.com/barrel-b","slug":"lock-test-barrel-b"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/b.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.7,"barrel_type":"standard","caliber":"9mm","is_lci":false,"requires_slide_text":"Lock Test slides only"}'::jsonb,
    '{"slides":["lock-test-slide-a"]}'::jsonb);

  select r.source, r.compatibility_note into lock_row
    from public.barrel_slide_requirements r
    join public.products bp on bp.id = r.barrel_product_id
    join public.products sp on sp.id = r.slide_product_id
   where bp.slug = 'lock-test-barrel-b' and sp.slug = 'lock-test-slide-a';
  if not found then
    raise exception 'lock B->A was not written at all';
  end if;
  if lock_row.source is distinct from 'https://example.com/barrel-b' then
    raise exception 'lock B->A: source is %, expected the barrel''s url', coalesce(lock_row.source, '<NULL>');
  end if;
  if lock_row.compatibility_note is distinct from 'Lock Test slides only' then
    raise exception 'lock B->A: compatibility_note is %, expected the barrel''s requires_slide_text', coalesce(lock_row.compatibility_note, '<NULL>');
  end if;

  -- ── direction 2: a new SLIDE names the barrel (p_fits.barrels),
  --    nothing typed → provenance still comes from the BARREL's row ──
  perform public.create_product(
    '{"brand":"Locktest","name":"Lock Test Slide C","category":"slide","platforms":["p365"],"url":"https://example.com/slide-c","slug":"lock-test-slide-c"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/c.jpg","is_default":true}]'::jsonb,
    '{"slide_length_in":3.7,"barrel_length_in":3.7,"barrel_included":false,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":true}'::jsonb,
    '{"barrels":["lock-test-barrel-b"]}'::jsonb);

  select r.source, r.compatibility_note into lock_row
    from public.barrel_slide_requirements r
    join public.products bp on bp.id = r.barrel_product_id
    join public.products sp on sp.id = r.slide_product_id
   where bp.slug = 'lock-test-barrel-b' and sp.slug = 'lock-test-slide-c';
  if not found then
    raise exception 'lock B->C was not written at all';
  end if;
  if lock_row.source is distinct from 'https://example.com/barrel-b' then
    raise exception 'lock B->C: source is %, expected the barrel''s url', coalesce(lock_row.source, '<NULL>');
  end if;
  if lock_row.compatibility_note is distinct from 'Lock Test slides only' then
    raise exception 'lock B->C: compatibility_note is %, expected the barrel''s requires_slide_text', coalesce(lock_row.compatibility_note, '<NULL>');
  end if;

  -- ── an explicit source and note in the fit object still win ──
  perform public.create_product(
    '{"brand":"Locktest","name":"Lock Test Barrel D","category":"barrel","platforms":["p365"],"url":"https://example.com/barrel-d","slug":"lock-test-barrel-d"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/d.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.7,"barrel_type":"standard","caliber":"9mm","is_lci":false,"requires_slide_text":"Should not appear in the lock"}'::jsonb,
    '{"slides":[{"product":"lock-test-slide-a","source":"https://example.com/review-notes","compatibility_note":"Hand-written note"}]}'::jsonb);

  select r.source, r.compatibility_note into lock_row
    from public.barrel_slide_requirements r
    join public.products bp on bp.id = r.barrel_product_id
    join public.products sp on sp.id = r.slide_product_id
   where bp.slug = 'lock-test-barrel-d' and sp.slug = 'lock-test-slide-a';
  if not found then
    raise exception 'lock D->A was not written at all';
  end if;
  if lock_row.source is distinct from 'https://example.com/review-notes'
     or lock_row.compatibility_note is distinct from 'Hand-written note' then
    raise exception 'lock D->A: explicit source/note did not win (got %, %)',
      coalesce(lock_row.source, '<NULL>'), coalesce(lock_row.compatibility_note, '<NULL>');
  end if;

  -- ── guard 5 by construction: no lock row anywhere lacks a source ──
  if exists (select 1 from public.barrel_slide_requirements where source is null) then
    raise exception 'a barrel_slide_requirements row has a NULL source';
  end if;

  raise notice 'create_product lock provenance: all assertions passed';
end $$;

rollback;
