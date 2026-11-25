// fit-slide-block.test.mjs — the Field Notes `::fit slide=` block, the
// slide side of the fit views (Alex, 2026-11-25), plus the two slide
// changes that shipped with it: the ::compare `port_style` column and a
// null weight on a slide ::rank card.
//
// `::fit slide=a[,b,…] against=frame` reads v_slide_frame_fit: one row per
// grip class the slides fit (fits = true only), the number of live,
// approved grips in it, the view's verdict. `against=barrel` reads
// v_barrel_slide_fit: the barrels the slides take (fit_status = 'fits'),
// linked, the "no comp effect" ones listed apart. Both are a CLOSED
// <details>. A group is honest only when every slide has the SAME fit set:
// the build fails a mismatched group (against scripts/fixtures/
// slide-frame-fit.json and the barrel fixture turned around), and the
// renderer, re-checking live, refuses one in words.
//
// Run with --refresh-fixture to re-read the slide fixture from production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = await import(pathToFileURL(join(ROOT, 'scripts/slide-fit-fixture.mjs')).href);
if (process.argv.includes('--refresh-fixture')) {
  const client = await readFile(join(ROOT, 'js/supabase-client.js'), 'utf8');
  const url = client.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
  const key = client.match(/eyJ[A-Za-z0-9._-]+/)[0];
  const fits = await FIX.readLiveSlideFrameFits({ url, key });
  await writeFile(FIX.SLIDE_FIT_FIXTURE, FIX.slideFixtureText(fits));
  console.log('slide fit fixture refreshed: ' + Object.keys(fits).length + ' slides');
}
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;
const md = await import(fn('_markdown.mjs'));
const page = await import(fn('field-note.mjs'));
const blocks = await import(fn('_guide-blocks.mjs'));
const handler = page.default;

const ARTICLE = 'best-p365-fuse-slides';
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the parser ───────────────────────────────────────────────────────────
test('::fit slide= parses one slug or a list, against=frame|barrel, never gun=', () => {
  assert.deepEqual(md.parseDirective('::fit slide=s-1 against=frame'),
    { kind: 'fit', part: 'slide', slug: 's-1', slugs: ['s-1'], against: 'frame', gun: null });
  assert.deepEqual(md.parseDirective('::fit slide=s-1,s-2 against=barrel'),
    { kind: 'fit', part: 'slide', slug: 's-1', slugs: ['s-1', 's-2'], against: 'barrel', gun: null });
  assert.equal(md.parseDirective('::fit slide=s-1'), null, 'against= is required');
  assert.equal(md.parseDirective('::fit slide=s-1 against=optic'), null, 'frame or barrel only');
  assert.equal(md.parseDirective('::fit slide=s-1 against=frame gun=p365-fuse'), null, 'no pistol narrows the views');
  assert.equal(md.parseDirective('::fit slide=s-1,s-1 against=frame'), null, 'no duplicate in a group');
  assert.equal(md.parseDirective('::fit barrel=b-1 against=frame'), null, 'against= belongs to slide= only');
  assert.equal(md.parseDirective('::fit optic=o-1 gun=p365').part, 'optic', 'optic= unchanged');
  assert.equal(md.parseDirective('::fit barrel=b-1,b-2').part, 'barrel', 'barrel= unchanged');
});

test('the queries: the fit views, fits only, products through the NAMED spec FKs, discontinued filtered', () => {
  const f = decodeURIComponent(page.slideFrameFitQueryPath('S1'));
  assert.ok(f.startsWith('v_slide_frame_fit?slide_product_id=eq.S1&fits=is.true&'), f);
  assert.ok(f.includes('frame:products!frame_specs_product_id_fkey!inner('));
  assert.ok(f.endsWith('&frame.is_discontinued=is.false'));
  const b = decodeURIComponent(page.slideBarrelFitQueryPath('S1'));
  assert.ok(b.startsWith('v_barrel_slide_fit?slide_product_id=eq.S1&fit_status=eq.fits&'), b);
  assert.ok(b.includes('barrel:products!barrel_specs_product_id_fkey!inner('));
  assert.ok(b.endsWith('&barrel.is_discontinued=is.false'));
});

