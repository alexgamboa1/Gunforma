// The Armory as the guide editor, its My Armory panel, and the Gun Guides
// gallery's Edit / Delete.
//
// WHY: every rule here fails silently in a browser. A save that lands in the
// wrong table, an admin's edit that rewrites a community guide's owner, an
// update refused by RLS that quietly inserts a copy instead, an Edit link
// shown to a reader who cannot use it, a refused delete reported as done —
// each renders a perfectly normal page. The database refuses the writes it
// should (the migration's dry run, in the PR), but which write the page
// SENDS, and what it then tells the person, is only pinned here.
//
// This runs the REAL inline scripts of gunforma-armory.html and
// gunforma-gun-guides.html in node:vm, beside the real shared modules, with
// a stubbed DOM and a stubbed supabase client that records every write.
//
// Run: node --test scripts/guide-editor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const ADMIN = { id: 'aaaaaaaa-0000-4000-8000-000000000001' };
const JOE = { id: 'bbbbbbbb-0000-4000-8000-000000000002' };
const PLAT = 'cccccccc-0000-4000-8000-000000000003';
const GUIDE_ID = 'dddddddd-0000-4000-8000-000000000004';

// A supabase stub. Every query chain records what it would send; `answer`
// decides what it resolves to — undefined means it never settles, which is
// what keeps each page's own loadAll() from rendering under the test.
function makeSb(state) {
  const sb = {
    calls: [],
    answer: () => undefined,
    auth: {
      getSession: () => new Promise(() => {}),
      onAuthStateChange() {},
    },
    rpc: () => ({ maybeSingle: () => new Promise(() => {}) }),
    from(table) {
      const call = { table, op: 'select', payload: null, filters: [] };
      const q = {
        select(cols) { if (call.op === 'select') call.cols = cols; return q; },
        insert(p) { call.op = 'insert'; call.payload = p; sb.calls.push(call); return q; },
        update(p) { call.op = 'update'; call.payload = p; sb.calls.push(call); return q; },
        delete() { call.op = 'delete'; sb.calls.push(call); return q; },
        eq(c, v) { call.filters.push([c, v]); return q; },
        order() { return q; }, in() { return q; }, is() { return q; }, limit() { return q; },
        maybeSingle() { return q; },
        then(res, rej) {
          let a = sb.answer(call);
          // A read nobody answered never settles (that is how the page's own
          // load stays out of the way); a WRITE nobody answered is one the
          // test did not expect, so it fails loudly instead of hanging.
          if (a === undefined && call.op !== 'select') a = { data: null, error: { message: `unexpected ${call.op} on ${table}` } };
          if (a === undefined) return;
          return Promise.resolve(a).then(res, rej);
        },
      };
      return q;
    },
  };
  return sb;
}

function makeDom() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, onclick: null,
    dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  });
  return { els, document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [] } };
}

function loadPage(file, marker, { confirm = () => true } = {}) {
  const ctx = { console, setTimeout, clearTimeout, Promise, URLSearchParams };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/category-map.js', 'js/build-categories.js', 'js/display-name.js',
    'js/variant-label.js', 'js/variant-swatch.js', 'js/option-price.js', 'js/frame-fit.js', 'js/slide-fit.js', 'js/guide-url.js',
    'js/build-total.js', 'js/armory-builds.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const dom = makeDom();
  const store = {};
  ctx.document = dom.document;
  ctx.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  ctx.location = { search: '', pathname: '/' + file };
  ctx.replaced = [];
  ctx.history = { replaceState(_s, _t, url) { ctx.replaced.push(url); } };
  ctx.confirm = confirm;
  ctx.sb = makeSb();
  const html = read(file);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes(marker));
  assert.ok(script, `found the inline script in ${file}`);
  vm.runInContext(script, ctx, { filename: `${file} <script>` });
  return { ctx, els: dom.els, store };
}

// ── The Armory ─────────────────────────────────────────────────────────────

function armory(opts) {
  const page = loadPage('gunforma-armory.html', 'THE ARMORY', opts);
  const { ctx } = page;
  // A two-product catalog on one platform, the shape loadAll() builds.
  const product = (id, category, name, variants) => ({
    id, slug: id, name, category, brand: 'Maker', platform_ids: [PLAT],
    variants, defaultVariant: variants[0],
  });
  const slide = product('slide-1', 'slide', 'Slide One', [{ id: 'sv1', msrp: 300, color: 'Black' }, { id: 'sv2', msrp: 320, color: 'FDE' }]);
  const trigger = product('trig-1', 'trigger', 'Trigger One', [{ id: 'tv1', msrp: 150, color: 'Black' }]);
  const trigger2 = product('trig-2', 'trigger', 'Trigger Two', [{ id: 'tv2', msrp: 160, color: 'Black' }]);
  ctx.PRODUCTS = [slide, trigger, trigger2];
  ctx.PRODUCTS.forEach((p) => { ctx.PRODUCTS_BY_ID[p.id] = p; });
  ctx.PLATFORMS = [{ id: PLAT, name: 'SIG P365', slug: 'p365' }];
  ctx.PLATFORMS_BY_ID[PLAT] = ctx.PLATFORMS[0];
  ctx.STATE.platform = ctx.PLATFORMS[0];
  ctx.THEMES = [{ key: 'concealed_carry', label: 'Concealed carry', sort_order: 10 }, { key: 'duty', label: 'Duty', sort_order: 40 }];
  return page;
}
const set = (ctx, code) => vm.runInContext(code, ctx);

