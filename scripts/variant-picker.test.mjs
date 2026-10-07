// Runs the picker's COLOR STEP and the swatch module for real, against a
// stubbed catalog — no DOM, no network.
//
// WHY: js/affiliate.js shipped a ReferenceError that every static check passed
// over, because nothing executed its loader. This is the same module family
// and the same risk: openColorStep() and variantListHtml() are only reached by
// a click, so a dead reference in either would survive check-all.sh, a page
// load, and a full render of 231 cards.
//
// It also pins the rules that are easy to regress silently:
//   • a single-variant product must NOT get a color step (81 of 231 products)
//   • order is default-first then by label, or the list reshuffles per request
//   • a variant with no photo gets a SWATCH, never a sibling's photo
//   • every color value in the live catalog resolves to something drawable
//
// Run: node --test scripts/variant-picker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Loaded in the order the pages load them, which check-script-order.mjs
// enforces in the HTML.
const win = { document: null };
for (const f of ['js/variant-label.js', 'js/variant-swatch.js']) {
  new Function('window', await readFile(join(ROOT, f), 'utf8'))(win);
}
// part-picker touches `document` at init only; the card layer does not.
win.document = {
  getElementById: () => null,        // "grid not open" — openColorStep bails
  createElement: () => ({ setAttribute() {}, set textContent(_) {} }),
  head: { appendChild() {} },
};
new Function('window', 'document', await readFile(join(ROOT, 'js/part-picker.js'), 'utf8'))(win, win.document);

const PP = win.PartPicker;

const v = (over = {}) => ({
  id: 'v-' + (over.color || 'x') + '-' + (over.finish || ''),
  is_default: false, color: 'Black', finish: 'DLC',
  primary_image_url: null, msrp: 100, variant_label: null, ...over,
});

const ONE = { id: 'p1', brand: 'B', name: 'N', variants: [v({ is_default: true })] };
const MANY = {
  id: 'p2', brand: 'True Precision', name: 'P365-FUSE',
  variants: [
    v({ color: 'Gold',  finish: 'TiN',  id: 'g' }),
    v({ color: 'Black', finish: 'DLC',  id: 'b', is_default: true, primary_image_url: 'https://img/black.jpg' }),
    v({ color: 'FDE',   finish: 'Cerakote', id: 'f' }),
  ],
};

test('a single-variant product gets no color step', () => {
  assert.equal(PP.hasColorChoice(ONE), false);
  assert.equal(PP.variantsOf(ONE).length, 1);
  // openColorStep must REFUSE, so the caller adds in one click. This is the
  // rule that keeps 81 of 231 products at their current single-click flow.
  assert.equal(PP.openColorStep('barrels', ONE), false);
});

test('a multi-variant product gets one, default first', () => {
  assert.equal(PP.hasColorChoice(MANY), true);
  const order = PP.variantsOf(MANY).map((x) => win.variantLabel(x));
  assert.equal(order[0], 'Black / DLC', 'default must sort first, got ' + order.join(' | '));
  // The rest alphabetical, so the list is stable across requests.
  assert.deepEqual(order.slice(1), ['FDE / Cerakote', 'Gold / TiN']);
});

test('the step renders one row per color, each with its own label and add call', () => {
  const html = PP.variantListHtml('barrels', MANY);
  const rows = html.match(/class="variant-row"/g) || [];
  assert.equal(rows.length, 3, 'expected 3 rows, got ' + rows.length);
  for (const label of ['Black / DLC', 'FDE / Cerakote', 'Gold / TiN']) {
    assert.ok(html.includes(label), 'missing label ' + label);
  }
  // Each row calls pickVariant with ITS OWN variant id, not the default's.
  for (const id of ['b', 'g', 'f']) {
    assert.ok(html.includes(`pickVariant('barrels','p2','${id}')`), 'no pickVariant for ' + id);
  }
  assert.ok(html.includes('Standard'), 'default row is not marked');
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html), 'placeholder leaked into the step');
});

