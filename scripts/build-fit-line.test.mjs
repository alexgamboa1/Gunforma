// js/build-fit-line.js — the product page's "Fits your build" line.
//
// WHY: every failure here renders a perfectly normal product page. A line
// that reads the WRONG rows judges confidently and wrong; one that renders
// over a failed read turns a network blip into "Doesn't fit"; one that
// fires without a build in progress adds reads to the two most crawled
// routes on the site for every visitor. The verdict RULES are pinned by
// scripts/armory-fit.test.mjs — this file pins what build-fit-line.js is
// trusted with: when it reads, what it reads, and when it says nothing.
//
// Run: node --test scripts/build-fit-line.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const GUN = { id: 'gun-xmacro', slug: 'p365-xmacro', name: 'P365 XMacro', housing_class: 'xmacro',
  barrel_length_in: '3.7', slide_length_in: '3.7', integrated_comp: false,
  grip_fit_tier: 'xmacro', slide_fit_tier: 'xmacro', slide_comp_style: 'none' };
const FUSE_GUN = { ...GUN, id: 'gun-fuse', slug: 'p365-fuse', name: 'P365 FUSE', slide_fit_tier: 'fuse', barrel_length_in: '4.3', slide_length_in: '4.3' };

function makeSb(answers) {
  const sb = { reads: [] };
  sb.from = (table) => {
    const call = { table, filters: [] };
    const q = {
      select(cols) { call.cols = cols; return q; },
      eq(c, v) { call.filters.push([c, v]); return q; },
      in(c, v) { call.filters.push([c, v]); return q; },
      then(res, rej) {
        sb.reads.push(call);
        const a = answers(call);
        return Promise.resolve(a === undefined ? { data: [], error: null } : a).then(res, rej);
      },
    };
    return q;
  };
  return sb;
}