test('savePlan: a Gunforma guide goes to guides with its theme and switch, never a user_id', () => {
  const { ctx } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true;
    STATE.target = 'curated'; STATE.savedId = null; STATE.title = 'Deep carry';
    STATE.curated = { theme: 'duty', newTheme: '', published: false };`);
  const plan = ctx.savePlan([]);
  assert.equal(plan.table, 'guides');
  assert.equal(plan.op, 'insert');
  assert.equal(plan.payload.category, 'duty');
  assert.equal(plan.payload.is_published, false);
  assert.equal(plan.payload.title, 'Deep carry');
  assert.ok('gun_id' in plan.payload, 'gun_id is sent once the column exists');
  assert.ok(!('user_id' in plan.payload), 'guides has no user_id');

  set(ctx, `STATE.savedId = '${GUIDE_ID}';`);
  assert.equal(ctx.savePlan([]).op, 'update', 'an opened Gunforma guide is updated in place');

  set(ctx, `GUIDE_EDITING_LIVE = false;`);
  assert.ok(!('gun_id' in ctx.savePlan([]).payload), 'no gun_id before the migration adds the column');
});

test('savePlan: a community UPDATE never sends user_id, so an admin edit keeps the owner', () => {
  const { ctx } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; STATE.target = 'community'; STATE.savedId = null; STATE.ownerId = null;`);
  let plan = ctx.savePlan([]);
  assert.equal(plan.table, 'gun_guides');
  assert.equal(plan.op, 'insert');
  assert.equal(plan.payload.user_id, JOE.id, 'an insert names the saver');

  set(ctx, `STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = '${JOE.id}';`);
  plan = ctx.savePlan([]);
  assert.equal(plan.op, 'update');
  assert.ok(!('user_id' in plan.payload));
  assert.equal(plan.reinsertOnMiss, true, 'the owner\'s own deleted guide is saved again, theirs');

  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true;`);
  plan = ctx.savePlan([]);
  assert.equal(plan.op, 'update');
  assert.ok(!('user_id' in plan.payload), 'an admin edit does not take the guide over');
  assert.equal(plan.reinsertOnMiss, false, 'someone else\'s guide is never re-made as a copy');
});

test('saveGuide: an update that matches no row on someone else\'s guide adds no copy and says so', async () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true;
    STATE.target = 'community'; STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = '${JOE.id}';
    STATE.picks = { slide: { productId: 'slide-1', variantId: 'sv2' } };`);
  ctx.sb.answer = (call) => (call.op === 'update' ? { data: [], error: null } : undefined);
  await ctx.saveGuide();
  const writes = ctx.sb.calls.map((c) => `${c.op} ${c.table}`);
  assert.deepEqual(writes, ['update gun_guides'], 'one update, no fallback insert');
  assert.match(els.toast.textContent || els['toast-msg'].textContent, /Couldn’t save/);
  assert.equal(ctx.STATE.savedId, GUIDE_ID, 'still pointed at the guide it was editing');
});

test('saveGuide: the owner\'s own guide deleted elsewhere is saved again, as theirs', async () => {
  const { ctx } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; STATE.target = 'community';
    STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = '${JOE.id}';
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  ctx.sb.answer = (call) => (call.op === 'update' ? { data: [], error: null }
    : call.op === 'insert' ? { data: [{ id: 'eeeeeeee-0000-4000-8000-000000000005' }], error: null } : undefined);
  await ctx.saveGuide();
  assert.deepEqual(ctx.sb.calls.map((c) => c.op), ['update', 'insert']);
  assert.equal(ctx.sb.calls[1].payload.user_id, JOE.id);
});

test('saveGuide: before the migration, a Gunforma guide save sends nothing and says why', async () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = false;
    STATE.target = 'curated'; STATE.curated = { theme: 'duty', newTheme: '', published: true };
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  ctx.sb.answer = () => ({ data: [{ id: GUIDE_ID }], error: null });
  await ctx.saveGuide();
  assert.equal(ctx.sb.calls.length, 0);
  assert.match(els['toast-msg'].textContent, /isn’t switched on yet/);
});

