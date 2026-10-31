// Pins the discontinued-parts policy (Alex, 2026-10-30): a discontinued part
// is never hidden or deleted. Its page stays live and in the sitemap, says
// "Discontinued", sells nothing, and sends the reader to the successor THE
// MAKER NAMES (products.replaced_by_id) — or, with none, to similar parts.
// Builds, guides and the build pickers keep showing it; the catalog and the
// Armory hide it behind a "Show discontinued" toggle.
//
// Every way this breaks renders perfectly in a browser: a discontinued page
// with a buy button looks like any other product page, a sitemap that drops
// a page looks like a sitemap, and a picker that filters a part out looks
// like a catalog that never had it. So:
//
//   - product-page.mjs runs against a stubbed catalog: the badge, no buy rows
//     or offers, the successor card with the successor's own buy link, the
//     fallback to similar parts when there is no successor (the pre-migration
//     400 included) or the successor is not buyable, similar parts limited to
//     approved and live, and a live part untouched;
//   - the surfaces that must SHOW discontinued parts carry no filter that
//     drops them, and the two that hide them do it behind a toggle;
//   - PART_REDIRECTS (the addresses a sitemap and /parts must skip) is
//     exactly the set of /parts/ 301s in netlify.toml.
//
// Run: node --test scripts/discontinued.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFile(join(ROOT, f), 'utf8');
const handler = (await import(pathToFileURL(join(ROOT, 'netlify/functions/product-page.mjs')).href)).default;
const { PART_REDIRECTS } = await import(pathToFileURL(join(ROOT, 'netlify/functions/_part-redirects.mjs')).href);

const P = '00000000-0000-4000-8000-0000000000a1';      // the discontinued light
const S = '00000000-0000-4000-8000-0000000000b2';      // its successor
const A = '00000000-0000-4000-8000-0000000000c3';      // similar: approved, priced
const B = '00000000-0000-4000-8000-0000000000d4';      // similar: NOT approved
const C = '00000000-0000-4000-8000-0000000000e5';      // similar: approved, no price
const FRESH = new Date().toISOString().slice(0, 10);

const variant = (id, extra = {}) => ({
  id, slug: id, sku: null, upc: null, msrp: 199, is_default: true, primary_image_url: 'https://img.example/' + id + '.jpg',
  color: 'Black', finish: null, optic_cut: null, bundle: null, clamp_style: null, manual_safety_variant: false,
  reticle: null, reticle_color: null, variant_label: null, variant_images: [], affiliate_links: [], ...extra,
});
const product = (id, slug, name, extra = {}) => ({
  id, slug, name, category: 'light', description: 'A weapon light.', best_for: [], pros: null, cons: null,
  material: null, material_family: null, weight_oz: null, installation_difficulty: null, fitment_confidence: 'verified',
  build_warning: null, fitment_notes: null, lowest_price: null, url: 'https://streamlight.example/' + slug,
  is_discontinued: false, manufacturers: { name: 'Streamlight', slug: 'streamlight', website_url: 'https://streamlight.example' },
  product_variants: [variant(id + '-v')], ...extra,
});
const LINK = { id: 'link-1', url: 'https://shop.example/x', affiliate_url: 'https://track.example/x', street_price: 149.99,
  in_stock: true, last_checked: FRESH, op_last_matched_by: 'gtin', partners: { name: 'OpticsPlanet' } };