function page({ draft, product, answers } = {}) {
  const els = {};
  const el = (id, attrs) => ({ id, hidden: true, innerHTML: '',
    getAttribute: (k) => (attrs || {})[k] || null });
  const ctx = { console, Promise, setTimeout };
  ctx.window = ctx;
  const store = {};
  if (draft) store['gf-armory-build-v2'] = JSON.stringify(draft);
  ctx.localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  const line = product ? el('build-fit-line', { 'data-product-id': product.id, 'data-category': product.category }) : null;
  ctx.document = { getElementById: (id) => (id === 'build-fit-line' ? line : null) };
  ctx.sb = makeSb(answers || (() => undefined));
  vm.createContext(ctx);
  for (const f of ['js/slide-fit.js', 'js/armory-fit.js', 'js/build-fit-line.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return { ctx, line, sb: ctx.sb };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

const BUILD = { platformId: 'plat', gunId: 'gun-xmacro', gunMode: 'model', picks: {} };

test('no build in progress — or one carrying an identity — reads nothing and renders nothing', async () => {
  const none = page({ product: { id: 'p1', category: 'barrel' } });
  await settle();
  assert.equal(none.sb.reads.length, 0, 'no draft: no reads on a crawled route');
  assert.equal(none.line.hidden, true);

  const editing = page({ draft: { ...BUILD, savedId: 'row-1' }, product: { id: 'p1', category: 'barrel' } });
  await settle();
  assert.equal(editing.sb.reads.length, 0, 'an open saved build belongs to its ?edit=, not this line');
  assert.equal(editing.line.hidden, true);
});

test('a part already in the build says so without a single read', async () => {
  const p = page({ draft: { ...BUILD, picks: { trigger: { productId: 'trig-9' } } },
    product: { id: 'trig-9', category: 'trigger' } });
  await settle();
  assert.equal(p.sb.reads.length, 0);
  assert.equal(p.line.hidden, false);
  assert.match(p.line.innerHTML, /In your build/);
});

test('a barrel the picked ported slide refuses reads the right rows and says why', async () => {
  const answers = (call) => {
    if (call.table === 'guns') return { data: [GUN], error: null };
    if (call.table === 'slide_specs') return { data: [{ product_id: 'slide-c', barrel_length_in: '3.7', slide_length_in: '3.7',
      internally_ported: true, integrated_comp: false, threaded_barrel_ok: false, port_style: 'c-port', fit_tier: 'xmacro', comp_style: 'none' }], error: null };
    if (call.table === 'barrel_specs') return { data: [{ product_id: 'b-std', barrel_length_in: '3.7', barrel_type: 'standard' }], error: null };
    if (call.table === 'barrel_slide_requirements') return { data: [], error: null };
  };
  const p = page({ draft: { ...BUILD, picks: { slide: { productId: 'slide-c' } } },
    product: { id: 'b-std', category: 'barrel' }, answers });
  await settle(); await settle(); await settle();
  assert.equal(p.line.hidden, false);
  assert.match(p.line.innerHTML, /Doesn’t fit your build/);
  assert.match(p.line.innerHTML, /ported slide needs its maker’s matched barrel/);
  const specRead = p.sb.reads.find((r) => r.table === 'barrel_specs');
  assert.ok(specRead.filters.some(([c, v]) => c === 'product_id' && Array.isArray(v) && v.includes('b-std')),
    'the product’s own spec row is read, never guessed');
});

test('a magazine on a FUSE model asks the maker’s fuse rows', async () => {
  const answers = (call) => {
    if (call.table === 'guns') return { data: [FUSE_GUN], error: null };
    if (call.table === 'magazine_housing_fit') return { data: [
      { housing_class: 'fuse', fit: 'flush', note: 'Factory flush magazine for the FUSE' },
      { housing_class: 'xmacro', fit: 'flush', note: 'Factory magazine for the XMACRO' },
    ], error: null };
  };
  const p = page({ draft: { ...BUILD, gunId: 'gun-fuse' }, product: { id: 'mag-17', category: 'magazine' }, answers });
  await settle(); await settle(); await settle();
  assert.equal(p.line.hidden, false);
  assert.match(p.line.innerHTML, /Fits your build/);
  assert.match(p.line.innerHTML, /FUSE/, 'the fuse row’s note, not the xmacro one');
  const mf = p.sb.reads.find((r) => r.table === 'magazine_housing_fit');
  assert.deepEqual(mf.filters, [['magazine_product_id', 'mag-17']], 'this product’s rows only');
});

test('a failed read renders NOTHING — never a verdict without its data', async () => {
  const answers = (call) => {
    if (call.table === 'guns') return { data: [GUN], error: null };
    if (call.table === 'magazine_housing_fit') return { data: null, error: { message: 'boom' } };
  };
  const p = page({ draft: BUILD, product: { id: 'mag-17', category: 'magazine' }, answers });
  await settle(); await settle(); await settle();
  assert.equal(p.line.hidden, true, 'the page stays exactly what the crawler saw');
  assert.equal(p.line.innerHTML, '');
});

test('a category with no fit data renders nothing, not a guess', async () => {
  const p = page({ draft: BUILD, product: { id: 'trig-1', category: 'trigger' },
    answers: (call) => (call.table === 'guns' ? { data: [GUN], error: null } : undefined) });
  await settle(); await settle(); await settle();
  assert.equal(p.line.hidden, true);
});

// ── The server half: product-page.mjs's wiring ──────────────────────────
test('product-page serves the placeholder, the ?add= link, and the modules in order — and none of it on a discontinued page', () => {
  const src = read('netlify/functions/product-page.mjs');
  assert.match(src, /id="build-fit-line" class="build-fit-line" data-product-id="' \+ esc\(product\.id\) \+ '" data-category="' \+ esc\(product\.category\) \+ '" hidden/);
  assert.match(src, /\(discontinued \? '' :\s*\n?\s*'<div id="build-fit-line"/, 'no fit line on a discontinued page');
  assert.match(src, /class="add-to-build" href="gunforma-armory\.html\?add=' \+ esc\(product\.id\)/);
  const buyBranch = src.slice(src.indexOf("'<div class=\"section-title\">Buy</div>'"), src.indexOf('fitsOnHtml(fitsOn)'));
  assert.ok(buyBranch.includes('add-to-build'), 'the Add link lives in the non-discontinued Buy branch only');
  const nav = src.indexOf('navScript() +');
  const sf = src.indexOf("'<script src=\"js/slide-fit.js\"></script>'");
  const af = src.indexOf("'<script src=\"js/armory-fit.js\"></script>'");
  const bfl = src.indexOf("'<script src=\"js/build-fit-line.js\"></script>'");
  assert.ok(nav !== -1 && nav < sf && sf < af && af < bfl,
    'navScript (supabase + sb) first, then slide-fit, armory-fit, build-fit-line');
});
