// listing-rules.test.mjs — pins netlify/functions/_listing-rules.mjs to the
// documented rules (CLAUDE.md: "Prices we can stand behind", "Listing
// order"), so a drive-by edit to the shared module fails the deploy instead
// of quietly disagreeing with the browser copies.
//
// This is NOT a parity test against js/affiliate.js — the browser copies
// remain hand-synced, per CLAUDE.md's "Duplicated logic to keep in sync".
// What it pins is the SERVER module both product-page.mjs and guide-page.mjs
// now render through, against fixtures that encode the doctrine:
//   - op_last_matched_by null ⇒ stale, whatever the date says (the
//     load-bearing clause: a hand-typed last_checked must not pass)
//   - whole-UTC-day window, same boundary as SQL's current_date - 7:
//     exactly 7 days old is still fresh, 8 is stale
//   - sort: fresh-and-priced → in stock → price ascending → partner → URL,
//     and the order is deterministic for equal rows
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStalePrice, compareListingRows, displayPartnerName, STALE_AFTER_DAYS,
} from '../netlify/functions/_listing-rules.mjs';

function daysAgoUTC(n) {
  const now = new Date();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

test('missing link, date, or feed match is stale', () => {
  assert.equal(isStalePrice(null), true);
  assert.equal(isStalePrice({}), true);
  assert.equal(isStalePrice({ last_checked: daysAgoUTC(0) }), true, 'fresh date, never feed-matched');
  assert.equal(isStalePrice({ op_last_matched_by: 'T1' }), true, 'feed-matched, no date');
});

test('a hand-typed fresh date does not pass as verification', () => {
  // The exact failure the middle clause exists to catch.
  assert.equal(isStalePrice({ last_checked: daysAgoUTC(0), op_last_matched_by: null }), true);
});

test('whole-day boundary matches the SQL rule', () => {
  const l = (d) => ({ last_checked: d, op_last_matched_by: 'T1' });
  assert.equal(isStalePrice(l(daysAgoUTC(0))), false);
  assert.equal(isStalePrice(l(daysAgoUTC(STALE_AFTER_DAYS))), false,
    'exactly ' + STALE_AFTER_DAYS + ' days old is NOT < current_date - ' + STALE_AFTER_DAYS);
  assert.equal(isStalePrice(l(daysAgoUTC(STALE_AFTER_DAYS + 1))), true);
  assert.equal(isStalePrice(l('not-a-date')), true);
});

test('fresh-and-priced leads, then stock, then price', () => {
  const freshCheap  = { stale: false, price: 100, in_stock: true,  partnerName: 'B', url: 'u1' };
  const freshDear   = { stale: false, price: 200, in_stock: true,  partnerName: 'A', url: 'u2' };
  const freshNoStock = { stale: false, price: 90, in_stock: false, partnerName: 'A', url: 'u3' };
  const staleCheaper = { stale: true,  price: 50,  in_stock: true,  partnerName: 'A', url: 'u4' };
  const rows = [staleCheaper, freshDear, freshNoStock, freshCheap];
  rows.sort(compareListingRows);
  assert.deepEqual(rows.map((r) => r.url), ['u1', 'u2', 'u3', 'u4'],
    'a stale $50 must not outrank a fresh $100, and out-of-stock fresh sorts after in-stock fresh');
});

test('equal rows resolve deterministically by partner then URL', () => {
  const a = { stale: false, price: 100, in_stock: true, partnerName: 'Alpha', url: 'zzz' };
  const b = { stale: false, price: 100, in_stock: true, partnerName: 'Beta',  url: 'aaa' };
  const c = { stale: false, price: 100, in_stock: true, partnerName: 'Beta',  url: 'bbb' };
  const once  = [c, a, b].sort(compareListingRows).map((r) => r.url);
  const twice = [b, c, a].sort(compareListingRows).map((r) => r.url);
  assert.deepEqual(once, ['zzz', 'aaa', 'bbb'], 'partner name first, then URL');
  assert.deepEqual(once, twice, 'same order whatever PostgREST handed back');
});

test('partner display name drops the network suffix', () => {
  assert.equal(displayPartnerName('OpticsPlanet (Awin)'), 'OpticsPlanet');
  assert.equal(displayPartnerName('Olight (Awin)'), 'Olight');
  assert.equal(displayPartnerName(null), null);
});
