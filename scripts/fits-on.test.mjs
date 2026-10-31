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
//   - grip tiers are names: no tier label or grip cell carries inches;
//   - slides lead with their size (Alex, 2026-10-30): every grip-page row is
//     Alex's label verbatim, its slide size the row's bold lead, and a slide
//     page names its own slide the same way in the intro;
//   - "Needs comp" reads the product-page wording of the shared rule ("…to
//     cover the grip"), never the builders' "…to finish this build";
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
// Alex's ten labels, verbatim (2026-10-30), in ROW_ORDER, split where the
// bold slide size ends.
const LABELS = [
  ['Short slide 3.1"', ''],
  ['Short slide 3.1"', ' + add-on comp'],
  ['XL slide 3.7"',    ', internally ported short barrel (3.1" barrel: XMacro Comp, Spectre)'],
  ['XL slide 3.7"',    ''],
  ['XL slide 3.7"',    ' + add-on comp'],
  ['XL slide 3.7"',    ', ported barrel comp (3.7" barrel)'],
  ['FUSE slide 4.3"',  ', internally ported short barrel (3.7" barrel: FUSE Comp)'],
  ['FUSE slide 4.3"',  ''],
  ['FUSE slide 4.3"',  ' + add-on comp'],
  ['FUSE slide 4.3"',  ', ported barrel comp (4.3" barrel)'],
];
const SIZE_OF = { short: 'Short slide 3.1"', xmacro: 'XL slide 3.7"', fuse: 'FUSE slide 4.3"' };
const PAGE_NEEDS = 'Needs a threaded barrel and add-on comp to cover the grip.';

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
                 text: decode(m[1].replace(/<[^>]+>/g, '')),
                 lead: (m[1].match(/^<span class="fiton-size">([^<]+)<\/span>/) || [])[1],
                 cells: [...m[2].matchAll(/<span class="fit-tag[^"]*">([^<]+)<\/span>/g)].map((c) => c[1]),
                 reasons: [...m[2].matchAll(/<span class="fit-reason">([^<]+)<\/span>/g)].map((c) => decode(c[1])) }));

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
    assert.ok(sec.includes('This <strong>' + SIZE_OF[fit_tier].replace(/"/g, '&quot;') + '</strong> on each length of grip'),
      key + ': the intro names the slide by its size');
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
    assert.deepEqual(got.map((x) => x.text), LABELS.map(([a, b]) => a + b), tier + ': Alex’s labels, verbatim');
    assert.deepEqual(got.map((x) => decode(x.lead || '')), LABELS.map(([a]) => a), tier + ': each row leads with the slide size');
  }
  // the size is the row's most visible part: bold, the rest of the label not
  const css = (await render('frame', { tierRow: { fit_tier: 'xmacro' } })).html;
  assert.match(css, /\.fiton-size \{ font-weight: 700;/);
  assert.match(css, /\.fiton-rest \{ font-weight: 400;/);
});

test('the setups the grip page lists are the matrix rows, in order', () => {
  const keys = mod.FITS_ON_SETUPS.map((s) => s.slide.fit_tier + '/' + s.slide.comp_style + (s.comp ? '+comp' : ''));
  assert.deepEqual(keys, ROW_ORDER);
  assert.deepEqual(mod.FITS_ON_SETUPS.map((s) => [s.size, s.rest]), LABELS);
  // a setup's size is the size of its tier's slide — the one a slide page names
  for (const s of mod.FITS_ON_SETUPS) assert.equal(s.size, mod.FITS_ON_SLIDE_SIZE[s.slide.fit_tier]);
  assert.deepEqual(mod.FITS_ON_SLIDE_SIZE, SIZE_OF);
});

test('grip tiers are names: no grip label or grip intro carries inches', async () => {
  const r = await render('slide', { tierRow: { fit_tier: 'xmacro', comp_style: 'none' } });
  for (const x of rows(section(r.html, 'Fits on'))) assert.doesNotMatch(x.head, /\d\.\d|"|″/, x.head);
  for (const g of mod.FITS_ON_GRIP_TIERS) assert.doesNotMatch(g.grips, /\d\.\d|"|″/, g.grips);
  for (const tier of TIERS) {
    const g = await render('frame', { tierRow: { fit_tier: tier } });
    const intro = section(g.html, 'Slides on this grip').split('<table')[0];
    assert.match(intro, /This grip is <strong>(Short|XMacro|FUSE)<\/strong> length/);
    assert.doesNotMatch(intro, /\d\.\d|&quot;|″/, tier + ' grip intro');
  }
});

test('"Needs comp" on a product page reads the page wording, not the builder’s', async () => {
  const slide = await render('slide', { tierRow: { fit_tier: 'short', comp_style: 'none' } });
  const s = section(slide.html, 'Fits on');
  assert.ok(s.includes(PAGE_NEEDS), 'slide page: a Short slide on an XMacro grip');
  const grip = await render('frame', { tierRow: { fit_tier: 'fuse' } });
  const gr = rows(section(grip.html, 'Slides on this grip'));
  const xl = gr[ROW_ORDER.indexOf('xmacro/none')];
  assert.equal(xl.cells[0], NEEDS);
  assert.deepEqual(xl.reasons, [PAGE_NEEDS], 'grip page: an XL slide on a FUSE grip');
  for (const html of [slide.html, grip.html]) assert.doesNotMatch(html, /finish this build/);
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
      assert.doesNotMatch(src, /threaded barrel and (add-on )?comp/, dir + '/' + f + ' carries a copy of the needs-comp sentence');
    }
  }

  const toml = await readFile(join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /\[functions\."product-page"\]\s*\n\s*included_files = \[[^\]]*"js\/slide-fit\.js"/,
    'product-page ships js/slide-fit.js (included_files)');
});
