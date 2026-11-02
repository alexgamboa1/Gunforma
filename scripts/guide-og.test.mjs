// guide-og.test.mjs — a Gun Guide's share image, /gg-og/<uuid>-<hash>.png,
// held to the promises a browser cannot check:
//
//   - the image is 1200x630, read from the PNG's own bytes, whatever the
//     photos were (JPEG, PNG, WebP — resvg alone draws a WebP as nothing);
//   - a photo that fails (an error status, a reject, a timeout, bytes that
//     are not an image) still renders the collage, without that photo, and
//     the result is not cached durably;
//   - a render that fails, or a failed read, serves og-default.png's own
//     bytes — never a broken card, never a 404 or 503 for a guide that exists;
//   - the URL's hash is of what the image draws: it moves when a part, an
//     option, the title or today's total moves, and a stale one 301s to the
//     current one;
//   - the /gg/ page names exactly the URL the image function answers 200 on,
//     and declares og-default.png when the collage cannot be named;
//   - tiles follow BuildCategories.orderParts, at most six with "+N", and a
//     part never borrows another option's photo.
//
// The real handler, the real WebAssembly renderer, a stubbed fetch for
// PostgREST and the photos. No network.
//
// Run: node --test scripts/guide-og.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const og = await import(fn('guide-og.mjs'));
const handler = og.default;
const share = (await import(fn('guide-share.mjs'))).default;
const { collageModel, collageHash, shareImageFor, ogImagePath, parseOgPath, GG_OG_W, GG_OG_H, MAX_TILES,
        OG_DEFAULT_URL, COLLAGE_VERSION } = await import(fn('_guide-og.mjs'));
const { loadBuildCategories } = await import(fn('_build-categories.mjs'));
const { CDN_CACHE_BUILD } = await import(fn('_cache.mjs'));
const BC = await loadBuildCategories();

const SITE = 'https://gunforma.com';
const ID = 'd1ccac3a-3f29-4e5c-a14e-667386e46315';
const DEFAULT_PNG = readFileSync(join(ROOT, 'og-default.png'));

// ── photos ────────────────────────────────────────────────────────────────
const px = (w, h) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i += 4) { a[i] = 200; a[i + 1] = 120; a[i + 2] = 40; a[i + 3] = 255; }
  return a;
};
const PHOTOS = {
  'https://img.test/optic.jpg': readFileSync(join(ROOT, 'scripts/fixtures/og-photo.jpg')),
  'https://img.test/slide.webp': readFileSync(join(ROOT, 'scripts/fixtures/og-photo.webp')),
  'https://img.test/barrel.png': og.encodePng(px(90, 60), 90, 60),
};

// ── the guide ─────────────────────────────────────────────────────────────
const P = { opt: '11111111-0000-4000-8000-000000000001', sl: '11111111-0000-4000-8000-000000000002',
            bar: '11111111-0000-4000-8000-000000000003', trg: '11111111-0000-4000-8000-000000000004',
            fr: '11111111-0000-4000-8000-000000000005' };
const TODAY = new Date().toISOString().slice(0, 10);
const link = (id, price) => ({ id, url: 'https://shop.test/' + id, street_price: price, in_stock: true,
                               last_checked: TODAY, op_last_matched_by: 'awin-v2', partners: { name: 'Shop' } });
const prod = (category, slug) => ({ slug, category, url: 'https://maker.test/' + slug, is_discontinued: false,
                                    manufacturers: { name: 'Maker', website_url: 'https://maker.test' } });
