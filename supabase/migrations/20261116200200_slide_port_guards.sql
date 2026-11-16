-- Slide comp/porting cleanup — the CONSTRAINT half. These only hold after
-- 20261116200100_slide_port_data.sql has corrected the rows (13 slides
-- violated the second one before it), which is why they are a separate
-- file applied after it. The cross-row guards (every ported slide has a
-- barrel lock or an included barrel; every barrel_slide_requirements row
-- has a source; the platform+length ↔ class/tier/spring 1:1) cannot be
-- single-row CHECKs and live in scripts/check-fitment-data.mjs instead.
--
-- NULL semantics, stated on purpose: a NULL slide_length_in or
-- barrel_length_in makes the two length guards PASS, not fail — an
-- unrecorded length is unjudged, never wrong. check-fitment-data.mjs
-- reports NULL lengths separately so they cannot hide forever. (No live
-- row has a NULL length today; the catch is for future entry.)
-- A violation reaches the add-a-part admin page as the dry run's error
-- message naming the constraint below — the page prints error.message
-- verbatim, not a generic failure.

-- Guard 1: a slide longer than its barrel IS the comp-chamber design.
alter table public.slide_specs add constraint slide_specs_short_barrel_means_comp
  check (slide_length_in is null or barrel_length_in is null
         or slide_length_in <= barrel_length_in
         or comp_style = 'short_barrel');

-- Guard 2: equal lengths plus external ports IS the ported-barrel design.
alter table public.slide_specs add constraint slide_specs_equal_length_port_means_ported
  check (slide_length_in is null or barrel_length_in is null
         or slide_length_in <> barrel_length_in
         or port_style is null
         or comp_style = 'ported_barrel');

-- Guard 4: a port count without a style, or a style without a count, is a
-- half-entered row. This is also the backstop for the spec_field_rules
-- port_count scope, which can only name a value LIST of styles.
alter table public.slide_specs add constraint slide_specs_port_count_matches_port_style
  check ((port_count is null) = (port_style is null));
