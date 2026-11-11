// /l/<share_id> — an Armory build's share page — and js/armory-share.js's
// export, held to the 2026-11-10 design's rules.
//
// WHY: every rule here fails silently in a browser. A /l/ page that lost
// its noindex gets indexed; a /gg/ Armory-build link that stops 301ing
// keeps two live addresses for one document; a pre-migration /gg/ hit that
// 503s over the missing share_id column takes down pages that can render;
// a Reddit export that drifts from the agreed format or quietly swaps in
// affiliate links gets posts removed. The handler runs against a stubbed
// fetch (guide-share.test.mjs's harness); the export runs the real
// js/armory-share.js in node:vm.
//
// Run: node --test scripts/armory-share.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const handler = (await import(fn('guide-share.mjs'))).default;

const SITE = 'https://gunforma.com';
const ID = 'd1ccac3a-3f29-4e5c-a14e-667386e46315';
const BASED_ID = 'e2ddbd4b-4f3a-4e5c-a14e-667386e46316';
const UID = 'bbbbbbbb-0000-4000-8000-000000000002';
const BASED_UID = 'cccccccc-0000-4000-8000-000000000003';
const SHARE = 'abc123xy';
const BASED_SHARE = 'based99z';
const P_OPT = '11111111-0000-4000-8000-000000000001';

const TODAY = new Date().toISOString().slice(0, 10);
const VARIANTS = [
  { id: 'v-opt', product_id: P_OPT, is_default: true, msrp: 349.99, color: 'Black', primary_image_url: 'https://img.test/opt.jpg',
    products: { slug: 'holosun-507k-x2', category: 'optic', url: 'https://holosun.com/x', is_discontinued: false,
      manufacturers: { name: 'Holosun', website_url: 'https://holosun.com' } },
    affiliate_links: [{ id: 'L-opt', url: 'https://shop.test/o', street_price: 299.99, in_stock: true,
      last_checked: TODAY, op_last_matched_by: 'awin-v2', partners: { name: 'OpticsPlanet (Awin)' } }] },
];
const SNAPSHOT = [{ refId: P_OPT, category: 'optic', brand: 'Holosun', name: '507K X2', slug: 'holosun-507k-x2', variantId: 'v-opt' }];
const ROW = { id: ID, user_id: UID, title: 'Joe carry', platform_id: 'p', gun_id: null,
  parts_snapshot: SNAPSHOT, is_removed: false, created_at: '2026-11-01', updated_at: '2026-11-01',
  guns: { name: 'P365 XMacro', slug: 'p365-xmacro' }, platforms: { name: 'SIG P365' },
  share_id: SHARE, based_on_id: BASED_ID };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// PostgREST stand-in. Every answer honours the filter the query SENT, so a
// dropped is_removed filter reads as zero rows here.
function db({ row = ROW, basedRow, shareColumn = true, fail = null } = {}) {
  return (n, url) => {
    const u = String(url);
    if (fail && fail(u, n)) return json({ message: 'boom' }, 500);
    if (u.includes('/rest/v1/gun_guides?')) {
      if (u.includes('select=share_id') && !u.includes('is_removed')) {
        // shareIdFor()'s probe: the column, or a pre-migration 400.
        if (!shareColumn) return json({ message: 'column gun_guides.share_id does not exist' }, 400);
        return json(row && u.includes('id=eq.' + row.id) ? [{ share_id: row.share_id }] : []);
      }
      if (u.includes('share_id=eq.')) {
        if (!u.includes('is_removed=eq.false')) return json([]);
        return json(row && u.includes('share_id=eq.' + row.share_id) ? [row] : []);
      }
      if (u.includes('id=eq.' + BASED_ID)) {
        return json(basedRow && u.includes('is_removed=eq.false') ? [basedRow] : []);
      }
      return json(row && u.includes('is_removed=eq.false') && u.includes('id=eq.' + row.id) ? [row] : []);
    }
    if (u.includes('/rest/v1/guides?')) return json([]);
    if (u.includes('/rest/v1/profiles?')) {
      if (u.includes('id=in.')) {
        const out = [];
        if (u.includes(UID)) out.push({ id: UID, username: 'wraythe' });
        if (u.includes(BASED_UID)) out.push({ id: BASED_UID, username: 'origiver' });
        return json(out);
      }
      if (u.includes('id=eq.' + UID)) return json([{ username: 'wraythe' }]);
      if (u.includes('id=eq.' + BASED_UID)) return json([{ username: 'origiver' }]);
      return json([]);
    }
    if (u.includes('/rest/v1/product_variants?')) return json(VARIANTS);
    return json([]);
  };
}

