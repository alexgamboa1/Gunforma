#!/usr/bin/env node
// check-fitment-data — the six slide/barrel data invariants, asserted
// against the LIVE database (2026-11-16, the slide comp/porting cleanup).
//
// WHY IT IS NOT A BUILD CHECK: these are facts about production rows, and
// the build cannot see the database — the same reasoning as
// check-routes.mjs. It runs from .github/workflows/check-routes.yml, on the
// schedule and on demand. Guards 1, 2 and 4 are ALSO CHECK constraints on
// slide_specs (20261116200200_slide_port_guards.sql), which catch a bad
// write at write time; this script is the cross-row half (3, 5, 6) plus a
// second witness for the single-row three.
//
// The six:
//   1. slide longer than its barrel  -> comp_style = 'short_barrel'
//   2. equal lengths + port_style    -> comp_style = 'ported_barrel'
//   3. every slide with a port_style has a barrel lock OR barrel_included
//   4. port_count is null  <=>  port_style is null
//      (also the backstop for spec_field_rules' port_count scope, which
//      can only name a value LIST of styles)
//   5. every barrel_slide_requirements row has a non-empty source
//   6. (platform_id, slide_length_in) is 1:1 with slide_class, fit_tier
//      and required_spring_weight
//   7. no (barrel, slide) pair the view calls 'fits' violates the slide's
//      own rules: a threaded barrel on threaded_barrel_ok FALSE, a ported
//      barrel on ported_barrel_ok FALSE, or mismatched bore profiles
//      (2026-11-17, the fit-rules view change — watched failing against
//      the pre-fix view, which called 3 threaded barrels 'fits' on every
//      thread-refusing slide and 4 standard barrels 'fits' on the bull
//      set). The bore columns are read tolerantly so the run between the
//      code deploy and the migration fails on the DATA, never on a 400.
//
// A NULL slide/barrel length is reported as its own failure here — the
// CHECK constraints deliberately pass it (an unrecorded length is
// unjudged), so this is where one would otherwise hide forever.

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

async function rows(path) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
  });
  if (!res.ok) throw new Error('PostgREST ' + res.status + ' for ' + path);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('non-array body for ' + path);
  return body;
}

const failures = [];
const fail = (msg) => failures.push(msg);

const [slides, locks, products] = await Promise.all([
  rows('slide_specs?select=product_id,slide_length_in,barrel_length_in,comp_style,port_style,port_count,platform_id,slide_class,fit_tier,required_spring_weight,barrel_included'),
  rows('barrel_slide_requirements?select=barrel_product_id,slide_product_id,source'),
  rows('products?select=id,slug&category=in.(slide,barrel)'),
]);

const slug = (() => {
  const by = new Map(products.map((p) => [p.id, p.slug]));
  return (id) => by.get(id) || id;
})();

if (slides.length === 0) fail('slide_specs returned zero rows — the read itself is wrong');

const lockedSlides = new Set(locks.map((l) => l.slide_product_id));

for (const s of slides) {
  const name = slug(s.product_id);
  const sl = s.slide_length_in == null ? null : Number(s.slide_length_in);
  const bl = s.barrel_length_in == null ? null : Number(s.barrel_length_in);

  // The DB CHECKs pass a null length on purpose; here it is a finding.
  if (sl == null || bl == null) {
    fail(name + ': slide_length_in or barrel_length_in is null — unjudgeable row');
    continue;
  }
  // Guard 1
  if (sl > bl && s.comp_style !== 'short_barrel') {
    fail(name + ': slide ' + sl + '" over barrel ' + bl + '" but comp_style is ' + s.comp_style + ', not short_barrel');
  }
  // Guard 2
  if (sl === bl && s.port_style != null && s.comp_style !== 'ported_barrel') {
    fail(name + ': equal lengths with port_style ' + s.port_style + ' but comp_style is ' + s.comp_style + ', not ported_barrel');
  }
  // Guard 3
  if (s.port_style != null && !lockedSlides.has(s.product_id) && s.barrel_included !== true) {
    fail(name + ': ported (' + s.port_style + ') with no barrel lock and no included barrel — nothing feeds its ports');
  }
  // Guard 4
  if ((s.port_count == null) !== (s.port_style == null)) {
    fail(name + ': port_count ' + s.port_count + ' with port_style ' + s.port_style + ' — the pair must be set or null together');
  }
}

