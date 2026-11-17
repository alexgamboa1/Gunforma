// fit-sections.test.mjs — the barrel/slide fit sections on product pages.
//
// product-page.mjs lists, on a slide page, the barrels that fit it and, on a
// barrel page, the slides it fits, from v_barrel_slide_fit in ONE query per
// page. Everything here fails silently in a browser: a threaded barrel
// listed on a slide whose maker says no looks like any other row, an
// unapproved part looks like an approved one, and a missing lock line is
// just a shorter section. So the handler is run for real against a stubbed
// fetch, and the query it sends and the HTML it returns are both pinned:
//
//   - the thread rule is IN THE QUERY: a slide with threaded_barrel_ok false
//     asks for no threaded barrel; a threaded barrel asks for no slide whose
//     threaded_barrel_ok is false; NULL is listed with a note;
//   - only parts with is_approved === true and not discontinued are listed;
//   - a slide page groups Ported, Threaded, Flush, in that order;
//   - a locked barrel says "Only these slides …"; an open one does not;
//   - a locked barrel ALWAYS shows the heading and the warning — with no
//     slide listed (all unapproved, or the fit read failed) it says "Only
//     for specific <brand> slides …". The lock is read with the barrel's own
//     spec row, so it cannot vanish with the fit rows;
//   - "From $X" follows the headline rule: fresh prices only;
//   - otherwise nothing renders when nothing is listed, when the read fails,
//     or when the page's own spec row is missing — and the page is a 200;
//   - x-fit-section reports which of those happened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(pathToFileURL(join(ROOT, 'netlify/functions/product-page.mjs')).href);
const handler = mod.default;

const TODAY = new Date().toISOString().slice(0, 10);   // last_checked is a DATE
const fresh = (price, in_stock = true) => ({ street_price: price, in_stock, last_checked: TODAY, op_last_matched_by: 'gtin' });
const stale = (price) => ({ street_price: price, in_stock: true, last_checked: '2020-01-01', op_last_matched_by: 'gtin' });

function product(category, slug) {
  return {
    id: '00000000-0000-4000-8000-000000000001', slug, name: 'Test ' + category, category,
    description: 'A test part.', best_for: [], material: null, material_family: null,
    weight_oz: null, installation_difficulty: null, fitment_confidence: 'verified', build_warning: null,
    fitment_notes: null, lowest_price: null, url: 'https://acme.example/part', is_discontinued: false,
    manufacturers: { name: 'Acme', slug: 'acme', website_url: 'https://acme.example' },
    product_variants: [],
  };
}
let n = 0;
// approved: true | false | 'absent' (the field missing from the row)
function part(name, brand, { approved = true, discontinued = false, links = [], threaded = undefined } = {}) {
  n++;
  const p = {
    id: 'p' + n, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, category: 'x',
    is_discontinued: discontinued, manufacturers: { name: brand },
    product_variants: [{ affiliate_links: links }],
  };
  if (approved !== 'absent') p.is_approved = approved;
  if (threaded !== undefined) p.slide_specs = { threaded_barrel_ok: threaded };
  return p;
}

// barrel_specs.locks as the spec query returns it: one row per locked slide.
const locks = (...brands) => brands.map((b) => ({ slide_specs: { products: { manufacturers: { name: b } } } }));

// Run the handler. `fitAnswer` is what the view query returns (an array, or
// a Response for a failure); `specRow` is the page's own spec row (null = none).
async function render(category, { specRow, fitAnswer = [], compAnswer = null, springsAnswer = [] } = {}) {
  const seen = { fitUrls: [], specUrls: [] };
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/v_barrel_slide_fit?')) {
      seen.fitUrls.push(decodeURIComponent(u));
      return fitAnswer instanceof Response ? fitAnswer : json(fitAnswer);
    }
    if (u.includes('/products?slug=eq.')) return json([product(category, 'test-' + category)]);
    // The comp-block side read (it alone names bore_profile) and the
    // springs read — both must be routed BEFORE the generic _specs? branch.
    if (u.includes('/recoil_spring_specs?')) {
      return springsAnswer instanceof Response ? springsAnswer : json(springsAnswer);
    }
    if (u.includes('/slide_specs?') && u.includes('bore_profile')) {
      return compAnswer instanceof Response ? compAnswer : json(compAnswer ? [compAnswer] : []);
    }
    if (u.includes('_specs?')) { seen.specUrls.push(decodeURIComponent(u)); return json(specRow ? [specRow] : []); }
    if (u.includes('/products?id=eq.')) return json([{ restricted_states: null }]);
    return json([]);
  };
  try {
    const seg = { slide: 'slides', barrel: 'barrels', optic: 'optics' }[category];
    const res = await handler(new Request('https://gunforma.com/parts/' + seg + '/test-' + category));
    return { res, html: await res.text(), header: res.headers.get('x-fit-section'), ...seen };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}