const realFetch = globalThis.fetch;
const realError = console.error;
function stubFetch(impl) {
  const seen = { calls: 0, urls: [] };
  globalThis.fetch = async (url, init) => { seen.calls++; seen.urls.push(String(url)); return impl(seen.calls, url, init); };
  return seen;
}
test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });
const get = (path) => handler(new Request(SITE + path));

// ── serving /l/<share_id> ─────────────────────────────────────────────────
test('/l/ serves the build at its own URL: noindex both ways, never submitted, the share actions in place', async () => {
  const seen = stubFetch(db({ basedRow: { share_id: BASED_SHARE, user_id: BASED_UID, title: 'Orig' } }));
  const res = await get('/l/' + SHARE);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-armory-share'), 'build');
  assert.equal(res.headers.get('x-guide-share'), 'community');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const html = await res.text();
  assert.match(html, /<meta name="robots" content="noindex"\/>/);
  assert.match(html, new RegExp('<link rel="canonical" href="' + SITE + '/l/' + SHARE + '"'), 'its own URL, not /gg/');
  assert.match(html, /Armory build by @wraythe/, 'the byline');
  assert.match(html, new RegExp('Based on <a href="/l/' + BASED_SHARE + '">@origiver’s build</a>'), 'the credit, linked to its own /l/');
  assert.match(html, /id="ash-copy" data-url="https:\/\/gunforma\.com\/l\/abc123xy"/);
  assert.match(html, /id="ash-edit" href="\/gunforma-armory\.html\?from=/, 'Edit for a visitor is the editable-copy door');
  assert.match(html, /id="ash-reddit"/);
  assert.match(html, /id="ash-banner" hidden/, 'the owner banner ships empty: one cacheable page for everyone');
  assert.match(html, /id="ash-export" hidden/);
  assert.match(html, new RegExp('<div class="pr" data-ref="' + P_OPT + '"'), 'rows carry their product for the fit tags');
  assert.match(html, /<span class="pr-fit" data-fit><\/span>/);
  assert.match(html, /href="\/go\/L-opt"/, 'buy stays /go/');
  const order = ['js/slide-fit.js', 'js/armory-fit.js', 'js/armory-share.js'].map((f) => html.indexOf(f));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'the fit modules load in order');
  assert.ok(html.indexOf('js/supabase-client.js') < order[0], 'after the client (sb) exists');
  // The sitemap never lists /l/ — it is built from sitemap.mjs, which
  // carries no gun_guides read at all.
  assert.doesNotMatch(read('netlify/functions/sitemap.mjs'), /gun_guides/, 'no /l/ or /gg/ community URLs in the sitemap');
  assert.equal(seen.urls.some((u) => u.includes('share_id=eq.' + SHARE) && u.includes('is_removed=eq.false')), true,
    'the taken-down filter is SENT on the share read');
});

test('/l/: a build with no account has no byline at all, and no based-on line without a source', async () => {
  stubFetch(db({ row: { ...ROW, user_id: null, based_on_id: null } }));
  const html = await (await get('/l/' + SHARE)).text();
  assert.match(html, /class="eyebrow">Armory build</);
  assert.doesNotMatch(html, /by @/);
  assert.doesNotMatch(html, /Based on/);
});

