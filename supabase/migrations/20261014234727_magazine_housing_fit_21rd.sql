-- magazine_housing_fit rows for the SIG P365 9mm 21rd magazine
-- (sig-sauer-p365-21rd-mag, SKUs 8901594 / 8901595), four rows reviewed and
-- approved by AG on 2026-10-14. Same rules as the first rows migration
-- (20261014220416): keyed by product slug, idempotent, a slug that does not
-- resolve inserts nothing and the NOTICE says so.
--
-- Source for all four: https://www.sigsauer.com/p365-9mm-21rd-magazine.html
--
-- Every row is 'extended'. SIG's page says the baseplate "seats flush in
-- XMACRO-size grips"; we read that as no gap at the grip line, not as a
-- flush-fitting magazine — the 17rd is the flush mag in those grips, and a
-- 21-round body extends below every P365 grip. On the P365 and X/XL grips
-- SIG says it works but leaves a gap between the baseplate and the shorter
-- grip, which the note repeats.

do $$
declare
  n_before integer; n_after integer;
begin
  select count(*) into n_before from public.magazine_housing_fit;

  insert into public.magazine_housing_fit (magazine_product_id, housing_class, fit, note, source)
  select p.id, r.housing_class, r.fit, r.note, 'https://www.sigsauer.com/p365-9mm-21rd-magazine.html'
  from (values
    ('sig-sauer-p365-21rd-mag', 'xmacro', 'extended', 'Extends below the grip; the baseplate meets the grip with no gap'),
    ('sig-sauer-p365-21rd-mag', 'fuse',   'extended', 'The FUSE''s factory extended mag; the baseplate meets the grip with no gap'),
    ('sig-sauer-p365-21rd-mag', 'p365',   'extended', 'Works, but leaves a gap between the baseplate and the shorter grip (per SIG)'),
    ('sig-sauer-p365-21rd-mag', 'p365xl', 'extended', 'Works, but leaves a gap between the baseplate and the shorter grip (per SIG)')
  ) as r (slug, housing_class, fit, note)
  join public.products p on p.slug = r.slug and p.category::text = 'magazine'
  on conflict (magazine_product_id, housing_class) do nothing;

  select count(*) into n_after from public.magazine_housing_fit;
  raise notice 'magazine_housing_fit (21rd): % row(s) inserted (% before, % after); 4 expected where the magazine exists',
    n_after - n_before, n_before, n_after;
end $$;