// replacedBy: the replaced_by_id read — a uuid, null, or 'missing' (the
// column not there yet: PostgREST 400). successor: the successor row the
// live-only read returns, or null (it is discontinued). live: render a live
// part instead.
async function render({ replacedBy = null, successor = true, successorApproved = true, live = false } = {}) {
  const seen = [];
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    seen.push(u);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/products?slug=eq.')) {
      return json([product(P, 'streamlight-tlr-7-sub', 'TLR-7 Sub', { is_discontinued: !live,
        product_variants: [variant(P + '-v', { affiliate_links: [{ ...LINK, id: 'old-link' }] })] })]);
    }
    if (u.includes('/products?id=eq.' + P) && u.includes('select=replaced_by_id')) {
      return replacedBy === 'missing' ? json({ code: '42703', message: 'column products.replaced_by_id does not exist' }, 400)
        : json([{ replaced_by_id: replacedBy }]);
    }
    if (u.includes('/products?id=eq.' + S) && u.includes('is_discontinued=is.false')) {
      return json(successor ? [product(S, 'streamlight-tlr-7-x-sub-usb', 'TLR-7 X Sub USB',
        { product_variants: [variant(S + '-v', { affiliate_links: [LINK] })] })] : []);
    }
    if (u.includes('/products?id=eq.' + S) && u.includes('select=is_approved')) return json([{ is_approved: successorApproved }]);
    if (u.includes('select=restricted_states')) return json([{ restricted_states: null }]);
    if (u.includes('/product_platforms?product_id=eq.' + P)) return json([{ platform_id: 'PL1' }]);
    if (u.includes('/light_compatibility?light_product_id=eq.' + P)) return json([{ gun_id: 'G1' }]);
    if (u.includes('/light_compatibility?gun_id=in.')) {
      return json([P, A, B, C].map((id) => ({ light_product_id: id })));
    }
    if (u.includes('/products?category=eq.light')) {
      const row = (id, name, approved, links) => ({ id, slug: name.toLowerCase().replace(/\s+/g, '-'), name, category: 'light',
        is_approved: approved, manufacturers: { name: 'Holosun' }, product_platforms: [{ platform_id: 'PL1' }],
        product_variants: [{ is_default: true, primary_image_url: null, affiliate_links: links }] });
      return json([row(C, 'P.ID Zed', true, []), row(B, 'P.ID Unapproved', false, [LINK]), row(A, 'P.ID Alpha', true, [LINK])]);
    }
    return json([]);
  };
  try {
    const res = await handler(new Request('https://gunforma.com/parts/lights/streamlight-tlr-7-sub'));
    return { res, html: await res.text(), state: res.headers.get('x-discontinued'), seen };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}

const jsonLd = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const section = (html, title) => {
  const i = html.indexOf('<div class="section-title">' + title + '</div>');
  if (i === -1) return null;
  const end = html.indexOf('<div class="section-title">', i + 10);
  return html.slice(i, end === -1 ? undefined : end);
};

test('a discontinued part with a maker-named successor: badge, no buy rows, the successor card', async () => {
  const r = await render({ replacedBy: S });
  assert.equal(r.res.status, 200, 'the page stays live');
  assert.equal(r.state, 'replaced:streamlight-tlr-7-x-sub-usb');
  assert.match(r.html, /<div class="disc-badge">Discontinued<\/div>/);
  assert.equal(section(r.html, 'Buy'), null, 'no Buy section');
  assert.ok(!r.html.includes('/go/old-link'), 'the discontinued part’s own listing is not sold');
  assert.ok(!r.html.includes('<div class="price-line">'), 'no headline price — it has nothing to sell');
  assert.doesNotMatch(r.html, /<meta name="description" content="[^"]*Priced/, 'nor one in the snippet');
  assert.equal(jsonLd(r.html).offers, undefined, 'no offers in the structured data');
  const card = section(r.html, 'Replaced by');
  assert.ok(card, 'Replaced by section');
  assert.match(card, /href="\/parts\/lights\/streamlight-tlr-7-x-sub-usb"/, 'links the successor’s page');
  assert.match(card, /Streamlight TLR-7 X Sub USB/, 'names the successor by its display name');
  assert.match(card, /href="\/go\/link-1"[^>]*rel="noopener sponsored nofollow"/, 'carries the successor’s own buy link, through /go/');
  assert.match(card, /\$149\.99/, 'with its fresh price');
  assert.equal(section(r.html, 'Similar parts'), null, 'a successor replaces the similar list');
  assert.match(r.html, /<meta name="description" content="Discontinued — replaced by the Streamlight TLR-7 X Sub USB\. /);
  assert.ok(section(r.html, 'Options'), 'the options it came in still show');
});

test('no successor — or the column not there yet — falls back to similar parts, approved and live only', async () => {
  for (const replacedBy of [null, 'missing']) {
    const r = await render({ replacedBy });
    assert.equal(r.res.status, 200);
    assert.equal(r.state, 'similar:2', String(replacedBy));
    assert.equal(section(r.html, 'Replaced by'), null);
    const sec = section(r.html, 'Similar parts');
    assert.ok(sec, 'Similar parts section');
    assert.ok(sec.indexOf('P.ID Alpha') !== -1 && sec.indexOf('P.ID Alpha') < sec.indexOf('P.ID Zed'),
      'a part with a price we can state first');
    assert.ok(!sec.includes('Unapproved'), 'an unapproved part is never suggested');
    assert.ok(!sec.includes('TLR-7 Sub'), 'the page’s own part is not similar to itself');
    assert.match(sec, /From \$149\.99/);
    const q = r.seen.find((u) => u.includes('/products?category=eq.light'));
    assert.match(q, /is_discontinued=is\.false/, 'similar parts are live parts');
    assert.match(q, /product_platforms\.platform_id=in\.\(PL1\)/, 'on the same platform');
    assert.match(q, new RegExp('id=in\\.\\([^)]*' + A), 'matched the way it fits (light_compatibility)');
  }
});