test('/l/: zero rows is the 404; a failed read is the 503; a malformed slug reads nothing', async () => {
  stubFetch(db({ row: null }));
  assert.equal((await get('/l/' + SHARE)).status, 404);

  stubFetch((n, url) => String(url).includes('share_id=eq.') ? json({ message: 'boom' }, 500) : json([]));
  const res = await get('/l/' + SHARE);
  assert.equal(res.status, 503);
  assert.ok(res.headers.get('retry-after'));

  for (const p of ['/l/UPPER123', '/l/ab', '/l/has-dash1', '/l/' + SHARE + '/x']) {
    const seen = stubFetch(() => json([]));
    assert.equal((await get(p)).status, 404, p);
    assert.equal(seen.calls, 0, p + ': nothing read');
  }
});

// ── the /gg/ move ─────────────────────────────────────────────────────────
test('a community /gg/ link 301s to its /l/ page once share_id exists — and serves as before until it does', async () => {
  const moved = stubFetch(db());
  const res = await get('/gg/joe-carry-' + ID);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), SITE + '/l/' + SHARE);
  assert.equal(res.headers.get('x-guide-share'), 'community-moved');
  assert.ok(moved.urls.some((u) => u.includes('select=share_id')), 'the new address came from the row');

  // Pre-migration: the share_id probe 400s, and the page serves exactly as
  // before — never a 503 over a page that can render.
  stubFetch(db({ shareColumn: false }));
  const before = await get('/gg/joe-carry-' + ID);
  assert.equal(before.status, 200);
  assert.equal(before.headers.get('x-guide-share'), 'community');
  assert.equal(before.headers.get('x-robots-tag'), 'noindex');
});

test('a Gunforma guide’s /gg/ page is untouched: no share probe, no redirect', async () => {
  const CURATED = { id: ID, title: 'Sig P365 Duty', category: 'duty', description: null, platform_id: 'p', gun_id: null,
    parts_snapshot: SNAPSHOT, is_published: true, guide_themes: { label: 'Duty' }, guns: null, platforms: { name: 'SIG P365' } };
  const seen = stubFetch((n, url) => {
    const u = String(url);
    if (u.includes('/rest/v1/guides?')) return json(u.includes('is_published=eq.true') ? [CURATED] : []);
    if (u.includes('/rest/v1/product_variants?')) return json(VARIANTS);
    return json([]);
  });
  const res = await get('/gg/sig-p365-duty-' + ID);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-guide-share'), 'curated');
  assert.equal(res.headers.get('x-guide-share-index'), 'index');
  assert.ok(!seen.urls.some((u) => u.includes('select=share_id')), 'no share probe for a curated guide');
});

// ── comments on /l/ (PR 4) ────────────────────────────────────────────────
const C1 = '22222222-0000-4000-8000-000000000021';
const C2 = '22222222-0000-4000-8000-000000000022';
const COMMENTS = [
  { id: C1, user_id: UID, body: 'Owner here — ask away <b>no html</b>', created_at: '2026-11-10T10:00:00Z' },
  { id: C2, user_id: BASED_UID, body: 'Does the comp clear the light?', created_at: '2026-11-11T10:00:00Z' },
];
function dbWithComments(opts = {}) {
  const inner = db(opts);
  return (n, url) => {
    const u = String(url);
    if (u.includes('/rest/v1/armory_build_comments?')) {
      if (opts.commentsTable === false) return json({ message: 'relation "armory_build_comments" does not exist' }, 404);
      return json(COMMENTS);
    }
    return inner(n, url);
  };
}

test('/l/ renders the thread server-side: count, OP tag on the owner alone, escaped bodies, an empty box', async () => {
  stubFetch(dbWithComments());
  const res = await get('/l/' + SHARE);
  assert.equal(res.headers.get('x-armory-comments'), '2');
  const html = await res.text();
  assert.match(html, /<h2>2 comments<\/h2>/);
  const owner = html.slice(html.indexOf('data-comment-id="' + C1 + '"'), html.indexOf('data-comment-id="' + C2 + '"'));
  assert.match(owner, /@wraythe/);
  assert.match(owner, /<span class="optag">OP<\/span>/, 'the list’s owner wears OP');
  assert.match(owner, /ask away &lt;b&gt;no html&lt;\/b&gt;/, 'a body is text, never markup');
  const other = html.slice(html.indexOf('data-comment-id="' + C2 + '"'));
  assert.match(other, /@origiver/);
  assert.doesNotMatch(other.slice(0, other.indexOf('</div></div>')), /optag/, 'nobody else does');
  assert.match(html, new RegExp('data-comment-id="' + C2 + '" data-commenter="' + BASED_UID + '"'),
    'rows carry the writer for the browser’s delete/report wiring');
  assert.match(html, /<span class="cmt-actions" data-cmt-actions><\/span>/, 'action slots ship EMPTY: one cacheable page');
  assert.match(html, /<div id="ash-comment-box"><\/div>/, 'the box ships empty too — sign-in decides what it holds');
});