// ── the handler over the draft (served off the apex) ─────────────────────
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SLIDES = [
  'arc-division-reactor-365f-p365-fuse', 'fdez-werx-365rs-p365-fuse', 'fdez-werx-accs-p365-fuse', 'fdez-werx-p365-fuse-slide',
  'norsso-barracuda-edc-p365-fuse', 'norsso-piranha-cport-p365-fuse', 'norsso-rail-edc-p365-fuse', 'norsso-rail-kp-p365-fuse',
  'norsso-reptile-cport-p365-fuse', 'norsso-reptile-edc-p365-fuse', 'norsso-reptile-kp-p365-fuse', 'true-precision-p365-fuse',
];
const product = (slug, category = 'slide') => ({
  id: 'ID-' + slug, slug, name: 'Name ' + slug, category, url: 'https://maker.example/' + slug, is_discontinued: false, restricted_states: null,
  material: '17-4 Stainless', weight_oz: null,
  manufacturers: { name: 'Maker', website_url: 'https://maker.example' },
  product_variants: [{ id: 'V-' + slug, msrp: 399.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [] }],
});
const PRODUCTS = Object.fromEntries(SLIDES.map((s) => [s, product(s)]));

const grip = (cls, verdict, slug) => ({ housing_class: cls, verdict, frame: { slug, is_approved: true, is_discontinued: false } });
const FLUSH = 'Flush fit.', OVER = 'Slide overhangs the grip. Intentional and fine.';
const FRAME_ROWS = [
  grip('xmacro', OVER, 'g-x1'), grip('xmacro', OVER, 'g-x2'), grip('fuse', FLUSH, 'g-f1'),
  grip('p365', OVER, 'g-p1'), grip('p365xl', OVER, 'g-xl1'),
  { housing_class: 'p365', verdict: OVER, frame: { slug: 'g-hidden', is_approved: false, is_discontinued: false } },
];
const HOUSING = [
  { housing_class: 'p365', display_name: 'P365', typical_slide_length_in: 3.1 },
  { housing_class: 'p365xl', display_name: 'P365 X / XL', typical_slide_length_in: 3.7 },
  { housing_class: 'xmacro', display_name: 'P365 XMACRO', typical_slide_length_in: 3.7 },
  { housing_class: 'fuse', display_name: 'P365 FUSE', typical_slide_length_in: 4.3 },
];
const bar = (slug, brand, name, verdict = 'Compatible.') =>
  ({ verdict, barrel: { id: 'B-' + slug, slug, name, is_approved: true, is_discontinued: false, manufacturers: { name: brand } } });
const NOCOMP = 'Fits — no comp effect; designed for the matching ported barrel.';
const PLAIN_BARRELS = [bar('tp-threaded', 'True Precision', 'FUSE Threaded'), bar('fw-flush', 'Fdez Werx', 'FUSE Flush'),
  { verdict: 'Compatible.', barrel: { id: 'B-x', slug: 'unapproved-barrel', name: 'Hidden', is_approved: false, is_discontinued: false, manufacturers: { name: 'Aaa' } } }];
const PORTED_BARRELS = [bar('norsso-cport', 'Norsso', 'C Port Barrel'), bar('fw-flush', 'Fdez Werx', 'FUSE Flush', NOCOMP)];

function defaultFits(id) {
  const slug = id.replace(/^ID-/, '');
  if (/cport|kp|365rs|accs|fuse-slide|reactor/.test(slug)) return PORTED_BARRELS;
  return PLAIN_BARRELS;
}

async function render({ frame = () => FRAME_ROWS, barrels = defaultFits } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/products?slug=in.(')) {
      const want = u.match(/slug=in\.\(([^)]*)\)/)[1].split(',');
      return json(want.map((s) => PRODUCTS[s]).filter(Boolean));
    }
    let m = u.match(/v_slide_frame_fit\?slide_product_id=eq\.([^&]+)&fits=is\.true/);
    if (m) return json(frame(m[1]));
    m = u.match(/v_barrel_slide_fit\?slide_product_id=eq\.([^&]+)&fit_status=eq\.fits/);
    if (m) return json(barrels(m[1]));
    if (u.includes('/housing_classes?')) return json(HOUSING);
    if (u.includes('/slide_specs?')) {
      return json(SLIDES.map((s) => ({ product_id: 'ID-' + s, slide_length_in: 4.3,
        port_style: /cport/.test(s) ? { display_name: 'C-Port', geometry: 'Two Openings' } : null })));
    }
    return json([]);
  };
  try {
    const res = await handler(new Request(PREVIEW + '/field-notes/' + ARTICLE));
    return { res, html: await res.text() };
  } finally { globalThis.fetch = real; }
}

const frameBoxes = (html) => [...html.matchAll(/<details class="fn-block fn-fit fn-fit-slide fn-fit-slide-frame" data-fit-grips="(\d+)">([\s\S]*?)<\/details>/g)]
  .map((m) => ({ n: Number(m[1]), body: m[2] }));
