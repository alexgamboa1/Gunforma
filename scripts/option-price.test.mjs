// A part's headline price follows the selected option — and a retailer
// listing's headline does not move at all.
//
// WHY: on a maker-only product the catalog's buy box showed the FIRST
// option alphabetically whatever was selected. The Icarus AXG FUSE read
// "MSRP $519.99" (Black / Black) with FDE / Gold ($584.99) selected; its
// cheapest option is $449.99. Nothing failed — it rendered a real price, for
// the wrong option. Alex's rule (2026-10-30), held once in js/option-price.js:
//   selected → that option's price; nothing selected → "From $<lowest>";
//   selected option with no price → no number, "Check price".
//
// This runs the real modules (option-price.js, and affiliate.js against a
// stubbed PostgREST reply shaped like the AXG FUSE's real rows) and reads the
// buy box's headline. It also pins the wiring on the two pages and the one
// no-price wording.
//
// Run: node --test scripts/option-price.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// Loaded the way a page loads them: classic scripts against one global.
const win = {};
for (const f of ['js/variant-label.js', 'js/maker-link.js', 'js/option-price.js', 'js/affiliate.js']) {
  new Function('window', read(f))(win);
}

// The AXG FUSE's real options and MSRPs (read 2026-10-30), a representative
// subset: the default Black / Hogue is also the cheapest; Black / Gold
// without a safety has no MSRP (waived, no_msrp_ok).
const AXG = 'axg-fuse';
const OPTIONS = [
  { id: 'v-black-hogue', color: 'Black/Hogue', manual_safety_variant: false, msrp: 449.99, is_default: true },
  { id: 'v-black-hogue-ms', color: 'Black/Hogue', manual_safety_variant: true, msrp: 459.99 },
  { id: 'v-black-black', color: 'Black/Black', manual_safety_variant: false, msrp: 519.99 },
  { id: 'v-fde-gold', color: 'FDE/Gold', manual_safety_variant: false, msrp: 584.99 },
  { id: 'v-black-gold-ms', color: 'Black/Gold', manual_safety_variant: true, msrp: 594.99 },
  { id: 'v-black-gold', color: 'Black/Gold', manual_safety_variant: false, msrp: null },
];
const opts = OPTIONS.map((o) => ({ id: o.id, msrp: o.msrp }));

test('optionHeadline: selected, nothing selected, selected with no price', () => {
  const h = win.optionHeadline;
  assert.equal(h(opts, null).text, 'From $449.99', 'nothing selected: From the lowest priced option');
  assert.equal(h(opts, undefined).kind, 'from');
  assert.equal(h(opts, 'v-black-hogue').text, '$449.99');
  assert.equal(h(opts, 'v-fde-gold').text, '$584.99', 'FDE / Gold shows its own price');
  assert.equal(h(opts, 'v-black-black').text, '$519.99');
  const none = h(opts, 'v-black-gold');
  assert.equal(none.kind, 'check');
  assert.equal(none.text, 'Check price', 'a selected option with no price states no number');
  assert.equal(none.amount, null);
  assert.equal(h(opts, 'v-retired').kind, 'check', 'a selected option that is gone is not a sibling');
  assert.equal(h([{ id: 'a', msrp: 99 }], null).text, '$99.00', 'one option: its price, no "From"');
  assert.equal(h([{ id: 'a', msrp: null }, { id: 'b', msrp: null }], null).text, 'Check price');
  assert.equal(h([], null).text, 'Check price');
  assert.equal(win.CHECK_PRICE, 'Check price');
});

// ── the catalog buy box, run through affiliate.js ──────────────────────────
const MAKER_PRODUCT = {
  category: 'frame', url: 'https://icarusprecision.com/axg-fuse', is_discontinued: false,
  manufacturers: { name: 'Icarus Precision', website_url: 'https://icarusprecision.com' },
};
const today = new Date().toISOString().slice(0, 10);
const RETAIL = 'retail-product';
const RETAIL_PRODUCT = { category: 'optic', url: 'https://maker.example/optic', is_discontinued: false,
  manufacturers: { name: 'Maker', website_url: 'https://maker.example' } };
const link = (id, price, partner) => ({ id, url: 'https://shop/' + id, affiliate_url: null, street_price: price,
  in_stock: true, last_checked: today, op_last_matched_by: 'stored_op_mpn', partners: { name: partner } });
