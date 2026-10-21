// field-notes.test.mjs — the Field Notes renderer, end to end, with no
// network: the Markdown module as a pure function, and field-note.mjs run
// for real against a stubbed fetch the way check-analytics-snippet.mjs and
// upstream-failure.test.mjs run their handlers.
//
// What it pins:
//   - the Markdown subset renders the way the article writer expects, and
//     raw HTML or a javascript: link never reaches the page as markup
//   - a directive line becomes a placeholder, in order, with its arguments
//   - an undeclared slug, a non-slug path and a `.md` by name are 404s with
//     NO database read; a draft is a 404 on the apex and a page off it
//   - every way PostgREST can fail is a 503 with Retry-After after one
//     retry (the _pg.mjs rule) — never a 404, never a 200 with holes
//   - zero rows is NOT a failure: the page renders, says which part is not
//     in the catalog, and the x-field-note-* headers count it
//   - the fit verdicts: direct fit, doesn't fit, depends-on-the-SKU, the
//     maker's magazine claim and the absence of one — and the price block
//     under the shared stale-price and sort rules
//   - the analytics tag exactly once, the apex canonical, Article JSON-LD,
//     noindex on a draft only, no-store on a draft only
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const md = await import(fn('_markdown.mjs'));
const { FIELD_NOTES, fieldNotePath } = await import(fn('_field-notes-meta.mjs'));
const { PG_ATTEMPTS } = await import(fn('_pg.mjs'));
const { ANALYTICS_SNIPPET } = await import(fn('_analytics.mjs'));
const handler = (await import(fn('field-note.mjs'))).default;

// The fixture the handler tests run over. It must be a DRAFT with both
// block kinds; the registry's comment says to keep it.
const FIXTURE = FIELD_NOTES.find((a) => a.slug === 'renderer-check');
assert.ok(FIXTURE && FIXTURE.draft, 'the renderer-check draft fixture must stay in _field-notes-meta.mjs');
const APEX = 'https://gunforma.com';
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the Markdown module ──────────────────────────────────────────────────
test('front matter: scalars, quotes stripped, body returned without it', () => {
  const { meta, body } = md.parseFrontMatter('---\ntitle: "A title"\nauthor: Alex\n---\n\n# H\n');
  assert.deepEqual(meta, { title: 'A title', author: 'Alex' });
  assert.equal(body.trim(), '# H');
  assert.deepEqual(md.parseFrontMatter('# no front matter').meta, {});
});