test('photo when there is one, swatch when there is not — never a sibling photo', () => {
  const html = PP.variantListHtml('barrels', MANY);
  // Black has a photo.
  assert.ok(html.includes('https://img/black.jpg'), 'the photo it has is missing');
  // Exactly one <img>: the other two colors must NOT borrow it.
  const imgs = html.match(/<img /g) || [];
  assert.equal(imgs.length, 1, 'expected 1 img for 3 colors, got ' + imgs.length);
  // Counted with REAL quotes. The photo row also names the swatch inside its
  // onerror attribute — deliberately, so a dead image URL degrades to the same
  // honest answer as having no URL — and that copy is escaped (\&quot;), so it
  // does not match here. Matching loosely would have counted 3 and hidden
  // whichever of the two behaviours later broke.
  const rendered = html.match(/<span class="variant-media-swatch"/g) || [];
  assert.equal(rendered.length, 2, 'expected 2 rendered swatches, got ' + rendered.length);
  const fallbacks = html.match(/class=\\&quot;variant-media-swatch\\&quot;/g) || [];
  assert.equal(fallbacks.length, 1, 'the photo row lost its swatch fallback');
});

test('MSRP in the step is always labelled', () => {
  const html = PP.variantListHtml('barrels', MANY);
  const prices = html.match(/variant-row-price/g) || [];
  const tags   = html.match(/variant-row-msrp/g) || [];
  assert.equal(prices.length, tags.length,
    'every price in the picker is an MSRP and must carry the tag: ' + prices.length + ' prices, ' + tags.length + ' tags');
  // And a variant with no msrp prints no price rather than $0.00.
  const noMsrp = { id: 'p3', brand: 'B', name: 'N',
    variants: [v({ id: 'a', is_default: true, msrp: null }), v({ id: 'b2', color: 'Gold', msrp: null })] };
  assert.ok(!PP.variantListHtml('x', noMsrp).includes('$'), 'printed a price with no MSRP');
});

test('every color value in the live catalog resolves to something drawable', () => {
  // The full distinct set as measured 2026-09-29, with two-tone and the three
  // that are not colours at all.
  const REAL = ['Black','FDE','Gold','Gray','Copper','ODG','Satin Stainless Steel','Tan','Spectrum',
    'Stainless Steel','Black/Black','Stealth Gray','Coyote','Blue','Red','Green','Bronze/Black',
    'Sniper Gray','Silver','Gun Metal Gray','Midnight Bronze','Rose','Black/Cherry','Clear',
    'Desert Tan','Gray/Black','Gold/Black','Black/Hogue','Black/FDE','Hyena/Black','Matte Black',
    'Matte Rose Gold','Purple','Rainbow','Black/Gray','Red Bronze','Rose Gold','Black/Gold',
    'Tungsten','Black/Blue','Black Distressed','Tiger Stripe Gray','Coyote Tan','Coyote Bronze',
    'FDEB','Flat Black','Burnt Bronze','Gold/Blue','Gold/Gold','Gold/Gray','Gold/Red','Bronze',
    'Black/Red','Green/Black'];
  const unknown = REAL.filter((c) => win.variantSwatch(c).kind === 'unknown');
  assert.deepEqual(unknown, [], 'these colors render as a neutral chip: ' + unknown.join(', '));
  // Two-tone must SPLIT, not collapse to one fill — "Black/Cherry" read as
  // plain black while "Cherry" was unmapped.
  for (const c of ['Bronze/Black', 'Black/Cherry', 'Gold/Red', 'Hyena/Black']) {
    assert.equal(win.variantSwatch(c).kind, 'split', c + ' did not split');
  }
  // And the three that are not colours say so rather than picking one.
  for (const c of ['Spectrum', 'Rainbow']) assert.equal(win.variantSwatch(c).kind, 'iridescent', c);
  assert.equal(win.variantSwatch('Clear').kind, 'clear');
});