const sectionOf = (html, title) => {
  const i = html.indexOf('<div class="section-title">' + title + '</div>');
  if (i === -1) return null;
  const end = html.indexOf('<div class="fitguide-note">Matched on barrel length', i);
  return html.slice(i, end === -1 ? undefined : end);
};
const names = (sec) => [...sec.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);

test('slide page: groups Ported, Threaded, Flush; lists only approved, live parts; fresh "from" price', async () => {
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: true },
    fitAnswer: [
      { barrel_type: 'standard', part: part('Flush One', 'Zed', { links: [fresh(199.99), fresh(149.5, false)] }) },
      { barrel_type: 'ported',   part: part('Ported One', 'Acme', { links: [stale(99), fresh(250)] }) },
      { barrel_type: 'threaded', part: part('Threaded One', 'Acme', { links: [stale(120)] }) },
      { barrel_type: 'ported',   part: part('Not Approved', 'Acme', { approved: false }) },
      { barrel_type: 'ported',   part: part('Approval Unknown', 'Acme', { approved: 'absent' }) },
      { barrel_type: 'ported',   part: part('Discontinued One', 'Acme', { discontinued: true }) },
    ],
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.header, 'listed:3');
  const sec = sectionOf(r.html, 'Barrels that fit this slide');
  assert.ok(sec, 'section rendered');
  const groups = [...sec.matchAll(/<div class="fit-group">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['Ported', 'Threaded', 'Flush']);
  assert.deepEqual(names(sec), ['Acme Ported One', 'Acme Threaded One', 'Zed Flush One'], 'display names, brand included, unapproved/unknown/discontinued dropped');
  assert.match(sec, /Acme Ported One<\/a><\/span><span class="fit-price">From \$250\.00/, 'stale $99 is never quoted');
  assert.match(sec, /Zed Flush One<\/a><\/span><span class="fit-price">From \$199\.99/, 'in-stock wins over the cheaper out-of-stock fresh price, as in the headline');
  assert.doesNotMatch(sec, /Threaded One<\/a><\/span><span class="fit-price">/, 'stale-only part shows no price');
  assert.doesNotMatch(sec, /doesn&rsquo;t state threaded fit/, 'no note when the slide says yes');
  assert.equal(r.fitUrls.length, 1, 'one query');
  assert.doesNotMatch(r.fitUrls[0], /barrel_type=not\.in/, 'threaded barrels are asked for when the slide takes one');
  assert.match(r.fitUrls[0], /fit_status=eq\.fits/);
  assert.match(r.fitUrls[0], /part\.is_discontinued=is\.false/);
  assert.match(r.fitUrls[0], /products!barrel_specs_product_id_fkey!inner\(/, 'the embed names its FK (PGRST201)');
  assert.match(r.fitUrls[0], /is_approved/);
});

test('slide with threaded_barrel_ok false: the query excludes threaded barrels', async () => {
  const r = await render('slide', { specRow: { threaded_barrel_ok: false }, fitAnswer: [{ barrel_type: 'ported', part: part('P', 'Acme') }] });
  assert.match(r.fitUrls[0], /&barrel_type=not\.in\.\(threaded,threaded-and-ported\)/);
});

test('slide with threaded_barrel_ok NULL: threaded barrels listed, with the not-stated note', async () => {
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: null },
    fitAnswer: [{ barrel_type: 'threaded', part: part('T', 'Acme') }, { barrel_type: 'standard', part: part('F', 'Acme') }],
  });
  assert.doesNotMatch(r.fitUrls[0], /barrel_type=not\.in/);
  const sec = sectionOf(r.html, 'Barrels that fit this slide');
  assert.match(sec, /<div class="fit-group">Threaded<\/div><div class="fitguide-note">Maker doesn&rsquo;t state threaded fit for this slide\.<\/div>/);
  assert.equal((sec.match(/doesn&rsquo;t state threaded fit/g) || []).length, 1, 'once, under Threaded only');
});

