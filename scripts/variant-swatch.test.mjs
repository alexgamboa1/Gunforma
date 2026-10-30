// Runs js/variant-swatch.js and netlify/functions/_variant-swatch.mjs over
// the same colour names and fails if they disagree on ANY of them — and
// holds the server file's colour tables and swatchFor() byte-identical to
// the browser's. Same shape as maker-link.test.mjs, for the same reason: a
// browser copy and a server copy with no module boundary between the pages
// and the function. A drift here means the product page's variant rows and
// the catalog's chips draw the same colour differently.
//
// Run: node --test scripts/variant-swatch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const browserSrc = await readFile(join(ROOT, 'js/variant-swatch.js'), 'utf8');
const serverSrc  = await readFile(join(ROOT, 'netlify/functions/_variant-swatch.mjs'), 'utf8');

const browser = (() => {
  const g = {};
  new Function('window', browserSrc)(g);
  return g;
})();
const server = await import(join(ROOT, 'netlify/functions/_variant-swatch.mjs'));

test('the server file carries the browser block verbatim', () => {
  const start = browserSrc.indexOf('  var TOKENS = {');
  const end = browserSrc.indexOf('  global.variantSwatch = swatchFor;');
  assert.ok(start > 0 && end > start, 'browser file has the TOKENS…swatchFor block');
  const block = browserSrc.slice(start, end).trimEnd();
  assert.ok(serverSrc.includes(block), 'netlify/functions/_variant-swatch.mjs must contain js/variant-swatch.js\'s block byte for byte');
});

// Every name the tables know, the specials, two-tone pairs, and the ones the
// tables do not know — the neutral chip must agree too.
const NAMES = [
  ...Object.keys(server.NAMED),
  ...Object.keys(server.SPECIAL),
  'Black', 'GOLD', 'Gun Metal Gray', 'Stealth Gray', 'Satin Stainless Steel', 'Matte Black Anodized',
  'Black/Hogue', 'FDE/Gold', 'Gray/Black', 'ODG / Hogue', 'Bronze/Black', 'Black/Black', 'Gold/Red',
  'Black/Cherry', 'Spectrum', 'Rainbow', 'Clear', 'spectrum/black',
  'Midnight Bronze', 'Burnt Bronze', 'Coyote Bronze', 'Rose Gold', 'Matte Rose Gold',
  'Hyena/Black', 'Tiger Stripe Gray', 'Mystery Colour', 'Blurple', '', null, undefined, '  black  ', 'black_anodized',
];
for (const a of ['black', 'fde', 'gold', 'gray']) for (const b of ['copper', 'odg', 'cherry', 'blue']) NAMES.push(a + '/' + b);

test('both copies agree on swatchFor for every name', () => {
  for (const name of NAMES) {
    assert.deepEqual(server.swatchFor(name), browser.variantSwatch(name), 'swatchFor(' + JSON.stringify(name) + ')');
  }
});

test('both copies agree with a brand, for every name', () => {
  for (const brand of ['Icarus Precision', 'icarus  precision', 'Sharps Bros', '', null, undefined]) {
    for (const name of NAMES) {
      assert.deepEqual(server.swatchFor(name, brand), browser.variantSwatch(name, brand),
        'swatchFor(' + JSON.stringify(name) + ', ' + JSON.stringify(brand) + ')');
    }
  }
});

test('Icarus colours are frame/panel: the swatch is the frame (Alex, 2026-10-30)', () => {
  // the AXG FUSE's variants, every two-part shape
  assert.deepEqual(server.swatchFor('FDE/Gold', 'Icarus Precision'), server.swatchFor('FDE'));
  assert.deepEqual(server.swatchFor('ODG/Hogue', 'Icarus Precision'), server.swatchFor('ODG'));
  assert.deepEqual(server.swatchFor('Gray/Black', 'Icarus Precision'), server.swatchFor('Gray'));
  assert.deepEqual(server.swatchFor('Black/Gold', 'Icarus Precision'), server.swatchFor('Black'));
  assert.equal(server.swatchFor('FDE/Gold', 'Icarus Precision').kind, 'solid');
  // another maker's two-tone grip is still one object in two colours
  assert.equal(server.swatchFor('Black/Cherry', 'Sharps Bros').kind, 'split');
  assert.equal(server.swatchFor('FDE/Gold').kind, 'split', 'no brand: the old rule');
  // and a one-part Icarus colour is unchanged
  assert.deepEqual(server.swatchFor('Black', 'Icarus Precision'), server.swatchFor('Black'));
});

test('the rules the pages rely on', () => {
  assert.equal(server.swatchFor('Black').kind, 'solid');
  assert.equal(server.swatchFor('Black/Gold').kind, 'split');
  assert.equal(server.swatchFor('Black/Black').kind, 'solid', 'same token twice is one colour');
  assert.equal(server.swatchFor('Spectrum').kind, 'iridescent');
  assert.equal(server.swatchFor('Clear').kind, 'clear');
  assert.equal(server.swatchFor('Mystery Colour').kind, 'unknown', 'an unmapped name is a neutral chip, never a guess');
  assert.equal(server.swatchFor(null).kind, 'unknown');
  assert.match(server.swatchFor('Gold').css, /^background:#[0-9a-f]{6};$/);
});