test('saveGuide: a new theme is added first, then the guide carries its key', async () => {
  const { ctx } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true;
    STATE.target = 'curated'; STATE.savedId = null; STATE.curated = { theme: NEW_THEME, newTheme: '  Competition   carry ', published: true };
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  ctx.sb.answer = (call) => {
    if (call.table === 'guide_themes') return { data: [{ key: call.payload.key, label: call.payload.label, sort_order: call.payload.sort_order }], error: null };
    if (call.op === 'insert') return { data: [{ id: GUIDE_ID }], error: null };
  };
  await ctx.saveGuide();
  const [theme, guide] = ctx.sb.calls;
  assert.equal(theme.table, 'guide_themes');
  assert.deepEqual({ key: theme.payload.key, label: theme.payload.label, sort_order: theme.payload.sort_order },
    { key: 'competition_carry', label: 'Competition carry', sort_order: 50 });
  assert.equal(guide.table, 'guides');
  assert.equal(guide.payload.category, 'competition_carry');

  // The same name again reuses the theme instead of inserting a duplicate.
  ctx.sb.calls.length = 0;
  // (Publishing let go of the build, so the second guide is picked afresh.)
  set(ctx, `STATE.target = 'curated'; STATE.savedId = null; STATE.curated = { theme: NEW_THEME, newTheme: 'competition carry', published: true };
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  await ctx.saveGuide();
  assert.deepEqual(ctx.sb.calls.map((c) => c.table), ['guides']);
});

test('picksFromSnapshot: lists what cannot come back instead of dropping it silently', () => {
  const { ctx } = armory();
  const got = ctx.picksFromSnapshot([
    { refId: 'slide-1', category: 'slides', brand: 'Maker', name: 'Slide One', variantId: 'sv2' },
    { refId: 'trig-1', category: 'trigger', brand: 'Maker', name: 'Trigger One', variantId: 'retired-id' },
    { refId: 'trig-2', category: 'trigger', brand: 'Maker', name: 'Trigger Two' },
    { refId: 'gone', category: 'optic', brand: 'Gone Co', name: 'Old Optic' },
  ], PLAT);
  assert.deepEqual(JSON.parse(JSON.stringify(got.picks)), {
    slide: { productId: 'slide-1', variantId: 'sv2' },        // keyed by the product's category, saved option kept
    trigger: { productId: 'trig-1', variantId: 'tv1' },       // a retired option falls back to the default
  });
  assert.deepEqual(JSON.parse(JSON.stringify(got.dropped)), [
    { name: 'Maker Trigger Two', why: 'one trigger per build' },
    { name: 'Gone Co Old Optic', why: 'not in the catalog for this pistol' },
  ]);
});

// ── Start from a guide (?from=) ────────────────────────────────────────────
// A guide loaded as the START of the reader's own build: parts in, identity
// out. The stub emulates the database's side of the published filter, so a
// passing test also proves the page SENT .eq('is_published', true).
const publishedOnly = (rows) => (call) => {
  if (call.table === 'guides') {
    const asked = call.filters.some(([c, v]) => c === 'is_published' && v === true);
    return { data: asked ? rows.filter((r) => r.is_published === true && call.filters.some(([c, v]) => c === 'id' && v === r.id)) : [], error: null };
  }
  if (call.table === 'gun_guides') return { data: [], error: null };
};

test('openFromGuide: a published guide starts a NEW build — parts in, identity out', async () => {
  const { ctx } = armory();
  // A slide without a spec row is reconciled away (availableFor), so the
  // fixture carries one, as every catalog slide does.
  set(ctx, `SPEC.slide['slide-1'] = { product_id: 'slide-1', barrel_length_in: 3.7 };`);
  const row = { id: GUIDE_ID, title: 'Sig P365 Concealed Carry', category: 'concealed_carry', is_published: true,
    platform_id: PLAT, parts_snapshot: [
      { refId: 'slide-1', category: 'slide', brand: 'Maker', name: 'Slide One', variantId: 'sv2' },
      { refId: 'gone', category: 'optic', brand: 'Gone Co', name: 'Old Optic' },
    ] };
  ctx.sb.answer = publishedOnly([row]);
  await ctx.openFromGuide(GUIDE_ID);
  assert.equal(ctx.STATE.savedId, null, 'never adopts the guide as the save target');
  assert.equal(ctx.STATE.draftOf, null);
  assert.equal(ctx.STATE.ownerId, null);
  assert.equal(ctx.STATE.target, 'community', 'never curated — the save can’t reach guides');
  assert.equal(ctx.STATE.title, '', 'the title is the reader’s to type');
  assert.equal(ctx.STATE.startedFrom, 'Sig P365 Concealed Carry', 'the guide’s name is only the placeholder');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.STATE.picks)),
    { slide: { productId: 'slide-1', variantId: 'sv2' } }, 'the saved option comes over');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.STATE.dropped)),
    [{ name: 'Gone Co Old Optic', why: 'not in the catalog for this pistol' }],
    'what cannot come back is listed, never silently dropped');

  // The save after loading a guide is an INSERT to gun_guides, the reader's own.
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)};`);
  const plan = ctx.savePlan([]);
  assert.equal(plan.table, 'gun_guides');
  assert.equal(plan.op, 'insert');
  assert.equal(plan.payload.user_id, JOE.id);
});

test('openFromGuide: an unpublished guide is refused — a draft is never a template', async () => {
  const { ctx, els } = armory();
  const row = { id: GUIDE_ID, title: 'WIP draft', category: 'duty', is_published: false, platform_id: PLAT,
    parts_snapshot: [{ refId: 'trig-1', category: 'trigger', brand: 'Maker', name: 'Trigger One' }] };
  ctx.sb.answer = publishedOnly([row]);
  await ctx.openFromGuide(GUIDE_ID);
  assert.equal(Object.keys(ctx.STATE.picks).length, 0, 'the builder stays empty');
  assert.equal(ctx.STATE.savedId, null);
  assert.equal(ctx.STATE.startedFrom, '');
  assert.match(els['toast-msg'].textContent, /isn’t available/);
});

test('openFromGuide: declining the replace prompt leaves the build untouched', async () => {
  const { ctx } = armory({ confirm: () => false });
  set(ctx, `STATE.gun = null; STATE.title = 'Mine';
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } }; persistDraft();`);
  const row = { id: GUIDE_ID, title: 'Sig P365 Concealed Carry', category: 'concealed_carry', is_published: true,
    platform_id: PLAT, parts_snapshot: [{ refId: 'slide-1', category: 'slide', brand: 'Maker', name: 'Slide One' }] };
  ctx.sb.answer = publishedOnly([row]);
  await ctx.openFromGuide(GUIDE_ID);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.STATE.picks)),
    { trigger: { productId: 'trig-1', variantId: 'tv1' } }, 'the picks are byte-identical');
  assert.equal(ctx.STATE.title, 'Mine');
  assert.equal(ctx.STATE.savedId, null);
  assert.equal(ctx.STATE.startedFrom, '');
});

test('startFromGuide: the card does what ?from= does, and never adopts an identity', () => {
  const { ctx } = armory();
  set(ctx, `START_GUIDES = [{ id: '${GUIDE_ID}', title: 'Sig P365 Duty', category: 'duty', is_published: true,
    platform_id: '${PLAT}', parts_snapshot: [{ refId: 'trig-1', category: 'trigger', brand: 'Maker', name: 'Trigger One' }] }];`);
  ctx.startFromGuide(GUIDE_ID);
  assert.equal(ctx.STATE.savedId, null);
  assert.equal(ctx.STATE.draftOf, null);
  assert.equal(ctx.STATE.target, 'community');
  assert.equal(ctx.STATE.title, '');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.STATE.picks)), { trigger: { productId: 'trig-1', variantId: 'tv1' } });
});