test('blocks: headings with ids, lists, nested list, table, quote, fence, rule, figure', () => {
  const r = md.renderMarkdown([
    '## The Verdict', '### The verdict', '', 'Para one', 'continues.', '', '- a', '- b', '  - c', '', '1. x', '2. y', '',
    '| h | n |', '|---|---:|', '| v | 1 |', '', '> quoted', '', '```', '<raw>', '```', '', '---', '', '![cap](/assets/x.png)',
  ].join('\n'));
  assert.match(r.html, /<h2 id="the-verdict">The Verdict<\/h2>/);
  assert.match(r.html, /<h3 id="the-verdict-2">The verdict<\/h3>/, 'a second heading with the same text gets a distinct id');
  assert.match(r.html, /<p>Para one continues\.<\/p>/);
  assert.match(r.html, /<ul><li>a<\/li><li>b<ul><li>c<\/li><\/ul><\/li><\/ul>/);
  assert.match(r.html, /<ol><li>x<\/li><li>y<\/li><\/ol>/);
  assert.match(r.html, /<table><thead><tr><th>h<\/th><th style="text-align:right">n<\/th><\/tr><\/thead><tbody><tr><td>v<\/td><td style="text-align:right">1<\/td><\/tr><\/tbody><\/table>/);
  assert.match(r.html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(r.html, /<pre><code>&lt;raw&gt;<\/code><\/pre>/);
  assert.match(r.html, /<hr\/>/);
  assert.match(r.html, /<figure><img src="\/assets\/x.png" alt="cap" loading="lazy"\/><figcaption>cap<\/figcaption><\/figure>/);
  assert.deepEqual(r.headings.map((h) => h.id), ['the-verdict', 'the-verdict-2']);
});

test('inline: bold, italic, code, links; raw HTML and bad schemes are text', () => {
  assert.equal(md.inline('**b** *i* _j_ `c<x>`'), '<strong>b</strong> <em>i</em> <em>j</em> <code>c&lt;x&gt;</code>');
  assert.equal(md.inline('[s](/p365/) [o](https://sigsauer.com/x)'),
    '<a href="/p365/">s</a> <a href="https://sigsauer.com/x" target="_blank" rel="noopener">o</a>');
  assert.equal(md.inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(md.inline('[x](javascript:alert(1))'), 'x');
  assert.equal(md.inline('![a](data:text/html,x)'), 'a');
  assert.equal(md.inline('2 * 3 * 4'), '2 * 3 * 4', 'a lone asterisk is not emphasis');
});

test('directives: parsed into placeholders in order; a bad line renders nothing', () => {
  const r = md.renderMarkdown('::price a-1, b\n\n::fit optic=o gun=g\n\n::fit magazine=m gun=g\n\n::fit optic=o magazine=m gun=g\n\n::bogus x\n\n::fit optic=o');
  assert.equal(r.blocks.length, 3);
  assert.deepEqual(r.blocks[0], { kind: 'price', slugs: ['a-1', 'b'] });
  assert.deepEqual(r.blocks[1], { kind: 'fit', part: 'optic', slug: 'o', gun: 'g' });
  assert.deepEqual(r.blocks[2], { kind: 'fit', part: 'magazine', slug: 'm', gun: 'g' });
  assert.equal((r.html.match(/<!--fn-block-\d+-->/g) || []).join(','), '<!--fn-block-0-->,<!--fn-block-1-->,<!--fn-block-2-->');
  assert.equal(md.parseDirective('::price'), null);
  assert.equal(md.parseDirective('::price Bad_Slug'), null);
  assert.equal(md.parseDirective('::fit gun=g'), null);
  assert.equal(md.parseDirective('::fit optic=o gun=g extra=1'), null);
});

// ── the handler against a stubbed PostgREST ─────────────────────────────
const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
const realError = console.error;
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
test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

const run = async (url) => {
  const res = await handler(new Request(url));
  return { status: res.status, headers: res.headers, html: await res.text() };
};
const count = (s, needle) => s.split(needle).length - 1;

// A realistic catalog: one optic on a partner listing with a fresh price,
// one with no listing but a maker url, one magazine on a stale listing.
// Every stored name is the model alone (the naming convention), so the
// page is held to print "Sig Sauer P365 9mm 17rd …" and "Holosun 507K X2"
// — brand + name, never the bare model and never a doubled brand
// (_display-name.mjs).
const today = new Date().toISOString().slice(0, 10);
const FP = { K: 'fp-holosun-k', RMSC: 'fp-rmsc', RMR: 'fp-rmr', SLC: 'fp-sig-loc-compact' };
const PRODUCTS = {
  'holosun-507k-x2': { id: 'P1', slug: 'holosun-507k-x2', name: '507K X2', category: 'optic', url: 'https://holosun.com/507k', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V1', msrp: 359.99, is_default: true, primary_image_url: 'https://img/507k.jpg',
      affiliate_links: [{ id: 'L1', url: 'https://www.opticsplanet.com/x', affiliate_url: 'https://www.awin1.com/x', street_price: 329.99, in_stock: true, last_checked: today, op_last_matched_by: 'T1', partners: { name: 'OpticsPlanet (Awin)' } }] }] },
  'holosun-507c-x2': { id: 'P2', slug: 'holosun-507c-x2', name: '507C X2', category: 'optic', url: 'https://holosun.com/507c', is_discontinued: false, restricted_states: null,
    manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' },
    product_variants: [{ id: 'V2', msrp: 309.99, is_default: true, primary_image_url: null, affiliate_links: [] }] },
  'sig-sauer-p365-17rd-mag': { id: 'P3', slug: 'sig-sauer-p365-17rd-mag', name: 'P365 9mm 17rd Magazine', category: 'magazine', url: 'https://sigsauer.com/mag', is_discontinued: false, restricted_states: ['CA', 'NY'],
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

test('an undeclared slug, a non-slug path and a .md by name are 404s with no read', async () => {
  for (const path of ['/field-notes/not-declared', '/field-notes/Not_A_Slug', fieldNotePath(FIXTURE.slug) + '.md', '/field-notes/a/b']) {
    const seen = stubFetch(() => { throw new Error('must not fetch'); });
    const r = await run(PREVIEW + path);
    assert.equal(r.status, 404, path);
    assert.equal(r.headers.get('x-field-note'), 'none', path);
    assert.equal(r.headers.get('netlify-cdn-cache-control'), 'no-store');
    assert.equal(seen.calls, 0, path + ' read the database');
    assert.equal(count(r.html, ANALYTICS_SNIPPET), 1);
  }
});

test('a draft is a 404 on the apex, with no read', async () => {
  const seen = stubFetch(() => { throw new Error('must not fetch'); });
  const r = await run(APEX + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 404);
  assert.equal(seen.calls, 0);
});

test('the fixture renders off the apex: verdicts, prices, chrome, meta', async () => {
  stubFetch(catalog);
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 200);
  const h = r.html;
  // headers say what was asked and found
  assert.equal(r.headers.get('x-field-note'), FIXTURE.slug);
  assert.equal(r.headers.get('x-field-note-draft'), '1');
  assert.equal(r.headers.get('x-field-note-source'), 'file');
  assert.equal(r.headers.get('x-field-note-blocks'), 'price=1 fit=5');
  assert.equal(r.headers.get('x-field-note-products'), '3/3');
  assert.equal(r.headers.get('x-field-note-fits'), '5/5');
  assert.equal(r.headers.get('cache-control'), 'no-store', 'a draft is never cached');
  // chrome and meta
  assert.equal(count(h, ANALYTICS_SNIPPET), 1, 'analytics tag exactly once');
  assert.ok(/<\/body>/.test(h));
  assert.ok(h.includes('<link rel="canonical" href="' + APEX + fieldNotePath(FIXTURE.slug) + '" />'), 'apex canonical');
  assert.ok(h.includes('<meta property="og:url" content="' + APEX + fieldNotePath(FIXTURE.slug) + '"/>'));
  assert.ok(h.includes('"@type":"Article"') && h.includes('"@type":"BreadcrumbList"'), 'JSON-LD');
  assert.ok(h.includes('"datePublished":"' + FIXTURE.published + '"'));
  assert.ok(/<meta name="robots" content="noindex"\/>/.test(h), 'a draft is noindex');
  assert.equal(count(h, 'href="/p365/">Your P365</a>'), 2, 'the shared nav, desktop and mobile');
  assert.ok(h.includes('class="draft-strip"'));
  assert.ok(h.includes('<h1>Does the Holosun 507K X2 fit a P365 XL?'));
  assert.ok(!/<!--fn-block-\d+-->/.test(h), 'every placeholder was replaced');
  // the fit verdicts, in the fixture's order
  const fits = [...h.matchAll(/<div class="fn-verdict ([a-z]+)">([^<]+)<\/div>/g)].map((m) => m[1] + ':' + m[2]);
  assert.deepEqual(fits, ['yes:Yes, direct fit', 'depends:Depends on the SKU', 'no:No', 'yes:Flush fit', 'no:Doesn’t fit']);
  assert.ok(h.includes('<td class="v-no">Doesn’t fit</td>'), 'the -SL/-RXSL row of the XMacro says no');
  assert.ok(h.includes('SIG-LOC Compact <em class="likely">(likely)</em>'), 'the likely cut is marked');
  assert.ok(h.includes('Optic footprint: <strong>Holosun K-Series / Modified RMSc</strong>'));
  assert.ok(h.includes('Capacity: <strong>17 rounds</strong>'));
  // product names carry their brand exactly once — the fit question and
  // the price table's part cell
  assert.ok(h.includes('Does the <a href="/parts/magazines/sig-sauer-p365-17rd-mag">Sig Sauer P365 9mm 17rd Magazine</a> fit the Sig Sauer P365 XMacro?'),
    'an unbranded stored name is printed with its brand');
  assert.ok(h.includes('Does the <a href="/parts/optics/holosun-507k-x2">Holosun 507K X2</a> fit the Sig Sauer P365 XL?'),
    'a branded stored name is printed as stored');
  assert.ok(h.includes('<a href="/parts/magazines/sig-sauer-p365-17rd-mag">Sig Sauer P365 9mm 17rd Magazine</a>'),
    'the price table names the brand');
  assert.ok(h.includes('alt="Holosun 507K X2"') && !h.includes('alt="Holosun Holosun'), 'the photo alt is the same name (the magazine stub has no photo)');
  assert.ok(!h.includes('Holosun Holosun') && !h.includes('Sig Sauer Sig Sauer'), 'no brand is doubled');
  assert.ok(!h.includes('class="t-brand"'), 'no separate brand line under a name that already carries it');
  assert.ok(h.includes('Not available in: CA, NY'));
  assert.ok(h.includes('href="/fit/p365/red-dots/p365-xl"'), 'links down to the fit guide');
  assert.ok(h.includes('href="/p365/p365-xl"'), 'and up to the hub');
  // the price block: fresh price + partner button, maker button, stale → Check price
  assert.ok(h.includes('<td class="t-price">$329.99</td>'));
  assert.ok(h.includes('href="/go/L1" target="_blank" rel="noopener sponsored nofollow">Buy at OpticsPlanet'));
  assert.ok(h.includes('<td class="t-price">MSRP $309.99</td>'));
  assert.ok(h.includes('href="/go/part/P2" target="_blank" rel="noopener nofollow">Buy from Holosun'));
  assert.ok(h.includes('<td class="t-price">Check price</td>'), 'a stale price is never stated');
  assert.ok(!h.includes('$54.99'), 'the stale number does not appear anywhere');
  assert.ok(h.includes('href="/parts/optics/holosun-507k-x2"') && h.includes('href="/parts/magazines/sig-sauer-p365-17rd-mag"'));
  assert.ok(h.includes('Links to a maker') || h.includes('may earn a commission'), 'the disclosure line');
  // the Markdown constructs survived into the page
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !h.includes('<script>alert(1)'), 'raw HTML is text');
  assert.ok(h.includes('<a href="/p365/">site link</a>'));
});

