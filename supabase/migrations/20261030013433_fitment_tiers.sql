-- The P365 fitment model: tiers, comp styles, model-as-prefill. Signed off by
-- Alex 2026-10-29 (fitment-model/SHIP-PROMPT-fitment-for-claude-code.md in
-- the shared notes folder); the code that reads these columns — js/slide-fit.js,
-- the Armory, the catalog — merged and deployed FIRST, probing for them and
-- behaving exactly as before until this file is applied (house order:
-- code first, migration second).
--
-- WHAT CHANGES AND WHY. The model was being used as a filter: pick a FUSE in
-- the Armory and every XMacro grip disappeared. Wrong — every P365 slide goes
-- on every P365 grip (FCU permitting); what differs is where the slide ends.
-- So fit becomes a TIER comparison (short / xmacro / fuse), with the comp
-- style deciding whether a one-tier gap is "needs comp" or "won't fit":
--
--   * fit_tier on frame_specs (grips), slide_specs (slides) and guns (the
--     factory configuration, used as a PREFILL, never a filter).
--   * comp_style on slide_specs and guns: none / short_barrel (a shorter
--     barrel leaves room for the comp inside the slide — XMacro Comp,
--     Spectre) / ported_barrel (full-length chunk-ported barrel — FDEZ, ARC).
--     Neither comp style can take an add-on compensator.
--   * compensator_specs.fit_result: the maker's claim of how an add-on comp
--     lands on the next tier up (flush / partial / extends). Makers don't
--     publish it, so it starts NULL on every comp and the pages hedge
--     ("Comp flush / partially flush"); owner fit reports fill it in later.
--   * slide_specs.includes_barrel: the ARC Reactor kits ship their own
--     chunk-port barrel, so the Armory offers no barrel picker on them.
--
-- All tier columns are nullable: NULL = not yet classified = "Fit not
-- confirmed" on every page, never a guess.
--
-- The FUSE rows in guns were mis-classed: SIG's factory FUSE grip is the
-- XMACRO-size module (the 4.3" slide overhangs it — Sig's own listing for
-- SKU 8901773 says "Factory grip module of the P365-FUSE"), so P365 FUSE and
-- FUSE Comp move to housing_class 'xmacro'. housing_class stays as a grouping
-- label (and the magazine key: the FUSE takes XMacro-family magazines, which
-- this also fixes on the FUSE hub); it no longer decides fit on the P365.
--
-- Grants: frame_specs, slide_specs, compensator_specs and guns all carry
-- table-level SELECT for anon and authenticated (read 2026-10-29), so the new
-- columns are readable with no new grant. No new table, so no RLS work.
--
-- CREATE TYPE values are usable in the same transaction (unlike ALTER TYPE
-- ADD VALUE, the two-file enum rule in CLAUDE.md), so this is one file.
--
-- Rollback: supabase/fitment_tiers_rollback.sql.

-- ── 1. Types ────────────────────────────────────────────────────────────────

create type public.fit_tier as enum ('short', 'xmacro', 'fuse');
create type public.comp_style as enum ('none', 'short_barrel', 'ported_barrel');
create type public.comp_fit_result as enum ('flush', 'partial', 'extends');

comment on type public.fit_tier is
  'Where a P365 part ends, front to back: short (P365/X/XL grips, 3.1" slides), xmacro (XMacro/AXG/OEM-FUSE grips, 3.7"-class slides), fuse (full-FUSE-length grips, 4.3"-class slides). Tier NAMES are what users see, never inches.';
comment on type public.comp_style is
  'How a slide''s compensation works: none (plain), short_barrel (one-step-shorter barrel, comp inside the slide), ported_barrel (full-length chunk-ported barrel). Neither comp style can take an add-on compensator.';
comment on type public.comp_fit_result is
  'The maker''s claim of how an add-on comp lands against the next tier up: flush, partial, or extends past it.';

-- ── 2. Columns (nullable = not yet classified = "Fit not confirmed") ────────

alter table public.frame_specs
  add column fit_tier public.fit_tier;
alter table public.slide_specs
  add column fit_tier public.fit_tier,
  add column comp_style public.comp_style,
  add column includes_barrel boolean not null default false;
alter table public.compensator_specs
  add column fit_result public.comp_fit_result;
alter table public.guns
  add column grip_fit_tier public.fit_tier,
  add column slide_fit_tier public.fit_tier,
  add column slide_comp_style public.comp_style;

