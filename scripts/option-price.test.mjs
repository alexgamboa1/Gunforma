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

test('every option at one price: the plain price, no "From" (Alex, 2026-10-30)', () => {
  const h = win.optionHeadline;
  const same = h([{ id: 'a', msrp: 199 }, { id: 'b', msrp: 199 }, { id: 'c', msrp: '199.00' }], null);
  assert.equal(same.kind, 'option');
  assert.equal(same.text, '$199.00');
  assert.equal(h([{ id: 'a', msrp: 199 }, { id: 'b', msrp: 209 }], null).text, 'From $199.00', 'two prices: From the lower');
  assert.equal(h([{ id: 'a', msrp: 199 }, { id: 'b', msrp: null }], null).text, 'From $199.00',
    'an option with no price keeps the "From": it could cost more');
  assert.equal(h([{ id: 'a', msrp: 199 }, { id: 'b', msrp: 199 }], 'b').text, '$199.00', 'a selection is unchanged');
});

test('optionPriceText: cents only when present; the MSRP label names the list price', () => {
  const t = win.optionPriceText, h = win.optionHeadline;
  assert.equal(t(h(opts, null)), 'From $449.99');
  assert.equal(t(h(opts, null), { msrp: true }), 'MSRP from $449.99');
  assert.equal(t(h([{ id: 'a', msrp: 189 }], null), { msrp: true }), 'MSRP $189');
  assert.equal(t(h([{ id: 'a', msrp: 189 }, { id: 'b', msrp: 189 }], null), { msrp: true }), 'MSRP $189', 'same price: no "from"');
  assert.equal(t(h(opts, 'v-black-gold'), { msrp: true }), 'Check price', 'no number is never labelled');
  assert.equal(t(h([{ id: 'a', msrp: 353 }], null)), '$353');
  assert.equal(t(null), 'Check price');
});

// ── the catalog buy box, run through affiliate.js ──────────────────────────
const MAKER_PRODUCT = {
  category: 'frame', url: 'https://icarusprecision.com/axg-fuse', is_discontinued: false,
  manufacturers: { name: 'Icarus Precision', website_url: 'https://icarusprecision.com' },
};
const today = new Date().toISOString().slice(0, 10);
const SAME = 'same-price';
const RETAIL = 'retail-product';
const RETAIL_PRODUCT = { category: 'optic', url: 'https://maker.example/optic', is_discontinued: false,
  manufacturers: { name: 'Maker', website_url: 'https://maker.example' } };
const link = (id, price, partner) => ({ id, url: 'https://shop/' + id, affiliate_url: null, street_price: price,
  in_stock: true, last_checked: today, op_last_matched_by: 'stored_op_mpn', partners: { name: partner } });
