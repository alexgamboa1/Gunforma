-- v_comp_barrel_fit: a comp fits a barrel only on a matching, stated
-- thread pitch, and a comp sold with its own barrel fits no other barrel
-- (2026-11-24).
--
-- Before this, the view's first branch was `not requires_threaded_barrel
-- => 'fits'`, so both Radian Ramjet + Afterburner kits (Intra-Lok mount,
-- thread_pitch NULL) read 'fits' against all 30 barrels in the catalog —
-- standard, ported and threaded alike. And nothing looked at
-- comes_with_barrel, so the PMM, MCARBO and Radian kits — a comp sold with
-- the barrel it was made for — read 'fits' against every 1/2x28 barrel,
-- including the two P365 FUSE threaded barrels (True Precision, Fdez Werx),
-- which listed all 12 comps as fits.
--
-- The rule now, in order:
--   kit-barrel-only        the comp comes with its own barrel. The catalog
--                          does not list those kit barrels on their own
--                          (compensator_specs.included_barrel is text, no
--                          FK), so there is no pair to call 'fits'.
--   needs-threaded-barrel  unchanged: the barrel is not threaded.
--   pitch-not-stated       either side has no thread pitch. NULL never
--                          matches; an unknown is not a fit.
--   thread-mismatch        unchanged: both stated, different.
--   fits                   both stated, equal.
--
-- requires_threaded_barrel no longer short-circuits anything: a comp that
-- does not thread on (Intra-Lok) has no pitch to match, and the only two
-- live ones are kits anyway.
--
-- Same columns, same order, same names: CREATE OR REPLACE keeps the view's
-- grants, and its one reader (field-note.mjs's ::build comp × barrel pair,
-- which asks for fit_status = 'fits') needs no code change.
--
-- Measured 2026-11-24 (12 comps × 30 barrels = 360 rows):
--   before  fits 140 · needs-threaded-barrel 220
--   after   fits  56 · kit-barrel-only 150 · needs-threaded-barrel 154

create or replace view public.v_comp_barrel_fit with (security_invoker='true') as
 select c.product_id as comp_product_id,
        b.product_id as barrel_product_id,
        c.thread_pitch as comp_thread_pitch,
        b.thread_pitch as barrel_thread_pitch,
        case
            when c.comes_with_barrel then 'kit-barrel-only'::text
            when b.barrel_type <> all (array['threaded'::public.barrel_type, 'threaded-and-ported'::public.barrel_type]) then 'needs-threaded-barrel'::text
            when c.thread_pitch is null or b.thread_pitch is null then 'pitch-not-stated'::text
            when c.thread_pitch <> b.thread_pitch then 'thread-mismatch'::text
            else 'fits'::text
        end as fit_status
   from public.compensator_specs c
  cross join public.barrel_specs b;
