// The Armory as the guide editor, and the Gun Guides gallery's Edit / Delete.
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
    'js/variant-label.js', 'js/variant-swatch.js', 'js/option-price.js', 'js/frame-fit.js', 'js/slide-fit.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const dom = makeDom();
  const store = {};
  ctx.document = dom.document;
  ctx.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  ctx.location = { search: '', pathname: '/' + file };
  ctx.history = { replaceState() {} };
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
  set(ctx, `STATE.savedId = null; STATE.curated = { theme: NEW_THEME, newTheme: 'competition carry', published: true };`);
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

// ── The gallery ────────────────────────────────────────────────────────────

function gallery() {
  const page = loadPage('gunforma-gun-guides.html', 'GUN GUIDES');
  return page;
}
const CURATED_ROW = { id: GUIDE_ID, title: 'Sig P365 Duty', category: 'duty', is_published: true, platform_id: PLAT, parts_snapshot: [] };
const JOES_ROW = { id: 'ffffffff-0000-4000-8000-000000000006', user_id: JOE.id, title: 'Joe carry', platform_id: PLAT, parts_snapshot: [] };

test('gallery: Edit and Delete show to admins on every card, to an owner on their own, to nobody else', () => {
  const { ctx } = gallery();
  const actions = (viewer, admin) => {
    set(ctx, `ME = ${JSON.stringify(viewer)}; IS_ADMIN = ${admin};`);
    return [ctx.cardHtml(CURATED_ROW, 'curated'), ctx.cardHtml(JOES_ROW, 'community')]
      .map((h) => /class="gcard-actions"/.test(h));
  };
  assert.deepEqual(actions(null, false), [false, false], 'signed out: none');
  assert.deepEqual(actions({ id: 'someone-else' }, false), [false, false], 'another reader: none');
  assert.deepEqual(actions(JOE, false), [false, true], 'the owner: their own community guide only');
  assert.deepEqual(actions(ADMIN, true), [true, true], 'an admin: every card');

  set(ctx, `ME = ${JSON.stringify(ADMIN)}; IS_ADMIN = true;`);
  assert.match(ctx.cardHtml(CURATED_ROW, 'curated'), new RegExp(`href="gunforma-armory\\.html\\?edit=curated:${GUIDE_ID}"`));
  assert.match(ctx.cardHtml(JOES_ROW, 'community'), new RegExp(`href="gunforma-armory\\.html\\?edit=community:${JOES_ROW.id}"`));
});

test('gallery: a Gunforma guide names its theme; an unpublished one says so', () => {
  const { ctx } = gallery();
  set(ctx, `THEME_LABELS = { duty: 'Duty' };`);
  assert.match(ctx.kickerHtml(CURATED_ROW, 'curated'), /^Gunforma guide · Duty$/);
  assert.match(ctx.kickerHtml({ ...CURATED_ROW, is_published: false }, 'curated'), /Unpublished/);
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
