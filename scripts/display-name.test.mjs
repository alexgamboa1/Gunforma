// display-name.test.mjs — pins netlify/functions/_display-name.mjs and
// js/display-name.js to the naming convention: products.name is the model
// alone, the brand is manufacturers.name, and a page prints
// displayProductName() (brand + ' ' + name) or the { brand, model } pair
// from displayProductParts(). The convention is the migration
// 20261021160000_product_naming_convention.sql; the fixture here is the
// catalog as it reads once that file is applied, and every row of it is
// held to the convention — a stored name that opens with its brand fails
// this test before it reaches a page.
//
// The one rule the pair still applies is for a FROZEN name — a build's
// parts_snapshot, a part a builder typed — that opens with its brand: one
// leading brand form is stripped. Every case here fails silently in a
// browser: a card reading "Sig Sauer" over "Sig Sauer Romeo-X …", or a hub
// row reading "Magpul Magpul AMAG …", renders perfectly.
//
// Run: node --test scripts/display-name.test.mjs
//      node scripts/display-name.test.mjs --refresh-fixture   (after db push)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { displayProductName, displayProductParts, brandForms, hasDoubledBrand, BRAND_ALIASES } =
  await import(join(ROOT, 'netlify/functions/_display-name.mjs'));

// [brand, stored name, expected model, expected display name]
const CASES = [
  // ── The convention: a catalog row. model IS the name; the display name
  //    is brand + ' ' + name, nothing else.
  ['Holosun',        '507K X2',                                 '507K X2',                                 'Holosun 507K X2'],
  ['Magpul',         'AMAG 15 9mm 15rd Magazine',               'AMAG 15 9mm 15rd Magazine',               'Magpul AMAG 15 9mm 15rd Magazine'],
  ['Sig Sauer',      'P365 9mm 17rd Magazine',                  'P365 9mm 17rd Magazine',                  'Sig Sauer P365 9mm 17rd Magazine'],
  ['Sig Sauer',      'Romeo-X SIG-LOC Compact',                 'Romeo-X SIG-LOC Compact',                 'Sig Sauer Romeo-X SIG-LOC Compact'],
  ['Olight',         'Osight SE',                               'Osight SE',                               'Olight Osight SE'],
  ['Streamlight',    'TLR-7 HL-X',                              'TLR-7 HL-X',                              'Streamlight TLR-7 HL-X'],
  ['Herrington Arms', 'P365 XMacro Magwell',                    'P365 XMacro Magwell',                     'Herrington Arms P365 XMacro Magwell'],
  ['Icarus Precision', '311',                                   '311',                                     'Icarus Precision 311'],
  // A brand form followed by a HYPHEN is not the brand: True Precision's
  // True-Lock keeps its "True-".
  ['True Precision', 'True-Lock Compensator',                   'True-Lock Compensator',                   'True Precision True-Lock Compensator'],
  // Whole words only: a brand that happens to open a longer word is not a
  // prefix, and a brand mid-name is left where it is.
  ['Sig Sauer',      'Signature Grip',                          'Signature Grip',                          'Sig Sauer Signature Grip'],
  ['Olight',         'Olighting Kit',                           'Olighting Kit',                           'Olight Olighting Kit'],
  ['Springer Precision', 'Carry Basepad for Sig Sauer - P365 X-Macro', 'Carry Basepad for Sig Sauer - P365 X-Macro', 'Springer Precision Carry Basepad for Sig Sauer - P365 X-Macro'],
  ['Faxon Firearms', 'Exos Compensator by Faxon Firearms',      'Exos Compensator by Faxon Firearms',      'Faxon Firearms Exos Compensator by Faxon Firearms'],
  // ── A frozen name (parts_snapshot, a typed part): one leading brand
  //    form is stripped — the full name, any case …
  ['Holosun',        'Holosun 507K X2',                         '507K X2',                                 'Holosun 507K X2'],
  ['Sig Sauer',      'Sig Sauer Romeo-X Enclosed Compact',      'Romeo-X Enclosed Compact',                'Sig Sauer Romeo-X Enclosed Compact'],
  ['Sig Sauer',      'SIG SAUER P365 17rd',                     'P365 17rd',                               'Sig Sauer P365 17rd'],
  ['True Precision', 'True Precision Axiom P365',               'Axiom P365',                              'True Precision Axiom P365'],
  ['ECM/LWS',        'ECM/LWS Collab Ported Barrel',            'Collab Ported Barrel',                    'ECM/LWS Collab Ported Barrel'],
  // … the first word of a multi-word brand …
  ['Sig Sauer',      'SIG P365 17rd',                           'P365 17rd',                               'Sig Sauer P365 17rd'],
  ['Radian Weapons', 'Radian Ramjet + Afterburner Compensator P365', 'Ramjet + Afterburner Compensator P365', 'Radian Weapons Ramjet + Afterburner Compensator P365'],
  ['DMP Springs',    'DMP Soft RSA',                            'Soft RSA',                                'DMP Springs Soft RSA'],
  // … its initials …
  ['Taran Tactical Innovations', 'TTI SIG X-MACRO Completed Magazine w/ Versatile Basepad', 'SIG X-MACRO Completed Magazine w/ Versatile Basepad', 'Taran Tactical Innovations SIG X-MACRO Completed Magazine w/ Versatile Basepad'],
  ['Parker Mountain Machine', 'PMM P365 Compensator',           'P365 Compensator',                        'Parker Mountain Machine P365 Compensator'],
  // … or a listed alias.
  ['MASKAS Precision', 'MPI P365 Single Piece Extended Magazine Release - Macro Frame', 'P365 Single Piece Extended Magazine Release - Macro Frame', 'MASKAS Precision P365 Single Piece Extended Magazine Release - Macro Frame'],
  // A separator after the brand (and its space) goes with it; a separator
  // glued to the brand is the hyphen rule above, and stays.
  ['Holosun',        'Holosun - 507K X2',                       '507K X2',                                 'Holosun 507K X2'],
  ['Holosun',        'Holosun: 507K X2',                        'Holosun: 507K X2',                        'Holosun Holosun: 507K X2'],
  // ONE form is stripped, and nothing is edited beyond that: the old
  // Herrington name doubled its own brand (HA is the initials), a frozen
  // copy of it still does, and it is printed as the maker wrote it. The
  // helper never INTRODUCES a double; the assertion below says exactly
  // that.
  ['Herrington Arms', 'Herrington Arms HA Magwell for P365 X Macro', 'HA Magwell for P365 X Macro',        'Herrington Arms HA Magwell for P365 X Macro'],
  ['Sig Sauer',      'Sig Sauer SIG P365',                      'SIG P365',                                'Sig Sauer SIG P365'],
  // A name that IS the brand keeps it as its model (a card with no second
  // line is worse) and is printed once as a display name.
  ['Olight',         'Olight',                                  'Olight',                                  'Olight'],
  // Edges: no brand, no name, stray whitespace, non-strings.
  [null,             'AMAG 15 SG9',                             'AMAG 15 SG9',                             'AMAG 15 SG9'],
  ['',               'AMAG 15 SG9',                             'AMAG 15 SG9',                             'AMAG 15 SG9'],
  ['Magpul',         '',                                        '',                                        'Magpul'],
  ['Magpul',         null,                                      '',                                        'Magpul'],
  ['  Magpul ',      '  AMAG   15  SG9 ',                       'AMAG 15 SG9',                             'Magpul AMAG 15 SG9'],
  ['Sig Sauer',      '  Sig  Sauer  P365 17rd ',                'P365 17rd',                               'Sig Sauer P365 17rd'],
];

