// Gun Guides buy rows — the open guide sells every catalog part honestly:
// a fresh partner price shows, a stale one reads "Check price" and never
// falls back to MSRP, a maker-only part gets its /go/part/<id> button, a
// discontinued part keeps its mark and is never sold, and the SAVED
// option's listing is the one shown — never a sibling option's price as if
// it were this one. The total under the list is js/build-total.js's number
// (the same one a build's page shows), and the one disclosure line says
// what is true of the buttons above it.
//
// WHY: every one of those fails silently in a browser — a buy row showing
// the wrong option's price, or a stale number wearing a fresh face, renders
// perfectly — which is the entry criterion for scripts/check-all.sh.
//
// This runs the REAL code: js/affiliate.js (its real query-shape ingestion
// through loadFor over a stubbed supabase), js/maker-link.js,
// js/option-price.js, js/build-total.js, and the page's own inline script.
//
// Run: node --test scripts/gun-guide-buy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// A never-settling query chain, so the page's own loadAll() stalls and the
// test drives the renderers itself (same harness as guide-part-order).
const pending = () => {
  const q = { then() {} };
  for (const m of ['select', 'order', 'eq', 'in', 'is', 'limit']) q[m] = () => q;
  return q;
};
// A chain that resolves to the given rows at any await point — what
// affiliate.loadFor's one query gets back.
const sbRows = (data) => {
  const q = { then(resolve) { resolve({ data, error: null }); } };
  for (const m of ['select', 'order', 'eq', 'in', 'is', 'limit']) q[m] = () => q;
  return { from: () => q };
};
const element = () => ({
  hidden: false, innerHTML: '', onclick: null, dataset: {},
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
});

function loadContext() {
  // URL: js/maker-link.js parses hosts with it, and without it every maker
  // link silently evaluates to null — exactly the failure shape this suite
  // exists to catch, so the harness must not manufacture it.
  const ctx = { console, URL };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/category-map.js', 'js/build-categories.js', 'js/display-name.js',
    'js/variant-label.js', 'js/variant-swatch.js', 'js/maker-link.js', 'js/option-price.js',
    'js/affiliate.js', 'js/build-total.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const html = read('gunforma-gun-guides.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const page = scripts.find((s) => s.includes('GUN GUIDES'));
  assert.ok(page, 'found the Gun Guides inline script');
  ctx.sb = { from: pending };
  ctx.document = { getElementById: element, querySelector: () => null, querySelectorAll: () => [] };
  vm.runInContext(page, ctx, { filename: 'gunforma-gun-guides.html <script>' });
  return ctx;
}

const TODAY = new Date().toISOString().slice(0, 10);
const fresh = { last_checked: TODAY, op_last_matched_by: 'awin-v2' };
const products = (category, url, maker, site, disc = false) => ({
  category, url, is_discontinued: disc,
  manufacturers: { name: maker, website_url: site },
});

// The rows the one listings read returns (js/affiliate.js's select shape).
const ROWS = [
  // One option, one FRESH partner listing.
  { id: 'v-opt', product_id: 'opt', variant_label: 'Black', color: 'Black', is_default: true, msrp: 349.99,
    products: products('optic', 'https://holosun.com/507k', 'Holosun', 'https://holosun.com'),
    affiliate_links: [{ id: 'L-opt', url: 'https://shop.test/opt', affiliate_url: null, street_price: 299.99,
      in_stock: true, ...fresh, partners: { name: 'OpticsPlanet (Awin)' } }] },
  // One option, one STALE listing: a price, a date, but never feed-matched.
  { id: 'v-sl', product_id: 'sl', variant_label: 'Black', color: 'Black', is_default: true, msrp: 429.99,
    products: products('slide', 'https://greyghost.test/slide', 'Grey Ghost Precision', 'https://greyghost.test'),
    affiliate_links: [{ id: 'L-sl', url: 'https://shop.test/sl', affiliate_url: null, street_price: 379.99,
      in_stock: true, last_checked: TODAY, op_last_matched_by: null, partners: { name: 'Brownells' } }] },
  // Maker-only: no listing at all, a usable products.url on the maker's own host.
  { id: 'v-bar', product_id: 'bar', variant_label: 'Gold', color: 'Gold', is_default: true, msrp: 189,
    products: products('barrel', 'https://norsso.com/p365-barrel', 'Norsso', 'https://norsso.com'),
    affiliate_links: [] },
  // Two options, each with its own fresh listing; the guide saved the FDE one.
  { id: 'v-fr-blk', product_id: 'fr', variant_label: 'Black', color: 'Black', is_default: true, msrp: 109.99,
    products: products('frame', 'https://wilson.test/grip', 'Wilson Combat', 'https://wilson.test'),
    affiliate_links: [{ id: 'L-fr-blk', url: 'https://shop.test/fr-blk', affiliate_url: null, street_price: 99.99,
      in_stock: true, ...fresh, partners: { name: 'PartnerA' } }] },
  { id: 'v-fr-fde', product_id: 'fr', variant_label: 'FDE', color: 'FDE', is_default: false, msrp: 109.99,
    products: products('frame', 'https://wilson.test/grip', 'Wilson Combat', 'https://wilson.test'),
    affiliate_links: [{ id: 'L-fr-fde', url: 'https://shop.test/fr-fde', affiliate_url: null, street_price: 119.99,
      in_stock: true, ...fresh, partners: { name: 'PartnerB' } }] },
  // Discontinued — still carrying a fresh listing, which must never render.
  { id: 'v-disc', product_id: 'disc', variant_label: 'Black', color: 'Black', is_default: true, msrp: 59.99,
    products: products('basepad', 'https://x.test/pad', 'XBrand', 'https://x.test', true),
    affiliate_links: [{ id: 'L-disc', url: 'https://shop.test/disc', affiliate_url: null, street_price: 49.99,
      in_stock: true, ...fresh, partners: { name: 'OpticsPlanet (Awin)' } }] },
];

