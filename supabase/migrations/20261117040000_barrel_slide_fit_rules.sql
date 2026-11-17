-- The fit rule, in the view (Alex, 2026-11-17 — the follow-up to #251;
-- approved as tabled with two corrections). v_barrel_slide_fit decided fit
-- by barrel length + barrel-side locks only, calling three THREADED
-- barrels 'fits' on every thread-refusing slide and seven wrong barrels
-- 'fits' on the Norsso Bull Barrel Set. The product page's own query
-- compensated for threads, so the one page serving false fit information
-- was the Bull Barrel Set's — four standard 3.7in barrels listed that its
-- larger bore cannot take (measured on production 2026-11-17,
-- x-fit-section: listed:5).
--
-- 1) bore_profile on BOTH spec tables: 'standard' | 'bull', NOT NULL
--    default 'standard'. Norsso bull-barrel slides take only Norsso bull
--    barrels (larger bore); profiles must match. Mechanism-based, needs no
--    locks, covers future bull sets. Set 'bull' on the two Norsso bull
--    products. Rule rows (optional) for both categories so add-a-part can
--    set it.
--
-- 2) port_style_is_makers_name on slide_specs: port_styles.display_name is
--    the NAMING maker's own word, and Arc Division names no port design —
--    its two Reactor rows point at 'chunk-port' (another maker's word), so
--    the generated Compensation label must say "Arc Division names no port
--    design for it" and show only the geometry. That fact cannot be
--    derived; this flag records it. Default true; false on the two Arc
--    rows.
--
-- 3) The view, replaced (security_invoker preserved). Existing statuses
--    keep their exact precedence and values — a pair that was 'blocked' or
--    'length-mismatch' yesterday is today. Three new refusals follow them:
--
--      profile-mismatch       bores differ (the bull rule)
--      threaded-not-allowed   threaded/threaded-and-ported barrel on a
--                             slide whose maker says threaded_barrel_ok
--                             = FALSE
--      ported-not-allowed     ported/threaded-and-ported barrel on a
--                             slide whose maker says ported_barrel_ok
--                             = FALSE
--
--    NULL stays allowed — the maker has not stated it — and a threaded
--    barrel fitting a thr-NULL slide says so in its verdict, never
--    presented as confirmed. The asymmetry is deliberate and must not be
--    "fixed": a ported barrel in a slide without matching ports is
--    dangerous; a plain barrel in a ported slide is harmless — so ported
--    slides DO list standard barrels, worded "no comp effect".
--
-- Readers: product-page.mjs, fit-sections.test.mjs and check-routes.mjs
-- all filter fit_status=eq.fits, so the new refusal statuses are excluded
-- by construction; the page KEEPS its own threaded query filters as
-- deliberate redundancy (they also bridge the deploy-before-push gap).
-- check-fitment-data guard 7 asserts no 'fits' pair violates any of the
-- three rules, and was watched failing against the pre-fix view.
-- supabase/tests/barrel-slide-fit.sql drives the view over created
-- fixtures on every PR.
--
-- Expected on production after this applies (counted 2026-11-17):
--   SIG Spectre Comp and each of the 4 N365DG non-XP  -> 4 (standard 3.1)
--   each of the 2 N365DG XP                           -> 5 (4 standard + locked C-Port)
--   each of the 4 C-Port XL slides                    -> 5, zero threaded
--   Zaffiri ZPS.P                                     -> 8 (threaded allowed)
--   Bull Barrel Set                                   -> 1 (the GEO bull barrel)

-- ── 1) columns (replay-safe: plain DDL, idempotent by if-not-exists) ──────
alter table public.slide_specs
  add column if not exists bore_profile text not null default 'standard';
alter table public.barrel_specs
  add column if not exists bore_profile text not null default 'standard';
alter table public.slide_specs
  add column if not exists port_style_is_makers_name boolean not null default true;