const VARIANTS = [
  { id: 'v-opt', product_id: P.opt, is_default: true, msrp: 300, color: 'Black', primary_image_url: 'https://img.test/optic.jpg',
    products: prod('optic', 'opt'), affiliate_links: [link('L1', 299.99)] },
  { id: 'v-sl', product_id: P.sl, is_default: true, msrp: 400, color: 'Black', primary_image_url: 'https://img.test/slide.webp',
    products: prod('slide', 'sl'), affiliate_links: [link('L2', 379.99)] },
  { id: 'v-bar', product_id: P.bar, is_default: true, msrp: 189, color: 'Gold', primary_image_url: 'https://img.test/barrel.png',
    products: prod('barrel', 'bar'), affiliate_links: [] },
  { id: 'v-trg', product_id: P.trg, is_default: true, msrp: 150, color: 'Black', primary_image_url: null,
    products: prod('trigger', 'trg'), affiliate_links: [] },
  // A grip with a photo on its default option and NONE on the option saved.
  { id: 'v-fr-blk', product_id: P.fr, is_default: true, msrp: 110, color: 'Black', primary_image_url: 'https://img.test/frame-black.jpg',
    products: prod('frame', 'fr'), affiliate_links: [] },
  { id: 'v-fr-fde', product_id: P.fr, is_default: false, msrp: 110, color: 'FDE', primary_image_url: null,
    products: prod('frame', 'fr'), affiliate_links: [] },
];
// Stored out of build order on purpose: trigger first, optic last.
const SNAPSHOT = [
  { refId: P.trg, category: 'trigger', brand: 'Maker', name: 'Trigger' },
  { refId: P.fr, category: 'frame', brand: 'Maker', name: 'Grip', variantId: 'v-fr-fde' },
  { refId: P.bar, category: 'barrel', brand: 'Maker', name: 'Barrel' },
  { refId: P.sl, category: 'slide', brand: 'Maker', name: 'Slide' },
  { refId: P.opt, category: 'optic', brand: 'Maker', name: 'Optic' },
];
const ROW = { id: ID, title: 'Sig P365 Concealed Carry', category: 'concealed_carry', parts_snapshot: SNAPSHOT,
              is_published: true, guide_themes: { label: 'Concealed carry' }, guns: null, platforms: { name: 'SIG P365' } };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function world({ row = ROW, variants = VARIANTS, photo = null, dbFail = false } = {}) {
  return (url, init) => {
    const u = String(url);
    if (u.includes('/rest/v1/')) {
      if (dbFail) return json({ message: 'boom' }, 500);
      if (u.includes('/rest/v1/guides?')) return json(row && u.includes('is_published=eq.true') ? [row] : []);
      if (u.includes('/rest/v1/gun_guides?')) return json([]);
      if (u.includes('/rest/v1/product_variants?')) return json(variants);
      return json([]);
    }
    if (photo) { const r = photo(u, init); if (r) return r; }
    const bytes = PHOTOS[u];
    return bytes ? new Response(bytes, { status: 200 }) : new Response('nope', { status: 404 });
  };
}
const realFetch = globalThis.fetch;
const realError = console.error;
function stub(impl) {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push(String(url)); return impl(url, init); };
  return seen;
}
test.beforeEach(() => { console.error = () => {}; og._hooks.beforeRender = null; og._hooks.afterRender = null; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; og._hooks.beforeRender = null; og._hooks.afterRender = null; });

// The rendered pixel at a tile's photo centre, and at its swatch chip's
// centre (the chip sits at 16% down, 46% of the tile — collageSvg()).
function capturePixels() {
  const got = {};
  og._hooks.afterRender = (pixels, model) => { got.pixels = Buffer.from(pixels); got.model = model; };
  return got;
}
function pixelAt(got, label, where) {
  const tiles = got.model.tiles;
  const k = tiles.findIndex((t) => t.label === label);
  const { x, y, size } = og.gridFor(tiles.length + (got.model.more > 0 ? 1 : 0))(k);
  const chip = Math.round(size * 0.46);
  const px = Math.round(x + size / 2);
  const py = Math.round(where === 'chip' ? y + size * 0.16 + chip / 2 : y + size / 2);
  const i = (py * GG_OG_W + px) * 4;
  return [got.pixels[i], got.pixels[i + 1], got.pixels[i + 2]];
}
const TILE_BG = [0xf7, 0xf6, 0xf2];
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const pngSize = (b) => (b[0] === 0x89 && b[1] === 0x50 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);
const currentPath = (row = ROW, variants = VARIANTS) =>
  ogImagePath(ID, collageHash(collageModel({ kind: 'curated', row, variants }, BC)));
const get = (path) => handler(new Request(SITE + path));

