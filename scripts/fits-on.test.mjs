// fits-on.test.mjs — the "Fits on" grids on P365 slide and grip pages.
//
// product-page.mjs draws, on a slide page, where the slide ends on each grip
// tier (and with an add-on comp, for a plain slide) and, on a grip page,
// where each of the ten slide setups ends on it. Every cell is a chip, and a
// wrong chip renders perfectly — so the handler is run for real against a
// stubbed fetch and the served cells are held to the signed-off matrix
// (fitment ship prompt §2, Alex 2026-10-29), written out here in its LABELS,
// independently of js/slide-fit.js:
//
//   - a slide page of each kind reproduces its matrix row, and a plain
//     slide's add-on-comp column reproduces the "+ add-on comp" row;
//   - a grip page of each tier reproduces its matrix column, all ten rows;
//   - a part with no tier reads "Fit not confirmed" — a line, not an empty
//     grid — and a P320 part (no tier model) gets no section at all;
//   - tiers are names: no tier label or grip cell carries inches;
//   - a failed read or a missing spec row leaves the page a 200 without
//     the section, and x-fits-on says which;
//   - the rule is not copied: no server file restates it, and the function
//     ships js/slide-fit.js itself (netlify.toml included_files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(pathToFileURL(join(ROOT, 'netlify/functions/product-page.mjs')).href);
const handler = mod.default;

// ── the signed-off matrix, in its labels ────────────────────────────────────
const FLUSH = 'Flush', EXT = 'Extended slide', NEEDS = 'Needs comp', WONT = 'Won’t fit';
const CEXT = 'Comp extends', CFOP = 'Comp flush / partially flush', NC = 'Fit not confirmed';
//          slide setup                              [ Short, XMacro, FUSE ]
const MATRIX = {
  'short/none':           [FLUSH, NEEDS, WONT],          // 1
  'short/none+comp':      [CEXT,  CFOP,  WONT],          // 2
  'xmacro/short_barrel':  [EXT,   FLUSH, WONT],          // 3
  'xmacro/none':          [EXT,   FLUSH, NEEDS],         // 4
  'xmacro/none+comp':     [CEXT,  CEXT,  CFOP],          // 5
  'xmacro/ported_barrel': [EXT,   FLUSH, WONT],          // 6
  'fuse/short_barrel':    [EXT,   EXT,   FLUSH],         // 7
  'fuse/none':            [EXT,   EXT,   FLUSH],         // 8
  'fuse/none+comp':       [CEXT,  CEXT,  CEXT],          // 9
  'fuse/ported_barrel':   [EXT,   EXT,   FLUSH],         // 10
};
const ROW_ORDER = ['short/none', 'short/none+comp', 'xmacro/short_barrel', 'xmacro/none', 'xmacro/none+comp',
  'xmacro/ported_barrel', 'fuse/short_barrel', 'fuse/none', 'fuse/none+comp', 'fuse/ported_barrel'];
const TIERS = ['short', 'xmacro', 'fuse'];

function product(category) {
  return {
    id: '00000000-0000-4000-8000-000000000001', slug: 'test-' + category, name: 'Test ' + category, category,
    description: 'A test part.', best_for: [], pros: null, cons: null, material: null, material_family: null,
    weight_oz: null, installation_difficulty: null, fitment_confidence: 'verified', build_warning: null,
    fitment_notes: null, lowest_price: null, url: 'https://acme.example/part', is_discontinued: false,
    manufacturers: { name: 'Acme', slug: 'acme', website_url: 'https://acme.example' },
    product_variants: [],
  };
}

// Run the handler. `tierRow` is the fit_tier/comp_style row (null = none, a
// Response = a failed read); `platform` the part's platform slug.
async function render(category, { tierRow, platform = 'p365' } = {}) {
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  console.error = () => {};
  const table = category === 'slide' ? 'slide_specs' : 'frame_specs';
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/products?slug=eq.')) return json([product(category)]);
    if (u.includes('/' + table + '?') && u.includes('select=fit_tier')) {
      return tierRow instanceof Response ? tierRow : json(tierRow ? [tierRow] : []);
    }
    if (u.includes('/product_platforms?')) return json([{ platforms: { slug: platform } }]);
    if (u.includes('_specs?')) return json([{ threaded_barrel_ok: true }]);
    if (u.includes('/products?id=eq.')) return json([{ restricted_states: null }]);
    return json([]);
  };
  try {
    const seg = { slide: 'slides', frame: 'frames' }[category];
    const res = await handler(new Request('https://gunforma.com/parts/' + seg + '/test-' + category));
    return { res, html: await res.text(), header: res.headers.get('x-fits-on') };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}