do $$ begin
  alter table public.slide_specs
    add constraint slide_specs_bore_profile_valid check (bore_profile in ('standard','bull'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.barrel_specs
    add constraint barrel_specs_bore_profile_valid check (bore_profile in ('standard','bull'));
exception when duplicate_object then null; end $$;

-- ── rule rows: add-a-part can set them; optional, defaulted ───────────────
insert into public.spec_field_rules (category, field, requirement, label, sort_order)
values ('barrel', 'bore_profile', 'optional', 'Bore profile', 85),
       ('slide',  'bore_profile', 'optional', 'Bore profile', 85),
       ('slide',  'port_style_is_makers_name', 'optional', 'Port style is the maker''s own name', 81)
on conflict (category, field) do nothing;

-- ── 2) data: the two bull products, the two Arc rows ──────────────────────
-- Drift-refusing; NOTICE-skips on an empty database (replay).
do $$
declare
  n integer;
  r record;
begin
  select count(*) into n from public.products;
  if n = 0 then
    raise notice 'products is empty (fresh database) — no rows to flag';
    return;
  end if;

  for r in
    select * from (values
      ('norsso-spec-ops-bull-barrel-ported-set-p365-xl', 'slide'),
      ('norsso-n365xl-bb-geo-port-bull-barrel',          'barrel')
    ) as t(slug, kind)
  loop
    if r.kind = 'slide' then
      update public.slide_specs s set bore_profile = 'bull'
        from public.products p where p.id = s.product_id and p.slug = r.slug;
    else
      update public.barrel_specs b set bore_profile = 'bull'
        from public.products p where p.id = b.product_id and p.slug = r.slug;
    end if;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'bore_profile: expected exactly one % spec row for %, touched %', r.kind, r.slug, n;
    end if;
  end loop;

  update public.slide_specs s set port_style_is_makers_name = false
    from public.products p
   where p.id = s.product_id
     and p.slug in ('arc-division-reactor-365x-p365-xmacro', 'arc-division-reactor-365f-p365-fuse');
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'port_style_is_makers_name: expected the two Arc Reactor rows, touched %', n;
  end if;
end $$;

-- ── 3) the view ───────────────────────────────────────────────────────────
create or replace view public.v_barrel_slide_fit
with (security_invoker = true) as
select b.product_id as barrel_product_id,
    s.product_id as slide_product_id,
    b.barrel_length_in,
    s.barrel_length_in as slide_barrel_length_in,
    b.barrel_type,
    case
      when s.barrel_length_in is null then 'unknown'
      when (exists (select 1 from public.barrel_slide_requirements r
                     where r.barrel_product_id = b.product_id))
           and not (exists (select 1 from public.barrel_slide_requirements r
                             where r.barrel_product_id = b.product_id
                               and r.slide_product_id = s.product_id)) then 'blocked'
      when b.barrel_length_in <> s.barrel_length_in then 'length-mismatch'
      when b.bore_profile is distinct from s.bore_profile then 'profile-mismatch'
      when b.barrel_type in ('threaded', 'threaded-and-ported')
           and s.threaded_barrel_ok is false then 'threaded-not-allowed'
      when b.barrel_type in ('ported', 'threaded-and-ported')
           and s.ported_barrel_ok is false then 'ported-not-allowed'
      else 'fits'
    end as fit_status,
    case
      when s.barrel_length_in is null then 'Slide barrel length not recorded. Verify before building.'
      when (exists (select 1 from public.barrel_slide_requirements r
                     where r.barrel_product_id = b.product_id))
           and not (exists (select 1 from public.barrel_slide_requirements r
                             where r.barrel_product_id = b.product_id
                               and r.slide_product_id = s.product_id)) then 'Maker specifies this barrel for other slides only. Do not build.'
      when b.barrel_length_in <> s.barrel_length_in then 'Barrel length does not match the slide.'
      when b.bore_profile is distinct from s.bore_profile then 'Norsso bull-barrel slides take Norsso bull barrels only.'
      when b.barrel_type in ('threaded', 'threaded-and-ported')
           and s.threaded_barrel_ok is false then 'This slide''s maker says threaded barrels don''t fit.'
      when b.barrel_type in ('ported', 'threaded-and-ported')
           and s.ported_barrel_ok is false then 'This slide''s maker says ported barrels must not be used.'
      when b.barrel_type in ('threaded', 'threaded-and-ported')
           and s.threaded_barrel_ok is null then 'Compatible by length; the maker doesn''t state threaded fit.'
      when b.barrel_type = 'standard' and s.comp_style = 'ported_barrel'
        then 'Fits — no comp effect; designed for the matching ported barrel.'
      else 'Compatible.'
    end as verdict
from public.barrel_specs b
cross join public.slide_specs s;