// ── the image ─────────────────────────────────────────────────────────────
test('renders a 1200x630 PNG — read from the bytes — with JPEG, PNG and WebP photos all drawn', async () => {
  stub(world());
  const got = capturePixels();
  const res = await get(currentPath());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  // Each photo is on the canvas: its tile's centre is the photo's colour,
  // not the bare tile. Loading is not drawing — resvg draws an image it
  // cannot decode (any WebP, in 2.6.2) as nothing, with no error.
  for (const label of ['Slide', 'Barrel', 'Optic']) {
    const p = pixelAt(got, label, 'photo');
    assert.ok(!near(p, TILE_BG), label + ' photo drawn (centre pixel ' + p + ' is not the bare tile)');
  }
  assert.equal(res.headers.get('x-gg-og'), 'rendered');
  // Three photos asked (the trigger has none; the grip's saved option has
  // none) and three loaded: the WebP was decoded, not silently dropped.
  assert.equal(res.headers.get('x-gg-og-photos'), '3/3');
  assert.equal(res.headers.get('netlify-cdn-cache-control'), CDN_CACHE_BUILD);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(pngSize(buf), { w: GG_OG_W, h: GG_OG_H });
  assert.deepEqual({ w: GG_OG_W, h: GG_OG_H }, { w: 1200, h: 630 });
});

test('a photo that fails — status, reject, timeout, not-an-image — renders without it, never stored', async () => {
  const cases = {
    'error status': () => new Response('gone', { status: 500 }),
    'network reject': () => Promise.reject(new TypeError('fetch failed')),
    'not an image': () => new Response('<html>blocked</html>', { status: 200 }),
    timeout: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
  };
  for (const [label, fail] of Object.entries(cases)) {
    stub(world({ photo: (u, init) => (u.endsWith('slide.webp') ? fail(u, init) : null) }));
    const got = capturePixels();
    const res = await get(currentPath());
    assert.equal(res.status, 200, label);
    // Without the photo, the tile is the slide option's own colour (Black).
    assert.ok(near(pixelAt(got, 'Slide', 'chip'), [0x1b, 0x1b, 0x1b]), label + ': the slide draws as its swatch');
    assert.equal(res.headers.get('x-gg-og'), 'rendered', label);
    assert.equal(res.headers.get('x-gg-og-photos'), '2/3', label);
    assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store', label + ': a degraded collage is retried, not kept');
    assert.deepEqual(pngSize(Buffer.from(await res.arrayBuffer())), { w: GG_OG_W, h: GG_OG_H }, label);
  }
});

test('a failed render serves og-default.png\'s own bytes, uncached — never a broken card', async () => {
  stub(world());
  og._hooks.beforeRender = () => { throw new Error('renderer exploded'); };
  const res = await get(currentPath());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-gg-og'), 'fallback');
  assert.equal(res.headers.get('x-gg-og-reason'), 'render-failed');
  assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.equals(DEFAULT_PNG), 'the bytes are og-default.png');
  assert.deepEqual(pngSize(buf), { w: 1200, h: 630 }, 'the size the page declared');
});

test('a failed read is the default card too, not a 404 or a 503', async () => {
  stub(world({ dbFail: true }));
  const res = await get(currentPath());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gg-og'), 'fallback');
  assert.equal(res.headers.get('x-gg-og-reason'), 'read-failed');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(DEFAULT_PNG));
});

test('a guide that is gone (zero rows from both tables) is a 404; a bad path is a 404 before any read', async () => {
  let seen = stub(world({ row: null }));
  let res = await get(ogImagePath(ID, 'abcdef0123'));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store');
  for (const p of ['/gg-og/nothing.png', '/gg-og/' + ID + '-xyz.png', '/gg-og/' + ID + '-abcdef0123.jpg', '/gg-og/a/' + ID + '.png']) {
    seen = stub(world());
    res = await get(p);
    assert.equal(res.status, 404, p);
    assert.equal(seen.length, 0, p + ': nothing read');
  }
});