const ROWS = [
  ...OPTIONS.map((o) => ({ id: o.id, product_id: AXG, variant_label: null, color: o.color, finish: 'Anodized',
    manual_safety_variant: o.manual_safety_variant, is_default: !!o.is_default, primary_image_url: null,
    msrp: o.msrp, products: MAKER_PRODUCT, affiliate_links: [] })),
  { id: 'r-black', product_id: RETAIL, variant_label: null, color: 'Black', finish: null, is_default: true,
    primary_image_url: null, msrp: 399.99, products: RETAIL_PRODUCT,
    affiliate_links: [link('l-a', 349.99, 'OpticsPlanet (Awin)'), link('l-b', 359.99, 'Brownells')] },
  { id: 'r-fde', product_id: RETAIL, variant_label: null, color: 'FDE', finish: null, is_default: false,
    primary_image_url: null, msrp: 419.99, products: RETAIL_PRODUCT, affiliate_links: [link('l-c', 379.99, 'OpticsPlanet (Awin)')] },
];
const sb = { from() {
  const q = { select: () => q, is: () => q, in: () => Promise.resolve({ data: ROWS, error: null }) };
  return q;
} };
await win.affiliate.loadFor(sb, [AXG, RETAIL]);
const headline = (block) => (block.match(/<div class="part-affiliate-info">([\s\S]*?)<\/div>/) || [])[1] || '';

test('maker-only buy box: the headline follows the selected option', () => {
  const box = (sel) => headline(win.affiliate.renderBlock(AXG, sel === undefined ? undefined : { selectedVariantId: sel }));
  assert.match(box(undefined), /From \$449\.99/, 'nothing selected');
  assert.match(box('v-black-hogue'), /MSRP \$449\.99/, 'Black / Hogue');
  const fde = box('v-fde-gold');
  assert.match(fde, /MSRP \$584\.99/, 'FDE / Gold');
  assert.doesNotMatch(fde, /519\.99/, 'never the first option\'s price');
  const noPrice = box('v-black-gold');
  assert.match(noPrice, /Check price/, 'Black / Gold, no safety: no price');
  assert.doesNotMatch(noPrice, /\$/, 'and no number at all — not another option\'s');
});

test('retailer-offer buy box: unchanged, whatever is selected', () => {
  const plain = win.affiliate.renderBlock(RETAIL);
  assert.equal(win.affiliate.renderBlock(RETAIL, { selectedVariantId: 'r-fde' }), plain);
  assert.equal(win.affiliate.renderBlock(RETAIL, { selectedVariantId: 'r-black' }), plain);
  assert.equal(headline(plain),
    '<span class="part-affiliate-price">From $349.99</span><span class="part-affiliate-range">up to $379.99</span>' +
    '<span class="part-affiliate-partner">at <strong>OpticsPlanet</strong><span class="part-affiliate-stock in">In stock</span></span>',
    'the retailer headline is the fresh-price range, as before');
});

// ── wiring on the pages that render it ─────────────────────────────────────
test('the catalog panel opens with nothing selected and passes the selection to the buy box', () => {
  const src = read('gunforma-parts-catalog.html');
  assert.match(src, /var DETAIL_STATE = \{ productId: null, activeVariantIdx: null \};/);
  assert.match(src, /DETAIL_STATE\.activeVariantIdx = null;\s*renderDetail\(p\);/, 'openDetail resets to nothing selected');
  assert.match(src, /affiliate\.renderBlock\(p\.id, \{ selectedVariantId: activeV \? activeV\.id : undefined \}\)/);
  assert.match(src, /window\.optionHeadline\(variants\.map/, 'the panel price uses the shared rule');
});

test('the build page\'s maker-only row uses the shared rule', () => {
  const src = read('gunforma-build-detail.html');
  assert.match(src, /var head = window\.optionHeadline\(/);
});

test('one wording for no price: "Check price" — never "Price N/A" or "Price n/a"', () => {
  const files = [
    ...readdirSync(ROOT).filter((f) => f.endsWith('.html')),
    ...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f),
    ...readdirSync(join(ROOT, 'netlify/functions')).filter((f) => f.endsWith('.mjs')).map((f) => 'netlify/functions/' + f),
  ];
  const hits = files.filter((f) => /price\s*n\/a/i.test(read(f)));
  assert.deepEqual(hits, [], 'files still saying "Price N/A": ' + hits.join(', '));
});
