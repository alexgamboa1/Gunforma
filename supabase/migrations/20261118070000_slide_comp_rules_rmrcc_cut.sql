-- Slides state their comp style, and the RMRcc cut exists (Alex, 2026-11-18).
--
-- 1. create_product() could not set slide_specs.comp_style or
--    ported_barrel_ok — neither had a spec_field_rules row, and the function
--    accepts only ruled keys — so a slide added through add-a-part saved
--    with comp_style NULL, and the three slide_port_guards CHECKs all pass
--    on NULL (comp_style = 'short_barrel' is NULL, and a CHECK refuses only
--    FALSE). The three Norsso bull sets were being saved with it set by
--    hand. Two rule rows close the entry gap; NOT NULL closes the guard
--    gap. create_product() needs no change for either:
--      * its NOT-NULL-without-default sweep already refuses a slide sheet
--        missing comp_style IN WORDS ("the slide spec sheet needs:
--        comp_style"), dry run included, so the add-part page's Check shows
--        the sentence and Save never sends the gap;
--      * jsonb_populate_record casts the text value to the comp_style enum,
--        and a value outside the enum is refused by the type.
--    ported_barrel_ok stays nullable and its rule optional: NULL means "not
--    stated by the maker" (the threaded_barrel_ok convention), reported
--    under optional_blank, never missing. The page draws it Yes / No / Not
--    stated (NOT_STATED_FIELDS, same commit).
--
-- 2. optic_cuts gains 'rmrcc' (display "Trijicon RMRcc", direct mount),
--    linked to the EXISTING rmrcc footprint row, so slides sold in an RMRcc
--    cut can carry it — product_variants.optic_cut is a foreign key to
--    optic_cuts, so until this row exists no variant can say it.
--
-- Checked on production 2026-11-18 before writing: zero slide_specs rows
-- with comp_style NULL (the bull sets' hand-set values included), and
-- footprints already holds slug 'rmrcc' ("Trijicon RMRcc") with no
-- optic_cuts row or cut-to-footprint link naming it.
--
-- Fresh database: the rule rows and the optic_cuts row replay as plain
-- inserts; SET NOT NULL passes on an empty table; the cut-to-footprint link
-- NOTICEs and skips when footprints is empty (the footprint rows are seed
-- data, not migration history). A non-empty footprints table missing
-- 'rmrcc' is drift and refuses.

-- ── 1a. the two rule rows ──────────────────────────────────────────────────
-- Sort order slots comp_style at 70 (the mechanism, read before port_style
-- at 80) and ported_barrel_ok at 115 (beside threaded_barrel_ok at 110).
insert into public.spec_field_rules (category, field, requirement, label, sort_order)
values
  ('slide', 'comp_style',       'required', 'Compensation style',     70),
  ('slide', 'ported_barrel_ok', 'optional', 'Takes a ported barrel', 115)
on conflict (category, field) do nothing;

-- ── 1b. comp_style NOT NULL ────────────────────────────────────────────────
-- Zero NULLs on 2026-11-18. If one arrives between then and the push, name
-- it instead of failing with SET NOT NULL's generic error: the fix is an
-- UPDATE classifying that slide by MECHANISM (CLAUDE.md, slide porting
-- vocabulary), never a default.
do $$
declare bad text;
begin
  select string_agg(p.slug, ', ' order by p.slug) into bad
    from public.slide_specs s
    join public.products p on p.id = s.product_id
   where s.comp_style is null;
  if bad is not null then
    raise exception 'slide_specs.comp_style is NULL on: %. Classify each by mechanism (none / short_barrel / ported_barrel) before this migration.', bad;
  end if;
end $$;

alter table public.slide_specs
  alter column comp_style set not null;

-- ── 2. the RMRcc optic cut ─────────────────────────────────────────────────
insert into public.optic_cuts (optic_cut, display_name, mounting, notes)
values ('rmrcc', 'Trijicon RMRcc', 'direct',
        'RMRcc-specific pocket. Smaller than the RMR — the two are not interchangeable.')
on conflict (optic_cut) do nothing;

do $$
declare
  fp uuid;
  n  integer;
begin
  select id into fp from public.footprints where slug = 'rmrcc';
  if fp is null then
    select count(*) into n from public.footprints;
    if n = 0 then
      raise notice 'footprints is empty (fresh database) — the rmrcc cut-to-footprint link arrives with the footprint seed';
      return;
    end if;
    raise exception 'footprints has % rows but none with slug rmrcc — drift: that footprint has been live since the footprint seed', n;
  end if;

  insert into public.optic_cut_footprints (optic_cut, footprint_id, fit, notes)
  values ('rmrcc', fp, 'direct', null)
  on conflict (optic_cut, footprint_id) do nothing;
end $$;
