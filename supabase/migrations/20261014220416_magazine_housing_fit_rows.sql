-- magazine_housing_fit rows: the nine catalogue magazines against the four
-- factory P365 housing classes, in the maker's own words. 32 rows, reviewed
-- and approved by AG on 2026-10-14 (PR: "Magazines that fit your P365").
--
-- Every row rests on the maker's fits / not-compatible / included-extras
-- wording on the product's own page (products.url), mapped through
-- guns.housing_class. Combinations the maker does not mention have no row:
-- the XMACRO 10rd and the AXG LEGION 17rd on the p365 and p365xl classes,
-- and every aftermarket-only and P320 class.
--
-- Two rows rest on the owner's confirmation in addition to SIG listing the
-- FUSE: the XMACRO 10rd and the AXG LEGION 17rd on the FUSE (both 'flush').
-- The SIG 17rd on the FUSE cites American Rifleman's FUSE coverage.
--
-- "extended" describes how the magazine sits in the grip, never capacity —
-- the 10rd finger-extension holds the same ten rounds as the flush mag.
--
-- Keyed by product slug so the file reads as what it is. A slug that does
-- not resolve inserts nothing (a fresh branch seeds no products), and the
-- NOTICE says how many rows landed; on production all nine resolve.

do $$
declare
  n_before integer; n_after integer;