const PART = {
  fr:    { refId: 'fr', category: 'frame', brand: 'Wilson Combat', name: 'Grip', variantId: 'v-fr-fde' },
  sl:    { refId: 'sl', category: 'slide', brand: 'Grey Ghost Precision', name: 'Slide' },
  bar:   { refId: 'bar', category: 'barrel', brand: 'Norsso', name: 'Barrel', variantId: 'v-bar' },
  opt:   { refId: 'opt', category: 'optic', brand: 'Holosun', name: '507K', msrp: 349.99 },
  disc:  { refId: 'disc', category: 'basepad', brand: 'XBrand', name: 'Pad', slug: 'x-pad' },
  typed: { category: 'holsters', brand: 'Tier 1', name: 'Holster', pending: true },
};
const ALL = [PART.fr, PART.sl, PART.bar, PART.opt, PART.disc, PART.typed];

async function openCtx() {
  const ctx = loadContext();
  const rows = await ctx.affiliate.loadFor(sbRows(ROWS), ['opt', 'sl', 'bar', 'fr', 'disc']);
  ctx.LISTING_ROWS = rows;
  ctx.DISCONTINUED.disc = 1;
  return ctx;
}
const one = (ctx, part) => ctx.detailHtml({ id: 'g1', title: 'T', parts_snapshot: [part] });

test('loadFor hands back the raw rows — the one read feeds photos, buy rows and the total', async () => {
  const ctx = loadContext();
  const rows = await ctx.affiliate.loadFor(sbRows(ROWS), ['opt']);
  assert.equal(rows.length, ROWS.length, 'the resolved value is the raw rows');
  assert.equal(rows[0].id, 'v-opt');
  // Not deepEqual: arrays made inside the vm carry its Array prototype.
  const empty = await ctx.affiliate.loadFor(sbRows(ROWS), []);
  assert.ok(Array.isArray(empty) && empty.length === 0, 'no ids: empty, not undefined');
});

test('a fresh partner price shows, through /go/<link id>, sponsored', async () => {
  const ctx = await openCtx();
  const html = one(ctx, PART.opt);
  assert.match(html, /class="gdetail-buy"/);
  assert.match(html, /\$299\.99/);
  assert.match(html, /OpticsPlanet/);
  assert.match(html, /href="\/go\/L-opt"[^>]*rel="noopener sponsored nofollow"/);
  assert.match(html, /\$349\.99 MSRP/, 'the saved number is labelled for what it is');
});

test('a stale price reads "Check price" — never its number, never an MSRP fallback', async () => {
  const ctx = await openCtx();
  const html = one(ctx, PART.sl);
  assert.match(html, /class="gdetail-buy"/, 'the link still works');
  assert.match(html, /Check price/);
  assert.doesNotMatch(html, /\$379\.99/, 'the stale number is never stated');
  assert.doesNotMatch(html, /429\.99/, 'no MSRP fallback for a stale listing');
  assert.match(html, /href="\/go\/L-sl"/);
});

