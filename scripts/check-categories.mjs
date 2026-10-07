#!/usr/bin/env node
// check-categories — one category list on every surface.
//
// WHAT IT CAUGHT BEFORE IT EXISTED. Five surfaces each named the same
// products.category values, by hand, differently: the build said "Grip
// Modules", the catalog "Frame Modules", the server's list "Frame", add-a-part
// "Grip module (frame)"; "Basepads" against "Base plate"; "Magazine Release"
// against "Magazine Releases". Every one rendered perfectly. And a category
// added to one list and not another ships a part nobody can reach.
//
// THE SOURCES. js/category-map.js (browser) and
// netlify/functions/_category-meta.mjs (server) hold every category with its
// URL segment and two names. Two copies, because the pages have no module
// loader and the functions are ESM; this check is what keeps them one list.
//
// Five assertions:
//   1. The two sources are identical: same categories, same order, same
//      segment, same plural, same singular.
//   2. Every category sits in exactly one build section
//      (js/build-categories.js), so the builder can pick it.
//   3. No other file carries its own category list. A file that maps three
//      or more category values to strings is a hand-written copy.
//   4. product-page.mjs's SPEC_TABLES covers every category except those
//      declared to have no spec sheet, and names nothing else.
//   5. Every page that reads the browser source's globals loads it.
//
// It cannot see the live enum: the build has no database access, and the
// API description is closed to the public key. scripts/check-routes.mjs
// covers that against production on a schedule — every category that has a
// product must be in these lists.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const read = (f) => readFile(join(ROOT, f), 'utf8');

// ── the two sources ───────────────────────────────────────────────────────
const browser = {};
new Function('window', await read('js/category-map.js'))(browser);
const server = await import(pathToFileURL(join(ROOT, 'netlify/functions/_category-meta.mjs')).href);

const bKeys = Object.keys(browser.PRODUCT_CATEGORIES || {});
const sKeys = Object.keys(server.CATEGORY_META || {});
if (!bKeys.length) fail.push('js/category-map.js published no PRODUCT_CATEGORIES');
if (!sKeys.length) fail.push('_category-meta.mjs exports no CATEGORY_META');

// ── 1. identical ──────────────────────────────────────────────────────────
if (bKeys.join('|') !== sKeys.join('|')) {
  fail.push('the two sources list different categories, or in a different order:\n'
          + `      js/category-map.js:    ${bKeys.join(', ')}\n`
          + `      _category-meta.mjs:    ${sKeys.join(', ')}`);
}
for (const k of bKeys) {
  const b = browser.PRODUCT_CATEGORIES[k], s = server.CATEGORY_META[k];
  if (!s) continue;
  if (JSON.stringify(b) !== JSON.stringify(s)) {
    fail.push(`'${k}' differs: js/category-map.js ${JSON.stringify(b)} vs _category-meta.mjs ${JSON.stringify(s)}`);
  }
  if (!Array.isArray(b) || b.length !== 3 || b.some((x) => typeof x !== 'string' || !x.trim())) {
    fail.push(`'${k}' must be [URL segment, plural, singular], all non-empty: ${JSON.stringify(b)}`);
  }
  if (b && /[A-Z_ ]/.test(b[0])) fail.push(`'${k}' segment '${b[0]}' must be lowercase-with-hyphens`);
}
const segs = bKeys.map((k) => browser.PRODUCT_CATEGORIES[k][0]);
if (new Set(segs).size !== segs.length) fail.push('two categories share a URL segment');
for (const i of [1, 2]) {
  const names = bKeys.map((k) => browser.PRODUCT_CATEGORIES[k][i]);
  if (new Set(names).size !== names.length) fail.push(`two categories share a ${i === 1 ? 'plural' : 'singular'} name`);
}

