-- optic_cut_footprints: record the basis for "Holosun K-footprint optics
-- mount directly on the RMSc cut" — the row every P365 fit guide walks to
-- list the five live K-footprint optics (407K X2, 507K X2, EPS, EPS Carry,
-- SCS Carry GR) against the family's factory cut.
--
-- Verified 2026-10-20 (Alex), direct mounting: K-footprint optics sit flat
-- on the P365 factory RMSc cut and mount with the two screws that ship with
-- the optic. No plate, no adapter, no lug work. Rifle Configurator's
-- lug-pocket claim does not apply to these. Until now the row's note was a
-- hedge ("overlaps the RMSc pattern on many slides"); it keeps that text
-- and the 2026-09-30 repoint record after the new basis, same shape as the
-- -RXSL note in 20261020031413.
--
-- Exactly one row, keyed by optic_cut plus footprint_id (the holosun-k
-- footprint). `fit` stays 'direct' — it already was; this changes the note
-- only. The sig-loc-compact → holosun-k row is untouched: its basis is
-- SIG's SIG-LOC FAQ, not this test. Notes are not rendered on any page
-- (guide-page.mjs selects optic_cut, fit, footprint_id and the footprint's
-- slug and common_name), so nothing served changes.
--
-- Idempotent: the same two keys always match the same one row and the
-- UPDATE writes the same value. On a fresh database the table is empty when
-- migrations run (seed.sql loads it afterwards and already carries this
-- note), so an empty table is a NOTICE, not an error. Anything else that is
-- not exactly one matched and one updated row raises.

do $$
declare
  n_table   integer;
  n_target  integer;
  n_updated integer;
begin
  select count(*) into n_table from public.optic_cut_footprints;

  select count(*) into n_target
    from public.optic_cut_footprints
   where optic_cut = 'rmsc'
     and footprint_id = '9755f5fd-6201-407d-9f76-eb57495e1fd3';   -- footprints.slug = 'holosun-k'

  if n_table = 0 then
    raise notice 'optic_cut_footprints is empty (fresh database): nothing to update, seed.sql carries the note';
    return;
  end if;

  if n_target <> 1 then
    raise exception 'expected exactly 1 rmsc -> holosun-k row in optic_cut_footprints, found %', n_target;
  end if;

  update public.optic_cut_footprints
     set notes = 'Verified 2026-10-20 (Alex), direct mounting: K-footprint optics sit flat on the P365 factory RMSc cut and mount with the two screws that ship with the optic; no plate, no adapter, no lug work. Rifle Configurator''s lug-pocket claim does not apply. | K-footprint overlaps the RMSc pattern on many slides | Repointed from empty twin footprint holosun-507k, 2026-09-30'
   where optic_cut = 'rmsc'
     and footprint_id = '9755f5fd-6201-407d-9f76-eb57495e1fd3';

  get diagnostics n_updated = row_count;
  if n_updated <> 1 then
    raise exception 'expected to update exactly 1 row, updated %', n_updated;
  end if;

  raise notice 'optic_cut_footprints: rmsc -> holosun-k note now records the 2026-10-20 direct-mount verification';
end $$;