test('openForEdit: a Gunforma guide opens only for an admin, and adopts its identity', async () => {
  const row = { id: GUIDE_ID, title: 'Sig P365 Duty', category: 'duty', is_published: false, platform_id: PLAT,
    parts_snapshot: [{ refId: 'trig-1', category: 'trigger', brand: 'Maker', name: 'Trigger One' }] };

  const reader = armory();
  set(reader.ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; IS_ADMIN = false;`);
  reader.ctx.sb.answer = (call) => (call.table === 'guides' ? { data: [row], error: null } : undefined);
  await reader.ctx.openForEdit('curated', GUIDE_ID);
  assert.equal(reader.ctx.STATE.savedId, null, 'a reader is not put into edit mode');
  assert.match(reader.els['toast-msg'].textContent, /Only admins/);

  const admin = armory();
  set(admin.ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true;`);
  admin.ctx.sb.answer = (call) => (call.table === 'guides' ? { data: [row], error: null } : undefined);
  await admin.ctx.openForEdit('curated', GUIDE_ID);
  const s = admin.ctx.STATE;
  assert.equal(s.target, 'curated');
  assert.equal(s.savedId, GUIDE_ID);
  assert.equal(s.title, 'Sig P365 Duty');
  assert.deepEqual(JSON.parse(JSON.stringify(s.curated)), { theme: 'duty', newTheme: '', published: false });
  assert.deepEqual(Object.keys(s.picks), ['trigger']);
  assert.equal(admin.ctx.savePlan([]).op, 'update');
});

test('openForEdit: declining the replace prompt leaves the build in progress untouched', async () => {
  const page = armory({ confirm: () => false });
  const { ctx, store } = page;
  store['gf-armory-picks-v1'] = JSON.stringify({ platformId: PLAT, gunId: null, title: 'My WIP',
    picks: { trigger: { productId: 'trig-1', variantId: 'tv1' } }, target: 'community', savedId: null });
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true;`);
  ctx.sb.answer = (call) => (call.table === 'guides'
    ? { data: [{ id: GUIDE_ID, title: 'Duty', category: 'duty', platform_id: PLAT, parts_snapshot: [] }], error: null } : undefined);
  await ctx.openForEdit('curated', GUIDE_ID);
  assert.equal(ctx.STATE.title, 'My WIP');
  assert.equal(ctx.STATE.savedId, null);
  assert.deepEqual(Object.keys(ctx.STATE.picks), ['trigger']);
});

test('startNewBuild clears every part of the identity', () => {
  const { ctx } = armory();
  set(ctx, `STATE.target = 'curated'; STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = 'x'; STATE.title = 'T';
    STATE.dropped = [{ name: 'a', why: 'b' }]; STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  ctx.startNewBuild();
  const s = ctx.STATE;
  assert.deepEqual([s.target, s.savedId, s.ownerId, s.title, s.dropped.length, Object.keys(s.picks).length],
    ['community', null, null, '', 0, 0]);
});

// ── Drafts and published (Alex, 2026-11-01) ──────────────────────────────

const LIVE_ROW = { id: GUIDE_ID, title: 'Sig P365 Concealed Carry', category: 'concealed_carry', is_published: true, platform_id: PLAT,
  parts_snapshot: [{ refId: 'trig-1', category: 'trigger', brand: 'Maker', name: 'Trigger One' }] };
const DRAFT_ID = '99999999-0000-4000-8000-000000000009';

test('a plain visit to the Armory never reopens a saved guide (the "Build yours" bug)', () => {
  const { ctx, store } = armory();
  // What an admin's browser held after editing Concealed Carry.
  store['gf-armory-picks-v1'] = JSON.stringify({ platformId: PLAT, title: 'Sig P365 Concealed Carry',
    picks: { trigger: { productId: 'trig-1', variantId: 'tv1' } }, target: 'curated', savedId: GUIDE_ID,
    curated: { theme: 'concealed_carry', newTheme: '', published: true } });
  ctx.restoreDraft();
  assert.equal(ctx.STATE.savedId, null, 'not in edit mode');
  assert.equal(ctx.STATE.target, 'community');
  assert.deepEqual(Object.keys(ctx.STATE.picks), [], 'and not holding the guide\'s parts');

  // A new, unsaved build in progress still survives (the sign-in round trip).
  store['gf-armory-picks-v1'] = JSON.stringify({ platformId: PLAT, title: 'My WIP',
    picks: { trigger: { productId: 'trig-1', variantId: 'tv1' } }, target: 'community', savedId: null });
  ctx.restoreDraft();
  assert.equal(ctx.STATE.title, 'My WIP');
  assert.deepEqual(Object.keys(ctx.STATE.picks), ['trigger']);
});

test('Edit on a PUBLISHED Gunforma guide opens a new draft of it, never the live row', async () => {
  const { ctx } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true; DRAFT_OF_LIVE = true;`);
  ctx.sb.answer = (call) => {
    if (call.table !== 'guides') return undefined;
    if (call.filters.some(([c]) => c === 'draft_of')) return { data: [], error: null };   // no draft yet
    return { data: [LIVE_ROW], error: null };
  };
  await ctx.openForEdit('curated', GUIDE_ID);
  const s = ctx.STATE;
  assert.equal(s.savedId, null, 'nothing saved yet — the save will INSERT a draft');
  assert.equal(s.draftOf, GUIDE_ID);
  assert.equal(s.curated.published, false, 'a draft starts unpublished');
  assert.deepEqual(Object.keys(s.picks), ['trigger'], 'with the live guide\'s parts');
  const plan = ctx.savePlan([]);
  assert.equal(plan.op, 'insert');
  assert.equal(plan.payload.is_published, false);
  assert.equal(plan.payload.draft_of, GUIDE_ID);

  set(ctx, `DRAFT_OF_LIVE = false;`);
  assert.ok(!('draft_of' in ctx.savePlan([]).payload), 'no draft_of before the migration adds the column');
});

test('Edit on a published guide reopens the draft already saved for it', async () => {
  const { ctx } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true; DRAFT_OF_LIVE = true;`);
  const draftRow = { ...LIVE_ROW, id: DRAFT_ID, is_published: false, draft_of: GUIDE_ID, title: 'CC v2' };
  ctx.sb.answer = (call) => {
    if (call.table !== 'guides') return undefined;
    if (call.filters.some(([c]) => c === 'draft_of')) return { data: [draftRow], error: null };
    return { data: [LIVE_ROW], error: null };
  };
  await ctx.openForEdit('curated', GUIDE_ID);
  assert.equal(ctx.STATE.savedId, DRAFT_ID);
  assert.equal(ctx.STATE.draftOf, GUIDE_ID);
  assert.equal(ctx.STATE.title, 'CC v2');
});

