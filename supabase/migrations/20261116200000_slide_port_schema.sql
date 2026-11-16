-- Slide comp/porting cleanup — the SCHEMA half. The data corrections are
-- 20261116200100_slide_port_data.sql, and the constraints that only hold
-- after those corrections are 20261116200200_slide_port_guards.sql.
--
-- House order: the code that stops reading the dropped columns, stops
-- naming pros/cons in product-page's main select, and tolerates the
-- window_cuts rename is merged and DEPLOYED before this file is pushed.
-- Every reader was enumerated on 2026-11-16 (the PR lists them).
--
-- Fresh database: every statement here is pure DDL against the baseline
-- shape, plus spec_field_rules updates that match zero rows while that
-- table is empty (seed.sql, loaded after the migrations, carries the
-- post-change rows).

-- 1. port_styles.geometry — Gunforma's plain-words classification of a
--    maker's own port_style name. Several maker names may share one
--    geometry (e-port and geo-port are both a straight port). Rendered as
--    "{display_name} ({geometry})" by product-page.mjs.
alter table public.port_styles add column geometry text;

comment on column public.port_styles.port_style is
  'The maker''s own name for the port pattern (c-port, geo-port, …). Gunforma''s plain-words classification is geometry.';
comment on column public.port_styles.geometry is
  'Gunforma''s plain-words classification of the pattern (Two Openings, Straight Port, …). Several maker names may share one. Pages render "{display_name} ({geometry})".';

-- 2. ported_barrel_ok — may this slide take a PORTED barrel? Three states,
--    the threaded_barrel_ok convention: null = the maker has not stated
--    it; false only where the maker says so (SIG's Spectre Comp build
--    warning, Norsso's N365DG non-XP slides).
alter table public.slide_specs add column ported_barrel_ok boolean;

comment on column public.slide_specs.ported_barrel_ok is
  'Maker''s own claim: may a ported barrel run in this slide? null = not stated, false only where the maker says so.';

-- 3. is_comped_or_ported — the one derived fact several surfaces want
--    ("does anything on this slide manage muzzle rise?"). Generated, so it
--    can never drift from its parts; read-only through PostgREST.
alter table public.slide_specs add column is_comped_or_ported boolean
  generated always as (comp_style <> 'none' or port_style is not null) stored;

comment on column public.slide_specs.is_comped_or_ported is
  'Derived: comp chamber or external slide ports. Generated from comp_style and port_style; never written.';

-- 4. window_cuts -> lightening_cuts. These are openings milled into the
--    slide to reduce mass — NOT gas-venting. Industry "window" often means
--    gas-venting, which this column never meant, so the name was a trap.
alter table public.slide_specs rename column window_cuts to lightening_cuts;

comment on column public.slide_specs.lightening_cuts is
  'Openings milled into the slide to reduce mass. Not gas-venting: port_style / port_count carry that.';

-- Its rule row renames in the SAME transaction: product_data_status()
-- reads the spec row as jsonb and looks fields up by the rule's name, so a
-- rule still saying window_cuts against the renamed column would read NULL
-- and report every one of the 51 slides as missing a required field.
update public.spec_field_rules
   set field = 'lightening_cuts', label = 'Lightening cuts'
 where category = 'slide' and field = 'window_cuts';

-- 5. internally_ported was (port_style is not null) on all 51 rows
--    (measured 2026-11-16, 0 mismatches); the generated column above is
--    the replacement for anything that wants the combined fact. Its rule
--    row goes with it, and the two rules it scoped move to port_style:
--      * port_style becomes optional, unscoped: blank = no external slide
--        ports (the MCARBO reads this way after the data migration).
--      * port_count stays required whenever port_style is one of the live
--        styles. spec_field_rules can only express value LISTS —
--        create_product() and product_data_status() both evaluate
--        (value ->> only_when_field) = any(only_when_values) — so this is
--        a hard-coded list of the six styles. A seventh style must be
--        added here too; guard 4 (slide_specs_port_count_matches_port_style
--        and scripts/check-fitment-data.mjs) is the backstop that catches
--        the omission.
delete from public.spec_field_rules
 where category = 'slide' and field = 'internally_ported';

update public.spec_field_rules
   set requirement = 'optional', only_when_field = null, only_when_values = null
 where category = 'slide' and field = 'port_style';

update public.spec_field_rules
   set only_when_field = 'port_style',
       only_when_values = array['c-port','e-port','geo-port','v-port','chunk-port','top-and-chunk']
 where category = 'slide' and field = 'port_count';

alter table public.slide_specs drop column internally_ported;

-- 6. includes_barrel duplicated barrel_included and disagreed with it on
--    two of the four TRUE rows (MCARBO and the Norsso bull-barrel set were
--    TRUE on barrel_included, FALSE here) — which is why the Armory still
--    offered those two sets a barrel picker. Every reader is repointed to
--    barrel_included in the code half of this PR.
alter table public.slide_specs drop column includes_barrel;

-- 7. Never-filled barrel columns (0 of 28 rows each, measured 2026-11-16).
--    v_comp_barrel_fit's two pairs_with_comp_id branches never fired (the
--    column was always null), and no code reads the view today; replace it
--    without the branches before the drop. CREATE OR REPLACE keeps the
--    view's grants. pairs_with_comp_id's FK and index drop with the column.
create or replace view public.v_comp_barrel_fit with (security_invoker='true') as
 select c.product_id as comp_product_id,
        b.product_id as barrel_product_id,
        c.thread_pitch as comp_thread_pitch,
        b.thread_pitch as barrel_thread_pitch,
        case
            when not c.requires_threaded_barrel then 'fits'::text
            when b.barrel_type <> all (array['threaded'::public.barrel_type, 'threaded-and-ported'::public.barrel_type]) then 'needs-threaded-barrel'::text
            when c.thread_pitch is distinct from b.thread_pitch then 'thread-mismatch'::text
            else 'fits'::text
        end as fit_status
   from public.compensator_specs c
  cross join public.barrel_specs b;

alter table public.barrel_specs drop column ballistic_loss;
alter table public.barrel_specs drop column pairs_with_comp_id;

-- 8. products.pros / cons / editor_rating: 0 of 303 filled, nothing ever
--    rendered them. product-page.mjs named pros and cons in its main
--    product select — that code change is deployed before this push, or
--    every product page dies on the missing columns. products_rating_range
--    drops with editor_rating.
alter table public.products drop column pros;
alter table public.products drop column cons;
alter table public.products drop column editor_rating;

-- 9. compensator_specs.mounting_type held exactly these four values on all
--    12 rows (2026-11-16). A CHECK rather than an enum type, the sights
--    precedent (CLAUDE.md "Sights": value lists are CHECKs the function
--    can refuse in words). NULL passes a CHECK by SQL semantics; the
--    spec_field_rules row keeps the field required for approval.
alter table public.compensator_specs add constraint compensator_specs_mounting_type_check
  check (mounting_type in ('Set-Screw','O-Ring','Intra-Lok','Locking-Block'));
