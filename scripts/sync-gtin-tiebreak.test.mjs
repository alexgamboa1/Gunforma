// A stored GTIN must break an MPN tie the MPN itself cannot.
//
// WHY THIS CASE EXISTS AT ALL
// MPNs are not unique in the OpticsPlanet feed, and the collision is not
// always two different products. TPP365BXBL is carried twice: once as
// "True Precision Sig Sauer P365 Non-Threaded Barrel, Black Nitride" and once
// as "Faxon Firearms True Precision Sig P365 Barrel Non-threaded Black
// Nitride" — the same barrel, listed twice, at $144.99 and $161.49.
//
// Both rows confirm a stored op_mpn, so the stored-identifier rule cannot
// separate them and the link is withheld as a candidate conflict EVERY NIGHT.
// It was withheld from 2026-09-21 onward, quietly showing "Check price" on a
// product that had a perfectly good price, because nothing could choose.
//
// Only one of the two carries a GTIN. That is the tiebreak, and it is a
// stronger identifier than an MPN by construction: an MPN is unique within a
// manufacturer, a GTIN is unique globally.
//
// WHAT MUST NOT CHANGE: when no candidate matches the stored GTIN, or several
// match with different fingerprints, the conflict must still withhold. The
// rule adds a way to RESOLVE a tie; it must never invent a winner. Both halves
// are asserted below, because only asserting the first would let a change that
// always picks the first candidate pass.
//
// Since 2026-11-16 this file also pins the other two resolver rules:
//   • the condition rule — a retail row is picked over an affirmatively
//     non-retail twin (open box / dealer demo), and ONLY then; and
//   • hyphen-insensitive stored-MPN comparison (mpnNorm) — OP's respelling
//     of a stored MPN ("EPS-CORE-RD-3" → "EPSCORERD3") is the same
//     identifier, not drift, and the stored value is never rewritten.
//
// Run: node --test scripts/sync-gtin-tiebreak.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProposals, mpnNorm } from './refresh-affiliate-prices.mjs';

const LINK = 'link-under-test';
const TODAY = '2026-09-30';

// The two real rows, reduced to what the resolver reads.
const TRUE_PRECISION = {
  tier: 'stored_op_mpn', price: 144.99, inStock: true,
  rawMpn: 'TPP365BXBL', rawGtin: '00719104536178', rawMid: '2524871',
  isDemo: false, feedName: 'True Precision Sig Sauer P365 Non-Threaded Barrel, Black Nitride',
  url: 'https://www.opticsplanet.com/true-precision-sig-sauer-p365-non-threaded-barrel.html',
};
const FAXON_DUPLICATE = {
  tier: 'stored_op_mpn', price: 161.49, inStock: false,
  rawMpn: 'TPP365BXBL', rawGtin: '', rawMid: '5045176',
  isDemo: false, feedName: 'Faxon Firearms True Precision Sig P365 Barrel Non-threaded Black Nitride',
  url: 'https://www.opticsplanet.com/faxon-firearms-true-precision-sig-p365-barrel-non-threaded-black-nitride.html',
};

// Minimal state, shaped like the real one. Only what resolveProposals touches.
function stateWith(target, proposals) {
  return {
    proposals: new Map([[LINK, proposals]]),
    byId: new Map([[LINK, { id: LINK, url: target.url || 'https://shop/x', ...target }]]),
    updates: new Map(),
    imageFills: new Map(),
    withheldIds: new Set(),
    conflicts: [], driftReview: [], tierCounts: {},
    demoRowsDropped: 0, resolvedByStoredId: 0, resolvedByStoredGtin: 0,
    resolvedByCondition: 0, conditionResolved: [],
    filled: 0, overwrites: 0,
  };
}
const outcome = (st) => ({
  wrote: st.updates.has(LINK),
  withheld: st.withheldIds.has(LINK),
  price: st.updates.get(LINK)?.street_price,
  conflicts: st.conflicts.length,
  byGtin: st.resolvedByStoredGtin,
});

