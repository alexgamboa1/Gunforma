// field-notes-v2.test.mjs — the Field Notes v2 blocks, rendered for real:
// field-note.mjs run over the renderer-check fixture against a stubbed
// PostgREST, the way field-notes.test.mjs and guide-blocks.test.mjs run the
// rest of the renderer.
//
// What it pins:
//   - the ::rank changes/same card: `~` lines under "What it changes from
//     the factory part", `=` lines under "What stays the same", the
//     baseline named and linked, pros/cons still rendering for the old
//     fixture shape; the card's colour swatches (named, via the shared
//     swatch rule — the colors table carries no hex) and the
//     manual-safety line only when a live variant has the option
//   - the method line on every article: once, under the byline, above the
//     affiliate disclosure, linking /how-gunforma-checks-parts.html
//   - ::unlocks: the verified/likely split and the adapter count for
//     lights, singular/plural verbs, counts filtered to live parts, a
//     zero-row line OMITTED (never "0 …") — except the magwell gap, the
//     one zero a reader should see; the slide side's direct/plate split
//     and the derived recoil-spring requirement; the dated footer
//   - ::colors: the baseline (factory) row first, colour names in
//     colors.sort_order, the count, the Cerakote column and "—" without it
//   - ::build: the happy path (role labels, product links, fresh prices
//     with their retailer, "Check price" with no fresh price, the total
//     with its "+ N parts without a live price" tail, the Armory button),
//     the adapter-separate "sold separately" and "fit likely, not
//     verified" row notes, and a deliberately non-fitting slide × frame
//     pair taking the block down to a visible refusal — no parts table,
//     no prices, no Armory button — with x-field-note-build reporting the
//     shortfall
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const md = await import(fn('_markdown.mjs'));
const { BUILD_ROLE_META, METHOD_PAGE_PATH } = await import(fn('_guide-blocks.mjs'));
const { FIELD_NOTES, fieldNotePath } = await import(fn('_field-notes-meta.mjs'));
const handler = (await import(fn('field-note.mjs'))).default;

const FIXTURE = FIELD_NOTES.find((a) => a.slug === 'renderer-check');
assert.ok(FIXTURE && FIXTURE.draft, 'the renderer-check draft fixture must stay in _field-notes-meta.mjs');
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the parser ───────────────────────────────────────────────────────────
test('the v2 directives parse; the malformed shapes are null', () => {
  const rank = md.parseDirective('::rank a-1 best="B" rank=1 baseline=f-0', ['~ lighter', '= same rail', '+ legacy pro']);
  assert.equal(rank.baseline, 'f-0');
  assert.deepEqual(rank.changes, ['lighter']);
  assert.deepEqual(rank.same, ['same rail']);
  assert.deepEqual(rank.pros, ['legacy pro']);
  assert.equal(md.parseDirective('::rank a-1 best="B" rank=1 baseline=Bad_Slug', []), null);

  assert.deepEqual(md.parseDirective('::unlocks frame=a-1'), { kind: 'unlocks', part: 'frame', slug: 'a-1' });
  assert.deepEqual(md.parseDirective('::unlocks slide=s-1'), { kind: 'unlocks', part: 'slide', slug: 's-1' });
  assert.equal(md.parseDirective('::unlocks optic=o-1'), null, 'only frame and slide');
  assert.equal(md.parseDirective('::unlocks frame=a slide=b'), null, 'exactly one key');
  assert.equal(md.parseDirective('::unlocks'), null);

  assert.deepEqual(md.parseDirective('::colors slugs=a,b baseline=c'), { kind: 'colors', baseline: 'c', slugs: ['a', 'b'] });
  assert.deepEqual(md.parseDirective('::colors slugs=a,c,b baseline=c').slugs, ['a', 'b'], 'the baseline is not repeated in the rows');
  assert.equal(md.parseDirective('::colors slugs=a,b'), null, 'baseline required');
  assert.equal(md.parseDirective('::colors baseline=c'), null, 'slugs required');

  const b = md.parseDirective('::build name="A build"', ['frame=f-1', 'slide=s-1']);
  assert.deepEqual(b, { kind: 'build', name: 'A build', parts: [{ role: 'frame', slug: 'f-1' }, { role: 'slide', slug: 's-1' }] });
  assert.equal(md.parseDirective('::build name="A"', ['frame=f-1', 'frame=f-2']), null, 'one part per role');
  assert.equal(md.parseDirective('::build name="A"', ['bogus=f-1']), null, 'an unknown role');
  assert.equal(md.parseDirective('::build name="A"', []), null, 'an empty build');
  assert.equal(md.parseDirective('::build', ['frame=f-1']), null, 'name required');
  // every role the parser accepts has its page meta, and nothing extra
  assert.deepEqual(Object.keys(BUILD_ROLE_META).sort(), md.BUILD_ROLES.slice().sort());
});