comment on column public.slide_specs.fit_tier is
  'Where the SLIDE ends — not the barrel: an XMacro Comp slide carries a 3.1" barrel and is still xmacro tier. barrel_length_in keeps meaning barrel length (Rule 1, barrel <-> slide match, unchanged).';
comment on column public.slide_specs.includes_barrel is
  'The slide ships with its own barrel (ARC Reactor kits): the Armory shows "Barrel included with this kit" and no barrel picker.';
comment on column public.compensator_specs.fit_result is
  'Maker claim first; owner fit reports (photo + result) may fill or override later. NULL renders "Comp flush / partially flush".';
comment on column public.guns.grip_fit_tier is
  'The factory configuration, used by the pages as a PREFILL (tags against the stock slide/grip) — never as a filter.';

-- ── 3. Backfill ─────────────────────────────────────────────────────────────
-- Rule-based where the rule is the fact (housing class -> grip tier; barrel
-- length + integrated_comp -> slide tier and comp style), row-pinned where a
-- specific row is the fact (the guns table, the two ARC kits, the Mischief
-- rename). On a fresh database (supabase db reset, the check-migrations
-- runner) there is no catalog — seed.sql carries lookup tables only — so the
-- DO block says so in a NOTICE and does nothing; on a database that HAS a
-- catalog, every pinned row must be as described or the whole file stops.

do $$
declare
  n integer;
  v_p365 uuid;