test('/l/ before the comments migration: the page serves, with no thread and no box', async () => {
  stubFetch(dbWithComments({ commentsTable: false }));
  const res = await get('/l/' + SHARE);
  assert.equal(res.status, 200, 'never a 503 over a page that can render');
  assert.equal(res.headers.get('x-armory-comments'), 'n/a');
  const html = await res.text();
  assert.doesNotMatch(html, /id="ash-thread"|id="ash-comment-box"/, 'no thread section, no comment box');
});

test('comments wiring: posts and deletes are believed only when a row comes back; a report is idempotent', async () => {
  const ctx = shareCtx();
  const calls = [];
  const answers = { insert: { data: [{ id: 'new-c', user_id: 'viewer-1', body: 'hi', created_at: '2026-11-11T12:00:00Z' }], error: null },
                    delete: { data: [], error: null }, report: { data: [{ comment_id: C2 }], error: null } };
  ctx.sb = { from: (table) => {
    const call = { table, op: null, payload: null, filters: [] };
    const q = {
      insert(p) { call.op = 'insert'; call.payload = p; calls.push(call); return q; },
      delete() { call.op = 'delete'; calls.push(call); return q; },
      select() { return q; },
      eq(c, v) { call.filters.push([c, v]); return q; },
      then(res) { return Promise.resolve(call.table === 'armory_comment_reports' ? answers.report
        : call.op === 'insert' ? answers.insert : answers.delete).then(res); },
    };
    return q;
  } };
  ctx.confirm = () => true;
  ctx.alert = (m) => { ctx._alerted = m; };

  // A pocket DOM: one existing comment by someone else, the thread, the box.
  const mkEl = () => {
    const el = { attrs: {}, children: [], innerHTML: '', className: '',
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; },
      remove() { this.removed = true; },
      querySelector(sel) {
        if (sel === '[data-cmt-actions]') return this.slot;
        if (sel.includes('data-cmt-delete')) return this.slot && /data-cmt-delete/.test(this.slot.innerHTML) ? (this.delBtn = this.delBtn || { disabled: false }) : null;
        if (sel.includes('data-cmt-report')) return this.slot && /data-cmt-report/.test(this.slot.innerHTML) ? (this.repBtn = this.repBtn || { disabled: false, textContent: '' }) : null;
        if (sel === 'textarea') return this.ta;
        if (sel === 'button.post') return this.postBtn;
        if (sel === 'h2') return this.h2;
        return null;
      },
      querySelectorAll(sel) { return sel === '.cmt' ? this.cmts : []; },
      insertBefore(node) { this.children.push(node); } };
    return el;
  };
  const cmt = mkEl();
  cmt.attrs = { 'data-comment-id': C2, 'data-commenter': BASED_UID };
  cmt.slot = mkEl();
  const thread = mkEl();
  thread.cmts = [cmt];
  thread.h2 = { textContent: '1 comment' };
  const box = mkEl();
  box.ta = { value: '  hi  ', focus() {} };
  box.postBtn = { disabled: false };
  const doc = { getElementById: (id) => (id === 'ash-thread' ? thread : id === 'ash-comment-box' ? box : null),
    createElement: () => mkEl() };
  const row = { id: ID, user_id: UID, share_id: SHARE };
  const viewer = { user: { id: 'viewer-1' }, isOwner: false, isAdmin: false };

  ctx.ArmoryShare.wireComments(doc, row, viewer);
  // Another reader's comment: no Delete for a stranger, Report present.
  assert.doesNotMatch(cmt.slot.innerHTML, /data-cmt-delete/, 'a stranger cannot delete');
  assert.match(cmt.slot.innerHTML, /data-cmt-report/);

  // Post: the write names the build and the writer, and the box clears
  // only on a returned row.
  await box.postBtn.onclick();
  const ins = calls.find((c) => c.table === 'armory_build_comments' && c.op === 'insert');
  assert.deepEqual(JSON.parse(JSON.stringify(ins.payload)), { armory_build_id: ID, user_id: 'viewer-1', body: 'hi' }, 'trimmed, as the viewer');
  assert.equal(box.ta.value, '', 'cleared after the row came back');
  assert.equal(thread.h2.textContent, '2 comments');

  // The owner deletes a stranger's comment — refused by RLS (zero rows):
  // the comment STAYS and the failure is said.
  const owner = { user: { id: UID }, isOwner: true, isAdmin: false };
  cmt.slot.innerHTML = ''; cmt.delBtn = null;
  ctx.ArmoryShare.wireComments(doc, row, owner);
  assert.match(cmt.slot.innerHTML, /data-cmt-delete/, 'the list’s owner may delete any comment on it');
  await cmt.delBtn.onclick();
  assert.ok(!cmt.removed, 'zero rows back: not reported as deleted');
  assert.match(String(ctx._alerted), /Couldn’t delete/);

  // Report: a duplicate (already reported) reads as reported, not an error.
  answers.report = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
  await cmt.repBtn.onclick();
  assert.equal(cmt.repBtn.textContent, 'Reported');

  // Signed out: the box is a sign-in door that lands back on this page.
  const box2 = mkEl();
  const doc2 = { getElementById: (id) => (id === 'ash-thread' ? thread : id === 'ash-comment-box' ? box2 : null), createElement: () => mkEl() };
  ctx.ArmoryShare.wireComments(doc2, row, { user: null, isOwner: false, isAdmin: false });
  assert.match(box2.innerHTML, /Sign in to comment/);
  assert.match(box2.innerHTML, new RegExp('next=' + encodeURIComponent('/l/' + SHARE).replace(/%/g, '%')), 'back to this /l/ page');
});