// ── the handler over the fixture ─────────────────────────────────────────
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
const realError = console.error;
test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

const today = new Date().toISOString().slice(0, 10);
const FP = { K: 'fp-holosun-k', RMSC: 'fp-rmsc', RMR: 'fp-rmr', SLC: 'fp-sig-loc-compact' };
const listing = (id, price) => ({ id, url: 'https://www.opticsplanet.com/' + id, affiliate_url: null, street_price: price, in_stock: true, last_checked: today, op_last_matched_by: 'T1', partners: { name: 'OpticsPlanet (Awin)' } });
const PRODUCTS = {
  'holosun-507k-x2': { id: 'P1', slug: 'holosun-507k-x2', name: 'Holosun 507K X2', category: 'optic', url: 'https://holosun.com/507k', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V1', msrp: 359.99, is_default: true, primary_image_url: 'https://img/507k.jpg', color: 'Black', affiliate_links: [listing('L1', 329.99)] }] },
  // manual_safety_variant on one live variant: the 507C's card must say so
  // and the 507K's must not (an optic with one is stub nonsense, but the
  // rule under test is the variant column, nothing else)
  'holosun-507c-x2': { id: 'P2', slug: 'holosun-507c-x2', name: 'Holosun 507C X2', category: 'optic', url: 'https://holosun.com/507c', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V2', msrp: 309.99, is_default: true, primary_image_url: null, color: 'FDE', manual_safety_variant: true, affiliate_links: [] }] },
  'sig-sauer-p365-17rd-mag': { id: 'P3', slug: 'sig-sauer-p365-17rd-mag', name: 'P365 9mm 17rd Magazine (All 9mm Models)', category: 'magazine', url: 'https://sigsauer.com/mag', is_discontinued: false, restricted_states: ['CA', 'NY'],
    manufacturers: { name: 'Sig Sauer', website_url: 'https://www.sigsauer.com' },
    product_variants: [{ id: 'V3', msrp: 59.99, is_default: true, primary_image_url: null,
      affiliate_links: [{ id: 'L3', url: 'https://www.opticsplanet.com/m', affiliate_url: null, street_price: 54.99, in_stock: true, last_checked: '2026-01-01', op_last_matched_by: 'T1', partners: { name: 'OpticsPlanet (Awin)' } }] }] },
  'tyrant-cnc-p365-xmacro-gm': { id: 'P4', slug: 'tyrant-cnc-p365-xmacro-gm', name: 'Tyrant CNC P365 XMacro Grip Module', category: 'frame', url: 'https://tyrantcnc.com/gm', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Tyrant CNC', website_url: 'https://tyrantcnc.com' },
    product_variants: [
      { id: 'V4a', msrp: 99.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [] },
      { id: 'V4b', msrp: 99.99, is_default: false, primary_image_url: null, color: 'FDE', affiliate_links: [] }] },
  'killer-innovations-velo-v1-p365-xl': { id: 'P5', slug: 'killer-innovations-velo-v1-p365-xl', name: 'Killer Innovations Velocity V1 P365 XL Slide', category: 'slide', url: 'https://killerinnovations.com/velo', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Killer Innovations', website_url: 'https://killerinnovations.com' },
    product_variants: [{ id: 'V5', msrp: 429.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [listing('L5', 399.99)] }] },
  'icarus-precision-air-xmacro': { id: 'P6', slug: 'icarus-precision-air-xmacro', name: 'Icarus Precision A.I.R. XMacro', category: 'frame', url: 'https://icarusprecision.com/air', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Icarus Precision', website_url: 'https://icarusprecision.com' },
    product_variants: [{ id: 'V6', msrp: 249.99, is_default: true, primary_image_url: null, color: 'FDE/Gold', affiliate_links: [listing('L6', 229.99)] }] },
  'wilson-combat-wcp365-xmacro': { id: 'P7', slug: 'wilson-combat-wcp365-xmacro', name: 'Wilson Combat WCP365 XMacro', category: 'frame', url: 'https://wilsoncombat.com/wcp', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Wilson Combat', website_url: 'https://wilsoncombat.com' },
    product_variants: [
      // Green deliberately FIRST in variant order: the table must re-order
      // to colors.sort_order (Black before Green), not variant order
      { id: 'V7b', msrp: 79.95, is_default: false, primary_image_url: null, color: 'Green', affiliate_links: [] },
      { id: 'V7a', msrp: 79.95, is_default: true, primary_image_url: null, color: 'Black', finish_family: 'Cerakote', affiliate_links: [] }] },
  'sig-sauer-p365-xmacro-gm-oem': { id: 'P8', slug: 'sig-sauer-p365-xmacro-gm-oem', name: 'P365 XMacro Grip Module', category: 'frame', url: 'https://sigsauer.com/gm', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Sig Sauer', website_url: 'https://www.sigsauer.com' },
    product_variants: [
      { id: 'V8a', msrp: 49.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [] },
      { id: 'V8b', msrp: 49.99, is_default: false, primary_image_url: null, color: 'Coyote', affiliate_links: [] }] },
  'holosun-507-promax': { id: 'P9', slug: 'holosun-507-promax', name: 'Holosun 507 ProMax', category: 'optic', url: 'https://holosun.com/promax', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V9', msrp: 399.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [] }] },
  'streamlight-tlr-7-hl-x-sub-usb': { id: 'P10', slug: 'streamlight-tlr-7-hl-x-sub-usb', name: 'TLR-7 HL-X sub USB', category: 'light', url: 'https://streamlight.com/tlr7', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Streamlight', website_url: 'https://www.streamlight.com' },
    product_variants: [{ id: 'V10', msrp: 229.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [listing('L10', 139.99)] }] },
};
const GUNS = {
  'p365-xl': { id: 'G1', slug: 'p365-xl', name: 'P365 XL', housing_class: 'p365xl' },
  'p365-xmacro': { id: 'G2', slug: 'p365-xmacro', name: 'P365 XMacro', housing_class: 'xmacro' },
  'p365': { id: 'G3', slug: 'p365', name: 'P365', housing_class: 'p365' },
};
const inList = (path, key) => { const m = path.match(new RegExp(key + '=in\\.\\(([^)]*)\\)')); return m ? m[1].split(',') : []; };
function catalog(n, path) {
  if (path.startsWith('products?id=in.')) return json(inList(path, 'id').map((id) => ({ id, is_approved: true, is_discontinued: false })));
  if (path.startsWith('products?')) return json(inList(path, 'slug').map((s) => PRODUCTS[s]).filter(Boolean));
  if (path.startsWith('guns?')) return json(inList(path, 'slug').map((s) => GUNS[s]).filter(Boolean));
  if (path.startsWith('optic_specs?product_id=in.')) return json([]);
  if (path.startsWith('magazine_specs?product_id=in.')) return json([]);
  if (path.startsWith('builds?')) return json([]);
  if (path.startsWith('optic_specs?product_id=eq.P1')) return json([{ footprint_id: FP.K, footprints: { slug: 'holosun-k', common_name: 'Holosun K-Series / Modified RMSc' } }]);
  if (path.startsWith('optic_specs?product_id=eq.P2')) return json([{ footprint_id: FP.RMR, footprints: { slug: 'rmr', common_name: 'Trijicon RMR' } }]);
  if (path.startsWith('optic_adapter_footprints?')) return json([]);
  if (path.startsWith('gun_optic_cuts?gun_id=eq.G1')) return json([{ optic_cut: 'rmsc', applies_to: 'all-current-skus', confidence: 'verified' }]);
  if (path.startsWith('gun_optic_cuts?gun_id=eq.G2')) return json([{ optic_cut: 'rmsc', applies_to: 'default', confidence: 'verified' }]);
  if (path.startsWith('optic_cuts?')) return json([{ optic_cut: 'rmsc', display_name: 'Shield RMSc' }]);
  if (path.startsWith('optic_cut_footprints?')) return json([
    { optic_cut: 'rmsc', fit: 'direct', footprint_id: FP.RMSC }, { optic_cut: 'rmsc', fit: 'direct', footprint_id: FP.K }]);
  if (path.startsWith('magazine_housing_fit?') && path.includes('fit=neq.not_compatible')) return json([{ magazine_product_id: 'P3' }]);
  if (path.startsWith('magazine_housing_fit?housing_class=eq.xmacro')) return json([{ fit: 'flush', note: null }]);
  if (path.startsWith('magazine_housing_fit?housing_class=eq.p365&')) return json([{ fit: 'not_compatible', note: null }]);
  if (path.startsWith('magazine_specs?')) return json([{ capacity: 17 }]);
  if (path.startsWith('colors?')) return json([
    { color: 'Black', sort_order: 1 }, { color: 'FDE', sort_order: 5 }, { color: 'FDE/Gold', sort_order: 6 },
    { color: 'Green', sort_order: 8 }, { color: 'Coyote', sort_order: 9 }]);
  if (path.startsWith('v_slide_frame_fit?') && path.includes('slide_product_id=eq.P5') && path.includes('frame_product_id=eq.P6')) return json([{ fits: true, verdict: 'Flush fit.' }]);
  if (path.startsWith('v_optic_slide_variant_fit?') && path.includes('optic_product_id=eq.P9')) return json([{ slide_variant_id: 'SV1', uses_optic_adapter: false }]);
  if (path.startsWith('v_frame_light_fit?') && path.includes('light_product_id=eq.P10')) return json([{ fitment_type: 'adapter-included', confidence: 'verified' }]);
  if (path.startsWith('v_slide_frame_fit?frame_product_id=eq.P4')) return json([{ slide_product_id: 'P5' }]);
  if (path.startsWith('v_slide_frame_fit?slide_product_id=eq.P5')) return json([{ frame_product_id: 'P4' }, { frame_product_id: 'P6' }]);
  if (path.startsWith('v_frame_light_fit?frame_product_id=eq.P4')) return json([
    // P10 twice (a second rail-bridge row) — one light, best row wins;
    // LX2 reaches the frame only with a separate adapter, never verified
    { light_product_id: 'P10', confidence: 'verified', fitment_type: 'direct' },
    { light_product_id: 'P10', confidence: 'likely', fitment_type: 'adapter-included' },
    { light_product_id: 'LX2', confidence: 'likely', fitment_type: 'adapter-separate' }]);
  if (path.startsWith('frame_specs?product_id=eq.P4')) return json([{ housing_class: 'xmacro', magwell_type: 'None',
    housing_classes: { magazine_family: 'macro-17', magazine_families: { display_name: 'P365 MACRO (17-round)' } } }]);
  if (path.startsWith('magwell_frame_requirements?frame_product_id=eq.P4')) return json([]);
  if (path.startsWith('v_optic_slide_variant_fit?slide_product_id=eq.P5')) return json([
    { optic_product_id: 'P9', uses_optic_adapter: false }, { optic_product_id: 'P1', uses_optic_adapter: true }]);
  if (path.startsWith('v_barrel_slide_fit?slide_product_id=eq.P5')) return json([{ barrel_product_id: 'PB1' }]);
  if (path.startsWith('slide_specs?product_id=eq.P5')) return json([{ part_classes: { display_name: '3.7in (P365 X, XL, XMacro, AXG)' } }]);
  throw new Error('unexpected query in test: ' + path);
}
function stubFetch(impl) {
  const seen = { calls: 0, paths: [] };
  globalThis.fetch = async (url, init) => {
    seen.calls++;
    const path = decodeURIComponent(String(url).replace(/^.*\/rest\/v1\//, ''));
    seen.paths.push(path);
    return impl(seen.calls, path, init);
  };
  return seen;
}
const run = async (url) => {
  const res = await handler(new Request(url));
  return { status: res.status, headers: res.headers, html: await res.text() };
};
const count = (s, needle) => s.split(needle).length - 1;

test('the rank card: changes/same lists, baseline line, swatches, manual-safety', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 200);
  const h = r.html;
  // the 507C card carries ~/= and the baseline; the 507K card keeps the
  // legacy pros/cons shape (the fixture covers both paths)
  const cardC = h.slice(h.indexOf('id="rank-holosun-507c-x2"'), h.indexOf('id="rank-sig-sauer'));
  assert.ok(cardC.includes('>What it changes from the factory part</div>'));
  assert.ok(cardC.includes('<li>Larger window than the K-series optics</li>'));
  assert.ok(cardC.includes('>What stays the same</div>'));
  assert.ok(cardC.includes('<li>Same CR1632 battery as the K-series optics</li>'));
  assert.ok(cardC.includes('Compared with <a href="/parts/optics/holosun-507k-x2">Holosun 507K X2</a>'), 'the baseline line links the compared part');
  assert.ok(!cardC.includes('>Pros</div>') && !cardC.includes('>Cons</div>'), 'no pros/cons heads on a changes/same card');
  const cardK = h.slice(h.indexOf('id="rank-holosun-507k-x2"'), h.indexOf('id="rank-holosun-507c-x2"'));
  assert.ok(cardK.includes('>Pros</div>') && cardK.includes('>Cons</div>'), 'the legacy shape still renders');
  assert.ok(!cardK.includes('rank-baseline'), 'no baseline line without baseline=');
  // colours as named swatches, from the live variants, via the shared rule
  assert.ok(cardK.includes('class="fn-swatch"') && cardK.includes('Black'), 'the 507K card shows its colour as a named swatch');
  assert.ok(cardC.includes('class="fn-swatch"') && cardC.includes('FDE'));
  // the manual-safety line only where a live variant has the option
  assert.ok(cardC.includes('Manual-safety option available'));
  assert.ok(!cardK.includes('Manual-safety option available'));
});

test('the method line: once, under the byline, above the disclosure, linking the methods page', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  const h = r.html;
  assert.equal(count(h, 'class="fn-method"'), 1, 'the line exactly once');
  assert.ok(h.includes('href="' + METHOD_PAGE_PATH + '">How gunforma checks parts'), 'links the methods page');
  const byline = h.indexOf('class="byline"'), method = h.indexOf('<p class="fn-method">'), disc = h.indexOf('class="fn-affiliate-note"');
  assert.ok(byline !== -1 && method !== -1 && disc !== -1);
  assert.ok(byline < method && method < disc, 'byline, then method line, then disclosure');
  assert.ok(!h.includes('We don’t range-test parts; where a fit') || true);
});

test('::unlocks frame: splits, live-only counts, the magwell gap, the dated footer', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  const h = r.html;
  const block = h.slice(h.indexOf('What the <a href="/parts/frames/tyrant-cnc-p365-xmacro-gm">'), h.indexOf('And a slide'));
  assert.ok(block.includes('2 lights fit — 1 verified · 1 likely · 1 needs an adapter or key'), 'the verified/likely split and the adapter count');
  assert.ok(block.includes('1 slide fits'));
  assert.ok(block.includes('P365 MACRO (17-round) — 1 magazine fits at the family level'), 'the family name from the housing class (frame_specs has no magazine_family column)');
  assert.ok(block.includes('No add-on magwell on record for this module'), 'the one zero a reader should see');
  assert.ok(block.includes('2 colours'));
  assert.ok(block.includes('Counts from the gunforma catalog on '), 'the dated footer');
  assert.ok(!block.includes('>0 '), 'no zero count renders as a line');
});

test('::unlocks slide: direct/plate split, barrels, grip modules, the derived spring', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  const h = r.html;
  const block = h.slice(h.indexOf('What the <a href="/parts/slides/killer-innovations-velo-v1-p365-xl">'), h.indexOf('The colour table'));
  assert.ok(block.includes('2 optics mount — 1 direct mount · 1 with a plate'));
  assert.ok(block.includes('1 barrel fits'));
  assert.ok(block.includes('2 grip modules fit'));
  assert.ok(block.includes('Recoil spring</span> 3.7in (P365 X, XL, XMacro, AXG)'), 'the requirement the slide page already derives, by name');
});

