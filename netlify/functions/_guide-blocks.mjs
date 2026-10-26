// _guide-blocks — the one copy of what the Field Notes product blocks may
// say about a part: which spec columns a ::compare table may show, which of
// them a ::rank card shows by default, and what each is labelled.
// ─────────────────────────────────────────────────────────────────────────
// A ::compare directive names its columns per article (the author decides
// what the comparison is about), but it may only name columns declared
// HERE — scripts/check-field-notes.mjs refuses anything else at build time,
// so a typo'd or guessed column never ships as a silent empty column. A
// ::rank card's compact spec list is the category's `rank` set below,
// chosen once per category, never per article.
//
// Labels match the product page's spec sheet (SPEC_TABLES in
// product-page.mjs) where the column appears there, so one column never has
// two names on the site. Scalar columns only, on purpose: an embedded
// select (housing_classes(...)) would drag the PGRST201 FK-naming rules
// into every compare query for one row of decoration.
//
// PRODUCT_COLS are columns on `products` itself (every category may use
// them); each category's `cols` are on its spec table. The fetch in
// field-note.mjs reads a spec table once per page with every declared
// column, so adding one here costs nothing per article.

const OZ = (v) => v + ' oz';
const IN = (v) => v + '"';
const MOA = (v) => v + ' MOA';
const ROUNDS = (v) => v + ' rounds';
const YESNO = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);

export const PRODUCT_COLS = {
  material:  { label: 'Material' },
  weight_oz: { label: 'Weight', fmt: OZ },
};

// category -> { table, cols: { column: {label, fmt?} }, rank: [column…] }
// `rank` is 4–6 decision-relevant columns, product-level ones included.
export const GUIDE_SPECS = {
  frame: {
    table: 'frame_specs',
    cols: {
      magwell_type:           { label: 'Magwell Type' },
      grip_rail_type:         { label: 'Rail Type' },
      grip_texture:           { label: 'Grip Texture' },
      undercut_trigger_guard: { label: 'Undercut Trigger Guard', fmt: YESNO },
      has_beaver_tail:        { label: 'Beavertail', fmt: YESNO },
    },
    rank: ['material', 'weight_oz', 'magwell_type', 'grip_rail_type', 'grip_texture'],
  },
  optic: {
    table: 'optic_specs',
    cols: {
      dot_size_moa:     { label: 'Dot Size', fmt: MOA },
      reticle:          { label: 'Reticle' },
      window_size:      { label: 'Window Size' },
      battery_type:     { label: 'Battery Type' },
      battery_life:     { label: 'Battery Life' },
      enclosed_emitter: { label: 'Enclosed Emitter', fmt: YESNO },
      housing_material: { label: 'Housing Material' },
    },
    rank: ['dot_size_moa', 'window_size', 'battery_life', 'enclosed_emitter', 'weight_oz'],
  },
  barrel: {
    table: 'barrel_specs',
    cols: {
      barrel_length_in: { label: 'Barrel Length', fmt: IN },
      barrel_type:      { label: 'Type' },
      thread_pitch:     { label: 'Thread Pitch' },
      caliber:          { label: 'Caliber' },
    },
    rank: ['barrel_length_in', 'barrel_type', 'thread_pitch', 'material'],
  },
  slide: {
    table: 'slide_specs',
    cols: {
      slide_length_in:    { label: 'Slide Length', fmt: IN },
      comes_with_sights:  { label: 'Comes With Sights', fmt: YESNO },
      window_cuts:        { label: 'Window Cuts', fmt: YESNO },
      threaded_barrel_ok: { label: 'Fits Threaded Barrel', fmt: YESNO },
      integrated_comp:    { label: 'Integrated Compensator', fmt: YESNO },
    },
    rank: ['slide_length_in', 'window_cuts', 'threaded_barrel_ok', 'material', 'weight_oz'],
  },
  compensator: {
    table: 'compensator_specs',
    cols: {
      mounting_type:            { label: 'Mounting Type' },
      requires_threaded_barrel: { label: 'Requires Threaded Barrel', fmt: YESNO },
      thread_pitch:             { label: 'Thread Pitch' },
      length_in:                { label: 'Length', fmt: IN },
      port_design:              { label: 'Port Design' },
    },
    rank: ['mounting_type', 'requires_threaded_barrel', 'thread_pitch', 'length_in'],
  },
  light: {
    table: 'light_specs',
    cols: {
      lumens_max:   { label: 'Max Lumens' },
      candela_max:  { label: 'Max Candela' },
      has_laser:    { label: 'Laser', fmt: YESNO },
      battery_type: { label: 'Battery Type' },
      rechargeable: { label: 'Rechargeable', fmt: YESNO },
    },
    rank: ['lumens_max', 'candela_max', 'battery_type', 'rechargeable', 'weight_oz'],
  },
  trigger: {
    table: 'trigger_specs',
    cols: {
      profile:          { label: 'Profile' },
      pull_weight_text: { label: 'Pull Weight' },
      adjustable:       { label: 'Adjustable', fmt: YESNO },
      drop_in:          { label: 'Drop-In', fmt: YESNO },
    },
    rank: ['profile', 'pull_weight_text', 'adjustable', 'drop_in'],
  },
  magazine: {
    table: 'magazine_specs',
    cols: {
      capacity:      { label: 'Capacity', fmt: ROUNDS },
      caliber:       { label: 'Caliber' },
      mag_style:     { label: 'Style' },
      body_material: { label: 'Body Material' },
    },
    rank: ['capacity', 'caliber', 'mag_style', 'body_material'],
  },
};

// A column's {label, fmt} for a category, product-level or spec-level, or
// null when the category does not declare it — which the build guard turns
// into a failure before it can ship as an empty column.
export function colMeta(category, col) {
  if (PRODUCT_COLS[col]) return PRODUCT_COLS[col];
  const cat = GUIDE_SPECS[category];
  return (cat && cat.cols[col]) || null;
}

// The /go/ section-tracking params: which page (the field note's slug) and
// which block kind sent the click. go.js reads them on the logged path only
// and whitelists loc; they never reach the retailer URL.
export const GO_LOCATIONS = ['picks', 'rank', 'compare', 'price'];
export function withGoParams(goUrl, slug, loc) {
  if (!slug || !loc) return goUrl;
  return goUrl + (goUrl.includes('?') ? '&' : '?') +
    's=' + encodeURIComponent(slug) + '&loc=' + encodeURIComponent(loc);
}

// The standard affiliate disclosure for any field note that renders a
// ::price, ::picks or ::rank block — one implementation, never per-article
// text. The anchor is the existing disclosure section on gunforma-legal.html.
export const AFFILIATE_DISCLOSURE_HTML =
  '<p class="fn-affiliate-note">Buying through links on this page may earn Gunforma a commission, at no extra cost to you. ' +
  '<a href="/gunforma-legal.html#affiliate">How affiliate links work &rarr;</a></p>';