test('locked threaded barrel: lock line, query drops slides that say no, NULL slides carry a note', async () => {
  const r = await render('barrel', {
    specRow: { barrel_type: 'threaded', locks: locks('Acme', 'Acme') },
    fitAnswer: [
      { part: part('Slide Yes', 'Acme', { threaded: true }) },
      { part: part('Slide Unknown', 'Acme', { threaded: null }) },
    ],
  });
  assert.equal(r.header, 'listed:2;locked');
  const sec = sectionOf(r.html, 'Slides this barrel fits');
  assert.match(sec, /<div class="fit-lock">Only these slides &mdash; the maker says this barrel should not be used in any other slide\.<\/div>/);
  assert.match(sec, /Acme Slide Unknown<\/a><span class="fit-note">Maker doesn&rsquo;t state threaded fit<\/span>/);
  assert.doesNotMatch(sec, /Acme Slide Yes<\/a><span class="fit-note">/);
  assert.match(r.fitUrls[0], /&part\.slide_specs\.threaded_barrel_ok=not\.is\.false/);
  assert.match(r.specUrls[0], /^.*\/barrel_specs\?.*locks:barrel_slide_requirements!barrel_slide_requirements_barrel_product_id_fkey\(slide_specs!barrel_slide_requirements_slide_product_id_fkey\(products!slide_specs_product_id_fkey\(manufacturers!products_brand_id_fkey\(name\)\)\)\)/,
    'the lock rows ride in the barrel\'s own spec query, FKs named');
  assert.doesNotMatch(r.fitUrls[0], /barrel_slide_requirements/, 'not on the fit rows, which can be empty');
  assert.match(r.fitUrls[0], /products!slide_specs_product_id_fkey!inner\(/);
});

test('open flush barrel: no lock line, no thread filter, no notes', async () => {
  const r = await render('barrel', {
    specRow: { barrel_type: 'standard', locks: [] },
    fitAnswer: [{ part: part('Any Slide', 'Acme', { threaded: false }) }],
  });
  assert.equal(r.header, 'listed:1');
  const sec = sectionOf(r.html, 'Slides this barrel fits');
  assert.ok(sec);
  assert.doesNotMatch(sec, /class="fit-lock"/);
  assert.doesNotMatch(sec, /class="fit-note"/);
  assert.doesNotMatch(r.fitUrls[0], /threaded_barrel_ok=not/);
});

test('open barrel with nothing listed: no heading at all', async () => {
  const r = await render('barrel', {
    specRow: { barrel_type: 'ported', locks: [] },
    fitAnswer: [{ part: part('Unapproved Slide', 'Acme', { approved: false }) }],
  });
  assert.equal(r.header, 'listed:0');
  assert.equal(sectionOf(r.html, 'Slides this barrel fits'), null);
  assert.doesNotMatch(r.html, /class="fit-lock"/);
});

const LOCK_NONE_LISTED = (brand) => '<div class="section-title">Slides this barrel fits</div>' +
  '<div class="fit-lock">Only for specific ' + brand + 'slides &mdash; the maker says this barrel should not be used in any other slide.</div>';

test('locked barrel whose slides are all unapproved: heading and the maker-named warning, no list', async () => {
  const r = await render('barrel', {
    specRow: { barrel_type: 'ported', locks: locks('Zaffiri Precision') },
    fitAnswer: [{ part: part('Unapproved Slide', 'Zaffiri Precision', { approved: false }) }],
  });
  assert.equal(r.header, 'listed:0;locked');
  assert.ok(r.html.includes(LOCK_NONE_LISTED('Zaffiri Precision ')), 'warning names the maker of the locked slides');
  assert.doesNotMatch(r.html, /class="fit-list"/, 'no list under it');
  assert.doesNotMatch(r.html, /Only these slides/, 'not the wording that points at a list');
});

test('locked barrel with no fit rows at all (e.g. its slide discontinued): still warns', async () => {
  const r = await render('barrel', { specRow: { barrel_type: 'ported', locks: locks('Fdez Werx') }, fitAnswer: [] });
  assert.equal(r.header, 'listed:0;locked');
  assert.ok(r.html.includes(LOCK_NONE_LISTED('Fdez Werx ')));
});

test('locked barrel whose fit read fails: still warns, page still a 200', async () => {
  const r = await render('barrel', {
    specRow: { barrel_type: 'ported', locks: locks('Norsso') },
    fitAnswer: new Response(JSON.stringify({ code: '42703', message: 'column products_1.is_approved does not exist' }), { status: 400 }),
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.header, 'failed;locked');
  assert.ok(r.html.includes(LOCK_NONE_LISTED('Norsso ')));
});

test('locked to several makers, or a maker the row does not name: the wording holds', async () => {
  const two = await render('barrel', { specRow: { barrel_type: 'ported', locks: locks('Norsso', 'Acme', 'Norsso') }, fitAnswer: [] });
  assert.ok(two.html.includes(LOCK_NONE_LISTED('Acme or Norsso ')), 'distinct, sorted, joined with "or"');
  const none = await render('barrel', { specRow: { barrel_type: 'ported', locks: [{ slide_specs: null }] }, fitAnswer: [] });
  assert.ok(none.html.includes(LOCK_NONE_LISTED('')), '"Only for specific slides" when no brand is known');
});

test('the fit read fails on a slide (e.g. is_approved not there yet): page is a 200 without the section', async () => {
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: true },
    fitAnswer: new Response(JSON.stringify({ code: '42703', message: 'column products_1.is_approved does not exist' }), { status: 400 }),
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.header, 'failed');
  assert.equal(sectionOf(r.html, 'Barrels that fit this slide'), null);
});