test('the stored GTIN picks the right row out of an MPN tie', () => {
  // Exactly the live state after the 2026-09-29 hand re-point: op_gtin set to
  // the True Precision row's GTIN, op_mpn refilled by the next run.
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: '00719104536178', op_merchant_product_id: '2524871',
      street_price: 161.49, in_stock: false },
    [TRUE_PRECISION, FAXON_DUPLICATE],
  );
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, false, 'still withheld — the tie was not broken');
  assert.equal(o.wrote, true, 'nothing was written');
  assert.equal(o.price, 144.99, 'picked the wrong row: expected the True Precision price');
  assert.equal(o.byGtin, 1, 'the resolution was not counted as a GTIN tiebreak');
});

test('order does not decide it — the Faxon row first changes nothing', () => {
  // Without this, a change that simply takes candidates[0] would pass the
  // test above and be wrong half the time in production, where feed order is
  // not guaranteed.
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: '00719104536178', op_merchant_product_id: '2524871' },
    [FAXON_DUPLICATE, TRUE_PRECISION],
  );
  resolveProposals(st, TODAY);
  assert.equal(outcome(st).price, 144.99, 'the answer changed with the input order');
});

test('no stored GTIN: still withheld, exactly as before', () => {
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: null, op_merchant_product_id: '5045176' },
    [TRUE_PRECISION, FAXON_DUPLICATE],
  );
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, true, 'wrote something with nothing to choose by');
  assert.equal(o.wrote, false);
  assert.equal(o.conflicts, 1, 'the conflict was not recorded for review');
});

test('stored GTIN matches NEITHER candidate: still withheld', () => {
  // The guess-prevention case. A GTIN that matches nothing must not cause a
  // pick — it must leave the conflict exactly where it was.
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: '00000000000000', op_merchant_product_id: '2524871' },
    [TRUE_PRECISION, FAXON_DUPLICATE],
  );
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, true, 'a non-matching stored GTIN picked a row anyway');
  assert.equal(o.byGtin, 0, 'counted a tiebreak that should not have happened');
});

test('two candidates share BOTH the stored MPN and the stored GTIN: still withheld', () => {
  // The case the GTIN genuinely cannot settle. Both rows confirm the stored
  // MPN, so the existing stored-identifier rule cannot collapse them, and both
  // also carry the stored GTIN, so the new rule cannot either. They differ
  // only on merchant_product_id — two listings claiming the same identifiers.
  // That is a real conflict and must stay withheld.
  //
  // Getting this fixture right mattered: the first version gave the twin a
  // DIFFERENT MPN, which let the pre-existing rule resolve it correctly before
  // the new block ever ran. The test failed while the code was right — the
  // fixture was not testing what its name claimed.
  const twin = { ...TRUE_PRECISION, rawMid: '9999999', price: 161.49 };
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: '00719104536178' },
    [TRUE_PRECISION, twin],
  );
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, true, 'two rows sharing both stored identifiers must not resolve');
  assert.equal(o.wrote, false);
  assert.equal(o.byGtin, 0, 'counted a tiebreak that could not have been made');
});

test('a single candidate is unaffected — no tiebreak, no counter', () => {
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: '00719104536178' },
    [TRUE_PRECISION],
  );
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.wrote, true);
  assert.equal(o.price, 144.99);
  assert.equal(o.byGtin, 0, 'counted a tiebreak where there was no tie');
});

test('GTIN comparison is normalised, not string equality', () => {
  // gtinNorm strips leading zeros; the feed and our column disagree about them
  // routinely. A raw === would silently never match and the tie would stay.
  const st = stateWith(
    { op_mpn: 'TPP365BXBL', op_gtin: '719104536178' },   // no leading zeros
    [TRUE_PRECISION, FAXON_DUPLICATE],                    // feed has 00719104536178
  );
  resolveProposals(st, TODAY);
  assert.equal(outcome(st).price, 144.99, 'leading-zero difference defeated the match');
});

