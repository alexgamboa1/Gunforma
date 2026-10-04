// A parts_snapshot row must survive being loaded into the builder and saved
// again, byte for byte.
//
// WHY: gunforma-post-build.html loads a saved build back into state.parts in
// two places — edit mode (hydrateFromEditMode) and the Armory handoff
// (hydrateFromArmoryHandoff) — and buildPartsSnapshot() writes state.parts
// back out on save. buildPartsSnapshot() only writes a field the part
// CARRIES, so a hydration path that forgets a field deletes it on the next
// save, silently. Both paths forgot all five variant fields: opening a build
// with a Gold barrel for edit and saving it, untouched, wrote it back as
// whatever the default was. Nothing failed and the page looked right until
// the save.
//
// check-snapshot-fields.mjs guards the same class of bug by comparing field
// LISTS, but only the armory's readers are on its list, and a list
// comparison cannot see a reader that is missing entirely. This runs the
// real code instead: it pulls buildPartsSnapshot() and every hydration
// push out of the page source and executes them, so it tests what ships
// rather than a copy of it.
//
// EVERY HYDRATION SITE IS FOUND, NOT LISTED. A new path that loads a
// snapshot into state.parts is picked up by the pattern below and must
// round-trip like the others; the count is asserted so a refactor that
// changes the shape fails loudly instead of quietly testing nothing.
//
// Run: node --test scripts/snapshot-roundtrip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFile(join(ROOT, f), 'utf8');