test('saving a draft only ever updates an unpublished row', async () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true;
    STATE.target = 'curated'; STATE.savedId = '${GUIDE_ID}';
    STATE.curated = { theme: 'duty', newTheme: '', published: false };
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  // The row turned out to be live (stale identity): the filter matches nothing.
  ctx.sb.answer = (call) => (call.op === 'update' ? { data: [], error: null } : undefined);
  await ctx.saveGuide();
  const [upd] = ctx.sb.calls;
  assert.deepEqual(upd.filters, [['id', GUIDE_ID], ['is_published', false]]);
  assert.equal(ctx.sb.calls.length, 1, 'no fallback insert');
  assert.match(els['toast-msg'].textContent, /published or deleted/);
});

test('publishing a draft of a live guide updates the live row, deletes the draft, and lets go', async () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; GUIDE_EDITING_LIVE = true; DRAFT_OF_LIVE = true;
    STATE.target = 'curated'; STATE.savedId = '${DRAFT_ID}'; STATE.draftOf = '${GUIDE_ID}'; STATE.title = 'CC v2';
    STATE.curated = { theme: 'concealed_carry', newTheme: '', published: true };
    STATE.picks = { trigger: { productId: 'trig-2', variantId: 'tv2' } };`);
  ctx.sb.answer = (call) => (call.op === 'update' ? { data: [{ id: GUIDE_ID }], error: null }
    : call.op === 'delete' ? { data: [{ id: DRAFT_ID }], error: null } : undefined);
  await ctx.saveGuide();
  const [upd, del] = ctx.sb.calls;
  assert.equal(upd.op, 'update');
  assert.deepEqual(upd.filters, [['id', GUIDE_ID]], 'the LIVE row takes the draft\'s contents');
  assert.equal(upd.payload.is_published, true);
  assert.equal(upd.payload.title, 'CC v2');
  assert.ok(!('draft_of' in upd.payload));
  assert.equal(del.op, 'delete');
  assert.deepEqual(del.filters, [['id', DRAFT_ID], ['is_published', false]]);
  const s = ctx.STATE;
  assert.deepEqual([s.savedId, s.draftOf, s.target, Object.keys(s.picks).length], [null, null, 'community', 0],
    'published is locked: the builder starts fresh');
  assert.match(els['toast-msg'].textContent, /Published/);
});

// ── My Armory (2026-11-02) ────────────────────────────────────────────────
// The reader's own Armory builds and saved parts, on the Armory page. Every
// rule here renders a perfectly normal panel when broken: another reader's
// rows listed as yours, Open landing in a Gunforma guide, a part that does
// not fit added anyway, a saved build quietly re-pointed, a write to
// part_favorites from a page that only reads it, a refused delete reported
// as done.

const JOES_BUILD = { id: 'abcdabcd-0000-4000-8000-00000000000b', user_id: JOE.id, title: 'Joe carry', platform_id: PLAT,
  gun_id: null, is_removed: false, created_at: '2026-11-01T00:00:00Z', platforms: { name: 'SIG P365' },
  parts_snapshot: [{ refId: 'trig-1', category: 'trigger', brand: 'Maker', name: 'Trigger One', variantId: 'tv1', msrp: 150 }] };

// Records every read (table + filters) the panel sends; answers the two.
function myArmoryReads(ctx, { builds = [JOES_BUILD], favs = [] } = {}) {
  const reads = [];
  ctx.sb.answer = (call) => {
    if (call.op !== 'select') return undefined;
    reads.push({ table: call.table, filters: call.filters });
    if (call.table === 'gun_guides') return { data: builds, error: null };
    if (call.table === 'part_favorites') return { data: favs, error: null };
    if (call.table === 'product_variants') return { data: [], error: null };
  };
  return reads;
}

test('My Armory reads only the signed-in reader\'s own rows, and never writes part_favorites', async () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; MY.open = true;`);
  const reads = myArmoryReads(ctx, { favs: [{ product_id: 'trig-2', created_at: '2026-11-01T00:00:00Z', products: { id: 'trig-2', name: 'Trigger Two' } }] });
  await ctx.loadMyArmory();
  const of = (t) => reads.filter((r) => r.table === t);
  assert.equal(of('gun_guides').length, 1);
  assert.deepEqual(of('gun_guides')[0].filters, [['user_id', JOE.id]], 'builds: user_id = the reader, nothing wider');
  assert.equal(of('part_favorites').length, 1);
  assert.deepEqual(of('part_favorites')[0].filters, [['user_id', JOE.id]], 'parts: user_id = the reader');
  assert.equal(els['my-armory-btn'].textContent, 'My Armory · 1 build · 1 part');
  assert.match(els['my-armory-body'].innerHTML, /Joe carry/);

  // Adding a saved part, deleting nothing: the panel's only writes are the
  // ones the reader asks for, and none of them is to part_favorites.
  set(ctx, `MY.tab = 'parts'; renderMyArmory();`);
  ctx.addSavedPart('trig-2');
  assert.deepEqual(ctx.sb.calls.filter((c) => c.table === 'part_favorites'), [], 'no write to part_favorites');
  const html = read('gunforma-armory.html');
  assert.doesNotMatch(html, /from\('part_favorites'\)\s*\.(insert|update|delete|upsert)/, 'and no code path that could');
});