test('zero rows is an answer: 200, the part named as missing, headers count it', async () => {
  const seen = stubFetch(() => json([]));
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-field-note-products'), '0/3');
  assert.equal(r.headers.get('x-field-note-fits'), '0/5');
  assert.ok(r.html.includes('<code>holosun-507k-x2</code> is not in the catalog'));
  assert.ok(seen.calls >= 1);
  assert.equal(seen.paths.filter((p) => p.startsWith('products?')).length, 1, 'one products read for every slug on the page');
});

const FAILURES = {
  'network error (fetch rejects)': () => { throw new TypeError('fetch failed'); },
  'timeout (abort)':               () => { throw new DOMException('aborted', 'TimeoutError'); },
  'PostgREST 500':                 () => json({ message: 'boom' }, 500),
  'PostgREST 429':                 () => json({ message: 'slow' }, 429),
  '2xx with an HTML body':         () => new Response('<html>cf</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  '2xx with a JSON object body':   () => json({ message: 'not an array' }),
};
for (const [label, impl] of Object.entries(FAILURES)) {
  test(`${label} → 503 with Retry-After, after one retry, never a 404`, async () => {
    const seen = stubFetch(impl);
    const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
    assert.equal(r.status, 503, 'status was ' + r.status);
    assert.ok(r.headers.get('retry-after'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(seen.calls, PG_ATTEMPTS, 'fetch attempts: ' + seen.calls);
  });
}
test('PostgREST 400 (a query bug) → 503, one attempt', async () => {
  const seen = stubFetch(() => json({ code: 'PGRST201' }, 400));
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 503);
  assert.equal(seen.calls, 1);
});

test('a failure after the first read is still a 503 — never a page with a hole', async () => {
  const seen = stubFetch((n, path) => (path.startsWith('guns?') ? json({ message: 'boom' }, 502) : catalog(n, path)));
  const r = await run(PREVIEW + fieldNotePath(FIXTURE.slug));
  assert.equal(r.status, 503);
  assert.ok(seen.paths.some((p) => p.startsWith('guns?')));
});
