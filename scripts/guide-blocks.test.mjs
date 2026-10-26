// guide-blocks.test.mjs — the Field Notes guide blocks (::picks, ::rank,
// ::compare, ::faq) and the trust layer, rendered for real: field-note.mjs
// run over the renderer-check fixture against a stubbed PostgREST, the way
// field-notes.test.mjs runs the rest of the renderer.
//
// What it pins:
//   - the four directives parse (and the malformed shapes do not)
//   - the picks box: 3 rows, each jumping to its ::rank anchor, fresh price
//     or NO number (never MSRP), "See current price" on a stale or unlisted
//     part
//   - the rank card: anchor, rank number, best badge, photo only when the
//     product has one, coupon chip, extra retailer links, the category's
//     declared spec columns, pros/cons, and "Used in N Gunforma builds"
//     only when N >= 1 — never "0 builds"
//   - the compare table: declared columns only, "—" for a null cell or a
//     price we cannot stand behind, with the footnote
//   - every /go/ href out of a block carries s=<slug>&loc=<block kind>;
//     nothing else about the URL changes
//   - the FAQ: details/summary pairs, and FAQPage JSON-LD merged into the
//     page's ONE structured-data script beside Article and BreadcrumbList
//   - the trust layer: the automatic affiliate disclosure, "Last reviewed
//     <Month YYYY>" from the registry's updated date, the changelog
//     newest-first, and no byline when the front matter has no author
//   - a slug PostgREST does not return renders a visible missing line, not
//     a silently skipped card (shipping one is check-field-notes' job)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const md = await import(fn('_markdown.mjs'));
const { withGoParams, colMeta, GUIDE_SPECS } = await import(fn('_guide-blocks.mjs'));
const { FIELD_NOTES, fieldNotePath } = await import(fn('_field-notes-meta.mjs'));
const handler = (await import(fn('field-note.mjs'))).default;

const FIXTURE = FIELD_NOTES.find((a) => a.slug === 'renderer-check');
assert.ok(FIXTURE && FIXTURE.draft, 'the renderer-check draft fixture must stay in _field-notes-meta.mjs');
assert.ok(Array.isArray(FIXTURE.changelog) && FIXTURE.changelog.length >= 2, 'the fixture carries a changelog so this suite can pin its rendering');
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the parser ───────────────────────────────────────────────────────────
test('picks/rank/faq parse with their bodies; compare on one line', () => {
  const picks = md.parseDirective('::picks', ['a-1 | Best overall', '', 'b-2 | Best budget']);
  assert.deepEqual(picks, { kind: 'picks', picks: [{ slug: 'a-1', label: 'Best overall' }, { slug: 'b-2', label: 'Best budget' }] });
  const rank = md.parseDirective('::rank a-1 best="Best overall" rank=1 code="GUNFORMA10"', ['+ pro one', '- con one']);
  assert.deepEqual(rank, { kind: 'rank', slug: 'a-1', best: 'Best overall', rank: 1, code: 'GUNFORMA10', pros: ['pro one'], cons: ['con one'] });
  assert.equal(md.parseDirective('::rank a-1 best="B" rank=2', []).code, null);
  const faq = md.parseDirective('::faq', ['Q: One?', 'A: Yes.', 'Q: Two?', 'A: No.']);
  assert.equal(faq.qas.length, 2);
  assert.deepEqual(faq.qas[0], { q: 'One?', a: 'Yes.' });
  const cmp = md.parseDirective('::compare optic gun=p365-xl cols=dot_size_moa,window_size slugs=a-1,b-2');
  assert.deepEqual(cmp, { kind: 'compare', category: 'optic', gun: 'p365-xl', cols: ['dot_size_moa', 'window_size'], slugs: ['a-1', 'b-2'] });
});

test('the malformed shapes are null, never a guess', () => {
  assert.equal(md.parseDirective('::picks', []), null, 'an empty picks box');
  assert.equal(md.parseDirective('::picks', ['no-pipe-no-label']), null);
  assert.equal(md.parseDirective('::picks', ['a | x', 'a | y']), null, 'the same slug twice');
  assert.equal(md.parseDirective('::picks extra-arg', ['a | x']), null);
  assert.equal(md.parseDirective('::rank a-1 best="B"', []), null, 'rank without rank=');
  assert.equal(md.parseDirective('::rank a-1 rank=1', []), null, 'rank without best=');
  assert.equal(md.parseDirective('::rank a-1 best="B" rank=0', []), null);
  assert.equal(md.parseDirective('::rank a-1 best="B" rank=1', ['not a pro or con line']), null);
  assert.equal(md.parseDirective('::rank a-1 best="B" rank=1 bogus="x"', []), null);
  assert.equal(md.parseDirective('::faq', ['Q: One?']), null, 'a question with no answer');
  assert.equal(md.parseDirective('::faq', ['A: answer first']), null);
  assert.equal(md.parseDirective('::faq', []), null);
  assert.ok(md.parseDirective('::compare optic cols=a slugs=x'), 'one slug parses — the ≥2 count is the guard\'s check');
  assert.equal(md.parseDirective('::compare optic slugs=x,y'), null, 'no cols');
  assert.equal(md.parseDirective('::compare cols=a slugs=x,y'), null, 'no category');
});

