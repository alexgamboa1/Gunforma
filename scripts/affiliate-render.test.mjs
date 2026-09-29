// Loads js/affiliate.js the way a page does and actually RUNS it — the loader,
// the label pass, the sort, and both renderers — against a stubbed PostgREST
// response.
//
// WHY THIS EXISTS
// Removing the shared label copy from this module left three orphaned
// references to `activeAxes`, a variable that no longer existed. Every static
// check passed: check-all.sh went green, the page loaded, all 231 catalog
// cards rendered. The module threw `ReferenceError: activeAxes is not defined`
// on the first call to loadFor() — which happens when a shopper opens a
// product's detail panel, so nothing at build or page-load time touches it.
//
// It was found by calling the function on a deploy preview. That should not
// have been the only way. This file is the cheap version of that: it executes
// the module's whole surface with no network and no DOM, so a dead reference
// or a renamed field fails the deploy instead of the buy row.
//
// The Supabase client is a stub — the point is not to test PostgREST, it is to
// prove every line of this module still runs and produces the labels, prices
// and markup the pages read.
//
// Run: node --test scripts/affiliate-render.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A page loads js/variant-label.js first, then js/affiliate.js, both as
// classic scripts against the same global. check-script-order.mjs is what
// enforces that ordering in the HTML; this mirrors it.
const win = {};
for (const f of ['js/variant-label.js', 'js/affiliate.js']) {
  new Function('window', await readFile(join(ROOT, f), 'utf8'))(win);
}

const PRODUCT = '04628757-d54f-4bba-b288-435b7bb74351';
const today = new Date().toISOString().slice(0, 10);

// Shaped exactly like the real select: variants, each with embedded
// affiliate_links, each with an embedded partner.
const ROWS = [
  { id: 'v-black-dlc', product_id: PRODUCT, variant_label: null, color: 'Black', finish: 'DLC',
    is_default: true, primary_image_url: 'https://img/black-dlc.jpg', products: { category: 'slide' },
    affiliate_links: [{ url: 'https://shop/black-dlc', affiliate_url: 'https://aff/black-dlc',
      street_price: 375.25, in_stock: true, last_checked: today, op_last_matched_by: 'stored_op_mpn',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  { id: 'v-black-nit', product_id: PRODUCT, variant_label: null, color: 'Black', finish: 'Nitride',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ url: 'https://shop/black-nit', affiliate_url: null,
      street_price: 318.99, in_stock: true, last_checked: today, op_last_matched_by: 'stored_op_mpn',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // Stale: a feed matched it once, but not inside the window. Must not price.
  { id: 'v-fde', product_id: PRODUCT, variant_label: null, color: 'FDE', finish: 'Cerakote',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ url: 'https://shop/fde', affiliate_url: null,
      street_price: 999.99, in_stock: true, last_checked: '2020-01-01', op_last_matched_by: 'stored_op_mpn',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // Never feed-verified: op_last_matched_by null. Also must not price, even
  // though last_checked is today — that is the whole point of the rule.
  { id: 'v-gold', product_id: PRODUCT, variant_label: null, color: 'Gold', finish: 'TiN',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ url: 'https://shop/gold', affiliate_url: null,
      street_price: 1.00, in_stock: true, last_checked: today, op_last_matched_by: null,
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // A hand-set override wins over color/finish.
  { id: 'v-override', product_id: PRODUCT, variant_label: '2 MOA Red Dot', color: 'Black', finish: 'DLC',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ url: 'https://shop/ovr', affiliate_url: null,
      street_price: 400.00, in_stock: false, last_checked: today, op_last_matched_by: 'stored_op_gtin',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
];

// Minimal chainable stub matching the calls affiliate.js makes.
const sb = {
  from() {
    const q = {
      select: () => q,
      is: () => q,
      in: () => Promise.resolve({ data: ROWS, error: null }),
    };
    return q;
  },
};

test('loadFor runs end to end and labels every listing', async () => {
  await win.affiliate.loadFor(sb, [PRODUCT]);
  const aff = win.affiliate.get(PRODUCT);
  assert.ok(aff, 'product was not cached');
  assert.equal(aff.listings.length, 5);

  const labels = aff.listings.map((l) => l.variantLabel);
  // This is the drift that shipped: the two Black variants MUST be
  // distinguishable, or a shopper sees one label at two prices.
  assert.ok(labels.includes('Black / DLC'), labels.join(' | '));
  assert.ok(labels.includes('Black / Nitride'), labels.join(' | '));
  assert.ok(labels.includes('2 MOA Red Dot'), 'variant_label override lost');
  assert.equal(new Set(labels).size, labels.length, 'two listings share a label: ' + labels.join(' | '));
  for (const l of labels) {
    assert.ok(!/undefined|\[object|NaN/.test(l), 'bad label: ' + l);
  }
});

test('the stale rule holds: neither a stale date nor an unverified price counts', async () => {
  await win.affiliate.loadFor(sb, [PRODUCT]);
  const aff = win.affiliate.get(PRODUCT);
  const by = (id) => aff.listings.find((l) => l.variantId === id);
  assert.equal(by('v-fde').stale, true,  'an old last_checked must be stale');
  assert.equal(by('v-gold').stale, true, 'op_last_matched_by null must be stale even with a fresh date');
  assert.equal(by('v-black-dlc').stale, false);
  // The range must never be anchored on a price nothing confirmed.
  assert.equal(aff.minPrice, 318.99, 'minPrice picked up a stale listing');
  assert.equal(aff.maxPrice, 375.25, 'maxPrice picked up a stale listing');
});

test('the hero is the listing whose price is displayed', async () => {
  await win.affiliate.loadFor(sb, [PRODUCT]);
  const aff = win.affiliate.get(PRODUCT);
  assert.equal(aff.hero.stale, false, 'hero is a stale listing');
  assert.equal(aff.hero.price, aff.minPrice, 'hero price and displayed minPrice disagree');
  // Cheapest fresh in-stock wins, and its URL is what the button uses.
  assert.equal(aff.hero.variantId, 'v-black-nit');
  assert.equal(aff.hero.url, 'https://shop/black-nit', 'falls back to url when affiliate_url is null');
});

test('both renderers produce markup with nothing undefined in it', async () => {
  await win.affiliate.loadFor(sb, [PRODUCT]);
  for (const fn of ['renderHero', 'renderBlock']) {
    const html = win.affiliate[fn](PRODUCT);
    assert.ok(html && html.length > 40, `${fn} returned nothing`);
    assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${fn} leaked a placeholder`);
    assert.match(html, /rel="noopener sponsored nofollow"/, `${fn} lost the rel attributes`);
  }
  const block = win.affiliate.renderBlock(PRODUCT);
  assert.match(block, /Black \/ Nitride/, 'renderBlock did not print variant labels');
  assert.match(block, /Black \/ DLC/);
});

test('an unknown product returns null rather than throwing', () => {
  assert.equal(win.affiliate.get('00000000-0000-4000-8000-000000000000'), null);
  assert.equal(win.affiliate.renderHero('00000000-0000-4000-8000-000000000000'), '');
});
