// Guards the parts catalog's sidebar wiring against the bug that shipped on
// 2026-11-18: attachFilterHandlers() attached its generic platform / category
// / brand handler to EVERY checkbox in #sidebar, and an unnamed checkbox (the
// spec filters carry data-spec-composite and no name attribute) fell through
// to 'brands' — so ticking "Finish = Polymer" also added the checkbox default
// value "on" to F.brands, no product has brand_id "on", and the grid emptied
// while the facet count beside the checkbox still said 13.
//
// The functions under test are lifted out of gunforma-parts-catalog.html by
// name and run against a stub DOM and a fixture catalog, the same shape as
// scripts/option-price.test.mjs. The core assertions:
//   - ticking a spec checkbox leaves F.brands empty
//   - the grid count (PRODUCTS.filter(matchesAll)) equals the facet count the
//     sidebar prints beside that checkbox (optionCount with the page's own
//     predicate)
//   - the named brand checkboxes still narrow and restore the grid
// Run: node scripts/spec-filter.test.mjs   (registered in check-all.sh)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// ── lift page functions by name (option-price.test.mjs's shape) ────────────
function liftFn(src, name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at !== -1, 'function ' + name + ' not found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(at + 1, i + 1);
}

// Lift a top-level `var NAME = {...};` / `[...];` declaration verbatim, so a
// scope can run over the PAGE'S OWN schema arrays rather than a copy.
function liftVar(src, name) {
  const at = src.indexOf('\nvar ' + name + ' = ');
  assert.ok(at !== -1, 'var ' + name + ' not found');
  const open = src.slice(at).search(/[[{]/) + at;
  const pair = { '{': '}', '[': ']' };
  const close = pair[src[open]];
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) break;
  }
  return src.slice(at + 1, i + 1) + ';';
}

// ── stub DOM: just enough for attachFilterHandlers ─────────────────────────
function checkbox(attrs) {
  const el = {
    name: attrs.name || '',          // property is '' when the attribute is absent
    value: attrs.value != null ? attrs.value : 'on',   // DOM default for a checkbox
    checked: !!attrs.checked,
    _attrs: attrs,
    _handlers: [],
    getAttribute(k) { return attrs[k] != null ? attrs[k] : null; },
    addEventListener(type, fn) { if (type === 'change') el._handlers.push(fn); },
    // A real change event runs every listener the element holds, in order —
    // which is exactly how the old code's bogus second handler fired.
    fire(checked) { el.checked = checked; el._handlers.forEach((fn) => fn()); },
  };
  return el;
}

function makeDocument(sidebarCheckboxes) {
  return {
    querySelectorAll(sel) {
      if (sel === '#sidebar .filter-search') return [];
      if (sel === '#sidebar input[type="checkbox"]') return sidebarCheckboxes.slice();
      if (sel === '[data-spec-composite]') {
        return sidebarCheckboxes.filter((el) => el.getAttribute('data-spec-composite'));
      }
      return [];
    },
    getElementById() { return null; },   // price-min / price-max absent
  };
}

// ── fixture catalog: 3 frames (2 with a Polymer variant), 1 slide ──────────
const PRODUCTS = [
  { id: 'p1', category: 'frame', brand_id: 'b1', brand: 'Icarus', name: 'A', platform_ids: ['pf1'],
    price: 100, _search: 'a', discontinued: false,
    variants: [{ finish: 'Polymer' }] },
  { id: 'p2', category: 'frame', brand_id: 'b1', brand: 'Icarus', name: 'B', platform_ids: ['pf1'],
    price: 120, _search: 'b', discontinued: false,
    variants: [{ finish: 'Polymer' }, { finish: 'Anodized' }] },
  { id: 'p3', category: 'frame', brand_id: 'b2', brand: 'Wilson', name: 'C', platform_ids: ['pf1'],
    price: 140, _search: 'c', discontinued: false,
    variants: [{ finish: 'Anodized' }] },
  { id: 'p4', category: 'slide', brand_id: 'b2', brand: 'Wilson', name: 'D', platform_ids: ['pf1'],
    price: 300, _search: 'd', discontinued: false,
    variants: [{ finish: 'DLC' }], slide_specs: { integrated_comp: true } },
];

const FINISH_SCHEMA = { source: 'variant', key: 'finish', type: 'strings' };
const COMP_SCHEMA = { source: 'slide_specs', key: 'integrated_comp', type: 'boolean' };