// ─── the condition rule (Alex, 2026-11-16) ──────────────────────────────────
// OP's open-box rows reuse the retail item's MPN — and here its GTIN too — so
// they confirm the stored identifier, survive the demo-drop, and nothing up to
// the conflict check can separate them. These are the Romeo2's real rows from
// the 2026-11-16 run, which that night withheld as a candidate conflict.
const ROMEO2_RETAIL = {
  tier: 'stored_op_mpn', price: 614.49, inStock: true,
  rawMpn: 'SOR21600', rawGtin: '00798681647705', rawMid: '6351237',
  isDemo: false, condition: 'new',
  feedName: 'SIG SAUER Romeo2 Reflex Red Dot Sights, Black, 6 MOA, SOR21600',
  url: 'https://www.opticsplanet.com/sig-sauer-romeo2-red-dot-sights-reflex.html',
};
const ROMEO2_OPEN_BOX = {
  tier: 'stored_op_mpn', price: 489.99, inStock: true,
  rawMpn: 'SOR21600', rawGtin: '00798681647705', rawMid: '7206641',
  isDemo: true, condition: 'non_retail',
  feedName: 'Open Box, Dealer Demo, SIG SAUER Romeo2 Reflex Red Dot Sights, Black, 6 MOA, SOR21600',
  url: 'https://www.opticsplanet.com/sig-sauer-romeo2-red-dot-sights-reflex.html',
};
const ROMEO2_STORED = {
  op_mpn: 'SOR21600', op_gtin: '00798681647705', op_merchant_product_id: '6351237',
  street_price: 589.99, in_stock: true,
};

test('a retail/open-box pair sharing every identifier resolves to the retail row', () => {
  const st = stateWith(ROMEO2_STORED, [ROMEO2_RETAIL, ROMEO2_OPEN_BOX]);
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, false, 'still withheld — the condition rule did not fire');
  assert.equal(o.wrote, true, 'nothing was written');
  assert.equal(o.price, 614.49, 'picked the open-box price');
  assert.equal(st.resolvedByCondition, 1, 'the resolution was not counted');
  assert.equal(st.conditionResolved[0].dropped.length, 1, 'the dropped twin was not recorded as evidence');
});

test('order does not decide the condition pick either', () => {
  const st = stateWith(ROMEO2_STORED, [ROMEO2_OPEN_BOX, ROMEO2_RETAIL]);
  resolveProposals(st, TODAY);
  assert.equal(outcome(st).price, 614.49, 'the answer changed with the input order');
});

test('every survivor non-retail: withheld — no price beats a demo price', () => {
  const secondDemo = { ...ROMEO2_OPEN_BOX, rawMid: '7206642', price: 450.00 };
  const st = stateWith(ROMEO2_STORED, [ROMEO2_OPEN_BOX, secondDemo]);
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, true, 'picked a demo row with no retail row in sight');
  assert.equal(o.wrote, false);
  assert.equal(st.resolvedByCondition, 0, 'counted a pick that must not exist');
});

test('two distinct retail rows (the 3-pack beside the single) stay withheld', () => {
  // The Magpul AMAG shape: the single magazine and its 3-pack are both NEW
  // and both real products. Condition cannot separate them and must not try.
  const single = {
    tier: 'url_only', price: 34.95, inStock: true,
    rawMpn: 'MAG1487SST', rawGtin: '00840815137313', rawMid: '6460001',
    isDemo: false, condition: 'new',
    feedName: 'Magpul Industries AMAG 15 SG9 SIG Sauer P365, 15 Round Pistol Magazine, Silver',
    url: 'https://www.opticsplanet.com/magpul-industries-amag-sig-sauer-p365-9mm-luger-15-round-pistol-magazine.html',
  };
  const threePack = {
    ...single, rawGtin: '00840815137320', rawMid: '6460002', price: 99.95,
    feedName: 'Magpul Industries AMAG SIG Sauer P365 15 Round Pistol Magazine, Silver, 3-pack',
  };
  const st = stateWith({ op_mpn: null, op_gtin: null, op_merchant_product_id: null }, [single, threePack]);
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.withheld, true, 'two different retail products were collapsed by condition');
  assert.equal(o.conflicts, 1, 'the conflict was not recorded for review');
  assert.equal(st.resolvedByCondition, 0);
});