test('an unmapped color still renders, and still shows its label', () => {
  const s = win.variantSwatch('Unobtainium Teal');
  assert.equal(s.kind, 'unknown');
  assert.ok(s.css.length > 10, 'unknown must still be drawable');
  const html = win.variantMediaHtml({ color: 'Unobtainium Teal' }, 'variant-media');
  assert.ok(html.includes('variant-media-swatch'), 'unknown color rendered no swatch');
});

// ── The "your build" row for a part already added ──────────────────────────
// selectedPartHtml() renders from the part the page stored in
// addPartWithVariant(): imageUrl / variantLabel / variantColor are the CHOSEN
// variant's. The bug these pin: the row read the catalog item's image, which
// is the DEFAULT variant's, so every non-default pick showed the default.
const CATALOG = { barrels: [{ ...MANY, image: 'https://img/black.jpg', price: '299' }] };
const STATE = { parts: [] };
for (const fn of ['addCatalogPart', 'removePart', 'pickVariant', 'cancelVariantPick']) win[fn] = () => {};
PP.init({ catalog: () => CATALOG, state: () => STATE, render: () => {} });

const part = (over = {}) => ({ uid: 'p1', refId: 'p2', category: 'barrels',
  brand: 'True Precision', name: 'P365-FUSE', pending: false, ...over });