// ── js/armory-share.js: the export ───────────────────────────────────────
function shareCtx(affiliate) {
  const ctx = { console, Promise, setTimeout };
  ctx.window = ctx;
  ctx.localStorage = { getItem: () => null };
  vm.createContext(ctx);
  for (const f of ['js/category-map.js', 'js/display-name.js', 'js/slide-fit.js', 'js/armory-fit.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  ctx.affiliate = affiliate || { getFor: () => null, get: () => null, loadFor: async () => [] };
  vm.runInContext(read('js/armory-share.js'), ctx, { filename: 'js/armory-share.js' });
  return ctx;
}

test('the Reddit export is the agreed format, byte for byte — Gunforma links, never affiliate ones', () => {
  const ctx = shareCtx();
  const day = new Date().toISOString().slice(0, 10);
  const text = ctx.ArmoryShare.exportText('reddit', {
    shareId: SHARE, title: 'Joe carry', gunName: 'SIG P365 XMacro',
    rows: [
      { catLabel: 'Optic', name: 'Holosun 507K X2', option: '', href: SITE + '/parts/optics/holosun-507k-x2', price: 299.99, shop: 'OpticsPlanet' },
      { catLabel: 'Trigger', name: 'True Precision Flat P365', option: 'Copper', href: SITE + '/parts/triggers/tp-flat', price: 100, shop: null },
      { stock: true, catLabel: 'Grip Module', text: 'P365 XMacro grip module' },
    ],
  });
  assert.equal(text,
    '[Gunforma Part List](https://gunforma.com/l/' + SHARE + ') · Starting from SIG P365 XMacro\n\n' +
    'Type|Item|Price\n:----|:----|:----\n' +
    '**Starting gun** | SIG P365 XMacro | Owned\n' +
    '**Optic** | [Holosun 507K X2](https://gunforma.com/parts/optics/holosun-507k-x2) | $299.99 @ OpticsPlanet\n' +
    '**Trigger** | [True Precision Flat P365 (Copper)](https://gunforma.com/parts/triggers/tp-flat) | $100 MSRP\n' +
    '**Grip Module** | Stock P365 XMacro grip module | Stock\n' +
    ' | *Stock parts not priced. Prices from Gunforma retailer data.* |\n' +
    ' | **Upgrade total** | **$399.99**\n' +
    ' | Generated by [Gunforma](https://gunforma.com) ' + day + ' |\n');
  assert.doesNotMatch(text, /\/go\/|awin|affiliate/i, 'item links go to Gunforma pages only');
});

test('export rows price by the chosen source under the shared rules: fresh in-stock first, MSRP fallback, one retailer only', () => {
  // In the order js/affiliate.js's shared comparator leaves them (the
  // export reads that order rather than keeping a second copy of the
  // sort): fresh-and-priced in stock by price, then out of stock, then
  // stale. The export's own job is the FILTER — a stale or out-of-stock
  // row never becomes the number, whatever sits where.
  const listings = [
    { maker: false, price: 299.99, stale: false, in_stock: true, partnerName: 'OpticsPlanet' },
    { maker: false, price: 310, stale: false, in_stock: true, partnerName: 'Brownells' },
    { maker: false, price: 240, stale: false, in_stock: false, partnerName: 'OutShop' },
    { maker: false, price: 250, stale: true, in_stock: true, partnerName: 'StaleShop' },
  ];
  const ctx = shareCtx({ getFor: () => ({ listings }), get: () => ({ listings }), loadFor: async () => [] });
  const row = { parts_snapshot: [{ refId: P_OPT, category: 'optic', brand: 'Holosun', name: '507K X2',
    slug: 'holosun-507k-x2', variantId: 'v-opt', variantLabel: '', msrp: 349.99 }], gun_id: null };
  const low = ctx.ArmoryShare.exportRows(row, null, 'low')[0];
  assert.equal(low.price, 299.99, 'the hero: lowest fresh in-stock');
  assert.equal(low.shop, 'OpticsPlanet');
  // The filter, isolated: with only a stale and an out-of-stock listing,
  // the export never states either number — MSRP stands in.
  const bad = shareCtx({ getFor: () => ({ listings: [listings[3], listings[2]] }), get: () => null, loadFor: async () => [] });
  const fallback = bad.ArmoryShare.exportRows(row, null, 'low')[0];
  assert.equal(fallback.price, 349.99, 'a stale or out-of-stock price is never the number — MSRP is');
  assert.equal(fallback.shop, null);
  const one = ctx.ArmoryShare.exportRows(row, null, 'Brownells')[0];
  assert.equal(one.price, 310);
  assert.equal(one.shop, 'Brownells');
  const msrp = ctx.ArmoryShare.exportRows(row, null, 'msrp')[0];
  assert.equal(msrp.price, 349.99);
  assert.equal(msrp.shop, null, 'MSRP names no retailer');
  // A model's unpicked factory parts ride along as Stock rows.
  const withGun = ctx.ArmoryShare.exportRows(row, { name: 'P365 XMacro' }, 'low');
  const stock = withGun.filter((r) => r.stock).map((r) => r.text);
  assert.deepEqual(JSON.parse(JSON.stringify(stock)), ['P365 XMacro grip module', 'P365 XMacro slide', 'P365 XMacro barrel']);
});

test('export rows follow the Build tab\'s order — stock and picked parts interleaved, never picks-then-stock', () => {
  const ctx = shareCtx();
  const row = { parts_snapshot: [
    { refId: 'p-opt', category: 'optic', brand: 'Holosun', name: '507K X2', slug: null },
    { refId: 'p-trig', category: 'trigger', brand: 'Maker', name: 'Flat', slug: null },
  ] };
  const rows = ctx.ArmoryShare.exportRows(row, { name: 'P365 XMacro' }, 'low');
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => (r.stock ? 'Stock ' : '') + r.catLabel))),
    ['Stock Grip Module', 'Stock Slide', 'Stock Barrel', 'Optic', 'Trigger'],
    'the stock core above the picked optic, as the build list shows it');
  // A picked slide takes its own slot between the stock grip and barrel.
  row.parts_snapshot.push({ refId: 'p-slide', category: 'slide', brand: 'Norsso', name: 'Reptile', slug: null });
  const mixed = ctx.ArmoryShare.exportRows(row, { name: 'P365 XMacro' }, 'low');
  assert.deepEqual(JSON.parse(JSON.stringify(mixed.map((r) => (r.stock ? 'Stock ' : '') + r.catLabel))),
    ['Stock Grip Module', 'Slide', 'Stock Barrel', 'Optic', 'Trigger']);
  // The order IS the page's: ARMORY_GROUPS flattened, pinned both ways.
  const groups = [...read('gunforma-armory.html').matchAll(/cats: '([a-z_ ]+)'\.split/g)].map((m) => m[1]).join(' ');
  assert.equal(groups, ctx.ArmoryShare.CAT_ORDER.join(' '), 'CAT_ORDER matches ARMORY_GROUPS');
});