// ─── hyphen-insensitive stored-MPN comparison ───────────────────────────────

test('mpnNorm: hyphens vanish, nothing else does', () => {
  assert.equal(mpnNorm('EPS-CORE-RD-3'), 'epscorerd3');
  assert.equal(mpnNorm('EPSCORERD3'), 'epscorerd3');
  assert.equal(mpnNorm(' EPS-CORE-RD-3 '), 'epscorerd3');
  assert.equal(mpnNorm('TD-P365SC-Gold'), 'tdp365scgold');
  assert.notEqual(mpnNorm('TD P365SC Gold'), 'tdp365scgold', 'spaces must NOT vanish — that is fuzzyNorm territory');
  assert.equal(mpnNorm(null), null);
  assert.equal(mpnNorm('-'), null);
});

test("OP's respelling of the stored MPN is the same identifier, not drift", () => {
  // The Holosun EPS-Core shape from the 2026-11-16 run: stored
  // "EPS-CORE-RD-3", feed now ships "EPSCORERD3". The strict comparison read
  // that as identifier drift and withheld the price every night.
  const st = stateWith(
    { op_mpn: 'EPS-CORE-RD-3', op_gtin: null, op_merchant_product_id: null },
    [{
      tier: 'url_only', price: 219.99, inStock: true,
      rawMpn: 'EPSCORERD3', rawGtin: '', rawMid: '6339901',
      isDemo: false, condition: 'new',
      feedName: 'Holosun EPS-CORE-RD-3 1x Reflex Red Dot Sight, Red 3 MOA Dot, Black',
      url: 'https://www.opticsplanet.com/holosun-eps-core-rd-3-1x-0-9x0-63-in-reflex-red-dot-sight.html',
    }],
  );
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(st.driftReview.length, 0, 'the respelling was still read as drift');
  assert.equal(o.wrote, true, 'the price was withheld');
  assert.equal(o.price, 219.99);
  const patch = st.updates.get(LINK);
  assert.ok(!('op_mpn' in patch), 'the stored MPN was rewritten — the comparison must bend, not the record');
  assert.equal(patch.op_merchant_product_id, '6339901', 'a null identifier should still be filled');
});

test('hyphen-insensitive confirmsStored still separates a shared-URL row', () => {
  const real = {
    tier: 'stored_op_mpn', price: 219.99, inStock: true,
    rawMpn: 'EPSCORERD3', rawGtin: '', rawMid: '6339901',
    isDemo: false, condition: 'new', feedName: 'Holosun EPS-CORE-RD-3', url: 'https://shop/x',
  };
  const noise = {
    tier: 'url_only', price: 179.99, inStock: true,
    rawMpn: 'OTHER999', rawGtin: '', rawMid: '7000001',
    isDemo: false, condition: 'new', feedName: 'Some other sight on the same page', url: 'https://shop/x',
  };
  const st = stateWith({ op_mpn: 'EPS-CORE-RD-3', op_gtin: null, op_merchant_product_id: null }, [noise, real]);
  resolveProposals(st, TODAY);
  const o = outcome(st);
  assert.equal(o.wrote, true, 'withheld — confirmsStored missed the respelled MPN');
  assert.equal(o.price, 219.99, 'the shared-URL noise row won');
  assert.equal(st.resolvedByStoredId, 1, 'the stored-identifier rule did not claim the resolution');
});