// The source text of the balanced {...} or (...) starting at `open`.
function balanced(src, open) {
  const pairs = { '{': '}', '(': ')' };
  const want = pairs[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    // Skip comments first: an apostrophe in "// don't" is not a string.
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {        // skip string literals
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === src[open]) depth++;
    else if (c === want && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error('unbalanced at ' + open);
}

// Every `(<x>.parts_snapshot || []).forEach(function (part) { state.parts.push({...}) })`.
const HYDRATE_RE = /\(\s*\w+\.parts_snapshot\s*\|\|\s*\[\]\s*\)\.forEach\(\s*function\s*\(\s*part\s*\)\s*\{\s*state\.parts\.push\(/g;
function hydrationSites(src) {
  const out = [];
  let m;
  HYDRATE_RE.lastIndex = 0;
  while ((m = HYDRATE_RE.exec(src)) !== null) {
    const objStart = src.indexOf('{', m.index + m[0].length - 1);
    out.push({ at: src.slice(0, m.index).split('\n').length, literal: balanced(src, objStart) });
  }
  return out;
}

const page = await read('gunforma-post-build.html');

// The category normaliser the hydration calls, run for real against the real
// js/build-categories.js — a stub would hide a row that normalises to a
// different key and so does not round-trip.
const win = {};
new Function('window', await read('js/build-categories.js'))(win);
// The page takes it from the same module: `const FALLBACK_CATEGORY_KEY =
// window.BuildCategories.FALLBACK_CATEGORY_KEY`.
assert.match(page, /const FALLBACK_CATEGORY_KEY\s*=\s*window\.BuildCategories\.FALLBACK_CATEGORY_KEY/);
const fallback = win.BuildCategories.FALLBACK_CATEGORY_KEY;
const normSrc = balanced(page, page.indexOf('{', page.indexOf('function normalizePartCategory(')));
const normalizePartCategory = new Function('window', 'FALLBACK_CATEGORY_KEY', 'console',
  'return function normalizePartCategory(raw) ' + normSrc)(win, fallback, { warn() {} });

const snapSrc = balanced(page, page.indexOf('{', page.indexOf('function buildPartsSnapshot()')));
const buildPartsSnapshotFor = (state) => new Function('state', 'return (function () ' + snapSrc + ')()')(state);

const SITES = hydrationSites(page);

// Run one hydration site over a snapshot, exactly as the page does, then save.
function roundTrip(site, rows) {
  let uid = 1;
  const make = new Function('part', 'uidRef', 'normalizePartCategory',
    'var uid = uidRef.n; var o = ' + site.literal + '; uidRef.n = uid; return o;');
  const ref = { n: uid };
  const state = { parts: rows.map((part) => make(part, ref, normalizePartCategory)) };
  return buildPartsSnapshotFor(state);
}

// Rows written in the order buildPartsSnapshot() emits keys, because a stored
// row WAS written by it — so "byte-identical" is a fair test, not just
// deep-equal.
const GOLD_BARREL = {
  category: 'barrels', refId: '0657a453-c53a-4c93-81c1-ac04699269d1',
  brand: 'True Precision', name: 'P365XL 3.7" Non-Threaded Barrels', pending: false,
  variantId: '3c9eccb2-f8d3-406d-815c-1ca02356ac6e', variantLabel: 'Gold · TiN',
  variantColor: 'Gold', variantFinish: 'TiN',
  imageUrl: 'https://op1.0ps.us/640-640/opplanet-true-precision-pistol-barrel-9mm-1-2x28-thread-sig-p365-xl-non-threaded-gold-tin-sub-compact-tp-p365xlb-xg-main-3.jpg',
};
// A chosen variant WITH a spec line (#123). Keys in buildPartsSnapshot()'s
// order: variantSpecs sits between variantFinish and imageUrl. Without it in
// the fixture, a load path that drops variantSpecs would pass this test and
// wipe the spec line on every edit.
const HOLO_GREEN = {
  category: 'optics', refId: 'e74a19db-915f-4d75-954b-f9f34446aca6',
  brand: 'Holosun', name: 'Holosun 407C X3', pending: false,
  variantId: '359acab6-3018-49db-8f81-5be9598e15f3', variantLabel: 'Black · Anodized',
  variantColor: 'Black', variantFinish: 'Anodized', variantSpecs: '2 MOA · Green dot',
  imageUrl: 'https://img.example/holosun-407c-x3-green.jpg',
};
const PLAIN = { category: 'triggers', refId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  brand: 'Sig Sauer', name: 'Curved P365', pending: false };
const NOTED = { category: 'optics', refId: '5795c40a-97b8-4a6a-9880-9ef4190685b9',
  brand: 'Olight', name: 'Osight X', pending: false, variant: 'Two-tone' };
const PAINT = { category: 'paintjob', refId: null, brand: 'Shop', name: 'FDE · Dragon scale stipple',
  pending: false, finish: { shop: 'Shop', color: 'FDE', stipple: 'Dragon scale' } };
const PENDING = { category: 'grips', refId: null, brand: 'Someone', name: 'Custom grip', pending: true };

// A part re-linked by relink_build_part() (supabase/relink_build_part.sql),
// exactly as the function stored it in its dry run against Gunforma-v2:
// "P365 Complete Build" part 6, the pending "Base Plate +3", linked to the
// Springer Precision base plate. Keys are in jsonb's own order, not
// buildPartsSnapshot()'s — Postgres sorts jsonb keys on write, so the stored
// row never had the writer's order. What must hold is that a load → save in
// the builder writes back the same keys with the same values, so the stored
// jsonb would be unchanged; the comparison is key by key for that reason.
// No variantFinish: the Tan variant has none, and the function strips nulls.
const RELINKED = {
  name: '+3 Magazine Extension for Sig Sauer X Macro 17rd Mags', brand: 'Springer Precision',
  refId: 'f309b3ee-26f8-4b64-812b-b072d05601ca', pending: false, category: 'basepad',
  imageUrl: 'https://cdn11.bigcommerce.com/s-pmz45dzobp/images/stencil/2048x2048/products/606/2627/277_-_P365_Macro_Extension_Tan_4__30950.1673555216.jpg?c=1',
  variantId: '26ee942d-1d0c-4044-96e1-6c96b6dd5711', variantColor: 'Tan', variantLabel: 'Tan',
};
// The same link with the spec line the queue page passes (computed with
// js/variant-label.js) — the dry run's signed-in-admin case.
const RELINKED_SPECS = Object.assign({}, RELINKED, { variantSpecs: '2 MOA · Red dot' });
const sameKeysAndValues = (a, b) => {
  const sort = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return sort(a) === sort(b);
};

test('post-build has the two hydration paths this test expects', () => {
  // Edit mode and the Armory handoff. If this count changes, a path was
  // added or reshaped — read it, then update the number; the round-trip
  // below already covers whatever was found.
  assert.equal(SITES.length, 2, 'hydration sites found at lines: ' + SITES.map((s) => s.at).join(', '));
});

test('the admin page loads no snapshot back into state.parts', async () => {
  // It only posts new builds. If it ever grows an edit or handoff path, that
  // path belongs in this test too.
  assert.deepEqual(hydrationSites(await read('gunforma-admin-post.html')), []);
});

for (const [i, site] of SITES.entries()) {
  const where = `hydration path ${i + 1} (line ${site.at})`;

  test(`${where}: a chosen variant survives load → save byte for byte`, () => {
    for (const row of [GOLD_BARREL, HOLO_GREEN]) {
      const [out] = roundTrip(site, [row]);
      assert.equal(JSON.stringify(out), JSON.stringify(row), 'changed: ' + row.name);
    }
  });

  test(`${where}: a part with no variant gains nothing — no nulls, no empty keys`, () => {
    for (const row of [PLAIN, NOTED, PAINT, PENDING]) {
      const [out] = roundTrip(site, [row]);
      assert.equal(JSON.stringify(out), JSON.stringify(row), 'changed: ' + row.name);
    }
  });

  test(`${where}: a part re-linked by relink_build_part() survives load → save`, () => {
    for (const row of [RELINKED, RELINKED_SPECS]) {
      const [out] = roundTrip(site, [row]);
      assert.ok(sameKeysAndValues(out, row), 'changed on round trip:\n  stored ' + JSON.stringify(row) + '\n  saved  ' + JSON.stringify(out));
    }
  });

  test(`${where}: a whole mixed build round-trips in order`, () => {
    const build = [GOLD_BARREL, HOLO_GREEN, PLAIN, NOTED, PAINT, PENDING];
    assert.equal(JSON.stringify(roundTrip(site, build)), JSON.stringify(build));
  });
}