test('an unclosed body block is tolerated by the renderer (the guard refuses it)', () => {
  const r = md.renderMarkdown('::picks\na-1 | Best overall\nb-2 | B\nc-3 | C');
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].picks.length, 3);
});

test('withGoParams appends s and loc and nothing else', () => {
  assert.equal(withGoParams('/go/L1', 'my-note', 'picks'), '/go/L1?s=my-note&loc=picks');
  assert.equal(withGoParams('/go/L1', null, 'picks'), '/go/L1', 'no slug, no params');
  assert.equal(colMeta('optic', 'dot_size_moa').label, 'Dot Size');
  assert.equal(colMeta('optic', 'not_a_column'), null);
  for (const [cat, c] of Object.entries(GUIDE_SPECS)) {
    assert.ok(c.rank.length >= 4 && c.rank.length <= 6, cat + ' rank set must be 4–6 columns');
    for (const col of c.rank) assert.ok(colMeta(cat, col), cat + ' rank column ' + col + ' must be declared');
  }
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
const PRODUCTS = {
  'holosun-507k-x2': { id: 'P1', slug: 'holosun-507k-x2', name: 'Holosun 507K X2', category: 'optic', url: 'https://holosun.com/507k', is_discontinued: false, restricted_states: null,
    material: null, weight_oz: 1,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V1', msrp: 359.99, is_default: true, primary_image_url: 'https://img/507k.jpg',
      affiliate_links: [
        { id: 'L1', url: 'https://www.opticsplanet.com/x', affiliate_url: 'https://www.awin1.com/x', street_price: 329.99, in_stock: true, last_checked: today, op_last_matched_by: 'T1', partners: { name: 'OpticsPlanet (Awin)' } },
        { id: 'L2', url: 'https://www.brownells.com/x', affiliate_url: null, street_price: 339.99, in_stock: true, last_checked: today, op_last_matched_by: 'T1', partners: { name: 'Brownells' } },
        // A SECOND OpticsPlanet listing (the live catalog has these): the
        // rank card's extras must not repeat the hero's retailer.
        { id: 'L4', url: 'https://www.opticsplanet.com/x2', affiliate_url: 'https://www.awin1.com/x2', street_price: 349.99, in_stock: true, last_checked: today, op_last_matched_by: 'T1', partners: { name: 'OpticsPlanet (Awin)' } },
      ] }] },
  'holosun-507c-x2': { id: 'P2', slug: 'holosun-507c-x2', name: 'Holosun 507C X2', category: 'optic', url: 'https://holosun.com/507c', is_discontinued: false, restricted_states: null,
    material: null, weight_oz: 1.5,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V2', msrp: 309.99, is_default: true, primary_image_url: null, affiliate_links: [] }] },
  'sig-sauer-p365-17rd-mag': { id: 'P3', slug: 'sig-sauer-p365-17rd-mag', name: 'P365 9mm 17rd Magazine (All 9mm Models)', category: 'magazine', url: 'https://sigsauer.com/mag', is_discontinued: false, restricted_states: ['CA', 'NY'],
    material: null, weight_oz: null,
    manufacturers: { name: 'Sig Sauer', website_url: 'https://www.sigsauer.com' },
    product_variants: [{ id: 'V3', msrp: 59.99, is_default: true, primary_image_url: null,
      affiliate_links: [{ id: 'L3', url: 'https://www.opticsplanet.com/m', affiliate_url: null, street_price: 54.99, in_stock: true, last_checked: '2026-01-01', op_last_matched_by: 'T1', partners: { name: 'OpticsPlanet (Awin)' } }] }] },
};
const GUNS = {
  'p365-xl': { id: 'G1', slug: 'p365-xl', name: 'P365 XL', housing_class: 'p365xl' },
  'p365-xmacro': { id: 'G2', slug: 'p365-xmacro', name: 'P365 XMacro', housing_class: 'xmacro' },
  'p365': { id: 'G3', slug: 'p365', name: 'P365', housing_class: 'p365' },
};
const inList = (path, key) => { const m = path.match(new RegExp(key + '=in\\.\\(([^)]*)\\)')); return m ? m[1].split(',') : []; };
function catalog(n, path) {
  if (path.startsWith('products?')) return json(inList(path, 'slug').map((s) => PRODUCTS[s]).filter(Boolean));
  if (path.startsWith('guns?')) return json(inList(path, 'slug').map((s) => GUNS[s]).filter(Boolean));
  if (path.startsWith('optic_specs?product_id=in.')) return json([
    { product_id: 'P1', dot_size_moa: 2, reticle: '2 MOA dot', window_size: '0.58x0.77 in', battery_type: 'CR1632', battery_life: '50,000 hours', enclosed_emitter: false, housing_material: '7075 Aluminum' },
    { product_id: 'P2', dot_size_moa: 2, reticle: null, window_size: '0.63x0.91 in', battery_type: 'CR1632', battery_life: null, enclosed_emitter: false, housing_material: null },
  ]);
  if (path.startsWith('magazine_specs?product_id=in.')) return json([
    { product_id: 'P3', capacity: 17, caliber: '9mm', mag_style: 'Extended', body_material: null },
  ]);
  if (path.startsWith('builds?')) return json([
    { parts_snapshot: [{ refId: 'P1' }, { refId: 'P3' }] },
    { parts_snapshot: [{ refId: 'P1' }, { refId: 'P1' }] },   // one build, counted once
  ]);
  if (path.startsWith('optic_specs?product_id=eq.P1')) return json([{ footprint_id: FP.K, footprints: { slug: 'holosun-k', common_name: 'Holosun K-Series / Modified RMSc' } }]);
  if (path.startsWith('optic_specs?product_id=eq.P2')) return json([{ footprint_id: FP.RMR, footprints: { slug: 'rmr', common_name: 'Trijicon RMR' } }]);
  if (path.startsWith('optic_adapter_footprints?')) return json([]);
  if (path.startsWith('gun_optic_cuts?gun_id=eq.G1')) return json([{ optic_cut: 'rmsc', applies_to: 'all-current-skus', confidence: 'verified' }]);
  if (path.startsWith('gun_optic_cuts?gun_id=eq.G2')) return json([{ optic_cut: 'rmsc', applies_to: 'default', confidence: 'verified' }, { optic_cut: 'sig-loc-compact', applies_to: 'sku-sl-rxsl', confidence: 'likely' }]);
  if (path.startsWith('optic_cuts?')) return json([{ optic_cut: 'rmsc', display_name: 'Shield RMSc' }, { optic_cut: 'sig-loc-compact', display_name: 'SIG-LOC Compact' }]);
  if (path.startsWith('optic_cut_footprints?')) return json([
    { optic_cut: 'rmsc', fit: 'direct', footprint_id: FP.RMSC }, { optic_cut: 'rmsc', fit: 'direct', footprint_id: FP.K },
    { optic_cut: 'sig-loc-compact', fit: 'direct', footprint_id: FP.SLC }]);
  if (path.startsWith('magazine_housing_fit?housing_class=eq.xmacro')) return json([{ fit: 'flush', note: 'The XMacro’s own magazine.' }]);
  if (path.startsWith('magazine_housing_fit?housing_class=eq.p365&')) return json([{ fit: 'not_compatible', note: null }]);
  if (path.startsWith('magazine_specs?')) return json([{ capacity: 17 }]);
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

test('the fixture renders every guide block, tracked, honest, merged', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 200);
  const h = r.html;
  assert.equal(r.headers.get('x-field-note-blocks'), 'price=1 fit=5 picks=1 rank=3 compare=1 faq=1');

  // the picks box: three rows, each jumping to its rank card's anchor
  assert.equal((h.match(/class="pick"/g) || []).length, 3);
  for (const s of ['holosun-507k-x2', 'holosun-507c-x2', 'sig-sauer-p365-17rd-mag']) {
    // Page-absolute, never a bare #fragment: the chrome's <base href="/"/>
    // would resolve that against the homepage (found on deploy preview 204).
    assert.ok(h.includes('href="/field-notes/renderer-check#rank-' + s + '"'), 'picks jumps to the rank anchor for ' + s);
    assert.ok(!h.includes('href="#rank-' + s + '"'), 'no bare fragment href — <base> would send it to the homepage');
    assert.ok(h.includes('id="rank-' + s + '"'), 'the rank card carries the anchor ' + s);
  }
  // fresh price with its retailer; a part with no fresh price shows NO
  // number and never MSRP — the button reads "See current price"
  assert.ok(h.includes('<span class="pick-price">$329.99 at OpticsPlanet</span>'));
  assert.ok(!h.includes('MSRP $309.99'.replace('MSRP', 'pick-price">MSRP')), 'no MSRP in a picks row');
  assert.ok(!/pick-price">\$54\.99/.test(h), 'a stale price is never a picks number');
  assert.ok(h.includes('See current price'), 'the no-fresh-price button label');

  // every /go/ href out of a block carries s + loc, and only those params
  assert.ok(h.includes('href="/go/L1?s=renderer-check&amp;loc=picks"'));
  assert.ok(h.includes('href="/go/L1?s=renderer-check&amp;loc=rank"'));
  assert.ok(h.includes('href="/go/L1?s=renderer-check&amp;loc=price"'));
  assert.ok(h.includes('href="/go/L1?s=renderer-check&amp;loc=compare"'));
  assert.ok(h.includes('href="/go/part/P2?s=renderer-check&amp;loc=picks"'), 'the maker shape is tracked too');
  assert.ok(h.includes('href="/go/L3?s=renderer-check&amp;loc=rank"'), 'a stale listing still links through /go/');

  // the rank cards: number, badge, photo only where one exists, chip,
  // extra retailer links, declared spec columns, pros/cons
  assert.ok(h.includes('<span class="rank-no">1</span>'));
  assert.ok(h.includes('<span class="rank-best">Best overall</span>'));
  assert.ok(h.includes('class="rank-photo" src="https://img/507k.jpg"'));
  assert.equal((h.match(/class="rank-photo"/g) || []).length, 1, 'no placeholder image area on the photo-less cards');
  assert.ok(h.includes('<span class="coupon-chip">Code GUNFORMA10 at checkout</span>'));
  assert.equal((h.match(/coupon-chip/g) || []).length, 1 + 1, 'one chip (plus its CSS rule) — only the card that declared a code');
  assert.ok(h.includes('>See price at Brownells</a>'), 'the second listing, same sort as the buy rows');
  // One link per retailer per card, hero's retailer taken: P1's hero is
  // OpticsPlanet and the stub carries a second OpticsPlanet listing — the
  // extras show Brownells and nothing else, and never the hero listing.
  const rankP1 = h.slice(h.indexOf('id="rank-holosun-507k-x2"'), h.indexOf('id="rank-holosun-507c-x2"'));
  assert.equal((rankP1.match(/class="rank-alt"/g) || []).length, 1, 'exactly one extra on the 507K card');
  assert.ok(!rankP1.includes('>See price at OpticsPlanet</a>'), 'the hero’s retailer never repeats as an extra');
  assert.equal((rankP1.match(/href="\/go\/L1\?/g) || []).length, 1, 'the hero listing itself appears once — its buy button, never an extra');
  const rankP3 = h.slice(h.indexOf('id="rank-sig-sauer-p365-17rd-mag"'), h.indexOf('The spec-comparison'));
  assert.ok(!rankP3.includes('class="rank-alts"'), 'a single-listing product renders no extras row at all');
  assert.ok(h.includes('<span>Dot Size</span><strong>2 MOA</strong>'));
  assert.ok(h.includes('<span>Capacity</span><strong>17 rounds</strong>'));
  assert.ok(h.includes('<div class="rank-pc-head">Pros</div>'));
  assert.ok(h.includes('<li>Mag release not included</li>') === false, 'the fixture’s own cons render, not the doc example');
  assert.ok(h.includes('<li>Side-loading battery tray costs a few ounces of window</li>'));

  // "Used in N Gunforma builds": P1 is in two builds (one of them naming it
  // twice, counted once); P2 is in none and renders NO line
  assert.ok(h.includes('Used in 2 Gunforma builds'));
  assert.ok(!h.includes('Used in 0 Gunforma'), 'N = 0 renders nothing');
  const rankP2 = h.slice(h.indexOf('id="rank-holosun-507c-x2"'), h.indexOf('id="rank-sig-sauer'));
  assert.ok(!rankP2.includes('Used in'), 'the unused part’s card carries no builds line');

  // the compare table: declared columns, — for null and for a missing
  // price, the footnote, the price linked through /go/
  assert.ok(h.includes('<th>Part</th><th>Dot Size</th><th>Window Size</th><th>Battery Life</th><th>Price today</th>'));
  assert.ok(h.includes('<td>&mdash;</td>'), 'a null cell is —');
  assert.ok(h.includes('<td class="t-price">&mdash;</td>'), 'no live price is —, never MSRP');
  assert.ok(h.includes('&mdash; = no live retailer price'));

  // the FAQ: details/summary, and FAQPage merged into the ONE JSON-LD script
  assert.equal((h.match(/<details><summary>/g) || []).length, 2);
  const scripts = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  assert.equal(scripts.length, 1, 'one structured-data script');
  const ld = JSON.parse(scripts[0][1].replaceAll('\\u003c', '<'));
  assert.deepEqual(ld.map((x) => x['@type']), ['Article', 'BreadcrumbList', 'FAQPage']);
  const faq = ld[2];
  assert.equal(faq.mainEntity.length, 2);
  assert.equal(faq.mainEntity[0]['@type'], 'Question');
  assert.equal(faq.mainEntity[0].acceptedAnswer['@type'], 'Answer');

  // the trust layer: the automatic disclosure near the top, the reviewed
  // month in the byline, the changelog newest first
  assert.ok(h.includes('class="fn-affiliate-note"'), 'the affiliate disclosure renders');
  assert.ok(h.indexOf('class="fn-affiliate-note"') < h.indexOf('class="fn-block'), 'and it sits above the first block');
  assert.ok(h.includes('href="/gunforma-legal.html#affiliate"'));
  assert.ok(h.includes('Last reviewed October 2026'));
  assert.ok(h.includes('<div class="section-title">Latest updates</div>'));
  assert.ok(h.indexOf('Added the four guide blocks') < h.indexOf('First version of the fixture'), 'newest first');
});

test('an authored con may not contradict a fit verdict on the same page', async () => {
  // The rule the fixture itself once broke: its 507C card claimed "needs a
  // plate" while the ::fit block above rendered "Doesn't fit" — and the fit
  // tables had no plate row (checked read-only, 2026-10-26: the rmsc cut
  // mounts only the RMSc and Holosun-K footprints, both direct, and the
  // 507C has no adapter rows). The verdict is live data, so
  // check-field-notes (offline by design) cannot see it; this test holds
  // the permanent fixture to it against the stub, which mirrors the live
  // tables. For articles the rule is editorial (CLAUDE.md, the evidence
  // rule).
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  const h = r.html;
  // every product with a "No" overall fit verdict on the page…
  const noFit = new Set();
  for (const m of h.matchAll(/<div class="fn-fit-q">Does the <a href="\/parts\/[^/"]+\/([a-z0-9-]+)">[\s\S]*?<div class="fn-verdict (yes|no|depends|unknown)"/g)) {
    if (m[2] === 'no') noFit.add(m[1]);
  }
  assert.ok(noFit.has('holosun-507c-x2'), 'the stub still renders the 507C as a no — the premise of this test');
  // …whose rank card cons then claim a plate is a contradiction
  const anchors = [...h.matchAll(/id="rank-([a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const slug of anchors) {
    if (!noFit.has(slug)) continue;
    const start = h.indexOf('id="rank-' + slug + '"');
    // the card ends where the next block begins — a rank anchor alone would
    // let the LAST card run to the end of the page and read the FAQ's own
    // "without a plate?" as its con
    const end = h.indexOf('<div class="fn-block', start + 1);
    const card = h.slice(start, end === -1 ? undefined : end);
    const cons = card.includes('>Cons</div>') ? card.slice(card.indexOf('>Cons</div>')) : '';
    assert.ok(!/plate/i.test(cons), slug + ': a con line claims a plate while the fit block says it doesn’t fit');
  }
});

test('a product PostgREST does not return is a visible gap, never a silent skip', async () => {
  stubFetch((n, path) => {
    if (path.startsWith('products?')) return json(inList(path, 'slug').map((s) => (s === 'holosun-507c-x2' ? null : PRODUCTS[s])).filter(Boolean));
    return catalog(n, path);
  });
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-field-note-products'), '2/3');
  assert.ok(r.html.includes('id="rank-holosun-507c-x2"'), 'the anchor survives so the jump link still lands');
  const card = r.html.slice(r.html.indexOf('id="rank-holosun-507c-x2"'), r.html.indexOf('id="rank-sig-sauer'));
  assert.ok(card.includes('<code>holosun-507c-x2</code> is not in the catalog'), 'the gap is visible');
});

test('the disclosure is keyed to block kinds: a fit-only page has none', () => {
  // The renderer puts the disclosure on a page whose blocks can earn a
  // commission (price/picks/rank). A fit block alone must not trigger it —
  // asserted at the deciding rule, since the fixture always carries all four.
  const r = md.renderMarkdown('::fit optic=holosun-507k-x2 gun=p365-xl');
  assert.equal(r.blocks.length, 1);
  assert.ok(!r.blocks.some((b) => b.kind === 'price' || b.kind === 'picks' || b.kind === 'rank'));
});
