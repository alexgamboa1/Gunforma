// The ♥: js/favorites.js, and the Parts Catalog driven through it.
//
// WHY: a heart that LOOKS saved and is not is invisible until the reader
// opens their saved parts and the part is missing. A delete that RLS refuses
// matches nothing and returns no error, so "no error" was never the test of
// a write — a row coming back is. And the catalog's heart is the one readers
// already know: moving it into a shared module (so the Armory hearts parts
// with the same code) must not change what it does there.
//
// The Armory's half — the heart never changing the build, the Saved parts
// tab and the pickers kept in step — is in guide-editor.test.mjs, which runs
// that page's real script.
//
// Run: node --test scripts/favorites.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const USER = { id: 'bbbbbbbb-0000-4000-8000-000000000002' };
const PART = 'aaaaaaaa-1111-4000-8000-000000000001';

// A supabase stub that records each write and answers it with `answer`.
function makeSb(answer) {
  const sb = {
    calls: [],
    from(table) {
      const call = { table, op: 'select', payload: null, filters: [], returning: null };
      const q = {
        select(cols) { if (call.op === 'select') call.cols = cols; else call.returning = cols; return q; },
        insert(p) { call.op = 'insert'; call.payload = p; return q; },
        delete() { call.op = 'delete'; return q; },
        eq(c, v) { call.filters.push([c, v]); return q; },
        then(res, rej) {
          sb.calls.push(call);
          return Promise.resolve().then(() => answer(call)).then(res, rej);
        },
      };
      return q;
    },
  };
  return sb;
}
function makeBtn() {
  const classes = new Set();
  const attrs = {};
  return {
    textContent: '', attrs,
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
    setAttribute(k, v) { attrs[k] = v; },
    getAttribute(k) { return attrs[k]; },
  };
}
// A fresh copy of the module per test, as a page would load it.
function load({ user = USER, answer = () => ({ data: [{ product_id: PART }], error: null }), doc } = {}) {
  const win = { console: { error() {}, warn() {} } };
  if (doc) win.document = doc;
  new Function('window', read('js/favorites.js'))(win);
  const toasts = [];
  const changes = [];
  const sb = makeSb(answer);
  win.Favorites.init({
    sb, user: () => user,
    toast: (msg, href, linkText) => toasts.push([msg, href, linkText]),
    signInHref: 'gunforma-signin.html?next=gunforma-armory.html',
    onChange: (id, isFav, phase) => changes.push([id, isFav, phase]),
  });
  return { F: win.Favorites, sb, toasts, changes };
}

test('a heart counts as saved only when the inserted row comes back', async () => {
  const { F, sb, changes, toasts } = load();
  const btn = makeBtn();
  assert.equal(await F.toggle(PART, btn), true);
  assert.deepEqual(sb.calls.map((c) => [c.op, c.table, c.payload, c.returning]),
    [['insert', 'part_favorites', { user_id: USER.id, product_id: PART }, 'product_id']], 'one insert, asking for its row back');
  assert.equal(F.has(PART), true);
  assert.equal(btn.textContent, '♥');
  assert.deepEqual(changes, [[PART, true, 'optimistic'], [PART, true, 'saved']]);
  assert.deepEqual(toasts, []);
});

test('a write with no row back is a failure: the heart flips back and says it did not save', async () => {
  for (const answer of [
    { data: [], error: null },                       // RLS matched nothing — no error at all
    { data: null, error: null },
    { data: null, error: { message: 'boom', code: '42501' } },
  ]) {
    // Unsaved → heart: insert refused.
    let page = load({ answer: () => answer });
    let btn = makeBtn();
    assert.equal(await page.F.toggle(PART, btn), false, JSON.stringify(answer));
    assert.equal(page.F.has(PART), false);
    assert.equal(btn.textContent, '♡', 'painted back');
    assert.deepEqual(page.changes.map((c) => c[2]), ['optimistic', 'revert']);
    assert.deepEqual(page.toasts, [['Couldn\'t save — try again', undefined, undefined]]);

    // Saved → un-heart: delete refused.
    page = load({ answer: () => answer });
    page.F.set([PART]);
    btn = makeBtn();
    assert.equal(await page.F.toggle(PART, btn), false);
    assert.equal(page.F.has(PART), true, 'still saved');
    assert.equal(btn.textContent, '♥');
    assert.deepEqual(page.sb.calls.map((c) => [c.op, c.filters, c.returning]),
      [['delete', [['user_id', USER.id], ['product_id', PART]], 'product_id']], 'the reader\'s own row, and asking for it back');
  }
  // Thrown, not returned.
  const thrown = load({ answer: () => { throw new Error('network'); } });
  assert.equal(await thrown.F.toggle(PART, makeBtn()), false);
  assert.equal(thrown.F.has(PART), false);
  assert.equal(thrown.toasts.length, 1);
});