const section = (html, title) => {
  const i = html.indexOf('<div class="section-title">' + title + '</div>');
  if (i === -1) return null;
  const end = html.indexOf('<div class="section-title">', i + 10);
  return html.slice(i, end === -1 ? undefined : end);
};
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const rows = (sec) => [...sec.matchAll(/<tr><th scope="row">([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/g)]
  .map((m) => ({ head: decode(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
                 cells: [...m[2].matchAll(/<span class="fit-tag[^"]*">([^<]+)<\/span>/g)].map((c) => c[1]) }));

test('a slide page of every kind reproduces its matrix row, and a plain slide its add-on-comp row', async () => {
  for (const key of ROW_ORDER.filter((k) => !k.endsWith('+comp'))) {
    const [fit_tier, comp_style] = key.split('/');
    const r = await render('slide', { tierRow: { fit_tier, comp_style } });
    assert.equal(r.res.status, 200);
    assert.equal(r.header, 'tier:' + key, key + ': x-fits-on');
    const sec = section(r.html, 'Fits on');
    assert.ok(sec, key + ': section rendered');
    const got = rows(sec);
    assert.deepEqual(got.map((x) => x.head.split(' ')[0]), ['Short', 'XMacro', 'FUSE'], key + ': one row per grip tier, in order');
    assert.deepEqual(got.map((x) => x.cells[0]), MATRIX[key], key + ': this slide on each grip tier');
    if (comp_style === 'none') {
      assert.match(sec, /<th scope="col">With an add-on comp<\/th>/);
      assert.deepEqual(got.map((x) => x.cells[1]), MATRIX[key + '+comp'], key + ': with an add-on comp');
      assert.match(sec, /Comp flush \/ partially flush”/, 'the hedge is explained');
      if (key === 'short/none') {
        // a Short slide on a FUSE grip: same reason with or without a comp, said once
        const fuseRow = sec.slice(sec.lastIndexOf('<tr><th scope="row">'));
        assert.equal((fuseRow.match(/can’t cover a FUSE grip/g) || []).length, 1, 'one reason per row, not two');
      }
    } else {
      assert.doesNotMatch(sec, /With an add-on comp/, key + ': a comp slide offers no add-on comp column');
      assert.ok(got.every((x) => x.cells.length === 1));
      assert.match(sec, /takes no add-on comp/);
    }
  }
});

test('a grip page of every tier reproduces its matrix column, all ten setups', async () => {
  for (const [i, tier] of TIERS.entries()) {
    const r = await render('frame', { tierRow: { fit_tier: tier } });
    assert.equal(r.header, 'tier:' + tier);
    const sec = section(r.html, 'Slides on this grip');
    assert.ok(sec, tier + ': section rendered');
    const got = rows(sec);
    assert.equal(got.length, 10, tier + ': ten slide setups');
    assert.deepEqual(got.map((x) => x.cells[0]), ROW_ORDER.map((k) => MATRIX[k][i]), tier + ' grip: the matrix column');
    assert.deepEqual(got.map((x) => x.head), mod.FITS_ON_SETUPS.map((s) => s.label));
  }
});

test('the setups the grip page lists are the matrix rows, in order', () => {
  const keys = mod.FITS_ON_SETUPS.map((s) => s.slide.fit_tier + '/' + s.slide.comp_style + (s.comp ? '+comp' : ''));
  assert.deepEqual(keys, ROW_ORDER);
  // the two comp-slide kinds carry their signed-off labels verbatim
  const label = (k) => mod.FITS_ON_SETUPS[ROW_ORDER.indexOf(k)].label;
  assert.equal(label('xmacro/short_barrel'), 'XL slide, internally ported short barrel');
  assert.equal(label('fuse/short_barrel'), 'FUSE slide, internally ported short barrel');
  assert.equal(label('xmacro/ported_barrel'), '3.7" ported barrel comp');
  assert.equal(label('fuse/ported_barrel'), '4.3" ported barrel comp');
});

test('tiers are names: no tier label, grip cell or plain-slide label carries inches', async () => {
  const r = await render('slide', { tierRow: { fit_tier: 'xmacro', comp_style: 'none' } });
  for (const x of rows(section(r.html, 'Fits on'))) assert.doesNotMatch(x.head, /\d\.\d|"|″/, x.head);
  const g = await render('frame', { tierRow: { fit_tier: 'fuse' } });
  const intro = section(g.html, 'Slides on this grip');
  assert.match(intro, /This grip is <strong>FUSE<\/strong> length/);
  for (const s of mod.FITS_ON_SETUPS.filter((s) => s.slide.comp_style !== 'ported_barrel')) {
    assert.doesNotMatch(s.label, /\d|"/, s.label);
  }
});

test('no tier reads "Fit not confirmed" — a line, never an empty grid', async () => {
  for (const [category, title, tierRow] of [
    ['frame', 'Slides on this grip', { fit_tier: null }],          // ECM R11 Fuse Comp, R11 Edge Fuse Comp
    ['slide', 'Fits on',             { fit_tier: null, comp_style: null }],
  ]) {
    const r = await render(category, { tierRow });
    assert.equal(r.res.status, 200);
    assert.equal(r.header, 'unconfirmed');
    const sec = section(r.html, title);
    assert.ok(sec, category + ': the section still renders');
    assert.match(sec, new RegExp('<span class="fit-tag fit-tag-muted">' + NC + '</span>'));
    assert.doesNotMatch(sec, /<table/, category + ': no grid of blanks');
  }
});

test('a slide whose comp style is not stated never guesses needs-comp against won’t-fit', async () => {
  const r = await render('slide', { tierRow: { fit_tier: 'short', comp_style: null } });
  assert.equal(r.header, 'tier:short/unstated');
  const got = rows(section(r.html, 'Fits on'));
  assert.deepEqual(got.map((x) => x.cells[0]), [FLUSH, NC, WONT]);
  assert.doesNotMatch(section(r.html, 'Fits on'), /With an add-on comp/);
});

test('P320 parts, other categories, a missing spec row and a failed read: no section, page still 200', async () => {
  const p320 = await render('frame', { tierRow: { fit_tier: null }, platform: 'p320' });
  assert.equal(p320.header, 'not-p365');
  assert.equal(section(p320.html, 'Slides on this grip'), null, 'P320 keeps FrameFit; no "Fit not confirmed" over it');

  const none = await render('slide', { tierRow: null });
  assert.equal(none.header, 'no-spec');
  assert.equal(section(none.html, 'Fits on'), null);

  const failed = await render('slide', { tierRow: new Response('boom', { status: 500 }) });
  assert.equal(failed.res.status, 200);
  assert.equal(failed.header, 'failed');
  assert.equal(section(failed.html, 'Fits on'), null);
});

test('the rule is js/slide-fit.js itself: loaded, not copied, and shipped with the function', async () => {
  const { loadSlideFit } = await import(pathToFileURL(join(ROOT, 'netlify/functions/_slide-fit.mjs')).href);
  const served = await loadSlideFit();
  const g = {};
  new Function('window', await readFile(join(ROOT, 'js/slide-fit.js'), 'utf8'))(g);
  assert.deepEqual(served.TAGS, g.SlideFit.TAGS, 'the loader returns the browser module');
  assert.equal(served.tag.toString(), g.SlideFit.tag.toString());

  // No server file restates the rule: its tier table and its reason text
  // live in js/slide-fit.js and nowhere under netlify/.
  for (const dir of ['netlify/functions', 'netlify/edge-functions']) {
    for (const f of (await readdir(join(ROOT, dir))).filter((n) => /\.m?js$/.test(n))) {
      const src = await readFile(join(ROOT, dir, f), 'utf8');
      assert.doesNotMatch(src, /short:\s*0,\s*xmacro:\s*1/, dir + '/' + f + ' carries a copy of the tier index');
      assert.doesNotMatch(src, /can’t cover a/, dir + '/' + f + ' carries a copy of the rule’s reasons');
    }
  }

  const toml = await readFile(join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /\[functions\."product-page"\]\s*\n\s*included_files = \[[^\]]*"js\/slide-fit\.js"/,
    'product-page ships js/slide-fit.js (included_files)');
});
