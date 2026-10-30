// Gun Guides parts follow the build's section order — on the card
// thumbnails and in the open guide — and every part shows a photo or its
// colour swatch, never an empty box.
//
// WHY: the page used to pick its card photos by a private priority list
// (HERO_PRIORITY) and list the open guide in stored order, so the same
// guide read compensator, barrel, optic, slide… while the builder and the
// Armory read slide, barrel, compensator, optic. The order now comes from
// one place, BuildCategories.orderParts() / groupParts() in
// js/build-categories.js, derived from its CATEGORIES list. A page that
// sorts on its own again renders perfectly and disagrees with the builder,
// which is the entry criterion for scripts/check-all.sh.
//
// This runs the REAL code: the taxonomy module, and the page's own inline
// script (with the real display-name and variant-swatch globals beside it,
// and a stubbed DOM and database), then reads the thumbnails and detail
// rows it emits.
//
// Run: node --test scripts/guide-part-order.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// A never-settling query chain: the page's loadAll() awaits it forever and
// never renders, so the test drives the renderers itself.
const pending = () => {
  const q = { then() {} };
  for (const m of ['select', 'order', 'eq', 'in', 'is', 'limit']) q[m] = () => q;
  return q;
};
const element = () => ({
  hidden: false, innerHTML: '', onclick: null, dataset: {},
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
});

function loadContext({ withPage = false } = {}) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/category-map.js', 'js/build-categories.js', 'js/display-name.js', 'js/variant-label.js', 'js/variant-swatch.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  if (withPage) {
    const html = read('gunforma-gun-guides.html');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const page = scripts.find((s) => s.includes('GUN GUIDES'));
    assert.ok(page, 'found the Gun Guides inline script');
    ctx.sb = { from: pending };
    ctx.document = { getElementById: element, querySelector: () => null, querySelectorAll: () => [] };
    vm.runInContext(page, ctx, { filename: 'gunforma-gun-guides.html <script>' });
  }
  return ctx;
}

// Stored order deliberately scrambled. Mixes the catalog vocabulary
// ('optic'), builder section keys ('optics', 'holsters'), the two
// categories that share one section (barrel, compensator), and a category
// nothing recognises.
const FIXTURE = [
  { refId: 'trig', category: 'trigger',       brand: 'Apex',     name: 'Trigger' },
  { refId: 'comp', category: 'compensator',   brand: 'Armory Craft', name: 'Comp' },
  { refId: 'mw',   category: 'magwell',       brand: 'Herrington Arms', name: 'Magwell' },
  { refId: 'mr',   category: 'mag_release',   brand: 'Align Tactical', name: 'Release' },
  { refId: 'opt',  category: 'optic',         brand: 'Aimpoint', name: 'ACRO P-2' },
  { refId: 'bar',  category: 'barrel',        brand: 'Norsso',   name: 'Barrel' },
  { refId: 'sl',   category: 'slide',         brand: 'Grey Ghost Precision', name: 'Slide' },
  { refId: 'hol',  category: 'holsters',      brand: 'Tier 1',   name: 'Holster' },
  { refId: 'fr',   category: 'frame',         brand: 'Wilson Combat', name: 'Grip' },
  { refId: 'zzz',  category: 'mystery_thing', brand: 'Nobody',   name: 'Unknown' },
  { refId: 'oth',  category: 'other',         brand: 'ECM',      name: 'Thumb ledge' },
  { refId: 'opt2', category: 'optics',        brand: 'Holosun',  name: '507K' },
  { refId: 'bp',   category: 'basepad',       brand: 'Springer', name: 'Basepad' },
  { refId: 'lt',   category: 'light',         brand: 'Streamlight', name: 'TLR-7' },
];
const BUILD_ORDER = ['fr', 'sl', 'bar', 'comp', 'opt', 'opt2', 'lt', 'trig', 'mr', 'mw', 'bp', 'hol', 'oth', 'zzz'];
// Array.from, not .map: arrays made inside the vm context carry its Array
// prototype, and deepStrictEqual refuses them against host arrays.
const refs = (parts) => Array.from(parts || [], (p) => p.refId);

test('orderParts: section order, then the section\'s own category order, then as stored', () => {
  const { BuildCategories: BC } = loadContext();
  const input = FIXTURE.map((p) => ({ ...p }));
  assert.deepEqual(refs(BC.orderParts(input)), BUILD_ORDER);
  assert.deepEqual(refs(input), refs(FIXTURE), 'the stored array is not reordered in place');
  assert.deepEqual(refs(BC.orderParts([])), []);
  assert.deepEqual(refs(BC.orderParts(null)), []);
});

test('groupParts: the build\'s groups, in order, empty ones dropped', () => {
  const { BuildCategories: BC } = loadContext();
  const groups = BC.groupParts(FIXTURE);
  assert.deepEqual(Array.from(groups, (g) => g.group.label), ['Core build', 'Controls', 'Magazine', 'Carry and finish']);
  assert.deepEqual(Array.from(groups, (g) => refs(g.parts)), [
    ['fr', 'sl', 'bar', 'comp', 'opt', 'opt2', 'lt', 'trig'], ['mr'], ['mw', 'bp'], ['hol', 'oth', 'zzz'],
  ]);
  assert.deepEqual(Array.from(groups).flatMap((g) => refs(g.parts)), BUILD_ORDER, 'groups concatenate to orderParts()');
  assert.deepEqual(Array.from(BC.groupParts(FIXTURE.filter((p) => p.refId === 'mw')), (g) => g.group.key), ['magazine']);
});