function freshScope() {
  const src = read('gunforma-parts-catalog.html');
  const scope = {
    F: { platforms: new Set(), categories: new Set(), brands: new Set(),
         priceMin: null, priceMax: null, search: '', favsOnly: false,
         showDiscontinued: false, sort: 'newest', specs: {} },
    PRODUCTS,
    FILTER_SEARCH_STATE: {},
    SPEC_FILTERS_BY_CATEGORY: { frame: [FINISH_SCHEMA], slide: [COMP_SCHEMA] },
    SPEC_UNIVERSAL_FILTERS: [],
    renderFilters() {},             // re-render is the real page's concern
    applyFiltersAndRender() {},
    matchesFitment() { return true; },
    Favorites: { has() { return false; }, size() { return 0; } },
    document: null,                 // set per test before attachFilterHandlers
  };
  const fns = ['attachFilterHandlers', 'matchesAllExcept', 'matchesAll',
               'matchesSpecFilter', 'optionCount', 'readSpec', 'specStateKey',
               'schemaForStateKey'];
  const body = fns.map((n) => liftFn(src, n)).join('\n') +
    '\nreturn {' + fns.join(',') + '};';
  const lifted = new Function('scope', 'with (scope) {' + body + '}')(scope);
  return { scope, ...lifted };
}

// The page's own facet-count predicate for a strings spec option
// (specsSectionHtml's optionCount callback, verbatim in shape).
function facetCount(page, schema, v) {
  const stateKey = page.specStateKey(schema);
  return page.optionCount(function (r) {
    const actual = page.readSpec(r, schema.source, schema.key);
    if (schema.source === 'variant') return actual instanceof Set && actual.has(v);
    return String(actual) === String(v);
  }, '__spec__' + stateKey);
}

test('ticking a spec checkbox leaves F.brands empty and the grid count equals the facet count', () => {
  const page = freshScope();
  const F = page.scope.F;
  F.categories.add('frame');

  const polymer = checkbox({ 'data-spec-composite': 'variant:finish',
                             'data-spec-widget': 'str', 'data-spec-val': 'Polymer' });
  const brandB1 = checkbox({ name: 'brand', value: 'b1' });
  page.scope.document = makeDocument([brandB1, polymer]);
  page.attachFilterHandlers();

  polymer.fire(true);

  assert.equal(F.brands.size, 0,
    'an unnamed spec checkbox must never reach the brand set (the old code added "on")');
  assert.ok(F.specs['variant:finish'] && F.specs['variant:finish'].values.has('Polymer'),
    'the spec handler itself still records the tick');

  const grid = PRODUCTS.filter(page.matchesAll).length;
  assert.equal(grid, facetCount(page, FINISH_SCHEMA, 'Polymer'),
    'grid count must equal the facet count beside the ticked checkbox');
  assert.equal(grid, 2, 'the two frames with a Polymer variant');

  // Unticking clears the spec constraint entirely.
  polymer.fire(false);
  assert.equal(F.specs['variant:finish'], undefined, 'empty values set drops the key');
  assert.equal(PRODUCTS.filter(page.matchesAll).length, 3, 'back to every frame');
});

test('named brand checkboxes still narrow the grid and restore it on untick', () => {
  const page = freshScope();
  const F = page.scope.F;
  F.categories.add('frame');

  const brandB1 = checkbox({ name: 'brand', value: 'b1' });
  const polymer = checkbox({ 'data-spec-composite': 'variant:finish',
                             'data-spec-widget': 'str', 'data-spec-val': 'Polymer' });
  page.scope.document = makeDocument([brandB1, polymer]);
  page.attachFilterHandlers();

  brandB1.fire(true);
  assert.deepEqual(Array.from(F.brands), ['b1'], 'the named handler still writes the real id');
  assert.equal(PRODUCTS.filter(page.matchesAll).length, 2, 'the two Icarus frames');

  brandB1.fire(false);
  assert.equal(F.brands.size, 0);
  assert.equal(PRODUCTS.filter(page.matchesAll).length, 3, 'untick restores the count');
});

test('a boolean spec toggle narrows without touching F.brands', () => {
  const page = freshScope();
  const F = page.scope.F;
  F.categories.add('slide');

  const comp = checkbox({ 'data-spec-composite': 'slide_specs:integrated_comp',
                          'data-spec-widget': 'boolean' });
  page.scope.document = makeDocument([comp]);
  page.attachFilterHandlers();

  comp.fire(true);
  assert.equal(F.brands.size, 0, 'the boolean "Yes" toggle is unnamed too');
  assert.equal(PRODUCTS.filter(page.matchesAll).length, 1, 'the one comped slide');

  comp.fire(false);
  assert.equal(F.specs['slide_specs:integrated_comp'], undefined);
  assert.equal(PRODUCTS.filter(page.matchesAll).length, 1, 'one slide in the fixture either way');
});