test('My Armory signed out: a sign-in line and nothing else, and no reads', async () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = null; MY.open = true;`);
  const reads = myArmoryReads(ctx);
  await ctx.loadMyArmory();
  assert.deepEqual(reads.filter((r) => r.table === 'gun_guides' || r.table === 'part_favorites'), [], 'nothing is read for nobody');
  assert.match(els['my-armory-body'].innerHTML, /Sign in<\/a> to see your saved builds and parts\./);
  assert.doesNotMatch(els['my-armory-body'].innerHTML, /ma-tab|ab-card|part-card/, 'no tabs, no lists');
  assert.equal(els['my-armory-btn'].textContent, 'My Armory');
});

test('My Armory: Open is ?edit=community, never curated — and a "no" leaves the open build alone', async () => {
  const { ctx } = armory({ confirm: () => false });
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)};`);
  const actions = ctx.savedBuildActionsHtml(JOES_BUILD);
  assert.match(actions, new RegExp(`href="gunforma-armory\\.html\\?edit=community:${JOES_BUILD.id}"`));
  assert.doesNotMatch(actions, /curated/);
  assert.match(read('gunforma-armory.html'), /openForEdit\('community', a\.dataset\.maOpen, \{ inPage: true \}\)/,
    'the in-page Open is the community path too');

  // Another Armory build of Joe's is open, with unsaved changes; he declines.
  set(ctx, `STATE.target = 'community'; STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = '${JOE.id}'; STATE.title = 'Open one';
    STATE.picks = { trigger: { productId: 'trig-2', variantId: 'tv2' } };`);
  ctx.sb.answer = (call) => (call.table === 'gun_guides' ? { data: [JOES_BUILD], error: null } : undefined);
  ctx.replaced.length = 0;
  await ctx.openForEdit('community', JOES_BUILD.id, { inPage: true });
  assert.deepEqual([ctx.STATE.savedId, ctx.STATE.target, ctx.STATE.title, Object.keys(ctx.STATE.picks)],
    [GUIDE_ID, 'community', 'Open one', ['trigger']], 'the build on screen is untouched');
  assert.deepEqual(ctx.replaced, [], 'and its ?edit= is not cleared');

  // He accepts: the row is adopted as the build's identity.
  const yes = armory({ confirm: () => true });
  set(yes.ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; STATE.picks = { trigger: { productId: 'trig-2', variantId: 'tv2' } };`);
  yes.ctx.sb.answer = (call) => (call.table === 'gun_guides' ? { data: [JOES_BUILD], error: null } : undefined);
  await yes.ctx.openForEdit('community', JOES_BUILD.id, { inPage: true });
  assert.deepEqual([yes.ctx.STATE.savedId, yes.ctx.STATE.target, yes.ctx.STATE.ownerId, yes.ctx.STATE.title],
    [JOES_BUILD.id, 'community', JOE.id, 'Joe carry']);
});

test('My Armory: "Add to build" is refused for a part that doesn\'t fit, and never changes the build\'s identity', () => {
  const { ctx } = armory();
  const product = (id, category, platform) => ({ id, slug: id, name: id, category, brand: 'Maker', platform_ids: [platform],
    variants: [{ id: id + '-v', msrp: 100, color: 'Black' }], defaultVariant: { id: id + '-v', msrp: 100, color: 'Black' } });
  const b37 = product('barrel-37', 'barrel', PLAT), b31 = product('barrel-31', 'barrel', PLAT), other = product('p320-trig', 'trigger', 'p320');
  for (const p of [b37, b31, other]) { ctx.PRODUCTS.push(p); ctx.PRODUCTS_BY_ID[p.id] = p; }
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)};
    SPEC.slide['slide-1'] = { product_id: 'slide-1', barrel_length_in: 3.7 };
    SPEC.barrel['barrel-37'] = { product_id: 'barrel-37', barrel_length_in: 3.7, barrel_type: 'standard' };
    SPEC.barrel['barrel-31'] = { product_id: 'barrel-31', barrel_length_in: 3.1, barrel_type: 'standard' };
    STATE.target = 'community'; STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = '${JOE.id}'; STATE.title = 'Joe carry';
    STATE.picks = { slide: { productId: 'slide-1', variantId: 'sv1' } };`);
  const identity = () => [ctx.STATE.target, ctx.STATE.savedId, ctx.STATE.ownerId, ctx.STATE.draftOf, ctx.STATE.title];
  const before = identity();

  const no = ctx.savedPartVerdict(b31);
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'Doesn’t fit with Maker Slide One.', 'the reason names the pick it clashes with');
  assert.match(ctx.savedPartHtml({ product_id: 'barrel-31' }), /data-ma-add="barrel-31" disabled>Can’t add</);
  assert.match(ctx.savedPartHtml({ product_id: 'barrel-31' }), /part-card-reason">Doesn’t fit with Maker Slide One\./);
  assert.equal(ctx.addSavedPart('barrel-31'), false);
  assert.equal(ctx.STATE.picks.barrel, undefined, 'refused: not added');
  assert.equal(ctx.savedPartVerdict(other).reason, 'Not a SIG P365 part.');
  assert.equal(ctx.addSavedPart('p320-trig'), false);

  assert.equal(ctx.addSavedPart('barrel-37'), true, 'a part that fits is added');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.STATE.picks.barrel)), { productId: 'barrel-37', variantId: 'barrel-37-v' });
  assert.deepEqual(identity(), before, 'target, savedId, ownerId and title unchanged — the next save updates the same row');
  assert.equal(ctx.savedPartVerdict(b37).inBuild, true);
  assert.equal(ctx.sb.calls.length, 0, 'adding a part writes nothing');

  set(ctx, `STATE.platform = null;`);
  assert.equal(ctx.savedPartVerdict(b37).reason, 'Pick a pistol below first.');
});

