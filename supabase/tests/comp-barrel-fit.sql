-- v_comp_barrel_fit: a comp fits a barrel only on a matching, stated
-- thread pitch, and a comp sold with its own barrel fits no other barrel
-- (2026-11-24, *_comp_barrel_fit_thread_pitch.sql). Driven over fixtures
-- created through the real create_product(); everything rolls back.
--
-- Two of the five statuses (pitch-not-stated, thread-mismatch) have no
-- live row today — every live threaded barrel and every non-kit comp is
-- 1/2x28 — so this file is the only place they are exercised.
--
--   cf-thread-comp   1/2x28 thread-on comp                (the Herrington shape)
--   cf-intralok-comp no pitch, not a kit                   (an Intra-Lok comp sold alone)
--   cf-kit-comp      1/2x28 comp sold with its own barrel  (the PMM / MCARBO shape)
--   cf-intralok-kit  no pitch, sold with its own barrel    (the Radian Ramjet shape)
--   cf-thr-half      threaded 1/2x28 barrel
--   cf-thr-916       threaded 9/16x24 barrel
--   cf-std           standard (unthreaded) barrel

begin;

do $$
begin
  perform public.create_product(
    '{"brand":"Compfit","name":"CF Thread Comp","category":"compensator","platforms":["p365"],"url":"https://example.com/cf-thread-comp","slug":"cf-thread-comp"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/c1.jpg","is_default":true}]'::jsonb,
    '{"caliber":"9mm","comes_with_barrel":false,"mounting_type":"Set-Screw","port_design":"Top Port Only","requires_threaded_barrel":true,"thread_pitch":"1/2x28"}'::jsonb);
  perform public.create_product(
    '{"brand":"Compfit","name":"CF Intralok Comp","category":"compensator","platforms":["p365"],"url":"https://example.com/cf-intralok-comp","slug":"cf-intralok-comp"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/c2.jpg","is_default":true}]'::jsonb,
    '{"caliber":"9mm","comes_with_barrel":false,"mounting_type":"Intra-Lok","port_design":"Top Port Only","requires_threaded_barrel":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Compfit","name":"CF Kit Comp","category":"compensator","platforms":["p365"],"url":"https://example.com/cf-kit-comp","slug":"cf-kit-comp"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/c3.jpg","is_default":true}]'::jsonb,
    '{"caliber":"9mm","comes_with_barrel":true,"included_barrel":"P365 3.1in Threaded Barrel","barrel_length_in":3.1,"mounting_type":"Set-Screw","port_design":"Top Port Only","requires_threaded_barrel":true,"thread_pitch":"1/2x28"}'::jsonb);
  perform public.create_product(
    '{"brand":"Compfit","name":"CF Intralok Kit","category":"compensator","platforms":["p365"],"url":"https://example.com/cf-intralok-kit","slug":"cf-intralok-kit"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/c4.jpg","is_default":true}]'::jsonb,
    '{"caliber":"9mm","comes_with_barrel":true,"included_barrel":"P365 3.1in Kit Barrel","barrel_length_in":3.1,"mounting_type":"Intra-Lok","port_design":"Top Port Only","requires_threaded_barrel":false}'::jsonb);

  perform public.create_product(
    '{"brand":"Compfit","name":"CF Threaded Half","category":"barrel","platforms":["p365"],"url":"https://example.com/cf-thr-half","slug":"cf-thr-half"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/b1.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.1,"barrel_type":"threaded","thread_pitch":"1/2x28","caliber":"9mm","is_lci":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Compfit","name":"CF Threaded 916","category":"barrel","platforms":["p365"],"url":"https://example.com/cf-thr-916","slug":"cf-thr-916"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/b2.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.1,"barrel_type":"threaded","thread_pitch":"9/16x24","caliber":"9mm","is_lci":false}'::jsonb);
  perform public.create_product(
    '{"brand":"Compfit","name":"CF Standard","category":"barrel","platforms":["p365"],"url":"https://example.com/cf-std","slug":"cf-std"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/b3.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.1,"barrel_type":"standard","caliber":"9mm","is_lci":false}'::jsonb);
end $$;

do $$
declare
  want record;
  got text;
begin
  for want in
    select * from (values
      -- the one way to fit: both pitches stated and equal
      ('cf-thread-comp',   'cf-thr-half', 'fits'),
      ('cf-thread-comp',   'cf-thr-916',  'thread-mismatch'),
      ('cf-thread-comp',   'cf-std',      'needs-threaded-barrel'),
      -- no pitch never matches — before the fix this was 'fits' on all three
      ('cf-intralok-comp', 'cf-thr-half', 'pitch-not-stated'),
      ('cf-intralok-comp', 'cf-thr-916',  'pitch-not-stated'),
      ('cf-intralok-comp', 'cf-std',      'needs-threaded-barrel'),
      -- a kit fits no other barrel, even one with its own pitch
      ('cf-kit-comp',      'cf-thr-half', 'kit-barrel-only'),
      ('cf-kit-comp',      'cf-std',      'kit-barrel-only'),
      ('cf-intralok-kit',  'cf-thr-half', 'kit-barrel-only'),
      ('cf-intralok-kit',  'cf-std',      'kit-barrel-only')
    ) as t(comp_slug, barrel_slug, status)
  loop
    select f.fit_status into got
      from public.v_comp_barrel_fit f
      join public.products c on c.id = f.comp_product_id
      join public.products b on b.id = f.barrel_product_id
     where c.slug = want.comp_slug and b.slug = want.barrel_slug;
    if not found then
      raise exception '% -> %: no view row at all', want.comp_slug, want.barrel_slug;
    end if;
    if got is distinct from want.status then
      raise exception '% -> %: fit_status is %, expected %', want.comp_slug, want.barrel_slug, got, want.status;
    end if;
  end loop;

  raise notice 'comp-barrel fit view: all assertions passed';
end $$;

rollback;