const ROWS = [
  ...OPTIONS.map((o) => ({ id: o.id, product_id: AXG, variant_label: null, color: o.color, finish: 'Anodized',
    manual_safety_variant: o.manual_safety_variant, is_default: !!o.is_default, primary_image_url: null,
    msrp: o.msrp, products: MAKER_PRODUCT, affiliate_links: [] })),
  ...['Black', 'FDE'].map((c) => ({ id: 's-' + c, product_id: SAME, variant_label: null, color: c, finish: null,
    is_default: c === 'Black', primary_image_url: null, msrp: 199, products: MAKER_PRODUCT, affiliate_links: [] })),
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
await win.affiliate.loadFor(sb, [AXG, SAME, RETAIL]);
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
  const same = headline(win.affiliate.renderBlock(SAME));
  assert.match(same, /MSRP \$199\.00/, 'every option at one price: the plain MSRP');
  assert.doesNotMatch(same, /From/);
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

// ── the cards: the page's own functions, run ───────────────────────────────
// A card never has an option picked, so it shows the panel's OPENING headline:
// several options → "From $<lowest>", one option → its price, none priced →
// "Check price". The Armory's picked card is a picked option: its own price,
// or "Check price". Each function is lifted out of the page by name and run
// against the real shared modules, so a card that goes back to reading the
// default option's MSRP fails here.
function liftFn(src, name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at !== -1, 'function ' + name + ' not found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(at + 1, i + 1);
}
function pageScope(page, fns, extra) {
  const src = read(page);
  const scope = {};
  for (const f of ['js/category-map.js', 'js/variant-label.js', 'js/variant-swatch.js', 'js/display-name.js', 'js/option-price.js']) {
    new Function('window', read(f))(scope);
  }
  const body = fns.map((n) => liftFn(src, n)).join('\n') +
    '\nreturn {' + fns.join(',') + ', window: window};';
  return new Function('window', ...Object.keys(extra), 'with (window) {' + body + '}')(scope, ...Object.values(extra));
}
const cardPrice = (html, cls) => (html.match(new RegExp('<(?:div|span) class="' + cls + '( na)?">([^<]*)<')) || []).slice(1);
const axgVariants = OPTIONS.map((o) => ({ id: o.id, msrp: o.msrp, color: o.color, is_default: !!o.is_default }));

test('catalog grid card: "From $<lowest>" until an option is picked, the same number as its panel', () => {
  const page = pageScope('gunforma-parts-catalog.html',
    ['cardHeadline', 'renderCard', 'swatchFallbackHtml', 'partCatLabel', 'esc', 'escAttr'],
    { FAVORITES: new Set(), PART_TYPES: {} });
  const card = (variants, lowest) => {
    const h = page.cardHeadline(variants, lowest);
    return { h, price: cardPrice(page.renderCard({ id: 'x', slug: 'part', name: 'Part', brand: 'Brand', category: 'frame',
      variants, price: h.amount, priceHeadline: h }), 'part-card-price') };
  };
  // AXG FUSE: six options, default is Black / Hogue; the card prints the lowest.
  const axg = card(axgVariants);
  assert.deepEqual(axg.price, [undefined, 'From $449.99'], 'several options: From the lowest, cents kept');
  assert.equal(axg.h.amount, 449.99, 'sort and the price filter read the same number');
  // A default option that is NOT the cheapest — the card used to print the default's MSRP.
  const pricier = card([{ id: 'a', msrp: 399.99, is_default: true }, { id: 'b', msrp: 349.99 }]);
  assert.deepEqual(pricier.price, [undefined, 'From $349.99'], 'never the default option\'s number when a cheaper one exists');
  assert.deepEqual(card([{ id: 'a', msrp: 129, is_default: true }]).price, [undefined, '$129'], 'one option: its plain price');
  assert.deepEqual(card([{ id: 'a', msrp: null }, { id: 'b', msrp: null }]).price, [' na', 'Check price'], 'nothing priced');
  assert.deepEqual(card([], 89.5).price, [undefined, '$89.50'], 'no option rows: the product-level price');
  assert.deepEqual(card([], null).price, [' na', 'Check price']);
  assert.deepEqual(card([{ id: 'a', msrp: 199 }, { id: 'b', msrp: 199 }]).price, [undefined, '$199'],
    'every option at one price: plain, no "From"');
  // The panel opens on the same text the card shows.
  const src = read('gunforma-parts-catalog.html');
  assert.match(src, /priceEl\.textContent = window\.optionPriceText\(headline,\s*\{ msrp: !!\(panelAff && panelAff\.partnerCount\) && variants\.length > 0 \}\);/,
    'the panel prints through the same formatter, labelled MSRP beside a retailer listing as the card is');
  assert.match(src, /var priceHeadline = cardHeadline\(variants, r\.lowest_price\);\s*var price = priceHeadline\.amount;/,
    'the product row\'s price (sort, filter) is the card\'s headline');
});

test('catalog retailer card: the price line is labelled MSRP beside the live retailer price', () => {
  const page = pageScope('gunforma-parts-catalog.html',
    ['cardHeadline', 'renderCard', 'swatchFallbackHtml', 'partCatLabel', 'esc', 'escAttr'],
    { FAVORITES: new Set(), PART_TYPES: {} });
  const HERO = '<div class="part-affiliate-hero">$161.99 Buy at OpticsPlanet</div>';
  const card = (variants, lowest, listed) => {
    page.window.affiliate = { renderHero: () => (listed ? HERO : '') };
    const h = page.cardHeadline(variants, lowest);
    const html = page.renderCard({ id: 'x', slug: 'part', name: 'Part', brand: 'Brand', category: 'barrel',
      variants, price: h.amount, priceHeadline: h });
    return { price: cardPrice(html, 'part-card-price'), hero: html.includes(HERO) };
  };
  const cport = [{ id: 'a', msrp: 209, is_default: true }, { id: 'b', msrp: 189 }];
  const retail = card(cport, null, true);
  assert.deepEqual(retail.price, [undefined, 'MSRP from $189'], 'several options beside a retailer: "MSRP from"');
  assert.ok(retail.hero, 'the retailer row stays on the card');
  assert.deepEqual(card([{ id: 'a', msrp: 189 }, { id: 'b', msrp: 189 }], null, true).price, [undefined, 'MSRP $189'],
    'same price beside a retailer: "MSRP $X"');
  assert.deepEqual(card(cport, null, false).price, [undefined, 'From $189'], 'a maker-only card carries one number and no label');
  assert.deepEqual(card([], 89.5, true).price, [undefined, '$89.50'],
    'the no-options fallback is a repricing-job price, not MSRP, and is never labelled MSRP');
});

test('builder picker (js/part-picker.js): cards and selected rows follow the rule', () => {
  const pw = { document: null, addCatalogPart() {}, removePart() {}, pickVariant() {}, cancelVariantPick() {} };
  for (const f of ['js/variant-label.js', 'js/variant-swatch.js', 'js/display-name.js', 'js/option-price.js']) {
    new Function('window', read(f))(pw);
  }
  pw.document = { getElementById: () => null, createElement: () => ({ setAttribute() {}, set textContent(_) {} }),
    head: { appendChild() {} } };
  new Function('window', 'document', read('js/part-picker.js'))(pw, pw.document);
  const item = { id: 'axg', brand: 'Icarus Precision', name: 'AXG FUSE', desc: '', image: null,
    price: 519.99, variants: axgVariants };
  const same = { id: 'same', brand: 'B', name: 'Same', desc: '', image: null, price: 199,
    variants: [{ id: 's1', msrp: 199, is_default: true }, { id: 's2', msrp: 199 }] };
  pw.PartPicker.init({ catalog: () => ({ frame: [item, same] }), state: () => ({ parts: [] }), render() {} });
  const price = (html, cls) => (html.match(new RegExp('<div class="' + cls + '">([^<]*)<')) || [])[1];
  assert.equal(price(pw.PartPicker.partCardHtml('frame', item), 'part-card-price'), 'From $449.99',
    'picker card: From the lowest, not the item-level default price');
  assert.equal(price(pw.PartPicker.partCardHtml('frame', same), 'part-card-price'), '$199', 'same price: plain');
  const row = (variantId) => price(pw.PartPicker.selectedPartHtml({ uid: 'u', refId: 'axg', category: 'frame',
    brand: 'Icarus Precision', name: 'AXG FUSE', variantId }), 'selected-part-price');
  assert.equal(row('v-fde-gold'), '$584.99', 'selected row: the chosen option\'s own price');
  assert.equal(row('v-black-gold'), 'Check price', 'chosen option with no price: no number');
  assert.equal(row(undefined), 'From $449.99', 'a part saved before variants reads like a card');
  for (const page of ['gunforma-post-build.html', 'gunforma-admin-post.html']) {
    const src = read(page);
    assert.ok(src.indexOf('src="js/option-price.js"') !== -1 && src.indexOf('src="js/option-price.js"') < src.indexOf('src="js/part-picker.js"'),
      page + ' loads js/option-price.js before js/part-picker.js');
  }
});

test('profile Favorite parts card follows the rule', () => {
  const page = pageScope('gunforma-profile.html', ['renderFavoritePartCard', 'escH'], {});
  const fav = (variants) => (page.renderFavoritePartCard({ id: 'x', name: 'Part', manufacturers: { name: 'Brand' },
    product_variants: variants }).match(/<div class="part-card-price">([^<]*)</) || [])[1];
  assert.equal(fav(axgVariants), 'From $449.99', 'several options: From the lowest, not the default\'s');
  assert.equal(fav([{ msrp: 199, is_default: true }, { msrp: 199 }]), '$199', 'same price: plain');
  assert.equal(fav([{ msrp: 79.99, is_default: true }]), '$79.99');
  assert.equal(fav([{ msrp: null, is_default: true }]), 'Check price', 'no price: the one wording, not an em dash');
});

test('Armory part cards: "From $<lowest>" on a picker card; the picked card follows the picked option', () => {
  const STATE = { picks: {} };
  const page = pageScope('gunforma-armory.html',
    ['partCardHtml', 'pickedHtml', 'optionPrices', 'fitTagHtml', 'esc', 'escAttr', 'money'], { STATE });
  const p = { id: 'axg', brand: 'Icarus Precision', name: 'AXG FUSE', variants: axgVariants,
    defaultVariant: axgVariants[0] };
  assert.deepEqual(cardPrice(page.partCardHtml('grip', p), 'part-card-price'), [undefined, 'From $449.99']);
  const one = { id: 'one', brand: 'B', name: 'One', variants: [{ id: 'o', msrp: 79.99, is_default: true }] };
  one.defaultVariant = one.variants[0];
  assert.deepEqual(cardPrice(page.partCardHtml('grip', one), 'part-card-price'), [undefined, '$79.99'], 'one option: plain price');
  const picked = (variantId) => { STATE.picks.grip = { id: 'axg', variantId }; return cardPrice(page.pickedHtml('grip', p), 'picked-price'); };
  assert.deepEqual(picked('v-fde-gold'), [undefined, '$584.99'], 'FDE / Gold: its own price');
  assert.deepEqual(picked('v-black-hogue'), [undefined, '$449.99']);
  assert.deepEqual(picked('v-black-gold'), [' na', 'Check price'], 'picked option with no price: no number');
  assert.match(read('gunforma-armory.html'), /<script src="js\/option-price\.js"><\/script>/);
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
