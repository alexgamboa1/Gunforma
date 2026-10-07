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
for (const f of ['js/variant-label.js', 'js/maker-link.js', 'js/affiliate.js']) {
  new Function('window', await readFile(join(ROOT, f), 'utf8'))(win);
}

const PRODUCT    = '04628757-d54f-4bba-b288-435b7bb74351';
// A part with no partner listing on any colour, and a url: every row is a
// maker row (Icarus's own site, so "Buy from Icarus Precision").
const MAKER_ONLY = '11111111-1111-4111-8111-111111111111';
// A part with no partner listing and no url: no entry at all, as before.
const NO_URL     = '22222222-2222-4222-8222-222222222222';
const today = new Date().toISOString().slice(0, 10);

// The products embed for the mixed product: a url on the maker's own site.
const MIXED_PRODUCT = {
  category: 'slide', url: 'https://www.norsso.com/p365-slide', is_discontinued: false,
  manufacturers: { name: 'Norsso', website_url: 'https://norsso.com' },
};

// Shaped exactly like the real select: variants, each with embedded
// affiliate_links, each with an embedded partner.
const ROWS = [
  { id: 'v-black-dlc', product_id: PRODUCT, variant_label: null, color: 'Black', finish: 'DLC',
    is_default: true, primary_image_url: 'https://img/black-dlc.jpg', products: { category: 'slide' },
    affiliate_links: [{ id: 'l-black-dlc', url: 'https://shop/black-dlc', affiliate_url: 'https://aff/black-dlc',
      street_price: 375.25, in_stock: true, last_checked: today, op_last_matched_by: 'stored_op_mpn',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  { id: 'v-black-nit', product_id: PRODUCT, variant_label: null, color: 'Black', finish: 'Nitride',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ id: 'l-black-nit', url: 'https://shop/black-nit', affiliate_url: null,
      street_price: 318.99, in_stock: true, last_checked: today, op_last_matched_by: 'stored_op_mpn',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // Stale: a feed matched it once, but not inside the window. Must not price.
  { id: 'v-fde', product_id: PRODUCT, variant_label: null, color: 'FDE', finish: 'Cerakote',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ id: 'l-fde', url: 'https://shop/fde', affiliate_url: null,
      street_price: 999.99, in_stock: true, last_checked: '2020-01-01', op_last_matched_by: 'stored_op_mpn',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // Never feed-verified: op_last_matched_by null. Also must not price, even
  // though last_checked is today — that is the whole point of the rule.
  { id: 'v-gold', product_id: PRODUCT, variant_label: null, color: 'Gold', finish: 'TiN',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ id: 'l-gold', url: 'https://shop/gold', affiliate_url: null,
      street_price: 1.00, in_stock: true, last_checked: today, op_last_matched_by: null,
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // A hand-set override wins over color/finish.
  { id: 'v-override', product_id: PRODUCT, variant_label: '2 MOA Red Dot', color: 'Black', finish: 'DLC',
    is_default: false, primary_image_url: null, products: { category: 'slide' },
    affiliate_links: [{ id: 'l-ovr', url: 'https://shop/ovr', affiliate_url: null,
      street_price: 400.00, in_stock: false, last_checked: today, op_last_matched_by: 'stored_op_gtin',
      partners: { name: 'OpticsPlanet (Awin)' } }] },
  // The MIXED case: a colour with no listing on a product that has one on
  // other colours. Used to be dropped; now a maker row, sorted last.
  { id: 'v-odg-maker', product_id: PRODUCT, variant_label: null, color: 'ODG', finish: 'Cerakote',
    is_default: false, primary_image_url: null, msrp: 415, products: MIXED_PRODUCT,
    affiliate_links: [] },

  // MAKER-ONLY: two colours, no listing on either, url on the maker's site.
  { id: 'v-mo-black', product_id: MAKER_ONLY, variant_label: null, color: 'Black', finish: null,
    is_default: true, primary_image_url: null, msrp: 379.99,
    products: { category: 'frame', url: 'https://www.icarusprecision.com/evo', is_discontinued: false,
                manufacturers: { name: 'Icarus Precision', website_url: 'https://icarusprecision.com' } },
    affiliate_links: [] },
  { id: 'v-mo-fde', product_id: MAKER_ONLY, variant_label: null, color: 'FDE', finish: null,
    is_default: false, primary_image_url: null, msrp: null,
    products: { category: 'frame', url: 'https://www.icarusprecision.com/evo', is_discontinued: false,
                manufacturers: { name: 'Icarus Precision', website_url: 'https://icarusprecision.com' } },
    affiliate_links: [] },

  // NO URL: nothing to link to. Must produce no entry, exactly as before.
  { id: 'v-nourl', product_id: NO_URL, variant_label: null, color: 'Black', finish: null,
    is_default: true, primary_image_url: null, msrp: 120,
    products: { category: 'light', url: null, is_discontinued: false,
                manufacturers: { name: 'Streamlight', website_url: 'https://www.streamlight.com' } },
    affiliate_links: [] },
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
  assert.equal(aff.listings.length, 6);
  assert.equal(aff.partnerCount, 5);
  assert.equal(aff.makerCount, 1);

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
  // The destination is still resolved the same way; what changed is that the
  // BUTTON points at the click layer rather than at the retailer.
  assert.equal(aff.hero.goUrl, '/go/l-black-nit');
});

test('both renderers produce markup with nothing undefined in it', async () => {
  await win.affiliate.loadFor(sb, [PRODUCT]);
  for (const fn of ['renderHero', 'renderBlock']) {
    const html = win.affiliate[fn](PRODUCT);
    assert.ok(html && html.length > 40, `${fn} returned nothing`);
    assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${fn} leaked a placeholder`);
    assert.match(html, /rel="noopener sponsored nofollow"/, `${fn} lost the rel attributes`);
    // Every buy anchor goes through /go/. A renderer that emitted the retailer
    // URL directly would still sell the part and silently log nothing, which
    // is exactly the failure scripts/check-buy-links.mjs exists to refuse.
    for (const m of html.matchAll(/<a\b[^>]*nofollow[^>]*>/g)) {
      assert.match(m[0], /href="\/go\//, `${fn} emitted a buy link that bypasses /go/: ` + m[0].slice(0, 110));
    }
  }
  const block = win.affiliate.renderBlock(PRODUCT);
  assert.match(block, /Black \/ Nitride/, 'renderBlock did not print variant labels');
  assert.match(block, /Black \/ DLC/);
});

// ── maker rows: the unpaid link for a colour or a part with no listing ────

test('a mixed product keeps its partner hero and lists the unlisted colour last, as a maker row', async () => {
  await win.affiliate.loadFor(sb, [PRODUCT]);
  const aff = win.affiliate.get(PRODUCT);
  assert.equal(aff.hero.variantId, 'v-black-nit', 'the hero must stay the partner listing');
  const last = aff.listings[aff.listings.length - 1];
  assert.equal(last.variantId, 'v-odg-maker', 'maker rows sort after every partner row');
  assert.ok(last.maker, 'the unlisted colour did not become a maker row');
  assert.equal(last.goUrl, '/go/part/' + PRODUCT);
  assert.equal(last.url, null, 'a maker row must not carry a retailer url');
  assert.equal(last.maker.label, 'Buy from Norsso');
  // The range is still anchored on partner prices only.
  assert.equal(aff.minPrice, 318.99);

  const block = win.affiliate.renderBlock(PRODUCT);
  assert.match(block, /href="\/go\/part\/04628757-d54f-4bba-b288-435b7bb74351"/);
  assert.match(block, /ODG \/ Cerakote/);
  assert.match(block, /MSRP \$415\.00/, 'a maker row shows its MSRP, labelled');
  assert.match(block, /Gunforma may earn a commission on retailer links\. Links to a maker&#39;s own store earn us nothing\./,
    'mixed block must carry the mixed disclosure');
  // The maker anchor is nofollow and NOT sponsored; the partner anchors are
  // untouched.
  const makerTag = block.match(/<a\b[^>]*\/go\/part\/[^>]*>/)[0];
  assert.match(makerTag, /rel="noopener nofollow"/);
  assert.doesNotMatch(makerTag, /sponsored/);
  assert.match(makerTag, /target="_blank"/);
  assert.doesNotMatch(block, /No retailer/);
});

test('a maker-only product renders a block with no partner markup, and NO card hero', async () => {
  await win.affiliate.loadFor(sb, [MAKER_ONLY]);
  const aff = win.affiliate.get(MAKER_ONLY);
  assert.ok(aff, 'maker-only product was not cached');
  assert.equal(aff.partnerCount, 0);
  assert.equal(aff.makerCount, 2);
  assert.equal(aff.minPrice, null, 'MSRP must never enter the price range');
  // Grid cards stay as they are: no button for a maker-only part.
  assert.equal(win.affiliate.renderHero(MAKER_ONLY), '');

  const block = win.affiliate.renderBlock(MAKER_ONLY);
  assert.ok(block.length > 40, 'renderBlock returned nothing for a maker-only product');
  assert.doesNotMatch(block, /sponsored/, 'a maker-only block must not say sponsored anywhere');
  assert.match(block, /Buy from Icarus Precision ↗/);
  assert.match(block, /These links go straight to the seller&#39;s own store\. Gunforma earns nothing on them\./);
  assert.doesNotMatch(block, /may earn a commission/);
  assert.match(block, /MSRP \$379\.99/, 'the hero shows the MSRP when there is one');
  assert.match(block, /Check price/, 'a colour with no MSRP says so rather than inventing a number');
  assert.doesNotMatch(block, /No retailer/);
  for (const m of block.matchAll(/<a\b[^>]*nofollow[^>]*>/g)) {
    assert.match(m[0], /href="\/go\/part\//, 'maker button bypasses /go/part/: ' + m[0].slice(0, 110));
  }
});

test('a product with no listing and no url has no entry, so the panel falls back to renderEmpty', async () => {
  await win.affiliate.loadFor(sb, [NO_URL]);
  assert.equal(win.affiliate.get(NO_URL), null);
  assert.equal(win.affiliate.renderBlock(NO_URL), '');
  assert.equal(win.affiliate.renderHero(NO_URL), '');
  assert.match(win.affiliate.renderEmpty(), /No retailer listings/);
});

test('an unknown product returns null rather than throwing', () => {
  assert.equal(win.affiliate.get('00000000-0000-4000-8000-000000000000'), null);
  assert.equal(win.affiliate.renderHero('00000000-0000-4000-8000-000000000000'), '');
});