test('My Armory: a delete is done only when a row comes back; deleting the open build keeps its parts, drops its identity', async () => {
  const run = async (answer, open) => {
    const page = armory({ confirm: () => true });
    const { ctx } = page;
    set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; MY.builds = { rows: [${JSON.stringify(JOES_BUILD)}], variants: [], byId: {}, defaults: {}, error: null };
      STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } }; STATE.title = 'Joe carry';`);
    if (open) set(ctx, `STATE.target = 'community'; STATE.savedId = '${JOES_BUILD.id}'; STATE.ownerId = '${JOE.id}';`);
    ctx.sb.answer = (call) => (call.op === 'delete' ? answer : undefined);
    const btn = { disabled: false };
    await ctx.deleteArmoryBuild(JOES_BUILD.id, btn);
    return { ...page, btn };
  };
  const refused = await run({ data: [], error: null }, false);
  assert.equal(refused.ctx.MY.builds.rows.length, 1, 'RLS matched nothing: still listed');
  assert.equal(refused.btn.disabled, false);
  assert.match(refused.els['toast-msg'].textContent, /Couldn’t delete/);
  assert.deepEqual(JSON.parse(JSON.stringify(refused.ctx.sb.calls.map((c) => [c.op, c.table, c.filters]))),
    [['delete', 'gun_guides', [['id', JOES_BUILD.id], ['user_id', JOE.id]]]], 'only the reader\'s own row is ever asked for');

  const done = await run({ data: [{ id: JOES_BUILD.id }], error: null }, false);
  assert.equal(done.ctx.MY.builds.rows.length, 0);
  assert.match(done.els['toast-msg'].textContent, /^Deleted “Joe carry”\.$/);

  const openOne = await run({ data: [{ id: JOES_BUILD.id }], error: null }, true);
  const s = openOne.ctx.STATE;
  assert.deepEqual([s.savedId, s.ownerId, s.target], [null, null, 'community'], 'no longer points at the deleted row');
  assert.deepEqual(Object.keys(s.picks), ['trigger'], 'the parts on screen stay');
  assert.equal(openOne.ctx.savePlan([]).op, 'insert', 'the next save is a new row, not a re-made deleted one');
  assert.match(openOne.els['toast-msg'].textContent, /still here as a new, unsaved build/);
});

test('ArmoryBuilds card: today\'s total, the saved option\'s photo, and no link or Share on a taken-down build', () => {
  const { ctx } = armory();
  const data = { byId: { tv1: { id: 'tv1', product_id: 'trig-1', primary_image_url: 'https://x.test/t1.jpg', color: 'Black' } },
    defaults: {}, error: null,
    variants: [{ id: 'tv1', product_id: 'trig-1', msrp: 150, is_default: true, color: 'Black', primary_image_url: 'https://x.test/t1.jpg',
      affiliate_links: [] }] };
  const card = ctx.ArmoryBuilds.cardHtml(JOES_BUILD, data, '');
  assert.match(card, /src="https:\/\/x\.test\/t1\.jpg"/, 'the saved option\'s own photo');
  assert.match(card, /<strong>\$150<\/strong> today/, 'priced by js/build-total.js');
  assert.match(card, new RegExp(`href="/gg/joe-carry-${JOES_BUILD.id}"`), 'the title links its /gg/ page');
  assert.match(card, />SIG P365</, 'the model, or the platform when there is none');
  const down = { ...JOES_BUILD, is_removed: true };
  assert.equal(ctx.ArmoryBuilds.shareable(down), false);
  assert.doesNotMatch(ctx.ArmoryBuilds.cardHtml(down, data, ''), /href="\/gg\//, 'a taken-down build links nowhere');
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)};`);
  assert.doesNotMatch(ctx.savedBuildActionsHtml(down), /data-ma-share/, 'and offers no Share');
});

// ── The names (Alex, 2026-11-02) ──────────────────────────────────────────
// A reader's saved build is an "Armory build" wherever a reader can see it.
test('names: a reader\'s build reads "Armory build" in the Armory, never "community guide" or "Gun Guide"', () => {
  const { ctx, els } = armory();
  set(ctx, `CURRENT_USER = ${JSON.stringify(JOE)}; STATE.target = 'community'; STATE.savedId = null;
    STATE.picks = { trigger: { productId: 'trig-1', variantId: 'tv1' } };`);
  ctx.renderSidebar();
  assert.equal(els['btn-save'].textContent, 'Save & share →');
  set(ctx, `STATE.savedId = '${GUIDE_ID}'; STATE.ownerId = '${JOE.id}';`);
  ctx.renderSidebar();
  assert.equal(els['btn-save'].textContent, 'Update your Armory build →');
  assert.match(els['edit-banner'].innerHTML, /Editing · Armory build/);
  set(ctx, `CURRENT_USER = ${JSON.stringify(ADMIN)}; IS_ADMIN = true;`);
  ctx.renderSidebar();
  assert.equal(els['btn-save'].textContent, 'Update this Armory build →');
  assert.match(els['save-opts'].innerHTML, /Saves to Armory builds/);
  const visible = [els['btn-save'].textContent, els['edit-banner'].innerHTML, els['save-opts'].innerHTML].join(' ');
  assert.doesNotMatch(visible, /community|Gun Guide/i);
  set(ctx, `STATE.savedId = null; STATE.ownerId = null;`);
  ctx.renderSidebar();
  assert.match(els['save-opts'].innerHTML, /> Armory build<\/label>.*> Gunforma guide<\/label>/, 'an admin still gets the Gunforma guide option');
  const src = read('gunforma-armory.html').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /['>][^'<\n]*(Community (Gun )?Guide|community guide|Community builds)[^'<\n]*['<]/,
    'no reader-facing string calls it a community guide');
});