for (const [brand, name, model, shown] of CASES) {
  test(`displayProductParts / displayProductName(${JSON.stringify(brand)}, ${JSON.stringify(name)})`, () => {
    assert.deepEqual(displayProductParts({ brand, name }), { brand: (brand || '').trim().replace(/\s+/g, ' '), model });
    assert.equal(displayProductName({ brand, name }), shown);
    assert.equal(hasDoubledBrand(shown, brand), hasDoubledBrand(name, brand), 'the helper never introduces a doubled brand: ' + shown);
  });
}

test('both helpers tolerate a missing object', () => {
  assert.equal(displayProductName(null), '');
  assert.equal(displayProductName({}), '');
  assert.deepEqual(displayProductParts(null), { brand: '', model: '' });
  assert.deepEqual(displayProductParts({}), { brand: '', model: '' });
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

// The guard the wire check reuses. It must catch every doubled shape a
// stored name could take, and pass every correct one.
test('hasDoubledBrand catches a brand opening twice in any two of its forms', () => {
  for (const [text, brand] of [
    ['Magpul Magpul AMAG 15 SG9', 'Magpul'],
    ['Sig Sauer SIG P365 17rd', 'Sig Sauer'],
    ['Sig Sauer Sig Sauer P365', 'Sig Sauer'],
    ['Radian Weapons Radian Ramjet', 'Radian Weapons'],
    ['Taran Tactical Innovations TTI SIG X-MACRO', 'Taran Tactical Innovations'],
    ['MASKAS Precision MPI P365', 'MASKAS Precision'],
    ['Herrington Arms HA Magwell', 'Herrington Arms'],
  ]) assert.equal(hasDoubledBrand(text, brand), true, text);
  for (const [text, brand] of [
    ['Magpul AMAG 15 SG9', 'Magpul'],
    ['Sig Sauer P365 9mm 17rd Magazine', 'Sig Sauer'],
    ['Sig Sauer Romeo-X SIG-LOC Compact', 'Sig Sauer'],
    ['True Precision True-Lock Compensator', 'True Precision'],
    ['Timber Creek Outdoors Sig Sauer P365 Extended Magazine Release', 'Timber Creek Outdoors'],
    ['Springer Precision Carry Basepad for Sig Sauer - P365 X-Macro', 'Springer Precision'],
    ['Sig Sauer Signature Grip', 'Sig Sauer'],
    ['', 'Magpul'],
  ]) assert.equal(hasDoubledBrand(text, brand), false, text);
});

// ── the fixture, and the browser copy ────────────────────────────────────
// scripts/fixtures/product-names.json is the live catalog as read with the
// public key once the naming migration is applied — refresh it with
// `node scripts/display-name.test.mjs --refresh-fixture` after `db push`
// and expect no diff. js/display-name.js is the same rule as a plain
// <script> global, for the picker, the build page, the catalog and the
// profile. Same split as js/maker-link.js ↔ _maker-link.mjs, same test
// shape: both copies over the same inputs — every case above, every
// fixture row, and a fuzz over the pieces those names are made of — and
// fail if they disagree on ANY of them. scripts/check-routes.mjs runs the
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

test('the convention holds on every fixture row: the stored name is the model alone, and the display name is brand + name', () => {
  for (const p of fixture.products) {
    assert.ok(p.brand, `${p.slug} has a brand`);
    assert.equal(displayProductParts(p).model, p.name, `${p.slug}: "${p.name}" opens with a form of its brand "${p.brand}" — rename the product, not the rule`);
    assert.equal(displayProductName(p), p.brand + ' ' + p.name, p.slug);
    assert.equal(hasDoubledBrand(displayProductName(p), p.brand), false, p.slug);
  }
});

const PAIRS = [
  ...CASES.map(([brand, name]) => [brand, name]),
  ...fixture.products.map((p) => [p.brand, p.name]),
];

const same = (brand, name) => {
  assert.deepEqual(browser.displayProductParts({ brand, name }), displayProductParts({ brand, name }), `displayProductParts(${JSON.stringify({ brand, name })})`);
  assert.equal(browser.displayProductName({ brand, name }), displayProductName({ brand, name }), `displayProductName(${JSON.stringify({ brand, name })})`);
  const shown = displayProductName({ brand, name });
  assert.equal(browser.hasDoubledBrand(shown, brand), hasDoubledBrand(shown, brand), `hasDoubledBrand(${JSON.stringify([shown, brand])})`);
};

test('both copies agree on every pinned case and every fixture row', () => {
  for (const [brand, name] of PAIRS) same(brand, name);
  for (const brand of [...new Set(PAIRS.map(([b]) => b))]) {
    assert.deepEqual(browser.brandForms(brand), brandForms(brand), `brandForms(${JSON.stringify(brand)})`);
  }
  assert.deepEqual(browser.BRAND_ALIASES, BRAND_ALIASES, 'BRAND_ALIASES is the same table in both files');
});

test('both copies agree over a fuzz of brand and name fragments', () => {
  const brands = [...new Set(PAIRS.map(([b]) => b))].filter(Boolean);
  const words  = [...new Set(PAIRS.flatMap(([, n]) => String(n || '').split(/\s+/)))].filter(Boolean);
  let seed = 20261021;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i++) {
    const brand = rnd(5) === 0 ? ['', null, '  ', 'X', 'A B'][rnd(5)] : brands[rnd(brands.length)];
    const parts = [];
    const len = rnd(6);
    for (let k = 0; k < len; k++) {
      const w = rnd(4) === 0 && brand ? String(brand).split(' ')[rnd(2) ? 0 : 1] || brand : words[rnd(words.length)];
      parts.push(rnd(3) === 0 ? String(w).toUpperCase() : w);
    }
    const name = parts.join([' ', '  ', ' - ', '-'][rnd(4)]);
    same(brand, name);
  }
});