test('a maker-only part gets the /go/part/<id> button, unsponsored, with the saved option\'s MSRP', async () => {
  const ctx = await openCtx();
  const html = one(ctx, PART.bar);
  assert.match(html, /href="\/go\/part\/bar"[^>]*rel="noopener nofollow"/);
  assert.match(html, /Buy from Norsso/);
  assert.match(html, /MSRP \$189\.00/);
  assert.doesNotMatch(html, /sponsored/, 'nobody pays for a maker link');
});

test('a discontinued part: no buy row, mark kept, /parts/ page linked', async () => {
  const ctx = await openCtx();
  const html = one(ctx, PART.disc);
  assert.doesNotMatch(html, /gdetail-buy/, 'never sold, even with a live listing');
  assert.doesNotMatch(html, /\/go\//);
  assert.match(html, /Discontinued/);
  assert.match(html, /href="\/parts\/basepads\/x-pad"/);
});

test('a typed part (no refId) gets no buy row', async () => {
  const ctx = await openCtx();
  assert.doesNotMatch(one(ctx, PART.typed), /gdetail-buy|\/go\//);
});

test('the SAVED option\'s listing is the one shown — never a sibling\'s', async () => {
  const ctx = await openCtx();
  const html = one(ctx, PART.fr);                       // saved: FDE at $119.99
  assert.match(html, /\$119\.99/);
  assert.match(html, /href="\/go\/L-fr-fde"/);
  assert.doesNotMatch(html, /\$99\.99/, 'the cheaper sibling option never stands in');
  assert.doesNotMatch(html, /L-fr-blk/);
  // No saved option (a curated guide): the product block, "From" the lowest.
  const noSel = one(ctx, { ...PART.fr, variantId: undefined });
  assert.match(noSel, /From \$99\.99/);
  // A saved option that is gone (retired): fall back to the product block,
  // the way the catalog panel does.
  const goneSel = one(ctx, { ...PART.fr, variantId: 'v-gone' });
  assert.match(goneSel, /From \$99\.99/);
  // A maker-only part whose saved option is gone: "Check price", never a
  // sibling option's MSRP as if it were this one.
  const goneMaker = one(ctx, { ...PART.bar, variantId: 'v-gone' });
  assert.match(goneMaker, /Check price/);
  assert.doesNotMatch(goneMaker, /MSRP \$189/);
});

test('the total is js/build-total.js\'s number — the same one a build\'s page shows', async () => {
  const ctx = await openCtx();
  const html = ctx.detailHtml({ id: 'g1', title: 'T', parts_snapshot: ALL });
  // fr 99.99 (cheapest fresh across options) + bar 189 (MSRP, no listing)
  // + opt 299.99 + disc 49.99 (the build rule prices it; the guide just
  // doesn't sell it) = 638.97 → "$639+", a floor: sl (stale) and the typed
  // part priced to nothing.
  const expect = ctx.priceTotalText(ctx.buildPriceTotal(ALL, ctx.LISTING_ROWS));
  assert.equal(expect, '$639+', 'the fixture prices to a floor');
  assert.match(html, /Total at today’s prices: <strong>\$639\+<\/strong>/);
});

test('one disclosure line for the whole guide, saying what is true of its buttons', async () => {
  const ctx = await openCtx();
  const mixed = ctx.detailHtml({ id: 'g1', title: 'T', parts_snapshot: ALL });
  assert.equal((mixed.match(/gdetail-disclosure/g) || []).length, 1);
  assert.equal((mixed.match(/part-affiliate-disclosure/g) || []).length, 0, 'per-block disclosures are off');
  assert.ok(mixed.includes(ctx.esc(ctx.buyDisclosure(true, true))), 'partner + maker: the mixed line');
  const partnerOnly = ctx.detailHtml({ id: 'g1', parts_snapshot: [PART.opt] });
  assert.ok(partnerOnly.includes(ctx.esc(ctx.buyDisclosure(true, false))));
  const makerOnly = ctx.detailHtml({ id: 'g1', parts_snapshot: [PART.bar] });
  assert.ok(makerOnly.includes(ctx.esc(ctx.buyDisclosure(false, true))));
  const noneSellable = ctx.detailHtml({ id: 'g1', parts_snapshot: [PART.typed, PART.disc] });
  assert.doesNotMatch(noneSellable, /gdetail-disclosure/, 'nothing to disclose, no line');
});

test('the catalog panel is untouched: renderBlock without opts keeps its own disclosure', async () => {
  const ctx = await openCtx();
  const block = ctx.affiliate.renderBlock('opt', { selectedVariantId: undefined });
  assert.match(block, /part-affiliate-disclosure/);
  assert.match(block, /\$299\.99/);
});