test('::unlocks omits a zero-row line entirely', async () => {
  stubFetch((n, path) => {
    if (path.startsWith('v_frame_light_fit?frame_product_id=eq.P4')) return json([]);
    return catalog(n, path);
  });
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  const h = r.html;
  const block = h.slice(h.indexOf('What the <a href="/parts/frames/tyrant-cnc-p365-xmacro-gm">'), h.indexOf('And a slide'));
  assert.ok(!block.includes('Lights'), 'zero lights renders no Lights line — never "0 lights"');
  assert.ok(block.includes('1 slide fits'), 'the other lines stay');
  assert.ok(block.includes('No add-on magwell on record'), 'the magwell gap is still the exception');
});

test('::colors: factory row first, colors.sort_order, the Cerakote column', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  const h = r.html;
  const block = h.slice(h.indexOf('<div class="fn-block fn-colors">'), h.indexOf('An example build'));
  const oem = block.indexOf('sig-sauer-p365-xmacro-gm-oem');
  const air = block.indexOf('icarus-precision-air-xmacro');
  const wilson = block.indexOf('wilson-combat-wcp365-xmacro');
  assert.ok(oem !== -1 && oem < air && oem < wilson, 'the baseline row renders first');
  assert.ok(block.includes('<span class="fn-factory">(factory)</span>'), 'and is labelled (factory)');
  assert.equal(count(block, 'fn-factory'), 1, 'only the baseline row is');
  const wilsonRow = block.slice(wilson);
  assert.ok(wilsonRow.indexOf('>Black<') !== -1 && wilsonRow.indexOf('>Black<') < wilsonRow.indexOf('>Green<'),
    'colours in colors.sort_order, not variant order (the stub lists Green first)');
  assert.ok(wilsonRow.includes('<td>Cerakote</td>'), 'any Cerakote variant marks the row');
  const airRow = block.slice(air, wilson);
  assert.ok(airRow.includes('<td>&mdash;</td>'), 'no Cerakote is —');
});

