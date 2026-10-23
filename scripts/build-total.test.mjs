// build-total.test.mjs — js/build-total.js and _build-cards.mjs's
// priceTotal() / priceTotalText() must agree on every input, and both must
// follow the documented price rules.
//
// Why it matters: the server renders a build's total onto the homepage
// card, the gallery card and the build page's kicker; the gallery's own JS
// renders it again on load. A drift between the copies shows a reader one
// number served and another painted over it, on a page that looks fine.
// Before these existed the cards summed MSRPs and the kicker used the
// catalog's price rules, and one build read "~$1176" and "$1,017".
//
// Run: node --test scripts/build-total.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const browser = await (async () => {
  const src = await readFile(join(ROOT, 'js/build-total.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();
const server = await import(join(ROOT, 'netlify/functions/_build-cards.mjs'));

const today = new Date();
const iso = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(today.getTime() - n * 86400000));
const FRESH = daysAgo(1), EDGE = daysAgo(7), STALE = daysAgo(8);

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const link = (price, checked, matched, in_stock) =>
  ({ street_price: price, last_checked: checked, op_last_matched_by: matched, in_stock });

const ROWS = [
  // A: two live listings, one fresh in stock, one cheaper fresh out of stock → 120
  { product_id: A, msrp: 200, is_default: true,  affiliate_links: [link(120, FRESH, 'feed', true), link(99, FRESH, 'feed', false)] },
  { product_id: A, msrp: 210, is_default: false, affiliate_links: [] },
  // B: listings only stale, or never matched → nothing (NOT the MSRP)
  { product_id: B, msrp: 300, is_default: true,  affiliate_links: [link(250, STALE, 'feed', true), link(240, FRESH, null, true)] },
  // C: no listing at all → the default variant's MSRP, not the first row's
  { product_id: C, msrp: 55,  is_default: false, affiliate_links: [] },
  { product_id: C, msrp: 60,  is_default: true,  affiliate_links: [] },
  // D: one listing checked exactly 7 days ago → still fresh (whole days)
  { product_id: D, msrp: 80,  is_default: true,  affiliate_links: [link('70.50', EDGE, 'feed', null)] },
];

const CASES = [
  { label: 'all four priced',           parts: [{ refId: A }, { refId: C }, { refId: D }] },
  { label: 'a stale part is a floor',   parts: [{ refId: A }, { refId: B }] },
  { label: 'a typed part is a floor',   parts: [{ refId: A }, { name: 'Typed', pending: true }] },
  { label: 'nothing prices',            parts: [{ refId: B }, { pending: true }] },
  { label: 'no parts',                  parts: [] },
  { label: 'not an array',              parts: null },
  { label: 'unknown product',           parts: [{ refId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] },
  { label: 'rows missing',              parts: [{ refId: A }], rows: null },
  { label: 'rows with junk',            parts: [{ refId: A }], rows: [null, {}, { product_id: 7 }, ...ROWS] },
  { label: 'duplicate part',            parts: [{ refId: A }, { refId: A }] },
];

for (const c of CASES) {
  test(`both copies agree: ${c.label}`, () => {
    const rows = 'rows' in c ? c.rows : ROWS;
    const s = server.priceTotal(c.parts, rows);
    const b = browser.buildPriceTotal(c.parts, rows);
    assert.deepEqual(b, s);
    assert.equal(browser.priceTotalText(b), server.priceTotalText(s));
  });
}

test('the rules: fresh in-stock first, stale is nothing, no listing is MSRP, 7 days is fresh', () => {
  assert.deepEqual(server.priceTotal([{ refId: A }, { refId: C }, { refId: D }], ROWS), { total: 120 + 60 + 70.5, count: 3, of: 3 });
  assert.deepEqual(server.priceTotal([{ refId: B }], ROWS), { total: null, count: 0, of: 1 });
  assert.equal(server.priceTotalText(server.priceTotal([{ refId: A }, { refId: B }], ROWS)), '$120+');
  assert.equal(server.priceTotalText(server.priceTotal([{ refId: A }, { refId: C }], ROWS)), '$180');
  assert.equal(server.priceTotalText(server.priceTotal([{ refId: B }], ROWS)), null);
  assert.equal(server.priceTotalText(server.priceTotal([{ refId: A }, { refId: A }, { refId: A }, { refId: A }, { refId: A }, { refId: A }, { refId: A }, { refId: A }, { refId: A }], ROWS)), '$1,080');
});