test('the Reddit export\'s text/html flavour is the same table, same Gunforma links, byte for byte', () => {
  const ctx = shareCtx();
  const day = new Date().toISOString().slice(0, 10);
  const html = ctx.ArmoryShare.exportHtml({
    shareId: SHARE, title: 'Joe carry', gunName: 'SIG P365 XMacro',
    rows: [
      { catLabel: 'Optic', name: 'Holosun 507K X2', option: '', href: SITE + '/parts/optics/holosun-507k-x2', price: 299.99, shop: 'OpticsPlanet' },
      { catLabel: 'Trigger', name: 'True Precision Flat P365', option: 'Copper', href: SITE + '/parts/triggers/tp-flat', price: 100, shop: null },
      { stock: true, catLabel: 'Grip Module', text: 'P365 XMacro grip module' },
    ],
  });
  assert.equal(html,
    '<p><a href="https://gunforma.com/l/' + SHARE + '">Gunforma Part List</a> · Starting from SIG P365 XMacro</p>' +
    '<table><thead><tr><th>Type</th><th>Item</th><th>Price</th></tr></thead><tbody>' +
    '<tr><td><strong>Starting gun</strong></td><td>SIG P365 XMacro</td><td>Owned</td></tr>' +
    '<tr><td><strong>Optic</strong></td><td><a href="https://gunforma.com/parts/optics/holosun-507k-x2">Holosun 507K X2</a></td><td>$299.99 @ OpticsPlanet</td></tr>' +
    '<tr><td><strong>Trigger</strong></td><td><a href="https://gunforma.com/parts/triggers/tp-flat">True Precision Flat P365 (Copper)</a></td><td>$100 MSRP</td></tr>' +
    '<tr><td><strong>Grip Module</strong></td><td>Stock P365 XMacro grip module</td><td>Stock</td></tr>' +
    '<tr><td></td><td><em>Stock parts not priced. Prices from Gunforma retailer data.</em></td><td></td></tr>' +
    '<tr><td></td><td><strong>Upgrade total</strong></td><td><strong>$399.99</strong></td></tr>' +
    '<tr><td></td><td>Generated by <a href="https://gunforma.com">Gunforma</a> ' + day + '</td><td></td></tr>' +
    '</tbody></table>');
  assert.doesNotMatch(html, /\/go\/|awin|affiliate/i, 'item links go to Gunforma pages only');
});

