-- gun_optic_cuts + sig-loc-compact cut + holosun footprint-twin merge
-- =============================================================================
-- Record of three tracked migrations applied to Gunforma-v2 on 2026-09-30
-- (migration names: gun_optic_cuts, sig_loc_compact_cut_footprints,
-- merge_holosun_footprint_twins). Approved by AG. This file is the repo's
-- copy of what ran, in the price_history.sql tradition — apply nothing from
-- here without checking the live schema first.
--
-- WHY: the guide pages ("what red dots fit a P365 XL?") need the GUN side of
-- optic fitment. The catalog already had the slide side
-- (product_variants.optic_cut -> optic_cut_footprints -> optic_specs
-- .footprint_id) but nothing said what cut a FACTORY pistol carries — and
-- research showed a single guns.optic_cut column cannot be right: 10 of the
-- 11 P365 models vary BY SKU (Sig's -SL/-RXSL suffixes are SIG-LOC slides,
-- -RS is classic RMSc, and the FUSE defaults to SIG-LOC while everything
-- else defaults to RMSc). Verification record, with per-model sources:
-- the claude.ai project doc claude/optic-cut-findings.md.
--
-- The two XMacro -RXSL rows carry confidence='likely': Sig's XMacro pages
-- list an RMSc spec field on SKUs that ship with a factory-mounted ROMEO-X
-- SIG-LOC — self-contradictory, resolved in SIG-LOC's favour because a
-- SIG-LOC optic cannot mount on a pure RMSc cut (per Sig's own FAQ).

-- ── 1. the table ────────────────────────────────────────────────────────────
create table public.gun_optic_cuts (
  gun_id     uuid not null references public.guns(id) on delete restrict,
  optic_cut  text not null,   -- joins optic_cut_footprints.optic_cut; 'none' = not optic-ready
  applies_to text not null,   -- 'default' | 'all-current-skus' | 'sku-sl-rxsl' | 'sku-rs' | 'legacy-non-optic-ready'
  confidence text not null default 'verified' check (confidence in ('verified','likely')),
  source_url text,
  notes      text,
  primary key (gun_id, optic_cut, applies_to)
);

-- CLAUDE.md security convention: RLS on, explicit revoke, re-grant only what
-- the policy needs. Verified after creation: the anon-write drift sweep
-- returns zero rows for this table.
alter table public.gun_optic_cuts enable row level security;
revoke all on public.gun_optic_cuts from anon, authenticated;
grant select on public.gun_optic_cuts to anon, authenticated;
create policy gun_optic_cuts_public_read on public.gun_optic_cuts
  for select using (true);

-- 21 rows inserted, one per (model, cut, sku-group), each carrying its
-- sigsauer.com source URL — see the applied migration for the full VALUES
-- list. Verified after: 21 rows over 11 guns.

-- ── 2. the sig-loc-compact cut ──────────────────────────────────────────────
-- Vocabulary row (the unreferenced 'romeo-x' placeholder — zero references
-- in product_variants, optic_cut_footprints and gun_optic_cuts, checked —
-- was deleted rather than kept as a second name for the same cut):
--   insert into optic_cuts values ('sig-loc-compact', 'SIG-LOC Compact', 'direct', ...);
--   delete from optic_cuts where optic_cut = 'romeo-x';
--
-- Footprint rows: SIG-LOC is a SUPERSET of the rmsc cut, per Sig's SIG-LOC
-- FAQ ("Traditional top-mount reflex sights are still compatible with our
-- SIG-LOC slides", removable recoil lug pins included). So the cut inherits
-- every rmsc mapping, plus its native footprint:
--   insert into optic_cut_footprints
--     select 'sig-loc-compact', footprint_id, fit, ... from optic_cut_footprints where optic_cut='rmsc';
--   insert into optic_cut_footprints
--     select 'sig-loc-compact', id, 'direct', ... from footprints where slug='sig-loc-compact';

-- ── 3. the holosun footprint-twin merge ─────────────────────────────────────
-- Pre-existing bug found during verification: footprints held TWIN rows for
-- one physical pattern — 'holosun-k' (all 5 Holosun K-series optics, incl.
-- the 507K X2 and EPS Carry, with NO cut mapping in) and 'holosun-507k'
-- (the cut mappings, ZERO optics). Net effect: the database said the
-- Holosun 507K fit nothing. Fix: repoint the cut mappings onto 'holosun-k'
-- (whose also_known_as now carries 'Holosun 507K / EPS Carry') and delete
-- the empty twin — the delete would have raised on any surviving reference,
-- and did not.
--
-- Verified after, independently of the migration's own success response:
-- the fit join returns 15 optics for the P365 XL including the 507K X2, and
-- v_optic_slide_variant_fit grew 945 -> 1250 rows (+305 = 5 K-optics x 61
-- RMSc slide variants, exactly as predicted).