test('signed out: the click writes nothing and says to sign in, linking back', async () => {
  const { F, sb, toasts, changes } = load({ user: null });
  const btn = makeBtn();
  assert.equal(await F.toggle(PART, btn), false);
  assert.deepEqual(sb.calls, []);
  assert.deepEqual(toasts, [['Sign in to save parts', 'gunforma-signin.html?next=gunforma-armory.html', 'Sign in']]);
  assert.deepEqual(changes, []);
  assert.equal(F.has(PART), false);
  assert.equal(btn.textContent, '', 'not painted');
  assert.deepEqual(await F.load(), { error: null });
  assert.deepEqual(sb.calls, [], 'and reads nothing for nobody');
});

test('one write per part at a time: a second click while saving does nothing', { timeout: 5000 }, async () => {
  const waiting = [];
  const { F, sb } = load({ answer: (call) => new Promise((r) => waiting.push(() => r({ data: [{ product_id: PART }], error: null }))) });
  const first = F.toggle(PART, makeBtn());
  await new Promise((r) => setTimeout(r, 0));
  const second = F.toggle(PART, makeBtn());
  await new Promise((r) => setTimeout(r, 0));
  waiting.forEach((go) => go());
  assert.equal(await second, false, 'ignored');
  assert.equal(await first, true);
  assert.deepEqual(sb.calls.map((c) => c.op), ['insert'], 'one write, not an insert and a delete racing');
  assert.equal(F.has(PART), true);
});

test('load reads only the reader\'s own rows', async () => {
  const { F, sb } = load({ answer: () => ({ data: [{ product_id: PART }, { product_id: 'p2' }], error: null }) });
  assert.deepEqual(await F.load(), { error: null });
  assert.deepEqual(sb.calls.map((c) => [c.op, c.table, c.cols, c.filters]),
    [['select', 'part_favorites', 'product_id', [['user_id', USER.id]]]]);
  assert.equal(F.size(), 2);
});

test('every heart for the part on the page is repainted, not just the one clicked', async () => {
  const btns = [makeBtn(), makeBtn()];
  btns.forEach((b) => b.setAttribute('data-fav-id', PART));
  const doc = { querySelectorAll: (sel) => (sel === '[data-fav-id="' + PART + '"]' || sel === '[data-fav-id]' ? btns : []) };
  const { F } = load({ doc });
  await F.toggle(PART, makeBtn());
  assert.deepEqual(btns.map((b) => b.textContent), ['♥', '♥']);
  F.clear();
  F.repaint();
  assert.deepEqual(btns.map((b) => b.textContent), ['♡', '♡']);
});

test('the heart\'s markup: its click stops at the button, so it never picks, opens or adds', () => {
  const { F } = load();
  const html = F.buttonHtml(PART, false);
  assert.match(html, /^<button type="button" class="fav-btn" data-fav-id="aaaaaaaa-1111-4000-8000-000000000001"/);
  assert.match(html, /onclick="event\.stopPropagation\(\);event\.preventDefault\(\);Favorites\.toggle\('aaaaaaaa-1111-4000-8000-000000000001',this\)"/);
  assert.match(html, /aria-label="Favorite" aria-pressed="false">♡<\/button>$/);
  assert.match(F.buttonHtml(PART, true, 'fav-inline'), /class="fav-btn fav-inline active".*aria-label="Unfavorite" aria-pressed="true">♥</);
  assert.doesNotMatch(F.buttonHtml(PART, true), /data-add|data-ma-add|data-open-detail/);
  assert.match(F.buttonHtml("x');alert(1);//", false), /Favorites\.toggle\('',this\)/, 'a non-uuid never reaches the handler');
});