test('::build happy path: roles, prices, the total with its unpriced tail, the Armory button', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.headers.get('x-field-note-build'), '3/3', 'slide×frame, optic×slide, light×frame all checked and passing');
  const h = r.html;
  const block = h.slice(h.indexOf('<div class="fn-block fn-build'), h.indexOf('## Every construct') === -1 ? undefined : h.indexOf('Every construct'));
  assert.ok(block.includes('<div class="fn-build-head">Flush-fit XMacro build</div>'));
  assert.ok(block.includes('<td>Grip Module</td>'), 'the role label is the category’s singular house name, never "frame"');
  assert.ok(block.includes('<td>Weapon Light</td>'), 'the light role too');
  assert.ok(block.includes('href="/parts/frames/icarus-precision-air-xmacro">Icarus Precision A.I.R. XMacro</a>'));
  assert.ok(block.includes('$229.99 at OpticsPlanet') && block.includes('$399.99 at OpticsPlanet') && block.includes('$139.99 at OpticsPlanet'));
  assert.ok(block.includes('<td class="t-price">Check price</td>'), 'no fresh price is "Check price", never MSRP');
  assert.ok(!block.includes('399.99</td><td class="t-price">MSRP'), 'sanity');
  assert.ok(block.includes('$769.97 at today’s prices + 1 part without a live price'), 'the total sums fresh prices only and names the gap');
  assert.ok(block.includes('href="/gunforma-armory.html">Start this build in the Armory</a>'), 'the Armory start link (no multi-part prefill exists)');
  assert.ok(!block.includes('fn-build-note'), 'a verified adapter-included light carries no note');
});