const barrelBoxes = (html) => [...html.matchAll(/<details class="fn-block fn-fit fn-fit-slide fn-fit-slide-barrel" data-fit-barrels="(\d+)">([\s\S]*?)<\/details>/g)]
  .map((m) => ({ n: Number(m[1]), body: m[2] }));

test('the frame box: one closed <details>, a row per grip class the slides fit, sorted by slide length, counts of live approved grips', async () => {
  const { res, html } = await render();
  assert.equal(res.status, 200);
  const b = frameBoxes(html);
  assert.equal(b.length, 1, 'one frame box for all 12 slides');
  assert.ok(b[0].body.startsWith('<summary class="fn-fit-q">Grips these slides fit (5 in 4 grip sizes)</summary>'), b[0].body.slice(0, 120));
  assert.equal(b[0].n, 5, 'the unapproved grip is not counted');
  const rows = [...b[0].body.matchAll(/<tr><td>([^<]+)<\/td><td>(\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows, [
    ['P365', '1', OVER], ['P365 X / XL', '1', OVER], ['P365 XMACRO', '2', OVER], ['P365 FUSE', '1', FLUSH],
  ]);
  assert.ok(!/<details[^>]*fn-fit-slide[^>]*\sopen/.test(html), 'served closed');
  assert.match(b[0].body, /<div class="disclosure">Fit from the Gunforma catalog on [A-Z][a-z]{2} \d{1,2}, \d{4}\.<\/div>$/);
});

test('the barrel boxes: one per group, linked barrels sorted brand then name, "no comp effect" listed apart, unapproved dropped', async () => {
  const { html } = await render();
  const b = barrelBoxes(html);
  assert.equal(b.length, 5, 'plain, Fdez Werx, C-Port, E Port, Arc');
  const plain = b[0];
  assert.ok(plain.body.startsWith('<summary class="fn-fit-q">Barrels these slides take (2)</summary>'));
  const links = [...plain.body.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g)].map((m) => m[1]);
  assert.deepEqual(links, ['/parts/barrels/fw-flush', '/parts/barrels/tp-threaded']);
  assert.ok(!plain.body.includes('no comp effect'), 'a plain group has one list');
  assert.ok(!plain.body.includes('unapproved-barrel'));
  const ported = b[1];
  assert.ok(ported.body.includes('<div class="fn-fit-sub">Matched barrel</div><ul class="fn-fit-slides"><li><a href="/parts/barrels/norsso-cport">'));
  assert.ok(ported.body.includes('<div class="fn-fit-sub">Also fits, no comp effect</div><ul class="fn-fit-slides"><li><a href="/parts/barrels/fw-flush">'));
});

test('a single slide works: singular heading', async () => {
  const { html } = await render();
  const arc = barrelBoxes(html).find((x) => x.body.includes('/parts/slides/arc-division-reactor-365f-p365-fuse'));
  assert.ok(arc.body.startsWith('<summary class="fn-fit-q">Barrels this slide takes (2)</summary>'));
});

test('live: a group whose sets differ is refused in words, never merged', async () => {
  const { html, res } = await render({ barrels: (id) => (id === 'ID-norsso-rail-edc-p365-fuse' ? PLAIN_BARRELS.slice(1) : defaultFits(id)) });
  assert.equal(res.status, 200);
  assert.equal(barrelBoxes(html).length, 4, 'the plain group is no longer a box');
  const m = html.match(/<div class="fn-block fn-fit fn-fit-slide fn-fit-slide-barrel fn-fit-mismatch">([\s\S]*?)<\/div><\/div>/);
  assert.ok(m, 'the refusal renders');
  assert.ok(m[1].includes('These slides no longer share one fit set'));
  assert.ok(m[1].includes('True Precision FUSE Threaded'), 'names the barrel they differ on');
  const { html: h2 } = await render({ frame: (id) => (id === 'ID-true-precision-p365-fuse' ? FRAME_ROWS.filter((r) => r.housing_class !== 'fuse') : FRAME_ROWS) });
  assert.equal(frameBoxes(h2).length, 0, 'a frame group that differs is refused too');
  assert.match(h2, /fn-fit-slide-frame fn-fit-mismatch[\s\S]*?differ on P365 FUSE\)/);
});