// Guard 5
for (const l of locks) {
  if (l.source == null || String(l.source).trim() === '') {
    fail('barrel_slide_requirements ' + slug(l.barrel_product_id) + ' -> ' + slug(l.slide_product_id) + ': no source');
  }
}

// Guard 6
const groups = new Map();
for (const s of slides) {
  const key = s.platform_id + '|' + s.slide_length_in;
  if (!groups.has(key)) groups.set(key, { classes: new Set(), tiers: new Set(), weights: new Set(), n: 0 });
  const g = groups.get(key);
  g.classes.add(String(s.slide_class));
  g.tiers.add(String(s.fit_tier));
  g.weights.add(String(s.required_spring_weight));
  g.n++;
}
for (const [key, g] of groups) {
  for (const [label, set] of [['slide_class', g.classes], ['fit_tier', g.tiers], ['required_spring_weight', g.weights]]) {
    if (set.size !== 1) {
      fail('platform+length ' + key + ' (' + g.n + ' slides) carries ' + set.size + ' distinct ' + label + ' values: ' + [...set].join(' / '));
    }
  }
}

// Guard 7 — the view's own word, cross-checked against the slides' rules.
// bore_profile is read tolerantly: before the fit-rules migration the
// column does not exist, and this guard must then fail on the thread and
// ported violations the old view ships, never on a 400.
async function rowsTolerant(withBore, withoutBore) {
  try { return { rows: await rows(withBore), bore: true }; }
  catch { return { rows: await rows(withoutBore), bore: false }; }
}
const [fitsPairs, b7, s7] = await Promise.all([
  rows('v_barrel_slide_fit?fit_status=eq.fits&select=barrel_product_id,slide_product_id&limit=10000'),
  rowsTolerant('barrel_specs?select=product_id,barrel_type,bore_profile',
               'barrel_specs?select=product_id,barrel_type'),
  rowsTolerant('slide_specs?select=product_id,threaded_barrel_ok,ported_barrel_ok,bore_profile',
               'slide_specs?select=product_id,threaded_barrel_ok,ported_barrel_ok'),
]);
if (!b7.bore || !s7.bore) {
  console.log('check-fitment-data: bore_profile not readable yet — guard 7 treats every profile as standard');
}
const barrelBy = new Map(b7.rows.map((b) => [b.product_id, b]));
const slideBy  = new Map(s7.rows.map((s) => [s.product_id, s]));
const THREADED = new Set(['threaded', 'threaded-and-ported']);
const PORTED   = new Set(['ported', 'threaded-and-ported']);
let fits7 = 0;
for (const p of fitsPairs) {
  const b = barrelBy.get(p.barrel_product_id);
  const s = slideBy.get(p.slide_product_id);
  if (!b || !s) continue;
  fits7++;
  const pair = slug(p.barrel_product_id) + ' -> ' + slug(p.slide_product_id);
  if (THREADED.has(b.barrel_type) && s.threaded_barrel_ok === false) {
    fail(pair + ": 'fits' but the slide's maker says threaded barrels don't fit");
  }
  if (PORTED.has(b.barrel_type) && s.ported_barrel_ok === false) {
    fail(pair + ": 'fits' but the slide's maker says ported barrels must not be used");
  }
  if ((b.bore_profile || 'standard') !== (s.bore_profile || 'standard')) {
    fail(pair + ": 'fits' across mismatched bore profiles (" +
      (b.bore_profile || 'standard') + ' barrel on ' + (s.bore_profile || 'standard') + ' slide)');
  }
}

console.log('check-fitment-data: ' + slides.length + ' slides, ' + locks.length + ' barrel locks, ' + groups.size + ' platform+length groups, ' + fits7 + " 'fits' pairs checked");
if (failures.length) {
  console.error('\ncheck-fitment-data: ' + failures.length + ' failure(s):');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-fitment-data: all seven invariants hold');