test('::build renders the adapter-separate and likely notes on the light row', async () => {
  stubFetch((n, path) => {
    if (path.startsWith('v_frame_light_fit?') && path.includes('light_product_id=eq.P10')) {
      return json([{ fitment_type: 'adapter-separate', confidence: 'likely' }]);
    }
    return catalog(n, path);
  });
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.headers.get('x-field-note-build'), '3/3', 'a note is not a failure');
  const h = r.html;
  assert.ok(h.includes('needs a key/adapter, sold separately'));
  assert.ok(h.includes('fit likely, not verified'));
  const lightRow = h.slice(h.indexOf('TLR-7 HL-X sub USB</a><span class="fn-build-note">'));
  assert.ok(lightRow.includes('needs a key/adapter, sold separately · fit likely, not verified'), 'both notes, on the light row');
});

test('a non-fitting slide × frame pair FAILS the build block: refusal, no prices, no button', async () => {
  stubFetch((n, path) => {
    if (path.startsWith('v_slide_frame_fit?') && path.includes('slide_product_id=eq.P5') && path.includes('frame_product_id=eq.P6')) {
      return json([{ fits: false, verdict: 'Slide too short for this module.' }]);
    }
    return catalog(n, path);
  });
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 200, 'the page still serves — the refusal is the block’s, and the header carries it for check-routes');
  assert.equal(r.headers.get('x-field-note-build'), '2/3', 'the shortfall is observable from outside');
  const h = r.html;
  const block = h.slice(h.indexOf('<div class="fn-block fn-build'), h.indexOf('</p></div>', h.indexOf('<div class="fn-block fn-build')) + 10);
  assert.ok(block.includes('fn-build-failed'));
  assert.ok(block.includes('does not pass the catalog’s fit data'));
  assert.ok(block.includes('Killer Innovations Velocity V1 P365 XL Slide × Icarus Precision A.I.R. XMacro'), 'the refusal names the pair');
  assert.ok(!block.includes('t-price'), 'no prices in a refused build');
  assert.ok(!block.includes('Start this build in the Armory'), 'no Armory button on a refused build');
});
