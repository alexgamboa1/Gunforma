-- spec_field_rules.sql
-- APPLIED 2026-10-03. See the record at the bottom of this file.
-- Dry-run first the same day inside one rolled-back transaction, together
-- with create_product.sql; the results are in #131.
--
-- WHAT A CATEGORY NEEDS, in one place. Read by create_product() (which spec
-- keys it accepts), by product_data_status() (what makes a part APPROVED),
-- and by PR 2's add-a-part form (what to ask for, in what order, labelled).
-- Three readers of one table instead of three lists that drift.
--
-- One row per (category, field). `field` is the <category>_specs column,
-- except `platform` and `footprint`, which are entered as slugs and stored as
-- platform_id / footprint_id.
--
--   requirement 'required'  APPROVED needs it filled. A part can still be
--                           saved without it — unapproved, and told so.
--   requirement 'optional'  reported as blank, never blocks approval.
--   only_when_field/values  the rule applies only when that field of the
--                           same spec sheet holds one of these values (as
--                           text: 'true', 'threaded', …). When the condition
--                           is false the field is NOT APPLICABLE and appears
--                           in neither list. A required only-when field whose
--                           condition holds must be sent with the spec sheet:
--                           create_product() refuses it otherwise.
--
-- HOW THE SEED WAS CHOSEN — measured over every live product on 2026-10-03,
-- not typed from memory:
--   filled on every product of the category  -> required
--   filled on some                           -> optional
--   filled on none, keys, trigger-owned classes -> no row
-- plus the conditional fields as ruled by Alex. Two deliberate departures
-- from the measurement, both ruled:
--   * compensator.length_in is filled on exactly the 5 compensators sold
--     WITHOUT a barrel. It is optional and only applicable then.
--   * optic.housing_material and mag_release.material are the same fact as
--     products.material. Their rows exist so the keys are accepted, but
--     create_product() fills them from products.material and the form does
--     not ask twice.
-- The ten columns no product has ever filled (barrel ballistic_loss and
-- pairs_with_comp_id, frame palm_swell and finger_grooves, optic mount_height,
-- light beam_type, compensator muzzle_flip_reduction, products pros / cons /
-- editor_rating) have no row, so they cannot be entered.
--
-- DEFAULTS. Several required fields have a database default (caliber '9mm',
-- capacity_change 0, drop_in true, is_combo false, …). A spec sheet that omits
-- one passes, holding the default. PR 2's form must make the admin answer each
-- of these explicitly rather than inherit the default silently.
--
-- RULES ARE ROWS. The 2-product categories (slide_release, safety_selector,
-- takedown_lever) are thin evidence; change a row when the catalog says
-- otherwise. slide_plate has no spec table and therefore no rows.

create table if not exists public.spec_field_rules (
  category         public.product_category not null,
  field            text not null,
  requirement      text not null check (requirement in ('required', 'optional')),
  only_when_field  text null,
  only_when_values text[] null,
  label            text not null,
  sort_order       int  not null,
  primary key (category, field),
  constraint spec_field_rules_only_when_pair
    check ((only_when_field is null) = (only_when_values is null))
);

comment on table public.spec_field_rules is
  'What each category''s spec sheet needs: required / optional / only-when. Read by create_product(), product_data_status() and the add-a-part form.';

-- RLS plus the explicit revoke CLAUDE.md requires: Supabase's default ACL
-- grants anon and authenticated every privilege on a new public table, so
-- RLS alone would leave write grants sitting underneath the read policy.
alter table public.spec_field_rules enable row level security;
revoke all on public.spec_field_rules from anon, authenticated;
grant select on public.spec_field_rules to anon, authenticated;

create policy spec_field_rules_public_read on public.spec_field_rules
  for select to anon, authenticated using (true);

