// display-name.test.mjs — pins netlify/functions/_display-name.mjs to the
// documented rule over the shapes the live catalog actually has (surveyed
// 2026-10-20: 204 of 277 live names start with their brand; the other 73
// are the magazines, the Olight / Streamlight / SureFire lights, and a
// handful of short-form names like "Faxon Exos" and "TTI SIG X-MACRO").
//
// Every case here fails silently in a browser: a hub row reading "AMAG 15
// SG9" or "Magpul Magpul AMAG 15 SG9" renders perfectly. So each live shape
// is pinned by name, and every output is held to never open with the same
// brand twice.
//
// Run: node --test scripts/display-name.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { displayProductName, nameCarriesBrand, brandForms, hasDoubledBrand, BRAND_ALIASES } =
  await import(join(ROOT, 'netlify/functions/_display-name.mjs'));

// [brand, stored name, expected display] — live rows first, then the edges.
const CASES = [
  // The problem: the brand is not in the name.
  ['Magpul',      'AMAG 15 SG9 P365 9mm 15rd Magazine',        'Magpul AMAG 15 SG9 P365 9mm 15rd Magazine'],
  ['Sig Sauer',   'P365 9mm 17rd Magazine (All 9mm Models)',   'Sig Sauer P365 9mm 17rd Magazine (All 9mm Models)'],
  ['Sig Sauer',   'P365-XMACRO 9mm 10rd Magazine',             'Sig Sauer P365-XMACRO 9mm 10rd Magazine'],
  ['Olight',      'Osight SE',                                 'Olight Osight SE'],
  ['Holosun',     'P.ID-K',                                    'Holosun P.ID-K'],
  ['Streamlight', 'TLR-7 HL-X',                                'Streamlight TLR-7 HL-X'],
  ['SureFire',    'X300T-A (Turbo)',                           'SureFire X300T-A (Turbo)'],
  ['Armory Craft', 'P365 - AMBI. EXTENDED Safety',             'Armory Craft P365 - AMBI. EXTENDED Safety'],
  // The name already starts with the full brand — any case.
  ['Holosun',     'Holosun 507K X2',                           'Holosun 507K X2'],
  ['Sig Sauer',   'Sig Sauer Romeo-X Pro',                     'Sig Sauer Romeo-X Pro'],
  ['Sig Sauer',   'SIG SAUER P365 17rd',                       'SIG SAUER P365 17rd'],
  ['True Precision', 'True Precision Axiom P365',              'True Precision Axiom P365'],
  // The first word of a multi-word brand is how makers shorten themselves.
  ['Sig Sauer',   'SIG P365 17rd',                             'SIG P365 17rd'],
  ['Faxon Firearms', 'Faxon Exos P365 Compensator',            'Faxon Exos P365 Compensator'],
  ['Radian Weapons', 'Radian Ramjet + Afterburner Compensator P365', 'Radian Ramjet + Afterburner Compensator P365'],
  ['Timber Creek Outdoors', 'Timber Creek Sig Sauer P365 Extended Magazine Release', 'Timber Creek Sig Sauer P365 Extended Magazine Release'],
  ['DMP Springs', 'DMP Soft RSA',                              'DMP Soft RSA'],
  // Initials.
  ['Taran Tactical Innovations', 'TTI SIG X-MACRO Completed Magazine w/ Versatile Basepad', 'TTI SIG X-MACRO Completed Magazine w/ Versatile Basepad'],
  ['Parker Mountain Machine', 'PMM P365 Compensator',          'PMM P365 Compensator'],
  // A listed alias the rules cannot derive.
  ['MASKAS Precision', 'MPI P365 Single Piece Extended Magazine Release - Macro Frame', 'MPI P365 Single Piece Extended Magazine Release - Macro Frame'],
  // The full brand anywhere in the name, as whole words.
  ['Faxon Firearms', 'Exos Compensator by Faxon Firearms',     'Exos Compensator by Faxon Firearms'],
  // Whole words only: a brand that happens to open a longer word is not a prefix.
  ['Sig Sauer',   'Signature Grip',                            'Sig Sauer Signature Grip'],
  ['Olight',      'Olighting Kit',                             'Olight Olighting Kit'],
  // Another maker's name inside the product name is not this product's brand.
  ['Springer Precision', 'Carry Basepad for Sig Sauer - P365 X-Macro', 'Springer Precision Carry Basepad for Sig Sauer - P365 X-Macro'],
  ['Tactical Development', 'Pro Ledge for TLR7 SUB-1913',      'Tactical Development Pro Ledge for TLR7 SUB-1913'],
  // Edges: no brand, no name, stray whitespace, non-strings.
  [null,          'AMAG 15 SG9',                               'AMAG 15 SG9'],
  ['',            'AMAG 15 SG9',                               'AMAG 15 SG9'],
  ['Magpul',      '',                                          'Magpul'],
  ['Magpul',      null,                                        'Magpul'],
  ['  Magpul ',   '  AMAG   15  SG9 ',                         'Magpul AMAG 15 SG9'],
  ['Sig Sauer',   '  Sig  Sauer  P365 17rd ',                  'Sig Sauer P365 17rd'],
];