const imgSrcs = (html) => [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
const hasInput = (html) => html.includes('class="selected-part-variant"');

test('a chosen variant with a photo shows THAT photo, not the default', () => {
  const html = PP.selectedPartHtml(part({ variantId: 'gp', variantLabel: 'Gold / TiN',
    variantColor: 'Gold', variantFinish: 'TiN', imageUrl: 'https://img/gold.jpg' }));
  assert.deepEqual(imgSrcs(html), ['https://img/gold.jpg']);
  assert.ok(!html.includes('black.jpg'), 'the default variant photo leaked into the row');
});

test('a chosen variant shows its label and hides the free-text field', () => {
  const html = PP.selectedPartHtml(part({ variantId: 'g', variantLabel: 'Gold / TiN',
    variantColor: 'Gold', variantFinish: 'TiN', imageUrl: null }));
  assert.match(html, /<div class="selected-part-variant-label">Gold \/ TiN<\/div>/);
  assert.ok(!hasInput(html), 'free-text variant input still rendered next to a chosen variant');
  assert.ok(html.includes('$299'), 'price line lost');
});

test('a chosen variant with NO photo gets its swatch — never the default photo', () => {
  const html = PP.selectedPartHtml(part({ variantId: 'g', variantLabel: 'Gold / TiN',
    variantColor: 'Gold', variantFinish: 'TiN', imageUrl: null }));
  // The product HAS a default photo (black.jpg); the Gold row must not use it.
  assert.deepEqual(imgSrcs(html), [], 'a photo was rendered for a variant that has none');
  assert.match(html, /<span class="selected-part-thumb-swatch" style="background:#c2953f;"/,
    'expected the Gold swatch, same as the picker row draws');
  assert.ok(!html.includes('No photo'), 'fell back to the "No photo" box instead of the swatch');
});

test('a part with no chosen variant and no photo falls back to a swatch from variantColor', () => {
  const html = PP.selectedPartHtml(part({ refId: 'nope', variantColor: 'FDE' }));
  assert.deepEqual(imgSrcs(html), []);
  assert.ok(html.includes('class="selected-part-thumb-swatch"'), 'no swatch for a known colour');
});

test('a part with no variant at all keeps the default photo and the free-text field', () => {
  // e.g. hydrated from a snapshot that predates variants: no variantId, no label.
  const html = PP.selectedPartHtml(part({ variant: 'Coyote' }));
  assert.deepEqual(imgSrcs(html), ['https://img/black.jpg']);
  assert.ok(hasInput(html), 'the no-variant fallback lost its free-text field');
  assert.ok(html.includes('value="Coyote"'), 'the typed note was not restored into the field');
  assert.ok(!html.includes('selected-part-variant-label'), 'rendered a label with nothing to say');
  // And noteVariant still writes it back to state.
  STATE.parts = [part({ uid: 'p9' })];
  PP.noteVariant('p9', '  Two-tone  ');
  assert.equal(STATE.parts[0].variant, 'Two-tone');
  PP.noteVariant('p9', '   ');
  assert.equal(STATE.parts[0].variant, undefined, 'blank must clear the key, not store ""');
});

test('pending custom parts still get no free-text field and no swatch', () => {
  const html = PP.selectedPartHtml(part({ refId: null, pending: true }));
  assert.ok(!hasInput(html));
  assert.ok(html.includes('Pending'), 'pending box lost');
});

test('the label is escaped', () => {
  const html = PP.selectedPartHtml(part({ variantId: 'x', variantLabel: '<b>Gold</b> & "TiN"' }));
  assert.ok(html.includes('&lt;b&gt;Gold&lt;/b&gt; &amp; &quot;TiN&quot;'));
});

// ── Spec line (variantSpecs) ───────────────────────────────────────────────
// Holosun 407C X3, as it is in product_variants: three variants with the SAME
// label, differing only in dot colour. Before the spec line the color step
// listed "Black · Anodized" three times.
const HOLO = { id: 'h1', brand: 'Holosun', name: '407C X3', variants: [
  v({ id: 'hr', variant_label: 'Black · Anodized', reticle: '2 MOA', reticle_color: 'Red', is_default: true }),
  v({ id: 'hz', variant_label: 'Black · Anodized', reticle: '2 MOA', reticle_color: 'Green' }),
  v({ id: 'ha', variant_label: 'Black · Anodized', reticle: '2 MOA', reticle_color: 'Gold' }),
] };

test('same-label variants are told apart by their spec line, in a stable order', () => {
  const html = PP.variantListHtml('optics', HOLO);
  const specs = [...html.matchAll(/<span class="variant-row-specs">([^<]*)<\/span>/g)].map((m) => m[1]);
  // Default first, then the shared label ties and the spec line decides —
  // not the variant id, which is arbitrary.
  assert.deepEqual(specs, ['2 MOA · Red dot', '2 MOA · Gold dot', '2 MOA · Green dot']);
  assert.equal(new Set(specs).size, 3, 'two rows still read the same');
  // The label itself is untouched.
  assert.equal((html.match(/<span class="variant-row-label">Black · Anodized<\/span>/g) || []).length, 3);
});

test('a product with no spec columns renders no spec line at all', () => {
  const html = PP.variantListHtml('barrels', MANY);
  assert.ok(!html.includes('variant-row-specs'), 'empty spec element rendered for a barrel');
});

test('a light shows battery then mount', () => {
  const light = { id: 'l1', brand: 'Streamlight', name: 'TLR-7 X', variants: [
    v({ id: 'l', is_default: true, color: 'Black', battery_type: 'CR123A', mount_system: 'Swappable keys (1913 + Glock)' }),
    v({ id: 'l2', color: 'FDE', battery_type: 'CR123A' }),
  ] };
  const html = PP.variantListHtml('lights', light);
  assert.ok(html.includes('<span class="variant-row-specs">CR123A · Swappable keys (1913 + Glock)</span>'));
  assert.ok(html.includes('<span class="variant-row-specs">CR123A</span>'));
});

test('the build row shows the stored spec line under the label', () => {
  const html = PP.selectedPartHtml(part({ refId: 'h1', variantId: 'hz', variantLabel: 'Black · Anodized',
    variantColor: 'Black', variantSpecs: '2 MOA · Green dot', imageUrl: 'https://img/407c.jpg' }));
  assert.match(html, /selected-part-variant-label">Black · Anodized<\/div><div class="selected-part-variant-specs">2 MOA · Green dot<\/div>/);
  // No specs → no element, so a barrel row is byte-for-byte what it was.
  const plain = PP.selectedPartHtml(part({ variantId: 'g', variantLabel: 'Gold / TiN', variantColor: 'Gold' }));
  assert.ok(!plain.includes('selected-part-variant-specs'));
});