test('the generic handler names its three groups in the page source', () => {
  // The guard the fix added: only name 'platform' | 'category' | 'brand' may
  // reach the set-mapping handler. A refactor that goes back to defaulting
  // el.name into 'brands' fails here before it fails a reader.
  const src = read('gunforma-parts-catalog.html');
  assert.match(src, /var SET_KEY_BY_GROUP = \{ platform: 'platforms', category: 'categories', brand: 'brands' \};/);
  assert.match(src, /var setKey = SET_KEY_BY_GROUP\[el\.name\];\s*\n\s*if \(!setKey\) return;/);
});

// ════════════════════════════════════════════════════════════════════════════
// The Material filter (2026-11-19). products.material_family is a
// product-level fact — source 'product', a third readSpec source — shown
// only where the scope holds two or more families, ordered by
// materials.sort_order, never offering "Unspecified"; and grip modules
// (frame) ask Material INSTEAD of Finish (AG: material and finish are
// separate, and Finish = "Polymer" was standing in for material). These
// tests run the PAGE'S OWN schema arrays (lifted, not copied), so a schema
// edit that loses the material entry or the frame hideFor fails here.

function freshPageScope() {
  const src = read('gunforma-parts-catalog.html');
  const scope = {
    F: { platforms: new Set(), categories: new Set(), brands: new Set(),
         priceMin: null, priceMax: null, search: '', favsOnly: false,
         showDiscontinued: false, sort: 'newest', specs: {} },
    PRODUCTS: [],
    MATERIAL_SORT: { Aluminum: 10, 'Stainless Steel': 20, Steel: 30, Polymer: 40, Titanium: 50, Mixed: 90, Unspecified: 99 },
    FILTER_SEARCH_STATE: {},
    renderFilters() {},
    applyFiltersAndRender() {},
    matchesFitment() { return true; },
    Favorites: { has() { return false; }, size() { return 0; } },
    document: null,
  };
  const fns = ['attachFilterHandlers', 'matchesAllExcept', 'matchesAll',
               'matchesSpecFilter', 'optionCount', 'readSpec', 'specStateKey',
               'schemaForStateKey', 'specsSectionHtml', 'specLabel',
               'schemaLabel', 'wrapOptionsListIfLong', 'productsForSpecScope',
               'esc', 'escAttr'];
  const vars = ['SPEC_ABBREV', 'SPEC_FILTERS_BY_CATEGORY', 'SPEC_UNIVERSAL_FILTERS'];
  const body = vars.map((n) => liftVar(src, n)).join('\n') + '\n' +
    fns.map((n) => liftFn(src, n)).join('\n') +
    '\nreturn {' + fns.concat(vars).join(',') + '};';
  const lifted = new Function('scope', 'with (scope) {' + body + '}')(scope);
  return { scope, ...lifted };
}

function frame(id, family, color, finish, brand) {
  return { id, category: 'frame', brand_id: brand || 'b1', brand: 'Icarus', name: id,
    platform_ids: ['pf1'], price: 100, _search: id, discontinued: false,
    material_family: family, material: family,
    variants: [{ color, finish: finish || null }] };
}
function slide(id, finish) {
  return { id, category: 'slide', brand_id: 'b2', brand: 'Norsso', name: id,
    platform_ids: ['pf1'], price: 300, _search: id, discontinued: false,
    material_family: 'Stainless Steel', material: 'Stainless Steel',
    variants: [{ color: 'Black', finish }] };
}
const PAGE_PRODUCTS = [
  frame('f1', 'Polymer', 'Black'),
  frame('f2', 'Polymer', 'Coyote'),
  frame('f3', 'Aluminum', 'Black', 'Anodized'),
  frame('f4', 'Mixed', 'Gray', 'Anodized'),
  frame('f5', 'Unspecified', 'Black'),
  slide('s1', 'DLC'),
  slide('s2', 'Cerakote'),
];