test('Copy for Reddit puts text/html AND text/plain on the clipboard; blocked rich copy falls back to the Markdown', async () => {
  const info = { shareId: SHARE, title: 'Joe carry', gunName: 'SIG P365 XMacro',
    rows: [{ catLabel: 'Optic', name: 'Holosun 507K X2', option: '', href: SITE + '/parts/optics/holosun-507k-x2', price: 299.99, shop: 'OpticsPlanet' }] };
  const rig = (clipboard) => {
    const ctx = shareCtx();
    ctx.Blob = function (parts, opts) { this.text = parts.join(''); this.type = opts.type; };
    ctx.ClipboardItem = function (items) { this.items = items; };
    ctx.navigator = { clipboard };
    return ctx;
  };
  // Rich copy available: both flavours, one write, no writeText.
  const wrote = []; const texts = [];
  const ctx = rig({ write: async (items) => { wrote.push(...items); }, writeText: async (t) => { texts.push(t); } });
  const btn = { textContent: 'Copy' };
  await ctx.ArmoryShare.copyExport('reddit', info, btn);
  assert.equal(wrote.length, 1);
  assert.equal(texts.length, 0);
  assert.equal(wrote[0].items['text/plain'].text, ctx.ArmoryShare.exportText('reddit', info), 'Markdown mode reads the Markdown');
  assert.equal(wrote[0].items['text/html'].text, ctx.ArmoryShare.exportHtml(info), 'the rich editor reads the table');
  assert.equal(btn.textContent, 'Copied ✓');
  // Rich copy blocked: the Markdown alone, still a copy.
  const got = [];
  const blocked = rig({ write: async () => { throw new Error('blocked'); }, writeText: async (t) => { got.push(t); } });
  await blocked.ArmoryShare.copyExport('reddit', info, { textContent: 'Copy' });
  assert.deepEqual(got, [blocked.ArmoryShare.exportText('reddit', info)]);
  // No ClipboardItem at all (older browser): the same fallback.
  const old = []; const noCI = rig({ write: async () => {}, writeText: async (t) => { old.push(t); } });
  noCI.ClipboardItem = undefined;
  await noCI.ArmoryShare.copyExport('reddit', info, { textContent: 'Copy' });
  assert.deepEqual(old, [noCI.ArmoryShare.exportText('reddit', info)]);
  // Plain text never rich-copies.
  const plain = []; const txt = rig({ write: async () => { throw new Error('should not write rich'); }, writeText: async (t) => { plain.push(t); } });
  await txt.ArmoryShare.copyExport('text', info, { textContent: 'Copy' });
  assert.deepEqual(plain, [txt.ArmoryShare.exportText('text', info)]);
});