test('the order is CATEGORIES order — no second copy of the taxonomy', () => {
  const { BuildCategories: BC } = loadContext();
  const one = BC.CATEGORIES.flatMap((c) => (c.dbCategory || [c.key]).map((cat) => ({ refId: c.key + ':' + cat, category: cat })));
  assert.deepEqual(refs(BC.orderParts([...one].reverse())), refs(one));
});

const row = (n, extra = {}) => ({ id: 'g' + n, title: n + ' parts', parts_snapshot: FIXTURE.slice(0, n), ...extra });
const tiles = (html) => [...html.matchAll(/<div class="gthumb" data-ref="([^"]*)">([\s\S]*?)<\/div>(?=<div class="gthumb|<\/div>)/g)];
const moreTile = (html) => (html.match(/class="gthumb gthumb-more"[^>]*>\+(\d+)</) || [])[1];

test('card thumbnails: the first five in build order, then one "+N" tile', () => {
  const ctx = loadContext({ withPage: true });
  for (const n of [1, 4, 5, 6, 12]) {
    const html = ctx.cardHtml(row(n), 'curated');
    const want = refs(ctx.BuildCategories.orderParts(FIXTURE.slice(0, n))).slice(0, 5);
    assert.deepEqual(tiles(html).map((m) => m[1]), want, `${n} parts: thumbnails follow build order`);
    if (n > 5) assert.equal(moreTile(html), String(n - 5), `${n} parts: "+${n - 5}" tile`);
    else assert.equal(moreTile(html), undefined, `${n} parts: no "+N" tile`);
  }
  // 12 parts → 5 thumbnails + "+7", the example in the task.
  const twelve = ctx.cardHtml(row(12), 'curated');
  assert.equal(tiles(twelve).length, 5);
  assert.equal(moreTile(twelve), '7');
});

test('open guide: every part, grouped and in build order, each with a photo or swatch', () => {
  const ctx = loadContext({ withPage: true });
  const html = ctx.detailHtml(row(14));
  assert.deepEqual([...html.matchAll(/class="gdetail-row" data-ref="([^"]*)"/g)].map((m) => m[1]), BUILD_ORDER);
  assert.deepEqual([...html.matchAll(/class="gdetail-group">([^<]*)</g)].map((m) => m[1]),
    ['Core build', 'Controls', 'Magazine', 'Carry and finish']);
  const photos = [...html.matchAll(/<span class="gdetail-photo">([\s\S]*?)<\/span><span class="gdetail-cat">/g)].map((m) => m[1]);
  assert.equal(photos.length, 14);
  for (const p of photos) assert.match(p, /<img |gmedia-swatch/, 'a photo or a swatch, never empty');
});

test('photos: the default option, the saved option when one is named, else a swatch — never a stand-in', () => {
  const ctx = loadContext({ withPage: true });
  ctx.DEFAULT_VARIANT_BY_PRODUCT.sl = { id: 'v-sl', product_id: 'sl', color: 'Black', primary_image_url: 'https://img.test/slide-black.jpg' };
  ctx.DEFAULT_VARIANT_BY_PRODUCT.bar = { id: 'v-bar', product_id: 'bar', color: 'Gold', primary_image_url: null };
  ctx.DEFAULT_VARIANT_BY_PRODUCT.fr = { id: 'v-fr-blk', product_id: 'fr', color: 'Black', primary_image_url: 'https://img.test/grip-black.jpg' };
  ctx.VARIANTS_BY_ID['v-fr-fde'] = { id: 'v-fr-fde', product_id: 'fr', color: 'FDE', primary_image_url: 'https://img.test/grip-fde.jpg' };
  ctx.VARIANTS_BY_ID['v-sl-od'] = { id: 'v-sl-od', product_id: 'sl', color: 'OD Green', primary_image_url: null };

  const media = (p) => ctx.partMediaHtml(p);
  assert.match(media(FIXTURE.find((p) => p.refId === 'sl')), /src="https:\/\/img\.test\/slide-black\.jpg"[^>]*loading="lazy"/);
  assert.match(media(FIXTURE.find((p) => p.refId === 'bar')), /gmedia-swatch/, 'no photo: swatch');
  assert.doesNotMatch(media(FIXTURE.find((p) => p.refId === 'bar')), /<img /);
  assert.match(media(FIXTURE.find((p) => p.refId === 'trig')), /gmedia-swatch/, 'nothing known: still a swatch');
  // A saved option shows that option, not the default.
  const fde = media({ ...FIXTURE.find((p) => p.refId === 'fr'), variantId: 'v-fr-fde' });
  assert.match(fde, /grip-fde\.jpg/);
  assert.doesNotMatch(fde, /grip-black\.jpg/);
  // A saved option with no photo gets its own swatch, never the default's photo.
  const od = media({ ...FIXTURE.find((p) => p.refId === 'sl'), variantId: 'v-sl-od' });
  assert.doesNotMatch(od, /slide-black\.jpg/);
  assert.match(od, /gmedia-swatch/);
  // A dead photo URL falls back to the swatch, not an empty box.
  assert.match(media(FIXTURE.find((p) => p.refId === 'sl')), /data-fallback="[^"]*gmedia-swatch/);
});