test('::compare slide port_style: display name + geometry, "—" for an unported slide', async () => {
  const meta = blocks.colMeta('slide', 'port_style');
  assert.equal(meta.label, 'Port Style');
  assert.ok(meta.select.includes('port_styles!slide_specs_port_style_fk('), 'through the named FK');
  assert.equal(meta.fmt({ display_name: 'C-Port', geometry: 'Two Openings' }), 'C-Port (Two Openings)');
  assert.equal(meta.fmt(null), null);
  const { html } = await render();
  const table = html.match(/<div class="fn-block fn-compare">([\s\S]*?)<\/table>/)[1];
  assert.ok(table.includes('<th>Port Style</th>'));
  assert.ok(table.includes('C-Port (Two Openings)'));
  assert.ok(/<td>&mdash;<\/td>/.test(table), 'an unported slide reads "—"');
});

test('a slide ::rank card with a null weight drops the Weight row, never a blank one', async () => {
  const { html } = await render();
  const cards = [...html.matchAll(/<div class="fn-block fn-rank"[\s\S]*?<div class="rank-pcs">/g)].map((m) => m[0]);
  assert.equal(cards.length, 12);
  for (const c of cards) {
    assert.ok(!c.includes('<span>Weight</span>'), 'no Weight row for a null weight');
    assert.ok(!/<strong>\s*<\/strong>/.test(c), 'no blank value');
    assert.ok(c.includes('<span>Slide Length</span><strong>4.3&quot;</strong>') || c.includes('<span>Slide Length</span><strong>4.3"</strong>'), 'other rows still render');
  }
});

// ── the build guard ──────────────────────────────────────────────────────
async function guardWith(edit) {
  const dir = await mkdtemp(join(tmpdir(), 'fit-slide-'));
  try {
    for (const p of ['scripts', 'netlify/functions', 'field-notes', 'field-notes.html', 'js'])
      await cp(join(ROOT, p), join(dir, p), { recursive: true });
    const file = join(dir, 'field-notes', ARTICLE + '.md');
    await writeFile(file, edit(await readFile(file, 'utf8')));
    return spawnSync(process.execPath, [join(dir, 'scripts/check-field-notes.mjs')], { encoding: 'utf8' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the guard passes the draft as written', async () => {
  const r = await guardWith((s) => s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the guard fails a barrel group whose slides take different barrels, naming them', async () => {
  const r = await guardWith((s) => s.replace('::fit slide=norsso-rail-kp-p365-fuse,norsso-reptile-kp-p365-fuse against=barrel',
    '::fit slide=norsso-rail-kp-p365-fuse,norsso-reptile-cport-p365-fuse against=barrel'));
  assert.notEqual(r.status, 0);
  const out = r.stdout + r.stderr;
  assert.match(out, /groups slides that do not take the same barrels/);
  assert.match(out, /norsso-n365-fuse-eport fits norsso-rail-kp-p365-fuse only/);
  assert.match(out, /norsso-n365-fuse-cport fits norsso-reptile-cport-p365-fuse only/);
});

test('the guard fails a frame group whose slides fit different grips', async () => {
  // An XL slide fits fewer grip sizes than a FUSE slide (fixture).
  const r = await guardWith((s) => s.replace('true-precision-p365-fuse against=frame', 'true-precision-p365-fuse,killer-innovations-velo-v1-p365-xl against=frame'));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /groups slides that do not fit the same grips — killer-innovations-velo-v1-p365-xl differ/);
});

test('the guard fails an unknown slug and a slug that is not a slide', async () => {
  let r = await guardWith((s) => s.replace('::fit slide=arc-division-reactor-365f-p365-fuse against=barrel', '::fit slide=no-such-slide-anywhere against=barrel'));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /names a slug not in the live catalog \(fixture\): no-such-slide-anywhere/);
  r = await guardWith((s) => s.replace('::fit slide=arc-division-reactor-365f-p365-fuse against=barrel', '::fit slide=norsso-n365-fuse-cport against=barrel'));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /names norsso-n365-fuse-cport, which is a barrel, not a slide/);
});

test('the slide fixture carries every FUSE slide the draft groups, with one shared grip set', async () => {
  const f = JSON.parse(await readFile(FIX.SLIDE_FIT_FIXTURE, 'utf8')).fits;
  for (const s of SLIDES) assert.ok(f[s], s);
  const key = JSON.stringify(f[SLIDES[0]]);
  for (const s of SLIDES) assert.equal(JSON.stringify(f[s]), key, s + ' fits the same grip classes');
  const diff = FIX.diffSlideFits({ a: { p365: 'x' } }, { a: { p365: 'y' }, b: {} });
  assert.equal(diff.length, 2);
});
