// guide-share.test.mjs — /gg/<slug>-<uuid>, every Gun Guide's own page,
// held to the rules that fail silently in a browser.
//
//   - not found means PostgREST said zero rows, from BOTH tables (a
//     published Gunforma guide, then a community guide): 404, no
//     Retry-After, never cached durably. Any failure to read — a reject, a
//     timeout, a 5xx, a 2xx with the wrong body — is 503 + Retry-After after
//     one retry, never a 404 (CLAUDE.md, "Not found means PostgREST said
//     zero rows"). A path with no uuid is a 404 before any read.
//   - the canonical is the apex /gg/<slug>-<uuid> built from the guide's
//     TITLE by _guide-url.mjs, whatever slug the request carried.
//   - a published Gunforma guide is indexable; a community guide is served
//     but noindex (meta and X-Robots-Tag) until titles can be reported
//     (claude/loadouts-spec.md §7.5). The queries themselves carry the
//     is_published / is_removed filters — the stub only answers rows when
//     they were sent, so a dropped filter fails here.
//   - the page itself: H1, the share card built from the data, buy rows
//     through /go/ under the listing rules, the build-total number,
//     discontinued and typed parts never sold, nav with Guides active.
//
// Same harness as upstream-failure.test.mjs: globalThis.fetch replaced per
// case, the real handler run against it. No network.
//
// Run: node --test scripts/guide-share.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const mod = await import(fn('guide-share.mjs'));
const handler = mod.default;
const { PG_ATTEMPTS } = await import(fn('_pg.mjs'));
const { CDN_CACHE_BUILD } = await import(fn('_cache.mjs'));
const { priceTotal, priceTotalText } = await import(fn('_build-cards.mjs'));

const ID = 'd1ccac3a-3f29-4e5c-a14e-667386e46315';
const UID = 'bbbbbbbb-0000-4000-8000-000000000002';
const SITE = 'https://gunforma.com';
const CANON = SITE + '/gg/sig-p365-concealed-carry-' + ID;
const P = { opt: '11111111-0000-4000-8000-000000000001', sl: '11111111-0000-4000-8000-000000000002',
            bar: '11111111-0000-4000-8000-000000000003', disc: '11111111-0000-4000-8000-000000000004',
            fr: '11111111-0000-4000-8000-000000000005' };

const TODAY = new Date().toISOString().slice(0, 10);
const fresh = { last_checked: TODAY, op_last_matched_by: 'awin-v2' };
const product = (category, slug, url, maker, site, disc = false) => ({
  slug, category, url, is_discontinued: disc, manufacturers: { name: maker, website_url: site } });
const VARIANTS = [
  { id: 'v-opt', product_id: P.opt, is_default: true, msrp: 349.99, color: 'Black', primary_image_url: 'https://img.test/opt.jpg',
    products: product('optic', 'holosun-507k-x2', 'https://holosun.com/x', 'Holosun', 'https://holosun.com'),
    affiliate_links: [{ id: 'L-opt', url: 'https://shop.test/o', street_price: 299.99, in_stock: true, ...fresh, partners: { name: 'OpticsPlanet (Awin)' } }] },
  { id: 'v-sl', product_id: P.sl, is_default: true, msrp: 429.99, color: 'Black', primary_image_url: null,
    products: product('slide', 'ggp-v3', 'https://ggp.test/s', 'Grey Ghost Precision', 'https://ggp.test'),
    affiliate_links: [{ id: 'L-sl', url: 'https://shop.test/s', street_price: 379.99, in_stock: true, last_checked: TODAY, op_last_matched_by: null, partners: { name: 'Brownells' } }] },
  { id: 'v-bar', product_id: P.bar, is_default: true, msrp: 189, color: 'Gold', primary_image_url: 'https://img.test/bar.jpg',
    products: product('barrel', 'norsso-n365', 'https://norsso.com/b', 'Norsso', 'https://norsso.com'), affiliate_links: [] },
  { id: 'v-fr-blk', product_id: P.fr, is_default: true, msrp: 109.99, color: 'Black', primary_image_url: 'https://img.test/fr-blk.jpg',
    products: product('frame', 'wc-grip', 'https://wc.test/g', 'Wilson Combat', 'https://wc.test'),
    affiliate_links: [{ id: 'L-fr-blk', url: 'https://shop.test/fb', street_price: 99.99, in_stock: true, ...fresh, partners: { name: 'PartnerA' } }] },
  { id: 'v-fr-fde', product_id: P.fr, is_default: false, msrp: 109.99, color: 'FDE', primary_image_url: 'https://img.test/fr-fde.jpg',
    products: product('frame', 'wc-grip', 'https://wc.test/g', 'Wilson Combat', 'https://wc.test'),
    affiliate_links: [{ id: 'L-fr-fde', url: 'https://shop.test/ff', street_price: 119.99, in_stock: true, ...fresh, partners: { name: 'PartnerB' } }] },
  { id: 'v-disc', product_id: P.disc, is_default: true, msrp: 59.99, color: 'Black', primary_image_url: null,
    products: product('basepad', 'x-pad', 'https://x.test/p', 'XBrand', 'https://x.test', true),
    affiliate_links: [{ id: 'L-disc', url: 'https://shop.test/d', street_price: 49.99, in_stock: true, ...fresh, partners: { name: 'Shop' } }] },
];
const SNAPSHOT = [
  { refId: P.opt, category: 'optic', brand: 'Holosun', name: '507K X2', slug: 'holosun-507k-x2' },
  { refId: P.sl, category: 'slide', brand: 'Grey Ghost Precision', name: 'V3 Slide', slug: 'ggp-v3' },
  { refId: P.bar, category: 'barrel', brand: 'Norsso', name: 'N365 Barrel', slug: 'norsso-n365' },
  { refId: P.fr, category: 'frame', brand: 'Wilson Combat', name: 'Grip', slug: 'wc-grip', variantId: 'v-fr-fde' },
  { refId: P.disc, category: 'basepad', brand: 'XBrand', name: 'Pad', slug: 'x-pad' },
  { category: 'holsters', brand: 'Tier 1', name: 'Axis Holster', pending: true },
];
const CURATED = { id: ID, title: 'Sig P365 Concealed Carry', category: 'concealed_carry', description: 'Deep carry.',
  platform_id: 'p', gun_id: null, parts_snapshot: SNAPSHOT, is_published: true,
  guide_themes: { label: 'Concealed carry' }, guns: null, platforms: { name: 'SIG P365' } };