test('the logo heads the card, in the band, and the bottom-right corner is empty', async () => {
  stub(world());
  const got = capturePixels();
  assert.equal((await get(currentPath())).status, 200);
  const BG = [0x0e, 0x0f, 0x11];
  const lit = (x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * GG_OG_W + x) * 4;
      if (!near([got.pixels[i], got.pixels[i + 1], got.pixels[i + 2]], BG, 24)) n++;
    }
    return n;
  };
  // The logo: 60px tall from x=40 in the 112px band — thousands of lit
  // pixels, where an image that failed to draw leaves none.
  assert.ok(lit(40, 26, 466, 86) > 4000, 'the logo is drawn in the header band (' + lit(40, 26, 466, 86) + ' lit pixels)');
  // Where the small corner wordmark used to sit: nothing.
  assert.equal(lit(960, 560, 1160, 600), 0, 'no corner wordmark');
});

// ── the hash ──────────────────────────────────────────────────────────────
test('a stale or missing hash 301s to the current one, uncached', async () => {
  for (const p of [ogImagePath(ID, 'abcdef0123'), ogImagePath(ID, null)]) {
    stub(world());
    const res = await get(p);
    assert.equal(res.status, 301, p);
    assert.equal(res.headers.get('location'), currentPath(), p);
    assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store', p);
  }
});

test('the hash is of what the image draws: it moves with the parts, the option, the title and the total', () => {
  const h = (row = ROW, variants = VARIANTS) => collageHash(collageModel({ kind: 'curated', row, variants }, BC));
  const base = h();
  assert.match(base, /^[0-9a-f]{10}$/);
  assert.equal(h(), base, 'same data, same hash');
  assert.equal(h({ ...ROW, parts_snapshot: SNAPSHOT.map((p) => ({ ...p })) }), base, 'a copy is the same');
  const moved = {
    'a part removed': h({ ...ROW, parts_snapshot: SNAPSHOT.slice(1) }),
    'a part added': h({ ...ROW, parts_snapshot: SNAPSHOT.concat({ category: 'holsters', brand: 'T1', name: 'Holster' }) }),
    'another option saved': h({ ...ROW, parts_snapshot: SNAPSHOT.map((p) => (p.refId === P.fr ? { ...p, variantId: 'v-fr-blk' } : p)) }),
    'the title': h({ ...ROW, title: 'Sig P365 Deep Carry' }),
    'a photo': h(ROW, VARIANTS.map((v) => (v.id === 'v-opt' ? { ...v, primary_image_url: 'https://img.test/optic-2.jpg' } : v))),
    "today's total": h(ROW, VARIANTS.map((v) => (v.id === 'v-opt' ? { ...v, affiliate_links: [link('L1', 249.99)] } : v))),
  };
  for (const [what, hash] of Object.entries(moved)) assert.notEqual(hash, base, what);
  // A design change moves every URL: the version is part of what is hashed.
  const m = collageModel({ kind: 'curated', row: ROW, variants: VARIANTS }, BC);
  assert.notEqual(collageHash({ ...m, v: m.v + 1 }), base, 'COLLAGE_VERSION');
  assert.deepEqual(parseOgPath(ogImagePath(ID, base)), { id: ID, hash: base });
});