test('both Copy buttons ride copyExport, and the Markdown-mode hint sits under each Reddit tab', () => {
  const mod = read('js/armory-share.js');
  const page = read('gunforma-armory.html');
  const HINT = 'On Reddit, if you see | and ** after pasting, switch the comment box to Markdown mode.';
  assert.ok(mod.includes(HINT), 'the /l/ export panel carries the line');
  assert.ok(page.includes(HINT), 'the Armory share panel carries the line');
  assert.match(mod, /ash-reddit[\s\S]{0,160}copyExport\('reddit'/, 'the visitor\'s Copy for Reddit too');
  assert.match(mod, /ash-copy-export'\)\.onclick = function \(e\) \{ copyExport\(state\.fmt/, 'the owner panel\'s Copy');
  assert.match(page, /ArmoryShare\.copyExport\(fmt, info, this\)/, 'the Armory panel\'s Copy');
});

test('ownership plumbing: the token store and the /l/ path shape', () => {
  const ctx = shareCtx();
  assert.equal(ctx.ArmoryShare.shareIdFromPath('/l/' + SHARE), SHARE);
  assert.equal(ctx.ArmoryShare.shareIdFromPath('/l/' + SHARE + '/'), SHARE);
  assert.equal(ctx.ArmoryShare.shareIdFromPath('/gg/x-' + ID), null);
  assert.equal(ctx.ArmoryShare.shareIdFromPath('/l/UPPER'), null);
  ctx.localStorage = { getItem: (k) => (k === ctx.ArmoryShare.TOKENS_KEY ? JSON.stringify({ [ID]: 'tok123' }) : null) };
  assert.equal(ctx.ArmoryShare.tokenFor(ID), 'tok123');
  assert.equal(ctx.ArmoryShare.tokenFor('other'), null);
  ctx.localStorage = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(ctx.ArmoryShare.tokenFor(ID), null, 'blocked storage degrades to not-the-owner');
});