for (const [brand, name, expected] of CASES) {
  test(`displayProductName(${JSON.stringify(brand)}, ${JSON.stringify(name)}) → ${JSON.stringify(expected)}`, () => {
    assert.equal(displayProductName({ brand, name }), expected);
    assert.equal(hasDoubledBrand(displayProductName({ brand, name }), brand), false, 'the brand is never doubled');
  });
}

test('displayProductName tolerates a missing object', () => {
  assert.equal(displayProductName(null), '');
  assert.equal(displayProductName({}), '');
});

test('brandForms: full brand, first word, initials, aliases — longest first, lower case', () => {
  assert.deepEqual(brandForms('Sig Sauer'), ['sig sauer', 'sig', 'ss']);
  assert.deepEqual(brandForms('Taran Tactical Innovations'), ['taran tactical innovations', 'taran', 'tti']);
  assert.deepEqual(brandForms('MASKAS Precision'), ['maskas precision', 'maskas', 'mpi', 'mp']);
  assert.deepEqual(brandForms('Holosun'), ['holosun'], 'a one-word brand has no short forms');
  assert.deepEqual(brandForms(''), []);
  assert.deepEqual(brandForms(null), []);
  for (const [b, aliases] of Object.entries(BRAND_ALIASES)) {
    assert.equal(b, b.toLowerCase(), 'BRAND_ALIASES keys are lower case: ' + b);
    for (const a of aliases) assert.equal(a, a.toLowerCase(), 'BRAND_ALIASES values are lower case: ' + a);
  }
});

test('nameCarriesBrand: the decision alone', () => {
  assert.equal(nameCarriesBrand('AMAG 15 SG9', 'Magpul'), false);
  assert.equal(nameCarriesBrand('Magpul AMAG 15 SG9', 'Magpul'), true);
  assert.equal(nameCarriesBrand('TTI SIG X-MACRO', 'Taran Tactical Innovations'), true);
  assert.equal(nameCarriesBrand('TTI SIG X-MACRO', 'Sig Sauer'), false, 'a brand mid-name that is not the full brand does not count');
  assert.equal(nameCarriesBrand('Made by Sig Sauer', 'Sig Sauer'), true);
  assert.equal(nameCarriesBrand('', 'Sig Sauer'), false);
  assert.equal(nameCarriesBrand('P365', ''), false);
});

// The guard the wire check reuses. It must catch every doubled shape the
// rule could have produced, and pass every correct one.
test('hasDoubledBrand catches a brand opening twice in any two of its forms', () => {
  for (const [text, brand] of [
    ['Magpul Magpul AMAG 15 SG9', 'Magpul'],
    ['Sig Sauer SIG P365 17rd', 'Sig Sauer'],
    ['Sig Sauer Sig Sauer P365', 'Sig Sauer'],
    ['Radian Weapons Radian Ramjet', 'Radian Weapons'],
    ['Taran Tactical Innovations TTI SIG X-MACRO', 'Taran Tactical Innovations'],
    ['MASKAS Precision MPI P365', 'MASKAS Precision'],
  ]) assert.equal(hasDoubledBrand(text, brand), true, text);
  for (const [text, brand] of [
    ['Magpul AMAG 15 SG9', 'Magpul'],
    ['Sig Sauer P365 9mm 17rd Magazine (All 9mm Models)', 'Sig Sauer'],
    ['Timber Creek Sig Sauer P365 Extended Magazine Release', 'Timber Creek Outdoors'],
    ['Springer Precision Carry Basepad for Sig Sauer - P365 X-Macro', 'Springer Precision'],
    ['Sig Sauer Signature Grip', 'Sig Sauer'],
    ['', 'Magpul'],
  ]) assert.equal(hasDoubledBrand(text, brand), false, text);
});

// ── the browser copy ──────────────────────────────────────────────────────
// js/display-name.js is the same rule as a plain <script> global, for the
// picker, the build page, the catalog and the profile. Same split as
// js/maker-link.js ↔ _maker-link.mjs, same test shape: run both copies over
// the same inputs and fail if they disagree on ANY of them. The inputs are
// every case above, every live product (scripts/fixtures/product-names.json,
// the catalog as read with the public key — refresh it with
// `node scripts/display-name.test.mjs --refresh-fixture`), and a fuzz over
// the pieces those names are made of. scripts/check-routes.mjs runs the
// same comparison over the live catalog on every scheduled run, so a
// product added after the fixture was captured is covered there.
import { readFile, writeFile } from 'node:fs/promises';

