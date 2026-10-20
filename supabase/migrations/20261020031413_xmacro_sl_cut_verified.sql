-- gun_optic_cuts: the P365 XMacro and XMacro Comp -SL / -RXSL rows go from
-- confidence 'likely' to 'verified'. Decision by Alex, 2026-10-19, from his
-- own research: SIG-LOC Compact optics fit those SKUs. Sig's spec field
-- still lists "COMPACT (Shield RMSc)" for them, so that is recorded in the
-- notes rather than hidden. source_url is kept as it was.
--
-- Exactly two rows, keyed by gun_id plus applies_to, no other fit data.
-- These were the only two non-verified rows in the table (2 likely, 19
-- verified, read on production 2026-10-19). The hub's "Which optic cut
-- does it have?" table and the fit guide's cut decoder drop their
-- "(likely)" tag from the data; the typed copy that said "likely" changed
-- in the same PR (netlify/functions/_guide-meta.mjs, _guide-content.mjs).
--
-- Idempotent: re-running finds the same two rows and writes the same
-- values. On a fresh database (db reset, a Supabase branch) the table is
-- empty when migrations run — seed.sql loads it afterwards and already
-- carries the verified rows — so an empty table is a NOTICE, not an error.
-- Anything else that is not exactly two matched rows raises.

do $$
declare
  n_table   integer;
  n_target  integer;
  n_updated integer;
begin
  select count(*) into n_table from public.gun_optic_cuts;

  select count(*) into n_target
    from public.gun_optic_cuts
   where gun_id in ('f3ec2adf-abef-493b-ba3c-972090b4fd18',   -- p365-xmacro
                    '5bbca04c-d997-41c0-bb9c-be80ec7febbf')   -- p365-xmacro-comp
     and applies_to = 'sku-sl-rxsl';

  if n_table = 0 then
    raise notice 'gun_optic_cuts is empty (fresh database): nothing to update, seed.sql carries the verified rows';
    return;
  end if;

  if n_target <> 2 then
    raise exception 'expected exactly 2 XMacro / XMacro Comp sku-sl-rxsl rows in gun_optic_cuts, found %', n_target;
  end if;

  update public.gun_optic_cuts
     set confidence = 'verified',
         notes      = 'Verified 2026-10-19 (Alex). SIG spec field lists COMPACT (Shield RMSc) for -SL/-RXSL; SIG-LOC Compact confirmed to fit.'
   where gun_id in ('f3ec2adf-abef-493b-ba3c-972090b4fd18',
                    '5bbca04c-d997-41c0-bb9c-be80ec7febbf')
     and applies_to = 'sku-sl-rxsl';

  get diagnostics n_updated = row_count;
  if n_updated <> 2 then
    raise exception 'expected to update exactly 2 rows, updated %', n_updated;
  end if;

  raise notice 'gun_optic_cuts: % row(s) set to verified (XMacro, XMacro Comp; sku-sl-rxsl)', n_updated;
end $$;