// ── 2. every category in exactly one build section ────────────────────────
const sandbox = {};
try {
  new Function('window', await read('js/category-map.js'))(sandbox);
  new Function('window', await read('js/build-categories.js'))(sandbox);
} catch (e) {
  fail.push(`js/build-categories.js does not evaluate after js/category-map.js: ${e.message}`);
}
const BC = sandbox.BuildCategories;
if (BC) {
  for (const k of bKeys) {
    const holders = BC.CATEGORIES.filter((c) => (c.dbCategory || []).includes(k)).map((c) => c.key);
    if (holders.length !== 1) {
      fail.push(`category '${k}' is in ${holders.length} build sections (${holders.join(', ') || 'none'}) — it must be in exactly one, `
              + 'or the builder cannot pick it');
    }
  }
  for (const c of BC.CATEGORIES) {
    for (const d of c.dbCategory || []) {
      if (!bKeys.includes(d)) fail.push(`build section '${c.key}' names '${d}', which is not a category`);
    }
    // a one-category section reads as that category
    if ((c.dbCategory || []).length === 1 && c.label !== browser.categoryPlural(c.dbCategory[0])) {
      fail.push(`build section '${c.key}' reads '${c.label}' but its category '${c.dbCategory[0]}' is `
              + `'${browser.categoryPlural(c.dbCategory[0])}'`);
    }
  }
}

// ── 3. no hand-written copies ─────────────────────────────────────────────
const SOURCES = new Set(['js/category-map.js', 'netlify/functions/_category-meta.mjs']);
const files = [];
for (const dir of ['.', 'js', 'netlify/functions']) {
  for (const f of await readdir(join(ROOT, dir))) {
    if (/\.(html|js|mjs)$/.test(f)) files.push(dir === '.' ? f : dir + '/' + f);
  }
}
const keyAlt = bKeys.map((k) => k.replace(/_/g, '_')).join('|');
// `frame: 'Frame Modules'` (object form) and `['frame', 'Grip module']` (tuple form)
const objRe = new RegExp(`(?<![\\w.'"])(${keyAlt})\\s*:\\s*['"]`, 'g');
const tupRe = new RegExp(`\\[\\s*['"](${keyAlt})['"]\\s*,\\s*['"]`, 'g');
for (const f of files) {
  if (SOURCES.has(f)) continue;
  const src = await read(f);
  const hits = new Set();
  for (const m of src.matchAll(objRe)) hits.add(m[1]);
  for (const m of src.matchAll(tupRe)) hits.add(m[1]);
  if (hits.size >= 3) {
    fail.push(`${f} maps ${hits.size} categories to strings itself (${[...hits].join(', ')}) — read js/category-map.js `
            + '(browser) or _category-meta.mjs (server) instead of carrying a copy');
  }
}

// ── 4. product-page spec tables ───────────────────────────────────────────
const pp = await read('netlify/functions/product-page.mjs');
const specBlock = pp.slice(pp.indexOf('const SPEC_TABLES = {'));
const specKeys = new Set([...specBlock.slice(0, specBlock.indexOf('\n};')).matchAll(/^ {2}(\w+): \['/gm)].map((m) => m[1]));
const without = new Set(server.CATEGORIES_WITHOUT_SPEC_SHEET || []);
if (!specKeys.size) fail.push('extracted 0 SPEC_TABLES keys from product-page.mjs — the extraction has gone stale');
for (const k of bKeys) {
  if (!specKeys.has(k) && !without.has(k)) {
    fail.push(`product-page.mjs SPEC_TABLES has no '${k}', and it is not in CATEGORIES_WITHOUT_SPEC_SHEET — its spec sheet would never render`);
  }
  if (specKeys.has(k) && without.has(k)) fail.push(`'${k}' is in SPEC_TABLES and in CATEGORIES_WITHOUT_SPEC_SHEET`);
}
for (const k of specKeys) if (!bKeys.includes(k)) fail.push(`product-page.mjs SPEC_TABLES names '${k}', which is not a category`);

// ── 5. pages that read the browser source load it ─────────────────────────
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const src = await read(f);
  const inline = src.replace(/<script src=[^>]*><\/script>/g, '');
  if (/\b(categoryPlural|categorySingular|CATEGORY_KEYS|PRODUCT_CATEGORIES|productPath|CATEGORY_URL_SEGMENT)\b/.test(inline)
      && !src.includes('src="js/category-map.js"')) {
    fail.push(`${f} reads the category globals but never loads js/category-map.js`);
  }
}

if (fail.length) {
  console.error('category check FAILED:\n');
  for (const f of fail) console.error(`  - ${f}`);
  console.error(`\n${fail.length} problem(s).`);
  process.exit(1);
}
console.log(`ok: ${bKeys.length} categories, identical in the browser and server sources; each in exactly one build `
          + `section; no file carries its own list (${files.length} scanned); product-page covers ${specKeys.size} spec sheets `
          + `+ ${without.size} without`);