const COMMUNITY = { id: ID, user_id: UID, title: 'Sig P365 Concealed Carry', platform_id: 'p', gun_id: null,
  parts_snapshot: SNAPSHOT, is_removed: false, guns: { name: 'P365 XMacro', slug: 'p365-xmacro' }, platforms: { name: 'SIG P365' } };

const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A PostgREST stand-in that honours the filters this test is about: a
// guide row comes back only when the query SENT is_published=eq.true /
// is_removed=eq.false — a dropped filter reads as zero rows here.
function db({ curated = null, community = null, username = 'wraythe', fail = null } = {}) {
  return (n, url) => {
    const u = String(url);
    if (fail && fail(u, n)) return json({ message: 'boom' }, 500);
    if (u.includes('/rest/v1/guides?')) return json(curated && u.includes('is_published=eq.true') ? [curated] : []);
    if (u.includes('/rest/v1/gun_guides?')) return json(community && u.includes('is_removed=eq.false') ? [community] : []);
    if (u.includes('/rest/v1/profiles?')) return json(username ? [{ username }] : []);
    if (u.includes('/rest/v1/product_variants?')) return json(VARIANTS);
    return json([]);
  };
}

const realFetch = globalThis.fetch;
const realError = console.error;
function stubFetch(impl) {
  const seen = { calls: 0, urls: [], signals: [] };
  globalThis.fetch = async (url, init) => { seen.calls++; seen.urls.push(String(url)); seen.signals.push(init && init.signal); return impl(seen.calls, url, init); };
  return seen;
}
test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

const get = (path) => handler(new Request(SITE + path));

// ── not found, and failures that are not "not found" ──────────────────────
test('a path with no uuid is 404 before any read', async () => {
  for (const p of ['/gg/no-uuid-here', '/gg/', '/gg/a/b-' + ID]) {
    const seen = stubFetch(() => json([]));
    const res = await get(p);
    assert.equal(res.status, 404, p);
    assert.equal(seen.calls, 0, p + ': nothing read');
  }
});

test('zero rows from both tables → 404, and only then: two reads, no Retry-After, never stored', async () => {
  const seen = stubFetch(db());
  const res = await get('/gg/whatever-' + ID);
  assert.equal(res.status, 404);
  assert.equal(seen.calls, 2, 'guides, then gun_guides — each an answer, neither retried');
  assert.equal(res.headers.get('retry-after'), null);
  assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store');
});

test('an unpublished Gunforma guide is a 404 — the query asks for published only', async () => {
  // The stub answers a guides row only when is_published=eq.true was sent;
  // an unpublished draft is simply not in that answer.
  const seen = stubFetch(db({ curated: null }));
  assert.equal((await get('/gg/' + ID)).status, 404);
  assert.ok(seen.urls[0].includes('is_published=eq.true'), 'the published filter is sent');
  assert.ok(seen.urls[1].includes('is_removed=eq.false'), 'the taken-down filter is sent');
});