test('a successor that is discontinued or unapproved is not offered: similar parts instead', async () => {
  for (const opts of [{ successor: false }, { successorApproved: false }]) {
    const r = await render({ replacedBy: S, ...opts });
    assert.equal(r.state, 'similar:2', JSON.stringify(opts));
    assert.equal(section(r.html, 'Replaced by'), null);
  }
});

test('a live part is untouched: Buy section, offers, no badge, no extra reads', async () => {
  const r = await render({ live: true });
  assert.equal(r.state, 'n/a');
  assert.ok(section(r.html, 'Buy'));
  assert.ok(!r.html.includes('<div class="disc-badge">'));
  assert.ok(Array.isArray(jsonLd(r.html).offers));
  assert.ok(!r.seen.some((u) => u.includes('replaced_by_id')), 'a live part never reads replaced_by_id');
});

test('the surfaces that show discontinued parts carry no filter that drops them', async () => {
  for (const f of ['gunforma-post-build.html', 'gunforma-admin-post.html', 'gunforma-admin-queue.html',
                   'gunforma-parts-catalog.html', 'gunforma-armory.html']) {
    const src = await read(f);
    assert.doesNotMatch(src, /\.eq\('is_discontinued',\s*false\)/, f + ': must load discontinued parts');
  }
  for (const f of ['netlify/functions/sitemap.mjs', 'netlify/functions/parts-index.mjs']) {
    const src = await read(f);
    assert.doesNotMatch(src, /is_discontinued=eq\.false/, f + ': a discontinued page stays listed');
    assert.match(src, /PART_REDIRECTS\.has\(/, f + ': but never an address that 301s');
  }
  // The builders mark them; the catalog and the Armory hide them behind a
  // toggle that starts off.
  for (const f of ['gunforma-post-build.html', 'gunforma-admin-post.html']) {
    assert.match(await read(f), /discontinued: r\.is_discontinued === true/, f + ': carries the flag to the card');
  }
  assert.match(await read('js/part-picker.js'), /item\.discontinued \? '<div class="part-disc">Discontinued<\/div>'/);
  const cat = await read('gunforma-parts-catalog.html');
  assert.match(cat, /showDiscontinued: false/);
  assert.match(cat, /id="show-discontinued"/);
  assert.match(cat, /r\.discontinued && !F\.showDiscontinued/);
  const arm = await read('gunforma-armory.html');
  assert.match(arm, /var SHOW_DISCONTINUED = false;/);
  assert.match(arm, /SHOW_DISCONTINUED \|\| !p\.discontinued/);
  // Guides and builds mark them, never drop them.
  assert.match(await read('gunforma-gun-guides.html'), /DISCONTINUED\[p\.refId\] \? ' <span class="gdetail-disc">Discontinued<\/span>'/);
  assert.match(await read('gunforma-build-detail.html'), /var discTag = discontinued \?/);
  assert.match(await read('netlify/functions/build-og.mjs'), /prod\.is_discontinued === true \?/);
});

test('PART_REDIRECTS is exactly the /parts/ 301s in netlify.toml', async () => {
  const toml = await read('netlify.toml');
  const froms = new Set();
  for (const block of toml.split('[[redirects]]').slice(1)) {
    const from = (block.match(/^\s*from\s*=\s*"([^"]+)"/m) || [])[1];
    const status = (block.match(/^\s*status\s*=\s*(\d+)/m) || [])[1];
    if (from && from.startsWith('/parts/') && !from.includes('*') && !from.includes(':') && status === '301') froms.add(from);
  }
  assert.ok(froms.size > 0);
  assert.deepEqual([...PART_REDIRECTS].sort(), [...froms].sort(),
    'a /parts/ 301 in netlify.toml must be in _part-redirects.mjs, and nothing else may be');
});