const FIXTURE = join(ROOT, 'scripts/fixtures/product-names.json');

if (process.argv.includes('--refresh-fixture')) {
  const client = await readFile(join(ROOT, 'js/supabase-client.js'), 'utf8');
  const url = client.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
  const key = client.match(/eyJ[A-Za-z0-9._-]+/)[0];
  const res = await fetch(url + '/rest/v1/products?select=slug,category,name,manufacturers!products_brand_id_fkey(name)&is_discontinued=eq.false&order=slug.asc&limit=1000',
    { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!res.ok) throw new Error('PostgREST ' + res.status);
  const rows = await res.json();
  const products = rows.map((r) => ({ slug: r.slug, category: r.category, brand: r.manufacturers ? r.manufacturers.name : null, name: r.name }));
  await writeFile(FIXTURE, JSON.stringify({ captured: new Date().toISOString().slice(0, 10),
    source: 'products?select=slug,category,name,manufacturers!products_brand_id_fkey(name)&is_discontinued=eq.false (public key)',
    products }, null, 1) + '\n');
  console.log('fixture refreshed: ' + products.length + ' live products');
}

const browser = await (async () => {
  const src = await readFile(join(ROOT, 'js/display-name.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();
const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));

test('the fixture is the live catalog shape: slug, category, brand, name on every row', () => {
  assert.ok(Array.isArray(fixture.products) && fixture.products.length >= 200, 'at least 200 live products');
  for (const p of fixture.products) {
    assert.equal(typeof p.slug, 'string');
    assert.equal(typeof p.name, 'string');
    assert.ok(p.brand == null || typeof p.brand === 'string');
  }
});

const PAIRS = [
  ...CASES.map(([brand, name]) => [brand, name]),
  ...fixture.products.map((p) => [p.brand, p.name]),
];

test('both copies agree on displayProductName for every pinned case and every live product', () => {
  for (const [brand, name] of PAIRS) {
    const b = browser.displayProductName({ brand, name });
    const s = displayProductName({ brand, name });
    assert.equal(b, s, `displayProductName(${JSON.stringify({ brand, name })})\n  browser: ${JSON.stringify(b)}\n  server:  ${JSON.stringify(s)}`);
  }
});

test('both copies agree on nameCarriesBrand, brandForms and hasDoubledBrand', () => {
  const brands = [...new Set(PAIRS.map(([b]) => b))];
  for (const brand of brands) {
    assert.deepEqual(browser.brandForms(brand), brandForms(brand), `brandForms(${JSON.stringify(brand)})`);
  }
  for (const [brand, name] of PAIRS) {
    assert.equal(browser.nameCarriesBrand(name, brand), nameCarriesBrand(name, brand), `nameCarriesBrand(${JSON.stringify([name, brand])})`);
    const shown = displayProductName({ brand, name });
    assert.equal(browser.hasDoubledBrand(shown, brand), hasDoubledBrand(shown, brand), `hasDoubledBrand(${JSON.stringify([shown, brand])})`);
    // The helper never INTRODUCES a double. A stored name may already open
    // with two forms of its brand — Herrington Arms calls its magwell "HA
    // Magwell", so "Herrington Arms HA Magwell for P365 X Macro" is the
    // maker's own name and is printed as stored.
    assert.equal(hasDoubledBrand(shown, brand), hasDoubledBrand(name, brand), 'the helper never introduces a doubled brand: ' + shown);
  }
  assert.deepEqual(browser.BRAND_ALIASES, BRAND_ALIASES, 'BRAND_ALIASES is the same table in both files');
});

test('both copies agree over a fuzz of brand and name fragments', () => {
  const brands = [...new Set(PAIRS.map(([b]) => b))].filter(Boolean);
  const words  = [...new Set(PAIRS.flatMap(([, n]) => String(n || '').split(/\s+/)))].filter(Boolean);
  let seed = 20261020;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i++) {
    const brand = rnd(5) === 0 ? ['', null, '  ', 'X', 'A B'][rnd(5)] : brands[rnd(brands.length)];
    const parts = [];
    const len = rnd(6);
    for (let k = 0; k < len; k++) {
      const w = rnd(4) === 0 && brand ? String(brand).split(' ')[rnd(2) ? 0 : 1] || brand : words[rnd(words.length)];
      parts.push(rnd(3) === 0 ? String(w).toUpperCase() : w);
    }
    const name = parts.join(rnd(4) === 0 ? '  ' : ' ');
    const b = browser.displayProductName({ brand, name });
    const s = displayProductName({ brand, name });
    assert.equal(b, s, `fuzz ${JSON.stringify({ brand, name })}: browser ${JSON.stringify(b)} vs server ${JSON.stringify(s)}`);
  }
});