test('a product-level Material tick narrows the grid, leaves F.brands empty, grid == facet', () => {
  const page = freshPageScope();
  const F = page.scope.F;
  page.scope.PRODUCTS = PAGE_PRODUCTS;
  F.categories.add('frame');

  const polymer = checkbox({ 'data-spec-composite': 'product:material_family',
                             'data-spec-widget': 'str', 'data-spec-val': 'Polymer' });
  const brandB1 = checkbox({ name: 'brand', value: 'b1' });
  page.scope.document = makeDocument([brandB1, polymer]);
  page.attachFilterHandlers();

  polymer.fire(true);
  assert.equal(F.brands.size, 0, 'a Material tick must never reach the brand set');
  assert.ok(F.specs['product:material_family'] && F.specs['product:material_family'].values.has('Polymer'),
    'the material schema resolves through schemaForStateKey (it must exist in the page arrays)');

  const grid = page.scope.PRODUCTS.filter(page.matchesAll).length;
  const facet = page.optionCount(function (r) {
    return String(page.readSpec(r, 'product', 'material_family')) === 'Polymer';
  }, '__spec__product:material_family');
  assert.equal(grid, 2, 'the two Polymer frames');
  assert.equal(grid, facet, 'grid count equals the facet count beside the ticked material');

  polymer.fire(false);
  assert.equal(F.specs['product:material_family'], undefined, 'untick drops the key');
  assert.equal(page.scope.PRODUCTS.filter(page.matchesAll).length, 5,
    'back to every frame — the Unspecified part reachable with nothing ticked');
});

test('Material combines with a variant-level Color filter', () => {
  const page = freshPageScope();
  const F = page.scope.F;
  page.scope.PRODUCTS = PAGE_PRODUCTS;
  F.categories.add('frame');

  const polymer = checkbox({ 'data-spec-composite': 'product:material_family',
                             'data-spec-widget': 'str', 'data-spec-val': 'Polymer' });
  const black = checkbox({ 'data-spec-composite': 'variant:color',
                           'data-spec-widget': 'str', 'data-spec-val': 'Black' });
  page.scope.document = makeDocument([polymer, black]);
  page.attachFilterHandlers();

  polymer.fire(true);
  black.fire(true);
  const grid = page.scope.PRODUCTS.filter(page.matchesAll).length;
  assert.equal(grid, 1, 'the one Black Polymer frame');
  // The Black facet count, with the colour key's own constraint excluded,
  // is what the sidebar prints beside Black — and must equal the grid.
  const facet = page.optionCount(function (r) {
    const actual = page.readSpec(r, 'variant', 'color');
    return actual instanceof Set && actual.has('Black');
  }, '__spec__variant:color');
  assert.equal(grid, facet, 'grid count equals the Black facet count');
});

test('the Material block needs two families, hides Unspecified, and follows sort_order', () => {
  const page = freshPageScope();
  const F = page.scope.F;
  page.scope.PRODUCTS = PAGE_PRODUCTS;

  F.categories.add('frame');
  let html = page.specsSectionHtml();
  assert.ok(html.includes('data-spec-block="product:material_family"'),
    'frames (three families) render the Material block');
  assert.ok(!html.includes('Unspecified'), 'Unspecified is never an option');
  const iAl = html.indexOf('data-spec-val="Aluminum"');
  const iPo = html.indexOf('data-spec-val="Polymer"');
  const iMx = html.indexOf('data-spec-val="Mixed"');
  assert.ok(iAl !== -1 && iPo !== -1 && iMx !== -1, 'all three families offered');
  assert.ok(iAl < iPo && iPo < iMx,
    'options follow materials.sort_order (Mixed last), not the alphabet (Mixed second)');

  F.categories.clear(); F.categories.add('slide');
  html = page.specsSectionHtml();
  assert.ok(!html.includes('data-spec-block="product:material_family"'),
    'one family in scope renders no Material block');
});

test('Finish hides on grip modules — and a hidden tick stops filtering', () => {
  const page = freshPageScope();
  const F = page.scope.F;
  page.scope.PRODUCTS = PAGE_PRODUCTS;

  F.categories.add('slide');
  let html = page.specsSectionHtml();
  assert.ok(html.includes('data-spec-block="variant:finish"'),
    'Finish still renders for slides');

  F.categories.clear(); F.categories.add('frame');
  F.specs['variant:finish'] = { schema: page.SPEC_UNIVERSAL_FILTERS.find((s) => s.key === 'finish'),
    type: 'strings', values: new Set(['Anodized']) };
  html = page.specsSectionHtml();
  assert.ok(!html.includes('data-spec-block="variant:finish"'),
    'no Finish block when the one selected category is frame');
  assert.equal(F.specs['variant:finish'], undefined,
    'the hidden block takes its ticked state with it — no invisible constraint');
  assert.equal(page.scope.PRODUCTS.filter(page.matchesAll).length, 5,
    'every frame shown: the stale Anodized tick no longer filters');
});