begin
  if not exists (select 1 from public.products) then
    raise notice 'fitment_tiers: empty catalog (fresh database) — schema only, no backfill';
    return;
  end if;

  select id into v_p365 from public.platforms where slug = 'p365';
  if v_p365 is null then
    raise exception 'fitment_tiers: no p365 platform row';
  end if;

  -- ── grips: housing class -> tier ─────────────────────────────────────────
  -- p365 / p365xl -> short; xmacro -> xmacro; fuse -> fuse. The two classes
  -- no gun carries map by Alex's per-part calls (2026-10-29): fuse-xl (the
  -- Icarus FUSE EVO, flush with a FUSE slide) -> fuse, and xmacro-sub (the
  -- Icarus Sub MACRO, flush with a 3.1" slide) -> short. The Mischief
  -- Commander G2 "XMacro/Fuse Plus" and the Shalotek FLEX XXLR-17 are
  -- already class fuse; the Commander G2 XXL is already class xmacro ("XXL"
  -- in a name does not decide the tier). P320 classes are untouched.
  update public.frame_specs
     set fit_tier = case housing_class
                      when 'p365'       then 'short'::public.fit_tier
                      when 'p365xl'     then 'short'
                      when 'xmacro-sub' then 'short'
                      when 'xmacro'     then 'xmacro'
                      when 'fuse'       then 'fuse'
                      when 'fuse-xl'    then 'fuse'
                    end
   where housing_class in ('p365', 'p365xl', 'xmacro', 'xmacro-sub', 'fuse', 'fuse-xl');
  get diagnostics n = row_count;
  raise notice 'fitment_tiers: % grip modules tiered', n;
  if n < 1 then
    raise exception 'fitment_tiers: no grip module matched a P365 housing class';
  end if;

  -- ── slides: barrel length + integrated_comp -> tier and comp style ───────
  -- A plain slide ends where its barrel ends. An integrated-comp slide with a
  -- 3.1" barrel is an XL-LENGTH slide whose shorter barrel leaves room for
  -- the comp (all eight confirmed by Alex: the Norsso N365DG family, the
  -- mCarbo compensated slide, the Spectre Comp) -> short_barrel, xmacro. An
  -- integrated-comp slide with a full-length barrel is chunk-ported (FDEZ,
  -- ARC) -> ported_barrel, at its barrel's own tier.
  update public.slide_specs
     set comp_style = case
                        when integrated_comp and barrel_length_in = 3.1 then 'short_barrel'::public.comp_style
                        when integrated_comp                            then 'ported_barrel'
                        else 'none'
                      end,
         fit_tier = case
                      when integrated_comp and barrel_length_in = 3.1 then 'xmacro'::public.fit_tier
                      when barrel_length_in = 3.1 then 'short'
                      when barrel_length_in = 3.7 then 'xmacro'
                      when barrel_length_in = 4.3 then 'fuse'
                    end
   where platform_id = v_p365;
  get diagnostics n = row_count;
  raise notice 'fitment_tiers: % slides tiered', n;
  if n < 1 then
    raise exception 'fitment_tiers: no P365 slide row to tier';
  end if;
  perform 1 from public.slide_specs where platform_id = v_p365 and fit_tier is null;
  if found then
    raise exception 'fitment_tiers: a P365 slide has a barrel length outside 3.1/3.7/4.3 — classify it by hand';
  end if;

  -- ── the ARC Reactor kits ship their own chunk-port barrel ────────────────
  -- And the 365F was slugged ...-p365-xmacro when it is a FUSE slide; the old
  -- path 301s in netlify.toml and check-routes asserts the pair on the wire.
  -- No build or gun guide snapshot carries the product (read 2026-10-29), so
  -- nothing else points at the old slug. The variant slug moves with it.
  update public.products
     set slug = 'arc-division-reactor-365f-p365-fuse'
   where slug = 'arc-division-reactor-365f-p365-xmacro' and category = 'slide';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'fitment_tiers: expected the one slide arc-division-reactor-365f-p365-xmacro, matched %', n;
  end if;
  update public.product_variants v
     set slug = replace(v.slug, 'arc-division-reactor-365f-p365-xmacro', 'arc-division-reactor-365f-p365-fuse')
    from public.products p
   where p.id = v.product_id and p.slug = 'arc-division-reactor-365f-p365-fuse'
     and v.slug like 'arc-division-reactor-365f-p365-xmacro%';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'fitment_tiers: expected the 365F''s one variant slug to move, matched %', n;
  end if;

  update public.slide_specs ss
     set includes_barrel = true
    from public.products p
   where p.id = ss.product_id
     and p.slug in ('arc-division-reactor-365x-p365-xmacro', 'arc-division-reactor-365f-p365-fuse');
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'fitment_tiers: expected the two ARC Reactor kits, matched %', n;
  end if;

  -- ── the Mischief rename: "XMacro/Fuse Plus" is the Fuse Plus ─────────────
  -- Alex confirmed 2026-10-29 it is flush with a FUSE slide (class fuse
  -- already, so its tier came from the class rule above). Name only; the
  -- slug is already mischief-machine-com-g2-fuse, so no URL moves.
  update public.products
     set name = 'Mischief Machine Commander G2 Fuse Plus'
   where slug = 'mischief-machine-com-g2-fuse'
     and name = 'Mischief Machine Commander G2 XMacro/Fuse Plus';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'fitment_tiers: expected the one Commander G2 XMacro/Fuse Plus row, matched %', n;
  end if;

  -- ── factory models: the prefill table, and the FUSE class fix ────────────
  update public.guns g
     set grip_fit_tier    = t.grip::public.fit_tier,
         slide_fit_tier   = t.slide::public.fit_tier,
         slide_comp_style = t.style::public.comp_style
    from (values
      ('p365',             'short',  'short',  'none'),
      ('p365-x',           'short',  'short',  'none'),
      ('p365-xl',          'short',  'xmacro', 'none'),
      ('p365-xl-rose-comp', 'short', 'xmacro', 'short_barrel'),
      ('p365-xmacro',      'xmacro', 'xmacro', 'none'),
      ('p365-xmacro-comp', 'xmacro', 'xmacro', 'short_barrel'),
      ('p365-axg',         'xmacro', 'xmacro', 'short_barrel'),
      ('p365-fuse',        'xmacro', 'fuse',   'none'),
      ('p365-fuse-comp',   'xmacro', 'fuse',   'short_barrel'),
      ('p365-xf-dh3',      'xmacro', 'fuse',   'short_barrel'),
      ('p365-xf-dh3-axg',  'xmacro', 'fuse',   'short_barrel')
    ) as t(slug, grip, slide, style)
   where g.slug = t.slug and g.platform_id = v_p365;
  get diagnostics n = row_count;
  if n <> 11 then
    raise exception 'fitment_tiers: expected all 11 P365 factory models, matched %', n;
  end if;

  -- SIG ships the XMACRO-size module on the FUSE; the 'fuse' class on these
  -- two rows was the mis-class that started this (frame_specs keeps 'fuse'
  -- for the aftermarket full-length modules — the class stays a grouping
  -- label there). This also moves the FUSE hub's magazine list onto the
  -- XMacro family rows in magazine_housing_fit, which is the true claim.
  update public.guns
     set housing_class = 'xmacro'
   where slug in ('p365-fuse', 'p365-fuse-comp') and housing_class = 'fuse';
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'fitment_tiers: expected P365 FUSE and FUSE Comp on housing_class fuse, matched %', n;
  end if;
end $$;