test('no spec row: the thread rule cannot be applied, so no fit query is sent', async () => {
  const r = await render('slide', { specRow: null, fitAnswer: [{ barrel_type: 'ported', part: part('P', 'Acme') }] });
  assert.equal(r.header, 'no-spec');
  assert.equal(r.fitUrls.length, 0);
});

test('other categories: no fit query', async () => {
  const r = await render('optic', { specRow: { footprint_id: null } });
  assert.equal(r.header, 'n/a');
  assert.equal(r.fitUrls.length, 0);
});

test('names are escaped', async () => {
  const r = await render('slide', { specRow: { threaded_barrel_ok: true }, fitAnswer: [{ barrel_type: 'ported', part: part('<script>x</script>', 'Acme') }] });
  assert.doesNotMatch(r.html, /<script>x<\/script>/);
  assert.match(r.html, /&lt;script&gt;x&lt;\/script&gt;/);
});

// ── the fit-rules follow-up (Alex, 2026-11-17) ──────────────────────────────

test('slide heading names the barrel length it takes, never a gun', async () => {
  // The Spectre shape: a 3.7in slide over a 3.1in barrel. "3.1in (P365,
  // P365 X)" on an XL slide would tell an XL owner the barrels are for
  // another gun, so the heading carries the length alone.
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: false, barrel_length_in: '3.1', slide_length_in: '3.7' },
    fitAnswer: [{ barrel_type: 'standard', part: part('Flush S', 'Acme', { links: [fresh(100)] }) }],
  });
  assert.ok(r.html.includes('<div class="section-title">Barrels that fit this slide (3.1in)</div>'),
    'heading carries the barrel length');
  const heading = r.html.match(/Barrels that fit this slide[^<]*/)[0];
  assert.ok(!/P365|XL|FUSE|XMacro|AXG/i.test(heading), 'no gun names in the heading');
});

test('the query still refuses threaded barrels itself — redundancy kept on purpose', async () => {
  // The view now refuses them too (threaded-not-allowed), but the page
  // keeps its own filter: it bridges the deploy-before-push gap and is the
  // same defense-in-depth the RLS-redundant filters use.
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: false, barrel_length_in: '3.1', slide_length_in: '3.7' },
  });
  assert.ok(r.fitUrls[0].includes('fit_status=eq.fits'), 'only fits rows are asked for');
  assert.ok(r.fitUrls[0].includes('barrel_type=not.in.(threaded,threaded-and-ported)'),
    'the page-side thread filter survives');
});