insert into public.spec_field_rules (category, field, requirement, only_when_field, only_when_values, label, sort_order) values
  -- slide (40 products): 10 required + 2 only-when
  ('slide', 'platform',               'required', null, null, 'Platform', 10),
  ('slide', 'slide_length_in',        'required', null, null, 'Slide length (in)', 20),
  ('slide', 'barrel_length_in',       'required', null, null, 'Barrel length (in)', 30),
  ('slide', 'comes_with_sights',      'required', null, null, 'Comes with sights', 40),
  ('slide', 'barrel_included',        'required', null, null, 'Barrel included', 50),
  ('slide', 'window_cuts',            'required', null, null, 'Window cuts', 60),
  ('slide', 'internally_ported',      'required', null, null, 'Internally ported', 70),
  ('slide', 'port_style',             'required', 'internally_ported', array['true'], 'Port style', 80),
  ('slide', 'port_count',             'required', 'internally_ported', array['true'], 'Number of ports', 90),
  ('slide', 'integrated_comp',        'required', null, null, 'Integrated compensator', 100),
  ('slide', 'threaded_barrel_ok',     'required', null, null, 'Takes a threaded barrel', 110),
  ('slide', 'required_spring_weight', 'required', null, null, 'Recoil spring weight it needs', 120),

  -- barrel (20): 5 required + 2 only-when + 1 optional
  ('barrel', 'platform',            'required', null, null, 'Platform', 10),
  ('barrel', 'barrel_length_in',    'required', null, null, 'Barrel length (in)', 20),
  ('barrel', 'barrel_type',         'required', null, null, 'Barrel type', 30),
  ('barrel', 'thread_pitch',        'required', 'barrel_type', array['threaded','threaded-and-ported'], 'Thread pitch', 40),
  ('barrel', 'port_style',          'required', 'barrel_type', array['ported','threaded-and-ported'], 'Port style', 50),
  ('barrel', 'caliber',             'required', null, null, 'Caliber', 60),
  ('barrel', 'is_lci',              'required', null, null, 'Loaded-chamber indicator', 70),
  ('barrel', 'requires_slide_text', 'optional', null, null, 'Slide it requires', 80),

  -- frame (51): 3 required + 1 only-when + 7 optional
  ('frame', 'housing_class',          'required', null, null, 'Grip housing class', 10),
  ('frame', 'has_rail',               'required', null, null, 'Has an accessory rail', 20),
  ('frame', 'grip_rail_type',         'required', 'has_rail', array['true'], 'Rail type', 30),
  ('frame', 'grip_texture',           'required', null, null, 'Grip texture', 40),
  ('frame', 'magwell_type',           'optional', null, null, 'Magwell type', 50),
  ('frame', 'has_beaver_tail',        'optional', null, null, 'Beavertail', 60),
  ('frame', 'undercut_trigger_guard', 'optional', null, null, 'Undercut trigger guard', 70),
  ('frame', 'thumb_rest',             'optional', null, null, 'Thumb rest', 80),
  ('frame', 'thumb_stippling',        'optional', null, null, 'Thumb stippling', 90),
  ('frame', 'includes_hardware',      'optional', null, null, 'Includes hardware', 100),
  ('frame', 'hardware_notes',         'optional', null, null, 'Hardware notes', 110),

  -- optic (47): 19 required + 1 optional
  ('optic', 'footprint',            'required', null, null, 'Footprint', 10),
  ('optic', 'optic_type',           'required', null, null, 'Optic type', 20),
  ('optic', 'reticle',              'required', null, null, 'Reticle', 30),
  ('optic', 'reticle_type',         'required', null, null, 'Reticle type', 40),
  ('optic', 'selectable_reticle',   'required', null, null, 'Selectable reticle', 50),
  ('optic', 'dot_size_moa',         'optional', null, null, 'Dot size (MOA)', 60),
  ('optic', 'magnification',        'required', null, null, 'Magnification', 70),
  ('optic', 'window_size',          'required', null, null, 'Window size', 80),
  ('optic', 'emitter',              'required', null, null, 'Emitter', 90),
  ('optic', 'enclosed_emitter',     'required', null, null, 'Enclosed emitter', 100),
  ('optic', 'brightness_settings',  'required', null, null, 'Brightness settings', 110),
  ('optic', 'auto_on_off',          'required', null, null, 'Auto on/off', 120),
  ('optic', 'shake_awake',          'required', null, null, 'Shake awake', 130),
  ('optic', 'adjustment_per_click', 'required', null, null, 'Adjustment per click', 140),
  ('optic', 'battery_type',         'required', null, null, 'Battery type', 150),
  ('optic', 'battery_location',     'required', null, null, 'Battery location', 160),
  ('optic', 'removable_battery',    'required', null, null, 'Removable battery', 170),
  ('optic', 'battery_life',         'required', null, null, 'Battery life', 180),
  ('optic', 'solar_power',          'required', null, null, 'Solar power', 190),
  ('optic', 'housing_material',     'required', null, null, 'Housing material (filled from the product''s material)', 200),

  -- light (33): 13 required + 1 only-when
  ('light', 'series',                  'required', null, null, 'Series', 10),
  ('light', 'config_note',             'required', null, null, 'Configuration', 20),
  ('light', 'mount_system',            'required', null, null, 'Mount system', 30),
  ('light', 'lumens_max',              'required', null, null, 'Lumens (max)', 40),
  ('light', 'candela_max',             'required', null, null, 'Candela (max)', 50),
  ('light', 'battery_type',            'required', null, null, 'Battery type', 60),
  ('light', 'rechargeable',            'required', null, null, 'Rechargeable', 70),
  ('light', 'length_in',               'required', null, null, 'Length (in)', 80),
  ('light', 'ipx_rating',              'required', null, null, 'IPX rating', 90),
  ('light', 'multiple_light_settings', 'required', null, null, 'Multiple light settings', 100),
  ('light', 'has_strobe',              'required', null, null, 'Strobe', 110),
  ('light', 'has_infrared',            'required', null, null, 'Infrared', 120),
  ('light', 'has_laser',               'required', null, null, 'Laser', 130),
  ('light', 'laser_color',             'required', 'has_laser', array['true'], 'Laser color', 140),

  -- compensator (12): 6 required + 2 only-when + 1 optional only-when
  ('compensator', 'caliber',                  'required', null, null, 'Caliber', 10),
  ('compensator', 'mounting_type',            'required', null, null, 'Mounting type', 20),
  ('compensator', 'requires_threaded_barrel', 'required', null, null, 'Needs a threaded barrel', 30),
  ('compensator', 'thread_pitch',             'required', null, null, 'Thread pitch', 40),
  ('compensator', 'port_design',              'required', null, null, 'Port design', 50),
  ('compensator', 'comes_with_barrel',        'required', null, null, 'Comes with a barrel', 60),
  ('compensator', 'included_barrel',          'required', 'comes_with_barrel', array['true'], 'Included barrel', 70),
  ('compensator', 'barrel_length_in',         'required', 'comes_with_barrel', array['true'], 'Included barrel length (in)', 80),
  ('compensator', 'length_in',                'optional', 'comes_with_barrel', array['false'], 'Compensator length (in)', 90),

  -- trigger (8): 5 required + 2 optional
  ('trigger', 'profile',          'required', null, null, 'Profile', 10),
  ('trigger', 'adjustable',       'required', null, null, 'Adjustable', 20),
  ('trigger', 'adjustment_type',  'required', null, null, 'Adjustment type', 30),
  ('trigger', 'safety_type',      'required', null, null, 'Safety type', 40),
  ('trigger', 'drop_in',          'required', null, null, 'Drop-in', 50),
  ('trigger', 'pull_weight_lb',   'optional', null, null, 'Pull weight (lb)', 60),
  ('trigger', 'pull_weight_text', 'optional', null, null, 'Pull weight (as stated)', 70),

  -- mag_release (8): 3 required + 3 optional
  ('mag_release', 'caliber',              'required', null, null, 'Caliber', 10),
  ('mag_release', 'style',                'required', null, null, 'Style', 20),
  ('mag_release', 'texture',              'required', null, null, 'Texture', 30),
  ('mag_release', 'material',             'optional', null, null, 'Material (filled from the product''s material)', 40),
  ('mag_release', 'length_added_in',      'optional', null, null, 'Length added (in)', 50),
  ('mag_release', 'includes_spring_stop', 'optional', null, null, 'Includes spring stop', 60),

  -- magwell (6): 3 required
  ('magwell', 'attachment_method', 'required', null, null, 'Attachment method', 10),
  ('magwell', 'is_combo',          'required', null, null, 'Combo (magwell + grip)', 20),
  ('magwell', 'includes_hardware', 'required', null, null, 'Includes hardware', 30),

  -- basepad (8): 3 required
  ('basepad', 'basepad_type',    'required', null, null, 'Base pad type', 10),
  ('basepad', 'fits_mag_type',   'required', null, null, 'Fits magazine', 20),
  ('basepad', 'capacity_change', 'required', null, null, 'Capacity change (rounds)', 30),

  -- slide_release (2): 2 required
  ('slide_release', 'texture',         'required', null, null, 'Texture', 10),
  ('slide_release', 'uses_oem_spring', 'required', null, null, 'Uses the OEM spring', 20),

  -- safety_selector (2): 3 required
  ('safety_selector', 'is_ambidextrous',        'required', null, null, 'Ambidextrous', 10),
  ('safety_selector', 'includes_detent_spring', 'required', null, null, 'Includes detent spring', 20),
  ('safety_selector', 'kit_contents',           'required', null, null, 'Kit contents', 30),

  -- takedown_lever (2): 2 required + 1 optional
  ('takedown_lever', 'takedown_type',             'required', null, null, 'Takedown type', 10),
  ('takedown_lever', 'has_thumb_rest',            'required', null, null, 'Thumb rest', 20),
  ('takedown_lever', 'optic_compatibility_notes', 'optional', null, null, 'Optic compatibility notes', 30);

-- ============================================================
-- APPLIED 2026-10-03 as migration spec_field_rules (20261003223210) to
-- project lagjjcpclvzrjlrswojt, from this file as merged in #131.
-- Verified live after the change:
--
--   101 rows; md5 of the rows (category|field|requirement|only_when_field|
--     only_when_values|label|sort_order, ordered by category, field)
--     850c2c1566e9e6f20f8a96301e100f1c, identical to the rows parsed from
--     this file
--   RLS on; grants: anon r, authenticated r — no write grant for either
--   anon reads it through PostgREST (200)
-- ============================================================
