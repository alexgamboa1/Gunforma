-- magazine_housing_fit rows for the four Magpul AMAG SG9 P365 magazines
-- (added to the catalog through create_product() on 2026-10-14): 12 rows,
-- reviewed and approved by AG. Same rules as 20261014220416 and
-- 20261014234727: keyed by product slug, idempotent, a slug that does not
-- resolve inserts nothing and the NOTICE says so.
--
-- Where the wording comes from:
--   AMAG 10 on p365 and AMAG 12 on p365xl: flush, owner-confirmed.
--   AMAG 15 on xmacro: extended, owner-confirmed. Magpul's AMAG 15 page says
--     "Flush Floor Plate Configuration" for Macro, but that text is copied
--     from the AMAG 17 page and is not used.
--   AMAG 17 on xmacro: flush per Magpul's AMAG 17 page.
--   No fuse rows: Magpul does not name the FUSE, so under the no-row rule
--     there are none.

do $$
declare
  n_before integer; n_after integer;
begin
  select count(*) into n_before from public.magazine_housing_fit;

  insert into public.magazine_housing_fit (magazine_product_id, housing_class, fit, note, source)
  select p.id, r.housing_class, r.fit, r.note, r.source
  from (values
    ('magpul-amag-10-sg9-p365-mag', 'p365',   'flush',                   'Flush with the standard floorplate; an extended floorplate is also in the box', 'https://magpul.com/amag-10-sg9-sig-p365.html'),
    ('magpul-amag-10-sg9-p365-mag', 'p365xl', 'not_compatible',          'Magpul: not compatible with X/XL grip modules',                                  'https://magpul.com/amag-10-sg9-sig-p365.html'),
    ('magpul-amag-10-sg9-p365-mag', 'xmacro', 'not_compatible',          'Magpul: not compatible with Macro grip modules',                                 'https://magpul.com/amag-10-sg9-sig-p365.html'),
    ('magpul-amag-12-sg9-p365-mag', 'p365',   'with_included_baseplate', 'Fit the included Standard/Micro grip extension',                                 'https://magpul.com/amag-12-sg9-sig-p365.html'),
    ('magpul-amag-12-sg9-p365-mag', 'p365xl', 'flush',                   'Flush with the included X/XL floorplate',                                        'https://magpul.com/amag-12-sg9-sig-p365.html'),
    ('magpul-amag-12-sg9-p365-mag', 'xmacro', 'not_compatible',          'Magpul: not compatible with Macro grip modules',                                 'https://magpul.com/amag-12-sg9-sig-p365.html'),
    ('magpul-amag-15-sg9-p365-mag', 'p365',   'with_included_baseplate', 'Fit the included Standard/Micro grip extension',                                 'https://magpul.com/amag-15-sg9-sig-p365.html'),
    ('magpul-amag-15-sg9-p365-mag', 'p365xl', 'with_included_baseplate', 'Fit the included X/XL grip extension',                                           'https://magpul.com/amag-15-sg9-sig-p365.html'),
    ('magpul-amag-15-sg9-p365-mag', 'xmacro', 'extended',                'Sits slightly below the grip; a little of the silver body shows',                'https://magpul.com/amag-15-sg9-sig-p365.html'),
    ('magpul-amag-17-sg9-p365-mag', 'p365',   'with_included_baseplate', 'Fit the included Standard/Micro grip extension',                                 'https://magpul.com/amag-17-sg9-sig-p365.html'),
    ('magpul-amag-17-sg9-p365-mag', 'p365xl', 'with_included_baseplate', 'Fit the included X/XL grip extension',                                           'https://magpul.com/amag-17-sg9-sig-p365.html'),
    ('magpul-amag-17-sg9-p365-mag', 'xmacro', 'flush',                   'Flush with the standard floorplate',                                             'https://magpul.com/amag-17-sg9-sig-p365.html')
  ) as r (slug, housing_class, fit, note, source)
  join public.products p on p.slug = r.slug and p.category::text = 'magazine'
  on conflict (magazine_product_id, housing_class) do nothing;

  select count(*) into n_after from public.magazine_housing_fit;
  raise notice 'magazine_housing_fit (Magpul AMAG): % row(s) inserted (% before, % after); 12 expected where all four magazines exist',
    n_after - n_before, n_before, n_after;
end $$;