// ── The gallery ────────────────────────────────────────────────────────────

function gallery() {
  const page = loadPage('gunforma-gun-guides.html', 'GUN GUIDES');
  return page;
}
const CURATED_ROW = { id: GUIDE_ID, title: 'Sig P365 Duty', category: 'duty', is_published: true, platform_id: PLAT, parts_snapshot: [] };
const JOES_ROW = { id: 'ffffffff-0000-4000-8000-000000000006', user_id: JOE.id, title: 'Joe carry', platform_id: PLAT, parts_snapshot: [] };

test('gallery: Edit and Delete show to admins only', () => {
  const { ctx } = gallery();
  const actions = (viewer, admin) => {
    set(ctx, `ME = ${JSON.stringify(viewer)}; IS_ADMIN = ${admin};`);
    return /class="gcard-actions"/.test(ctx.cardHtml(CURATED_ROW, 'curated'));
  };
  assert.equal(actions(null, false), false, 'signed out: none');
  assert.equal(actions(JOE, false), false, 'a reader: none');
  assert.equal(actions(ADMIN, true), true, 'an admin: every card');
  set(ctx, `ME = ${JSON.stringify(ADMIN)}; IS_ADMIN = true;`);
  assert.match(ctx.cardHtml(CURATED_ROW, 'curated'), new RegExp(`href="gunforma-armory\\.html\\?edit=curated:${GUIDE_ID}"`));
});

// Alex, 2026-11-02: Gun Guides is Gunforma's guides only. A reader's saved
// build is an Armory build, listed in their My Armory and profile.
test('gallery: Gun Guides shows Gunforma guides only — no Community tab, no gun_guides read', () => {
  const html = read('gunforma-gun-guides.html');
  assert.doesNotMatch(html, /id="tab-community"|>Community builds</, 'the Community builds tab is gone');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes('GUN GUIDES'));
  assert.doesNotMatch(script, /from\('gun_guides'\)/, 'the gallery never reads Armory builds');
});

test('gallery: a Gunforma guide names its theme; an unpublished one says so', () => {
  const { ctx } = gallery();
  set(ctx, `THEME_LABELS = { duty: 'Duty' };`);
  assert.match(ctx.kickerHtml(CURATED_ROW, 'curated'), /^Gunforma guide · Duty$/);
  assert.match(ctx.kickerHtml({ ...CURATED_ROW, is_published: false }, 'curated'), /Draft/);
  assert.match(ctx.kickerHtml({ ...CURATED_ROW, category: 'competition_carry' }, 'curated'), /Competition carry/);
});

test('gallery: a delete is done only when a row comes back', async () => {
  const run = async (answer) => {
    const { ctx, els } = gallery();
    set(ctx, `ME = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; EDITING_LIVE = true; CURATED = [${JSON.stringify(CURATED_ROW)}];`);
    ctx.sb.answer = (call) => (call.op === 'delete' ? answer : undefined);
    const btn = { disabled: false };
    await ctx.deleteGuide('curated', GUIDE_ID, btn);
    return { ctx, els, btn };
  };
  const refused = await run({ data: [], error: null });
  assert.equal(refused.ctx.CURATED.length, 1, 'RLS matched nothing: the card stays');
  assert.equal(refused.btn.disabled, false);
  assert.match(refused.els.toast.textContent, /Couldn’t delete/);
  assert.deepEqual(refused.ctx.sb.calls.map((c) => [c.op, c.table, c.filters]), [['delete', 'guides', [['id', GUIDE_ID]]]]);

  const done = await run({ data: [{ id: GUIDE_ID }], error: null });
  assert.equal(done.ctx.CURATED.length, 0);
  assert.match(done.els.toast.textContent, /Deleted/);
});

test('gallery: before the migration an admin delete of a Gunforma guide sends nothing', async () => {
  const { ctx, els } = gallery();
  set(ctx, `ME = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; EDITING_LIVE = false; CURATED = [${JSON.stringify(CURATED_ROW)}];`);
  await ctx.deleteGuide('curated', GUIDE_ID, { disabled: false });
  assert.equal(ctx.sb.calls.length, 0);
  assert.match(els.toast.textContent, /isn’t switched on yet/);
});

test('gallery: an admin sees Drafts and Published; a live guide edits as a draft and can be unpublished', async () => {
  const { ctx, els } = gallery();
  const draft = { ...CURATED_ROW, id: 'abababab-0000-4000-8000-00000000000a', is_published: false, title: 'New duty' };
  set(ctx, `ME = ${JSON.stringify(ADMIN)}; IS_ADMIN = true; EDITING_LIVE = true;
    CURATED = [${JSON.stringify(CURATED_ROW)}, ${JSON.stringify(draft)}];`);
  ctx.renderAll();
  const html = els['curated-grid'].innerHTML;
  assert.ok(html.indexOf('>Drafts ') < html.indexOf('New duty') && html.indexOf('New duty') < html.indexOf('>Published '),
    'Drafts section holds the draft, then Published');
  const live = ctx.cardHtml(CURATED_ROW, 'curated');
  assert.match(live, />Edit as draft</);
  assert.match(live, /data-unpublish/);
  assert.doesNotMatch(ctx.cardHtml(draft, 'curated'), /data-unpublish/);

  ctx.sb.answer = (call) => (call.op === 'update' ? { data: [{ id: GUIDE_ID }], error: null } : undefined);
  await ctx.unpublishGuide(GUIDE_ID, { disabled: false });
  const [upd] = ctx.sb.calls;
  assert.deepEqual(JSON.parse(JSON.stringify([upd.table, upd.payload, upd.filters])), ['guides', { is_published: false }, [['id', GUIDE_ID], ['is_published', true]]]);
  assert.equal(ctx.CURATED[0].is_published, false);
  assert.match(els.toast.textContent, /under Drafts/);
});
