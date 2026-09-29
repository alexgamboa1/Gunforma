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
