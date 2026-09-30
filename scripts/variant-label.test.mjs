// Runs js/variant-label.js and netlify/functions/_variant-label.mjs over the
// same inputs and fails if they disagree on ANY of them.
//
// Same shape, and the same reason, as scripts/build-url.test.mjs. The pages
// have no module loader, so the browser copy is a <script> global and the
// server copy is ESM; nothing but this test stops them drifting.
//
// And they HAD drifted, before either existed as a shared file. The three
// hand-maintained copies this pair replaced disagreed on whether `finish`
// was part of a label, which put "Black / DLC" on the product page and
// "Black" — twice, $56 apart — in the catalog buy row and on every build
// page. That is what this test is for: not a hypothetical, a repeat.
//
// The cases below are real rows from product_variants, plus the edges that
// decide behaviour. Add a case here whenever the formula grows a rule.
//
// Run: node --test scripts/variant-label.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load the browser copy the way a page does: as a script against a global.
const browser = await (async () => {
  const src = await readFile(join(ROOT, 'js/variant-label.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();
const server = await import(join(ROOT, 'netlify/functions/_variant-label.mjs'));

// [input, expected]
const CASES = [
  // Real rows — True Precision P365-FUSE, the product that exposed the drift.
  [{ color: 'Black',   finish: 'DLC'      }, 'Black / DLC'],
  [{ color: 'Black',   finish: 'Nitride'  }, 'Black / Nitride'],
  [{ color: 'FDE',     finish: 'Cerakote' }, 'FDE / Cerakote'],
  [{ color: 'Copper',  finish: 'TiCN'     }, 'Copper / TiCN'],
  [{ color: 'Gold',    finish: 'TiN'      }, 'Gold / TiN'],
  [{ color: 'Spectrum',        finish: null }, 'Spectrum'],
  [{ color: 'Stainless Steel', finish: null }, 'Stainless Steel'],
  [{ color: 'Stealth Gray',    finish: 'PVD' }, 'Stealth Gray / PVD'],

  // Real rows — Radian and Sharps Bros carry a slash inside `color` itself.
  // It must survive untouched; the separator is not special.
  [{ color: 'Black/Black',   finish: null }, 'Black/Black'],
  [{ color: 'Bronze/Black',  finish: null }, 'Bronze/Black'],
  [{ color: 'Black/Cherry',  finish: 'Anodized' }, 'Black/Cherry / Anodized'],

  // Real row — Norsso. The finish repeats a word the colour already carries,
  // so it is dropped: the reader was being told "Satin" twice.
  // These two are the whole live blast radius of the rule, measured against
  // product_variants on 2026-09-30: 14 variants on the first, 1 on the second.
  [{ color: 'Satin Stainless Steel', finish: 'Satin' }, 'Satin Stainless Steel'],
  [{ color: 'Stainless Steel', finish: 'Stainless' }, 'Stainless Steel'],
  [{ color: 'Satin', finish: 'Satin' }, 'Satin'],
  [{ color: 'satin', finish: 'SATIN' }, 'satin'],
  // Word order and position do not matter — it is a set test, not a prefix one.
  [{ color: 'Stainless Steel Satin', finish: 'Satin' }, 'Stainless Steel Satin'],
  // A multi-word finish fully covered by the colour goes too.
  [{ color: 'Satin Stainless Steel', finish: 'Satin Steel' }, 'Satin Stainless Steel'],

  // …but EVERY word must be covered. A partial overlap keeps both halves,
  // because the uncovered word is a real second axis.
  [{ color: 'Black/Cherry', finish: 'Cherry Anodized' }, 'Black/Cherry / Cherry Anodized'],
  [{ color: 'Stainless Steel', finish: 'Satin Stainless' }, 'Stainless Steel / Satin Stainless'],

  // WORD-level, not substring. "TiN" is inside "Nitride" as a substring and a
  // substring test would swallow it, losing a real finish.
  [{ color: 'Nitride', finish: 'TiN' }, 'Nitride / TiN'],
  [{ color: 'Blackout', finish: 'Black' }, 'Blackout / Black'],

  // A finish with no words at all has nothing to add. These are real rows.
  [{ color: 'Black', finish: '—' }, 'Black'],
  [{ color: 'Black', finish: '-' }, 'Black'],
  [{ color: 'Black', finish: '/' }, 'Black'],

  // variant_label overrides verbatim, whatever else is set.
  [{ variant_label: '2 MOA Red Dot', color: 'Black', finish: 'DLC' }, '2 MOA Red Dot'],
  [{ variant_label: '  2 MOA Red Dot  ', color: 'Black' }, '2 MOA Red Dot'],
  // …but an empty or whitespace override is not an override.
  [{ variant_label: '',    color: 'Black', finish: 'DLC' }, 'Black / DLC'],
  [{ variant_label: '   ', color: 'Black', finish: 'DLC' }, 'Black / DLC'],
  [{ variant_label: null,  color: 'Black' }, 'Black'],

  // finish only, no colour. 128 of 649 live variants have no finish; the
  // reverse is rarer but the formula must not assume colour exists.
  [{ color: null, finish: 'Cerakote' }, 'Cerakote'],
  [{ color: '',   finish: 'Cerakote' }, 'Cerakote'],
  [{ color: '  ', finish: '  Cerakote  ' }, 'Cerakote'],

  // Nothing to say. The caller decides the placeholder, not the formula —
  // the old code said "Standard", which read as a product tier.
  [{}, ''],
  [{ color: null, finish: null }, ''],
  [{ color: '', finish: '' }, ''],
  [null, ''],
  [undefined, ''],

  // Non-string junk must not throw or stringify. A numeric colour is not a
  // colour, and `[object Object]` has shipped in this repo before.
  [{ color: 42, finish: 'DLC' }, 'DLC'],
  [{ color: 'Black', finish: {} }, 'Black'],
  [{ variant_label: {}, color: 'Black' }, 'Black'],
];

test('the two copies agree on every case', () => {
  for (const [input, expected] of CASES) {
    const b = browser.variantLabel(input);
    const s = server.variantLabel(input);
    const where = JSON.stringify(input);
    assert.equal(b, s, `browser and server disagree for ${where}: ${b} vs ${s}`);
    assert.equal(b, expected, `wrong label for ${where}`);
  }
});

test('variantLabelOr agrees too, and only substitutes when empty', () => {
  for (const [input] of CASES) {
    assert.equal(
      browser.variantLabelOr(input, 'This colour'),
      server.variantLabelOr(input, 'This colour'),
      `variantLabelOr disagrees for ${JSON.stringify(input)}`,
    );
  }
  assert.equal(browser.variantLabelOr({ color: 'Black' }, 'This colour'), 'Black');
  assert.equal(browser.variantLabelOr({}, 'This colour'), 'This colour');
  assert.equal(server.variantLabelOr({}, 'This colour'), 'This colour');
  assert.equal(server.variantLabelOr({}), '');
});

test('the label does not depend on sibling variants', () => {
  // The whole point of the rewrite. The old formula took a list and showed
  // only the axes that differed across it, so adding or retiring a sibling
  // silently changed a label that is now written into parts_snapshot.
  const v = { color: 'Black', finish: 'DLC' };
  assert.equal(browser.variantLabel(v), 'Black / DLC');
  assert.equal(server.variantLabel(v), 'Black / DLC');
  // Same row, whether it is the only variant or one of eight.
  assert.equal(browser.variantLabel({ ...v }), 'Black / DLC');
});