const FAILURES = {
  'network error (fetch rejects)': () => { throw new TypeError('fetch failed'); },
  'timeout (abort)':               () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
  'PostgREST 500':                 () => json({ message: 'boom' }, 500),
  'PostgREST 429':                 () => json({ message: 'slow down' }, 429),
  '2xx with an HTML body':         () => new Response('<html>cloudflare</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  '2xx with a JSON object body':   () => json({ message: 'not an array' }),
};
for (const [label, impl] of Object.entries(FAILURES)) {
  test(`${label} on the first read → 503 + Retry-After, after one retry`, async () => {
    const seen = stubFetch(impl);
    const res = await get('/gg/' + ID);
    assert.equal(res.status, 503);
    assert.ok(res.headers.get('retry-after'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(seen.calls, PG_ATTEMPTS);
    assert.ok(seen.signals.every((s) => s instanceof AbortSignal), 'every attempt carries a timeout');
  });
}

test('a failure on the community read, after zero curated rows, is 503 — not a 404', async () => {
  stubFetch(db({ fail: (u) => u.includes('/gun_guides?') }));
  assert.equal((await get('/gg/' + ID)).status, 503);
});

test('a failure reading the parts is 503 — the guide was found, its page was not read', async () => {
  stubFetch(db({ curated: CURATED, fail: (u) => u.includes('/product_variants?') }));
  assert.equal((await get('/gg/' + ID)).status, 503);
});

// ── a published Gunforma guide ────────────────────────────────────────────
test('published Gunforma guide: 200, apex canonical from the title, indexable, Guides active', async () => {
  stubFetch(db({ curated: CURATED }));
  const res = await get('/gg/an-old-slug-' + ID);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-guide-share'), 'curated');
  assert.equal(res.headers.get('x-guide-share-index'), 'index');
  assert.equal(res.headers.get('x-robots-tag'), null);
  assert.equal(res.headers.get('netlify-cdn-cache-control'), CDN_CACHE_BUILD);
  const canon = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1];
  assert.equal(canon, CANON, 'the title decides the slug, not the request');
  assert.equal((html.match(/property="og:url" content="([^"]+)"/) || [])[1], CANON);
  // The collage, named by a hash of what it draws (guide-og.test.mjs holds
  // the image to it), declared at its real size.
  const ogImage = (html.match(/property="og:image" content="([^"]+)"/) || [])[1];
  assert.match(ogImage, new RegExp('^' + SITE + '/gg-og/' + ID + '-[0-9a-f]{10}\\.png$'));
  assert.equal(res.headers.get('x-guide-share-image'), 'collage');
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /property="og:image:type" content="image\/png"/);
  assert.equal((html.match(/name="twitter:image" content="([^"]+)"/) || [])[1], ogImage);
  assert.doesNotMatch(html, /name="robots"/);
  assert.match(html, /<h1>Sig P365 Concealed Carry<\/h1>/);
  assert.match(html, /Gunforma guide &middot; Concealed carry/);
  assert.match(html, /class="nav-link active" href="gunforma-gun-guides\.html">Guides</);
  const ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]);
  assert.equal(ld[0]['@type'], 'ItemList');
  assert.equal(ld[0].numberOfItems, SNAPSHOT.length);
  assert.equal(ld[1].itemListElement[2].item, CANON);
});

test('the share card is built from the data: parts, count and today\'s total', async () => {
  stubFetch(db({ curated: CURATED }));
  const html = await (await get('/gg/' + ID)).text();
  const total = priceTotalText(priceTotal(SNAPSHOT, VARIANTS));
  const desc = (html.match(/property="og:description" content="([^"]+)"/) || [])[1];
  assert.ok(desc.startsWith('Sig P365 Concealed Carry: Holosun 507K X2, Grey Ghost Precision V3 Slide'), desc);
  assert.ok(desc.includes('— 6 parts, ' + total + ' today.'), desc);
  assert.doesNotMatch(desc, /……/);
  assert.match((html.match(/property="og:title" content="([^"]+)"/) || [])[1], /^Sig P365 Concealed Carry: Holosun 507K X2/);
});

test('every part: photo or swatch, a /parts/ link, and a buy row under the listing rules', async () => {
  stubFetch(db({ curated: CURATED }));
  const res = await get('/gg/' + ID);
  const html = await res.text();
  assert.equal((html.match(/class="pr"/g) || []).length, SNAPSHOT.length);
  for (const href of ['/parts/optics/holosun-507k-x2', '/parts/slides/ggp-v3', '/parts/barrels/norsso-n365',
                      '/parts/frames/wc-grip', '/parts/basepads/x-pad']) {
    assert.ok(html.includes('href="' + href + '"'), href);
  }
  // fresh partner: the number, through /go/<link>, sponsored
  assert.match(html, /\$299\.99[\s\S]*?href="\/go\/L-opt"[^>]*rel="noopener sponsored nofollow"/);
  // stale partner: "Check price", the link still there, no number, no MSRP
  assert.match(html, /Check price<\/span>[\s\S]*?href="\/go\/L-sl"/);
  assert.doesNotMatch(html, /379\.99|429\.99/);
  // maker-only: /go/part/<id>, unsponsored, with the maker's label
  assert.match(html, new RegExp('href="/go/part/' + P.bar + '"[^>]*rel="noopener nofollow">Buy from Norsso'));
  // the SAVED option's listing (FDE at 119.99), never the cheaper sibling
  assert.match(html, /\$119\.99[\s\S]*?href="\/go\/L-fr-fde"/);
  assert.doesNotMatch(html, /L-fr-blk/);
  assert.match(html, /fr-fde\.jpg/, 'the saved option\'s photo');
  // discontinued: marked, linked, never sold
  assert.match(html, /Discontinued/);
  assert.doesNotMatch(html, /L-disc/);
  // typed part: its name, no link, no buy row
  assert.match(html, /Tier 1 Axis Holster/);
  assert.equal(res.headers.get('x-guide-share-buy'), '4');
  // every buy anchor goes through /go/
  for (const m of html.matchAll(/<a [^>]*rel="[^"]*nofollow[^"]*"[^>]*>/g)) assert.match(m[0], /href="\/go\//);
  // the total is the build pages' number; the disclosure says partner AND maker
  assert.ok(html.includes('Total at today’s prices: <strong>' + priceTotalText(priceTotal(SNAPSHOT, VARIANTS)) + '</strong>'));
  assert.match(html, /Gunforma may earn a commission on retailer links\. Links to a maker&#39;s own store earn us nothing\./);
  assert.ok(html.includes('href="/gunforma-armory.html?from=' + ID + '"'), 'customize link, never ?edit=');
});

// ── a community guide ─────────────────────────────────────────────────────
test('community guide: served 200, but noindex (meta + header), with its builder', async () => {
  stubFetch(db({ community: COMMUNITY }));
  const res = await get('/gg/' + ID);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-guide-share'), 'community');
  assert.equal(res.headers.get('x-guide-share-index'), 'noindex');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.match(html, /<meta name="robots" content="noindex"\/>/);
  assert.equal((html.match(/rel="canonical" href="([^"]+)"/) || [])[1], CANON);
  // A reader's build is an Armory build, by its builder — never a "community
  // guide" — and its crumb leads back to the Armory, not to Gun Guides
  // (which lists Gunforma's own guides only).
  assert.match(html, /<div class="eyebrow">Armory build by @wraythe<\/div>/);
  assert.doesNotMatch(html, /community/i);
  assert.match(html, /<div class="breadcrumb"><a href="\/">Home<\/a> \/ <a href="\/gunforma-armory\.html">Armory<\/a> \//);
  assert.match(html, /"name":"Armory","item":"https:\/\/gunforma\.com\/gunforma-armory\.html"/);
  assert.match(html, /og:image:alt" content="Armory build: /);
  assert.match(html, /P365 XMacro &middot; 6 parts/);
});

test('community guide: a failed username read drops the byline, never the page', async () => {
  stubFetch(db({ community: COMMUNITY, fail: (u) => u.includes('/profiles?') }));
  const res = await get('/gg/' + ID);
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), / by wraythe/);
});

// ── the queries ───────────────────────────────────────────────────────────
test('every embed names its FK — gun_guides carries two to guns', () => {
  assert.match(mod.COMMUNITY_SELECT, /guns!gun_guides_gun_id_fkey\(/);
  assert.match(mod.COMMUNITY_SELECT, /platforms!gun_guides_platform_id_fkey\(/);
  assert.match(mod.CURATED_SELECT, /guns!guides_gun_platform_fkey\(/);
  assert.match(mod.CURATED_SELECT, /guide_themes!guides_category_fkey\(/);
  assert.match(mod.VARIANT_SELECT, /products!product_variants_product_id_fkey\(/);
  assert.doesNotMatch(mod.COMMUNITY_SELECT + mod.CURATED_SELECT, /(^|,)guns\(/);
});

test('the parts read drops retired variants and retired listings', async () => {
  const seen = stubFetch(db({ curated: CURATED }));
  await get('/gg/' + ID);
  const q = seen.urls.find((u) => u.includes('/product_variants?'));
  assert.ok(q.includes('retired_at=is.null'));
  assert.ok(q.includes('affiliate_links.retired_at=is.null'));
});