test('comp block renders above the spec table, from the side read', async () => {
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: false, barrel_length_in: '3.1', slide_length_in: '3.7', barrel_included: false },
    compAnswer: {
      comp_style: 'short_barrel', port_style: null, port_count: null,
      ported_barrel_ok: false, bore_profile: 'standard', port_style_is_makers_name: true,
      port_styles: null, part_classes: { display_name: '3.7in (P365 X, XL, XMacro, AXG)' }, locks: [],
    },
  });
  assert.equal(r.res.headers.get('x-comp-label'), 'rendered');
  const comp = r.html.indexOf('class="comp-block"');
  const specs = r.html.indexOf('<div class="section-title">Specs</div>');
  assert.ok(comp !== -1 && specs !== -1 && comp < specs, 'comp block sits above the spec table');
  assert.ok(r.html.includes('XL (3.7in) recoil spring'), 'the spring follows SLIDE length');
  assert.ok(r.html.includes('Requires the 3.7in (P365 X, XL, XMacro, AXG) recoil spring assembly.'),
    'the spring requirement line carries the class display name');
});

test('a slide length with no catalog springs renders the requirement line alone', async () => {
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: true, barrel_length_in: '3.7', slide_length_in: '3.7' },
    springsAnswer: [],
  });
  assert.equal(r.res.status, 200);
  assert.ok(r.html.includes('Requires the 3.7in recoil spring assembly.'), 'requirement stated in words');
  assert.ok(!r.html.includes('Compatible springs'), 'no list heading over nothing');
});

test('springs render as buyable rows, factory brand first, lines from their own data', async () => {
  const sig = {
    spring_type: null, spring_weight: 'Factory RSA', captured: true,
    products: { id: 's2', slug: 'sig-rsa-37', name: 'P365XL Recoil Spring Assembly', is_approved: true,
      is_discontinued: false, manufacturers: { name: 'Sig Sauer' },
      product_variants: [{ affiliate_links: [fresh(34.99)] }] },
  };
  const ecm = {
    spring_type: 'Flat wire', spring_weight: '12 lb Yellow', captured: false,
    products: { id: 's1', slug: 'ecm-kit-37', name: 'Recoil Spring Kit 3.7', is_approved: true,
      is_discontinued: false, manufacturers: { name: 'ECM Precision' },
      product_variants: [{ affiliate_links: [fresh(44.99)] }] },
  };
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: true, barrel_length_in: '3.7', slide_length_in: '3.7' },
    springsAnswer: [ecm, sig],
  });
  assert.equal(r.res.headers.get('x-springs'), 'listed:2');
  const sec = r.html.slice(r.html.indexOf('Compatible springs'));
  const order = names(sec.slice(0, sec.indexOf('section-title')));
  assert.deepEqual(order.slice(0, 2), ['Sig Sauer P365XL Recoil Spring Assembly', 'ECM Precision Recoil Spring Kit 3.7'],
    'factory brand sorts first, derived from the data');
  assert.ok(r.html.includes('Flat wire · 12 lb Yellow'), 'the what-it-is line comes from the spring row');
  assert.ok(r.html.includes('captured assembly'), 'captured springs say so');
});

test('a failed comp read never takes the page down and renders no block', async () => {
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: true, barrel_length_in: '3.7', slide_length_in: '3.7' },
    compAnswer: new Response('boom', { status: 400 }),
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.res.headers.get('x-comp-label'), 'failed');
  assert.ok(!r.html.includes('class="comp-block"'));
});

test('the comp block names the matched barrel through the spec-table chain', async () => {
  // The lock FKs reference barrel_specs/slide_specs, not products — the
  // first embed guessed products directly and failed PGRST200 on every
  // slide page (x-comp-label: failed, production 2026-11-17).
  const r = await render('slide', {
    specRow: { threaded_barrel_ok: false, barrel_length_in: '3.7', slide_length_in: '3.7', barrel_included: false },
    compAnswer: {
      comp_style: 'ported_barrel', port_style: 'c-port', port_count: 2,
      ported_barrel_ok: true, bore_profile: 'standard', port_style_is_makers_name: true,
      port_styles: { display_name: 'C-Port', geometry: 'Two Openings' },
      part_classes: { display_name: '3.7in (P365 X, XL, XMacro, AXG)' },
      locks: [{ barrel_specs: { products: { name: 'Norsso N365XL 3.7" C Port Barrel', manufacturers: { name: 'Norsso' } } } }],
    },
  });
  assert.equal(r.res.headers.get('x-comp-label'), 'rendered');
  assert.ok(r.html.includes('Designed for the Norsso N365XL 3.7&quot; C Port Barrel.'),
    'the matched barrel is named from the nested spec-table embed');
});