begin
  select count(*) into n_before from public.magazine_housing_fit;

  insert into public.magazine_housing_fit (magazine_product_id, housing_class, fit, note, source)
  select p.id, r.housing_class, r.fit, r.note, coalesce(r.source, p.url)
  from (values
    -- 10rd Flush — https://www.sigsauer.com/p365-micro-compact-10rd-9mm-magazine.html
    ('sig-sauer-p365-10rd-flush-mag', 'p365',    'flush',          'Factory flush magazine for the P365', null),
    ('sig-sauer-p365-10rd-flush-mag', 'p365xl',  'not_compatible', 'SIG lists it as not compatible with the P365X and P365-XL', null),
    ('sig-sauer-p365-10rd-flush-mag', 'xmacro',  'not_compatible', 'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-10rd-flush-mag', 'fuse',    'not_compatible', 'SIG lists it as not compatible with the FUSE', null),
    -- 10rd Finger Extension — https://www.sigsauer.com/p365-micro-compact-10rd-9mm-extended-magazine.html
    ('sig-sauer-p365-10rd-finger-ext-mag', 'p365',   'extended',       'Same 10 rounds as the flush mag; the baseplate adds a pinky rest below the grip, no added capacity', null),
    ('sig-sauer-p365-10rd-finger-ext-mag', 'p365xl', 'not_compatible', 'SIG lists it as not compatible with the P365X and P365-XL', null),
    ('sig-sauer-p365-10rd-finger-ext-mag', 'xmacro', 'not_compatible', 'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-10rd-finger-ext-mag', 'fuse',   'not_compatible', 'SIG lists it as not compatible with the FUSE', null),
    -- X/XL 10rd Flush — https://www.sigsauer.com/p365xl-micro-compact-10rd-9mm-magazine-1.html
    ('sig-sauer-p365-x-xl-10rd-mag', 'p365xl', 'flush',          'Factory flush magazine for the P365X, P365-XL and XL COMP', null),
    ('sig-sauer-p365-x-xl-10rd-mag', 'p365',   'not_compatible', 'Not recommended per SIG', null),
    ('sig-sauer-p365-x-xl-10rd-mag', 'xmacro', 'not_compatible', 'Not recommended per SIG', null),
    ('sig-sauer-p365-x-xl-10rd-mag', 'fuse',   'not_compatible', 'Not recommended per SIG', null),
    -- XMACRO 10rd — https://www.sigsauer.com/p365-xmacro-10rd-magazine.html
    ('sig-sauer-p365-xmacro-10rd-mag', 'xmacro', 'flush', 'Factory flush 10-round for the XMACRO, XMACRO COMP, AXG and DH3', null),
    ('sig-sauer-p365-xmacro-10rd-mag', 'fuse',   'flush', 'Factory 10-round for the XMACRO-length grip; sits flush in the FUSE', null),
    -- 12rd — https://www.sigsauer.com/p365-micro-compact-12rd-9mm-magazine.html
    ('sig-sauer-p365-x-xl-12rd-mag', 'p365xl', 'flush',                   'Factory magazine for the P365X and P365-XL', null),
    ('sig-sauer-p365-x-xl-12rd-mag', 'p365',   'with_included_baseplate', 'Swap to the included P365 baseplate; extends below the grip', null),
    ('sig-sauer-p365-x-xl-12rd-mag', 'xmacro', 'not_compatible',          'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-x-xl-12rd-mag', 'fuse',   'not_compatible',          'SIG lists it as not compatible with the FUSE', null),
    -- 15rd — https://www.sigsauer.com/p365-micro-compact-15rd-9mm-magazine.html
    ('sig-sauer-p365-x-xl-15rd-mag', 'p365',   'extended',                'Extends below the grip', null),
    ('sig-sauer-p365-x-xl-15rd-mag', 'p365xl', 'with_included_baseplate', 'Swap to the included P365X / P365-XL baseplate; extends below the grip', null),
    ('sig-sauer-p365-x-xl-15rd-mag', 'xmacro', 'not_compatible',          'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-x-xl-15rd-mag', 'fuse',   'not_compatible',          'SIG lists it as not compatible with the FUSE', null),
    -- 17rd — https://www.sigsauer.com/p365-xmacro-17rd-magazine.html
    ('sig-sauer-p365-17rd-mag', 'xmacro', 'flush',                   'Factory magazine for the XMACRO, XMACRO COMP, AXG and DH3', null),
    ('sig-sauer-p365-17rd-mag', 'fuse',   'flush',                   'Factory flush magazine for the FUSE; the FUSE also ships with extended 21-round mags', 'https://americanrifleman.org/content/new-for-2024-sig-sauer-p365-fuse'),
    ('sig-sauer-p365-17rd-mag', 'p365',   'with_included_baseplate', 'Swap to the included P365 floor plate; extends well below the grip', null),
    ('sig-sauer-p365-17rd-mag', 'p365xl', 'with_included_baseplate', 'Swap to the included P365X / P365-XL floor plate; extends below the grip', null),
    -- AXG LEGION 17rd — https://www.sigsauer.com/p365-axg-legion-17-rd-magazine-black.html
    ('sig-sauer-p365-axg-legion-17rd-mag', 'xmacro', 'flush', 'LEGION alloy basepad installed; factory magazine for the AXG Legion, fits the XMACRO, XMACRO COMP and DH3', null),
    ('sig-sauer-p365-axg-legion-17rd-mag', 'fuse',   'flush', 'LEGION alloy basepad; sits flush in the FUSE grip', null),
    -- TTI 20rd — https://tarantacticalinnovations.com/sig-x-macro-completed-magazine-w-tti-versatile-basepad/
    ('tti-xmacro-completed-mag-w-basepad', 'xmacro', 'extended', '+3 TTI basepad extends below the grip', null),
    ('tti-xmacro-completed-mag-w-basepad', 'p365',   'extended', 'MACRO-length body with a +3 basepad; extends well below the grip', null),
    ('tti-xmacro-completed-mag-w-basepad', 'p365xl', 'extended', 'MACRO-length body with a +3 basepad; extends below the grip', null),
    ('tti-xmacro-completed-mag-w-basepad', 'fuse',   'extended', 'Factory 17-round body with TTI''s +3 basepad; extends below the grip', null)
  ) as r (slug, housing_class, fit, note, source)
  join public.products p on p.slug = r.slug and p.category::text = 'magazine'
  on conflict (magazine_product_id, housing_class) do nothing;

  select count(*) into n_after from public.magazine_housing_fit;
  raise notice 'magazine_housing_fit: % row(s) inserted (% before, % after); 32 expected where all nine magazines exist',
    n_after - n_before, n_before, n_after;
end $$;