// ── what is drawn ─────────────────────────────────────────────────────────
// The header band says whose it is. A reader's build is an ARMORY BUILD
// (Alex, 2026-11-02) — never "COMMUNITY GUIDE", and never GUN GUIDE, which
// is Gunforma's own. The label is drawn, so it is part of the design:
// COLLAGE_VERSION 4 moved every cached card off the old wording.
test('the band reads GUN GUIDE for a Gunforma guide and ARMORY BUILD for a reader\'s build', () => {
  assert.equal(og.bandLabel('curated'), 'GUN GUIDE');
  assert.equal(og.bandLabel('community'), 'ARMORY BUILD');
  assert.ok(COLLAGE_VERSION >= 4, 'COLLAGE_VERSION bumped with the label');
  assert.doesNotMatch(readFileSync(join(ROOT, 'netlify/functions/guide-og.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, ''), /COMMUNITY GUIDE/);
});

test('tiles follow BuildCategories.orderParts, not stored order', () => {
  const m = collageModel({ kind: 'curated', row: ROW, variants: VARIANTS }, BC);
  const want = BC.orderParts(SNAPSHOT).map((p) => p.category);
  assert.notDeepEqual(want, SNAPSHOT.map((p) => p.category), 'the fixture is stored out of order');
  const label = { slide: 'Slide', barrel: 'Barrel', frame: 'Grip Module', optic: 'Optic', trigger: 'Trigger' };
  assert.deepEqual(m.tiles.map((t) => t.label), want.map((c) => label[c]));
  assert.equal(m.count, SNAPSHOT.length);
  assert.equal(m.total, '$' + Math.round(299.99 + 379.99 + 189 + 150 + 110).toLocaleString('en-US'));
});

test('six parts are six tiles; seven or more are five tiles and "+N"', () => {
  const extra = (n) => Array.from({ length: n }, (_, i) => ({ category: 'misc', brand: 'B', name: 'Thing ' + i }));
  const six = collageModel({ kind: 'curated', row: { ...ROW, parts_snapshot: SNAPSHOT.concat(extra(1)) }, variants: VARIANTS }, BC);
  assert.equal(six.tiles.length, MAX_TILES);
  assert.equal(six.more, 0);
  const nine = collageModel({ kind: 'curated', row: { ...ROW, parts_snapshot: SNAPSHOT.concat(extra(4)) }, variants: VARIANTS }, BC);
  assert.equal(nine.tiles.length, MAX_TILES - 1);
  assert.equal(nine.more, 4);
});

test('a part never borrows another option\'s photo: the saved option\'s swatch instead', () => {
  const m = collageModel({ kind: 'curated', row: ROW, variants: VARIANTS }, BC);
  const grip = m.tiles.find((t) => t.label === 'Grip Module');
  assert.equal(grip.photo, null, 'the default option\'s photo is NOT used for the saved FDE option');
  assert.equal(grip.color, 'FDE');
  assert.ok(grip.swatch.colors.length, 'a colour to draw');
  // A saved option that is no longer live: the page may show the photo the
  // snapshot carried, but the image never fetches a URL a guide's author wrote.
  const gone = { ...ROW, parts_snapshot: SNAPSHOT.map((p) => (p.refId === P.fr
    ? { ...p, variantId: 'v-retired', imageUrl: 'https://attacker.test/x.png', variantColor: 'Black' } : p)) };
  const t = collageModel({ kind: 'curated', row: gone, variants: VARIANTS }, BC).tiles.find((x) => x.label === 'Grip Module');
  assert.equal(t.photo, null);
});

test('a collage with "+N", a long title and only swatches still renders 1200x630', async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ category: 'misc', brand: 'B', name: 'Thing ' + i }));
  const row = { ...ROW, title: 'An extremely long guide title that has to wrap across several lines and still be cut cleanly somewhere',
                parts_snapshot: SNAPSHOT.concat(many) };
  stub(world({ row }));
  const res = await get(currentPath(row));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gg-og'), 'rendered');
  assert.deepEqual(pngSize(Buffer.from(await res.arrayBuffer())), { w: GG_OG_W, h: GG_OG_H });
});

// ── the page that names it ────────────────────────────────────────────────
test('the /gg/ page names exactly the image URL the function answers 200 on', async () => {
  stub(world());
  const html = await (await share(new Request(SITE + '/gg/' + ID))).text();
  const img = (html.match(/property="og:image" content="([^"]+)"/) || [])[1];
  assert.ok(img.startsWith(SITE + '/gg-og/'), img);
  assert.equal(img, SITE + currentPath());
  const res = await handler(new Request(img));
  assert.equal(res.status, 200, 'not a 301: the page and the image agree on the hash');
  assert.equal(res.headers.get('x-gg-og'), 'rendered');
});

test('when the collage cannot be named, the page declares og-default.png at its real size', async () => {
  const found = { kind: 'curated', row: ROW };
  const failing = await shareImageFor(found, VARIANTS, { loadCategories: async () => null });
  assert.deepEqual([failing.url, failing.w, failing.h, failing.type, failing.collage], [OG_DEFAULT_URL, 1200, 630, 'image/png', false]);
  const throwing = await shareImageFor(found, VARIANTS, { loadCategories: async () => { throw new Error('boom'); } });
  assert.equal(throwing.url, OG_DEFAULT_URL);
  const ok = await shareImageFor(found, VARIANTS);
  assert.equal(ok.url, SITE + currentPath());
  assert.deepEqual([ok.w, ok.h, ok.type], [GG_OG_W, GG_OG_H, 'image/png']);
});