// ── The catalog, through the module ────────────────────────────────────────
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

test('the shared module drives both pages; neither writes part_favorites itself', () => {
  for (const page of ['gunforma-parts-catalog.html', 'gunforma-armory.html']) {
    const src = read(page);
    assert.match(src, /<script src="js\/favorites\.js"><\/script>/, page + ' loads the module');
    assert.match(src, /Favorites\.init\(\{/, page + ' mounts it once');
    assert.equal((src.match(/Favorites\.init\(/g) || []).length, 1);
    assert.doesNotMatch(src, /from\('part_favorites'\)\s*\.(insert|update|delete|upsert)/, page + ': no write of its own');
    assert.doesNotMatch(src, /\.fav-btn \{ position: absolute/, page + ': no copy of the heart\'s styles');
  }
  const catalog = read('gunforma-parts-catalog.html');
  assert.match(catalog, /Favorites\.buttonHtml\(r\.id, isFav\)/, 'the catalog card draws the shared heart');
  assert.match(catalog, /await Favorites\.load\(\);/, 'and reads through it');
  assert.match(catalog, /signInHref: 'gunforma-signin\.html',/, 'its sign-in link is unchanged');
  assert.doesNotMatch(catalog.replace(/^\s*\/\/.*$/gm, ''), /\bFAVORITES\b|paintFavButton/, 'its own copy is gone');
});

test('the catalog behaves as it did: tab count on every change, the My Favorites grid refreshed when a card must leave or come back', () => {
  const src = read('gunforma-parts-catalog.html');
  const log = [];
  const F = { favsOnly: false };
  const onFavoriteChange = new Function('F', 'updateTabCounts', 'applyFiltersAndRender',
    liftFn(src, 'onFavoriteChange') + '\nreturn onFavoriteChange;')(F, () => log.push('count'), () => log.push('grid'));
  const run = (favsOnly, isFav, phase) => { F.favsOnly = favsOnly; log.length = 0; onFavoriteChange('x', isFav, phase); return log.join(','); };
  // All parts tab: only the count moves.
  assert.equal(run(false, true, 'optimistic'), 'count');
  assert.equal(run(false, false, 'optimistic'), 'count');
  assert.equal(run(false, false, 'revert'), 'count');
  // My Favorites: an un-heart drops the card; hearting leaves the grid alone; a failure redraws.
  assert.equal(run(true, false, 'optimistic'), 'count,grid');
  assert.equal(run(true, true, 'optimistic'), 'count');
  assert.equal(run(true, true, 'revert'), 'count,grid');
  assert.equal(run(true, false, 'revert'), 'count,grid');
  // The saved confirmation changes nothing on screen, as before.
  assert.equal(run(true, true, 'saved'), '');
});

test('the heart looks as it did in the catalog: the same rules, now from the module', () => {
  const css = read('js/favorites.js');
  for (const rule of [
    'position: absolute; top: 8px; right: 8px; z-index: 2;',
    'width: 32px; height: 32px; border-radius: 50%;',
    'background: rgba(255,255,255,0.9); border: 0.5px solid #e5e5e5;',
    'font-family: inherit; font-size: 15px; color: #888; padding: 0;',
    '.fav-btn:hover { background: #fff; color: #d85a30; border-color: #d85a30; }',
    '.fav-btn.active { background: #fff; color: #d85a30; border-color: #d85a30; }',
    '.fav-btn:active { transform: scale(0.9); }',
  ]) assert.ok(css.includes(rule), rule);
  // The detail panel's heart goes through the same toggle.
  assert.match(read('gunforma-parts-catalog.html'), /await Favorites\.toggle\(productId, favEl\);/);
});
