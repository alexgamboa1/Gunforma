// admin-field-notes.test.mjs — the admin field-notes editor's server half
// (netlify/functions/admin-field-notes.mjs) and its text surgery
// (_field-notes-admin.mjs), against a MOCKED GitHub and a mocked Supabase
// Auth. The mock records every request, so "never merges, never writes
// main, never deletes a branch, never writes a path off the allowlist" is
// asserted on what was actually sent, not on what the code says.
//
// What it pins:
//   - 403 for no token, a bad token, a signed-in non-admin, and a profile
//     that is not the token's own user — with no GitHub request sent
//   - commitFiles() refuses a path off the allowlist (and `main`, and any
//     non-admin branch) BEFORE any request
//   - a save: a fresh admin-edit/<slug>-<yyyymmdd-hhmm> branch from main,
//     ONE commit of exactly the note + the registry, a PR to main titled
//     "Field note edit: <slug> — <what changed>", the changelog entry, and
//     `updated` bumped only for a full review; a second save while that PR
//     is open commits onto its branch and opens no second PR
//   - a FAIL in the text (or a missing "What changed", or the fixture)
//     refuses the save with no write
//   - publish flips only `draft` (first publish: dates + "First published.")
//     and adds the index card; unpublish removes it
//   - a pasted draft: the registry-row block stripped, the row added with
//     draft: true, the file committed, "New field note (draft): <slug>"
//   - no token: list still reads (the repo is public), writes say
//     "GitHub token not set — see setup"
//   - the registry round-trip leaves every byte outside the row unchanged
//   - the editor and check-field-notes.mjs share ONE lint (and through it
//     one VOICE_RULES); the page is noindex, carries no analytics tag, is
//     not in the sitemap, reuses requireAdmin() verbatim, and every admin
//     bar links it
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnUrl = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;
const A = await import(fnUrl('_field-notes-admin.mjs'));
const fn = await import(fnUrl('admin-field-notes.mjs'));
const handler = fn.default;
const read = (p) => readFile(join(ROOT, p), 'utf8');

const REGISTRY = await read(A.REGISTRY_PATH);
const INDEX = await read(A.INDEX_PATH);
const LIVE = 'best-p365-xmacro-grip-modules';
const LIVE_SRC = await read('field-notes/' + LIVE + '.md');
const FIX_SRC = await read('field-notes/renderer-check.md');
const TODAY = new Date().toISOString().slice(0, 10);

// ── the mocks ────────────────────────────────────────────────────────────
// One in-memory repository: commits are { tree: Map(path → text) }, refs
// name commits, PRs are a list. Supabase Auth knows three tokens.
function mockWorld({ prs = [] } = {}) {
  let n = 0;
  const id = () => 'c' + (++n);
  const commits = new Map();
  const trees = new Map();
  const mainTree = new Map([[A.REGISTRY_PATH, REGISTRY], [A.INDEX_PATH, INDEX],
    ['field-notes/' + LIVE + '.md', LIVE_SRC], ['field-notes/renderer-check.md', FIX_SRC], ['field-notes/VOICE.md', 'voice']]);
  const main = id(); trees.set(main + 't', mainTree); commits.set(main, { tree: main + 't' });
  const refs = new Map([['main', main]]);
  for (const p of prs) { refs.set(p.branch, main); }
  const pulls = prs.map((p, i) => ({ number: 900 + i, html_url: 'https://github.com/x/pull/' + (900 + i), head: { ref: p.branch, sha: main }, base: { ref: 'main' }, title: 't', state: 'open' }));
  const calls = [];
  const users = { ADMIN: { id: 'u-admin', email: 'admin@example.test', role: 'admin' }, USER: { id: 'u-user', role: 'user' }, MISMATCH: { id: 'u-x', role: 'admin', profileId: 'someone-else' } };
  const res = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const treeAt = (ref) => trees.get(commits.get(refs.get(ref) || ref).tree);
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    if (u.includes('/auth/v1/user')) { const t = auth.replace('Bearer ', ''); return users[t] ? res(200, { id: users[t].id, email: users[t].email }) : res(401, { msg: 'bad jwt' }); }
    if (u.includes('/rest/v1/rpc/get_my_profile')) { const t = auth.replace('Bearer ', ''); const x = users[t]; return res(200, x ? [{ id: x.profileId || x.id, role: x.role }] : []); }
    if (u.includes('/rest/v1/')) return res(200, []);   // the preview's catalog reads: an empty catalog
    if (!u.startsWith('https://api.github.com/repos/')) throw new Error('unexpected fetch ' + u);
    const path = decodeURIComponent(u.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, ''));
    calls.push({ method, path, body, authed: /^Bearer /.test(auth) });
    let m;
    if (method === 'GET' && (m = path.match(/^\/contents\/(.+)\?ref=(.+)$/))) {
      const t = treeAt(m[2]); if (!t) return res(404, { message: 'no ref' });
      if (m[1] === 'field-notes') return res(200, [...t.keys()].filter((k) => k.startsWith('field-notes/')).map((k) => ({ type: 'file', name: k.slice(12), path: k })));
      return t.has(m[1]) ? res(200, { content: Buffer.from(t.get(m[1])).toString('base64') }) : res(404, { message: 'Not Found' });
    }
    if (method === 'GET' && path.startsWith('/pulls?')) return res(200, pulls.filter((p) => p.state === 'open'));
    if (method === 'GET' && (m = path.match(/^\/pulls\/(\d+)$/))) { const p = pulls.find((x) => x.number === +m[1]); return p ? res(200, p) : res(404, {}); }
    if (method === 'GET' && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) return refs.has(m[1]) ? res(200, { object: { sha: refs.get(m[1]) } }) : res(404, { message: 'Not Found' });
    if (method === 'POST' && path === '/git/refs') { refs.set(body.ref.replace('refs/heads/', ''), body.sha); return res(201, {}); }
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(.+)$/))) return res(200, { tree: { sha: commits.get(m[1]).tree } });
    if (method === 'POST' && path === '/git/trees') { const t = new Map(trees.get(body.base_tree)); for (const e of body.tree) t.set(e.path, e.content); const s = id() + 't'; trees.set(s, t); return res(201, { sha: s }); }
    if (method === 'POST' && path === '/git/commits') { const s = id(); commits.set(s, { tree: body.tree, parents: body.parents, message: body.message }); return res(201, { sha: s }); }
    if (method === 'PATCH' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) { refs.set(m[1], body.sha); return res(200, {}); }
    if (method === 'POST' && path === '/pulls') { const p = { number: 950 + pulls.length, html_url: 'https://github.com/x/pull/' + (950 + pulls.length), head: { ref: body.head, sha: refs.get(body.head) }, base: { ref: body.base }, title: body.title, body: body.body, state: 'open' }; pulls.push(p); return res(201, p); }
    if (method === 'GET' && (m = path.match(/^\/commits\/(.+)\/status$/))) return res(200, { statuses: [{ context: 'netlify/velvety-stardust-4de48f/deploy-preview', state: 'success', target_url: 'https://deploy-preview-950--velvety-stardust-4de48f.netlify.app' }] });
    throw new Error('unmocked GitHub call ' + method + ' ' + path);
  };
  return { calls, refs, pulls, commits, trees, treeAt, main };
}
const realFetch = globalThis.fetch;
const realErr = console.error;
test.beforeEach(() => { process.env.GITHUB_FIELD_NOTES_TOKEN = 'test-token'; console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realErr; delete process.env.GITHUB_FIELD_NOTES_TOKEN; });

const call = async (token, method, params, body) => {
  const url = 'https://deploy-preview-1--x.netlify.app/.netlify/functions/admin-field-notes' + (params ? '?' + new URLSearchParams(params) : '');
  const res = await handler(new Request(url, { method, headers: Object.assign({}, token ? { Authorization: 'Bearer ' + token } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, headers: res.headers, body: await res.json() };
};
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const assertNeverDangerous = (calls) => {
  for (const c of calls) {
    assert.ok(c.method !== 'DELETE', 'never deletes: ' + c.path);
    assert.ok(!/\/merge$/.test(c.path), 'never merges: ' + c.path);
    assert.ok(!/^\/git\/refs\/heads\/main$/.test(c.path) || c.method === 'GET', 'never moves main');
    if (c.method === 'POST' && c.path === '/git/refs') assert.match(c.body.ref, /^refs\/heads\/admin-(edit|publish|new)\//);
    if (c.method === 'POST' && c.path === '/pulls') assert.equal(c.body.base, 'main', 'PRs target main');
    if (c.method === 'POST' && c.path === '/git/trees') for (const e of c.body.tree) assert.ok(A.isWritablePath(e.path), 'only allowlisted paths: ' + e.path);
  }
};

// ── auth ─────────────────────────────────────────────────────────────────
test('403 without an admin session — and no GitHub request', async () => {
  for (const tok of [null, 'NOPE', 'USER', 'MISMATCH']) {
    const w = mockWorld();
    for (const [m, p, b] of [['GET', { action: 'list' }], ['POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC, whatChanged: 'x' }]]) {
      const r = await call(tok, m, p, b);
      assert.equal(r.status, 403, String(tok));
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    assert.equal(w.calls.length, 0, 'no GitHub call for ' + tok);
  }
});

// ── the allowlist, before any request ───────────────────────────────────
test('commitFiles refuses a path off the allowlist, or a non-admin branch, before any request', async () => {
  const w = mockWorld();
  for (const p of ['index.html', 'netlify.toml', 'netlify/functions/field-note.mjs', 'field-notes/../CLAUDE.md', 'field-notes/Bad_Slug.md', 'field-notes/x/y.md', 'scripts/check-all.sh']) {
    await assert.rejects(fn.commitFiles('admin-edit/x-20261120-1200', [{ path: p, content: 'x' }], 'm'), /refused/, p);
  }
  for (const b of ['main', 'feature/x', 'admin-edit/x', 'admin-edit/../main-20261120-1200']) {
    await assert.rejects(fn.commitFiles(b, [{ path: A.notePath('x'), content: 'x' }], 'm'), /refused/, b);
  }
  assert.equal(w.calls.length, 0, 'refused before any GitHub call');
  for (const ok of [A.REGISTRY_PATH, A.INDEX_PATH, 'field-notes/a-b-1.md']) assert.ok(A.isWritablePath(ok), ok);
});

// ── list ─────────────────────────────────────────────────────────────────
test('list: the live guide Published, renderer-check a Fixture, an unregistered file flagged', async () => {
  const w = mockWorld();
  w.treeAt('main').set('field-notes/stray-note.md', '---\ntitle: Stray\n---\n');
  const r = await call('ADMIN', 'GET', { action: 'list' });
  assert.equal(r.status, 200);
  const live = r.body.notes.find((n) => n.slug === LIVE);
  assert.equal(live.draft, false); assert.equal(live.type, 'roundup'); assert.ok(live.title.startsWith('Best P365 XMacro'));
  const fx = r.body.notes.find((n) => n.slug === 'renderer-check');
  assert.equal(fx.fixture, true); assert.equal(fx.draft, true);
  const stray = r.body.notes.find((n) => n.slug === 'stray-note');
  assert.equal(stray.inRegistry, false, 'a file nothing declares is flagged');
  assert.ok(!r.body.notes.some((n) => n.slug === 'VOICE'), 'VOICE.md is a document, not a note');
  assert.equal(writes(w.calls).length, 0);
});

// ── preview ──────────────────────────────────────────────────────────────
test('preview: the real renderer, noindex, no analytics; the shared lint reports a FAIL', async () => {
  mockWorld();
  const src = LIVE_SRC.replace('The grip module is the biggest', 'We tested every module. The grip module is the biggest');
  const r = await call('ADMIN', 'POST', null, { action: 'preview', slug: LIVE, src, row: { published: '2026-10-26', updated: '2026-10-26' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.html.includes('<meta name="robots" content="noindex"/>'));
  assert.ok(r.body.html.includes('<strong>Preview.</strong>'));
  assert.ok(!r.body.html.includes('cloudflareinsights'), 'no analytics in an admin preview');
  assert.ok(r.body.html.includes('<h1>Best P365 XMacro'), 'the real renderer drew it');
  const f = r.body.issues.filter((i) => i.level === 'fail');
  assert.equal(f.length, 1);
  assert.match(f[0].msg, /we tested/i);
  assert.ok(f[0].line > 0, 'with its line number');
});

// ── save ─────────────────────────────────────────────────────────────────
test('save: a fresh admin-edit branch, one commit of note + registry, a PR to main', async () => {
  const w = mockWorld();
  const src = LIVE_SRC.replace('The short answer:', 'In short:');
  const r = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src, whatChanged: 'Tightened the answer block', fullReview: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assertNeverDangerous(w.calls);
  const branch = r.body.pr.branch;
  assert.match(branch, new RegExp('^admin-edit/' + LIVE + '-\\d{8}-\\d{4}$'));
  const trees = w.calls.filter((c) => c.method === 'POST' && c.path === '/git/trees');
  assert.equal(trees.length, 1, 'one commit');
  assert.deepEqual(trees[0].body.tree.map((e) => e.path).sort(), [A.REGISTRY_PATH, 'field-notes/' + LIVE + '.md'].sort());
  const pr = w.calls.find((c) => c.method === 'POST' && c.path === '/pulls');
  assert.equal(pr.body.title, 'Field note edit: ' + LIVE + ' — Tightened the answer block');
  assert.equal(pr.body.head, branch);
  const t = w.treeAt(branch);
  assert.ok(t.get('field-notes/' + LIVE + '.md').includes('In short:'));
  const notes = await A.loadRegistry(t.get(A.REGISTRY_PATH));
  const row = notes.find((n) => n.slug === LIVE);
  assert.equal(row.changelog[0], TODAY + ': Tightened the answer block.');
  assert.equal(row.updated, '2026-10-26', 'not a full review: the date stays');
  assert.equal(w.treeAt('main').get(A.REGISTRY_PATH), REGISTRY, 'main untouched');
  // the preview URL comes from Netlify's real status context,
  // netlify/<site>/deploy-preview (read off PR #281) — not deploy/netlify
  const st = await call('ADMIN', 'GET', { action: 'status', pr: r.body.pr.number });
  assert.equal(st.status, 200);
  assert.equal(st.body.preview.url, 'https://deploy-preview-950--velvety-stardust-4de48f.netlify.app', 'the preview URL is found');
});

test('save with "This is a full review" bumps updated; a second save adds to the open PR', async () => {
  const w = mockWorld();
  const r1 = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC, whatChanged: 'Full review of every card', fullReview: true });
  assert.equal(r1.status, 200);
  const row1 = (await A.loadRegistry(w.treeAt(r1.body.pr.branch).get(A.REGISTRY_PATH))).find((n) => n.slug === LIVE);
  assert.equal(row1.updated, TODAY);
  const r2 = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC + '\n', whatChanged: 'Second pass', fullReview: false });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.addedToExisting, true);
  assert.equal(r2.body.pr.branch, r1.body.pr.branch, 'same branch');
  assert.equal(w.calls.filter((c) => c.method === 'POST' && c.path === '/pulls').length, 1, 'no second PR');
  assert.equal(w.calls.filter((c) => c.method === 'POST' && c.path === '/git/refs').length, 1, 'no second branch');
  const row2 = (await A.loadRegistry(w.treeAt(r1.body.pr.branch).get(A.REGISTRY_PATH))).find((n) => n.slug === LIVE);
  assert.deepEqual(row2.changelog.slice(0, 2), [TODAY + ': Second pass.', TODAY + ': Full review of every card.']);
  assertNeverDangerous(w.calls);
});

test('save is refused with no write: a FAIL, no "What changed", the fixture', async () => {
  const w = mockWorld();
  let r = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC.replace('The grip module', 'At the range, the grip module'), whatChanged: 'x' });
  assert.equal(r.status, 422); assert.ok(r.body.issues.some((i) => i.level === 'fail'));
  r = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC, whatChanged: '  ' });
  assert.equal(r.status, 400);
  r = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC, whatChanged: 'Repriced to $99' });
  assert.equal(r.status, 400, 'a typed $ figure in the changelog line');
  r = await call('ADMIN', 'POST', null, { action: 'save', slug: 'renderer-check', src: FIX_SRC, whatChanged: 'x' });
  assert.equal(r.status, 400);
  assert.equal(writes(w.calls).length, 0);
});

// ── publish / unpublish ──────────────────────────────────────────────────
test('unpublish flips only draft and removes the card; publish puts both back', async () => {
  const w = mockWorld();
  const r = await call('ADMIN', 'POST', null, { action: 'publish', slug: LIVE, publish: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assertNeverDangerous(w.calls);
  const t = w.treeAt(r.body.pr.branch);
  const after = t.get(A.REGISTRY_PATH);
  const before = (await A.loadRegistry(REGISTRY)).find((n) => n.slug === LIVE);
  assert.deepEqual((await A.loadRegistry(after)).find((n) => n.slug === LIVE), { ...before, draft: true }, 'only draft changed');
  assert.ok(!t.get(A.INDEX_PATH).includes('href="/field-notes/' + LIVE + '"'), 'card removed');
  assert.equal(w.calls.find((c) => c.method === 'POST' && c.path === '/pulls').body.title, 'Field note unpublish: ' + LIVE);
  // a draft that has never been live: first publish sets the dates
  const w2 = mockWorld();
  const draftRegistry = A.insertRow(REGISTRY, { slug: 'new-guide', published: '2026-11-01', updated: '2026-11-01', draft: true, tags: ['grip-modules'] });
  w2.treeAt('main').set(A.REGISTRY_PATH, draftRegistry);
  w2.treeAt('main').set('field-notes/new-guide.md', LIVE_SRC.replace(/^title: .*$/m, 'title: A New Guide To Grips'));
  const p = await call('ADMIN', 'POST', null, { action: 'publish', slug: 'new-guide', publish: true });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const t2 = w2.treeAt(p.body.pr.branch);
  const row = (await A.loadRegistry(t2.get(A.REGISTRY_PATH))).find((n) => n.slug === 'new-guide');
  assert.deepEqual(row, { slug: 'new-guide', published: TODAY, updated: TODAY, tags: ['grip-modules'], changelog: [TODAY + ': First published.'] });
  const idx = t2.get(A.INDEX_PATH);
  assert.ok(idx.indexOf('href="/field-notes/new-guide"') < idx.indexOf('href="/field-notes/' + LIVE + '"'), 'newest first');
  assertNeverDangerous(w2.calls);
});

// ── new draft ────────────────────────────────────────────────────────────
test('new draft: the registry-row block stripped, the row added draft: true, one PR', async () => {
  const w = mockWorld();
  const text = LIVE_SRC.replace(/^title: .*$/m, 'title: Sample Grip Note') +
    "\n```registry-row\n{ slug: 'sample-grip-note', published: '2026-11-20', updated: '2026-11-20', draft: true, tags: ['grip-modules', 'p365-xmacro'] }\n```\n";
  const r = await call('ADMIN', 'POST', null, { action: 'new', text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assertNeverDangerous(w.calls);
  const t = w.treeAt(r.body.pr.branch);
  assert.match(r.body.pr.branch, /^admin-new\/sample-grip-note-\d{8}-\d{4}$/);
  assert.ok(!t.get('field-notes/sample-grip-note.md').includes('registry-row'), 'the block is stripped from the file');
  const row = (await A.loadRegistry(t.get(A.REGISTRY_PATH))).find((n) => n.slug === 'sample-grip-note');
  assert.deepEqual(row, { slug: 'sample-grip-note', published: '2026-11-20', updated: '2026-11-20', draft: true, tags: ['grip-modules', 'p365-xmacro'] });
  assert.equal(w.calls.find((c) => c.method === 'POST' && c.path === '/pulls').body.title, 'New field note (draft): sample-grip-note');
  assert.equal(t.get(A.INDEX_PATH), INDEX, 'a draft gets no index card');
  // refusals: a slug already declared, an unsafe slug, no block
  for (const bad of [text.replace(/sample-grip-note/g, LIVE), text.replace(/sample-grip-note/g, 'Bad Slug'), LIVE_SRC]) {
    const x = await call('ADMIN', 'POST', null, { action: 'new', text: bad });
    assert.ok(x.status >= 400, 'refused');
  }
});

// ── no token ─────────────────────────────────────────────────────────────
test('no token: list reads unauthenticated, writes say the setup sentence', async () => {
  delete process.env.GITHUB_FIELD_NOTES_TOKEN;
  const w = mockWorld();
  const l = await call('ADMIN', 'GET', { action: 'list' });
  assert.equal(l.status, 200); assert.equal(l.body.tokenSet, false);
  assert.ok(w.calls.every((c) => !c.authed), 'no Authorization header without a token');
  const s = await call('ADMIN', 'POST', null, { action: 'save', slug: LIVE, src: LIVE_SRC, whatChanged: 'x' });
  assert.equal(s.status, 503); assert.equal(s.body.error, fn.TOKEN_MISSING);
  assert.equal(writes(w.calls).length, 0);
});

// ── the registry surgery ─────────────────────────────────────────────────
test('registry round-trip: every byte outside the row unchanged; a foreign edit refused', async () => {
  const flipped = A.setDraft(REGISTRY, LIVE, true);
  const r = A.findRow(flipped, LIVE), r0 = A.findRow(REGISTRY, LIVE);
  assert.equal(flipped.slice(0, r.start), REGISTRY.slice(0, r0.start));
  assert.equal(flipped.slice(r.end), REGISTRY.slice(r0.end));
  assert.equal(A.setDraft(flipped, LIVE, false), REGISTRY, 'and back, byte for byte');
  const plus = A.addChangelog(REGISTRY, LIVE, "2026-11-20: It's a test, with a } brace.");
  assert.equal((await A.loadRegistry(plus)).find((n) => n.slug === LIVE).changelog[0], "2026-11-20: It's a test, with a } brace.");
  assert.equal(A.registryRows(plus).rows.length, A.registryRows(REGISTRY).rows.length, 'a brace inside a string never ends a row');
  // an edit that touched another row is refused by the verifier
  const wrong = A.setDraft(REGISTRY, 'renderer-check', false);
  await assert.rejects(A.verifyRegistryEdit(REGISTRY, wrong, LIVE, (await A.loadRegistry(REGISTRY)).find((n) => n.slug === LIVE)), /another row/);
});

// ── one lint, one page contract ──────────────────────────────────────────
test('the editor and check-field-notes.mjs share one lint and one VOICE_RULES', async () => {
  const fnSrc = await read('netlify/functions/admin-field-notes.mjs');
  const guard = await read('scripts/check-field-notes.mjs');
  const lint = await read('scripts/field-notes-lint.mjs');
  assert.match(fnSrc, /from '\.\.\/\.\.\/scripts\/field-notes-lint\.mjs'/, 'the function imports the shared lint');
  assert.match(guard, /scripts\/field-notes-lint\.mjs/, 'the guard imports the same lint');
  assert.match(lint, /from '\.\/field-notes-voice\.mjs'/, 'which imports the one VOICE_RULES module');
  assert.ok(!/VOICE_RULES\s*=/.test(fnSrc + guard), 'neither keeps its own copy of the word lists');
});

test('the page: noindex, no analytics, not in the sitemap, requireAdmin() verbatim, linked from every admin bar', async () => {
  const page = await read('gunforma-admin-field-notes.html');
  assert.ok(page.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.ok(!page.includes('cloudflareinsights'));
  assert.ok(!(await read('netlify/functions/sitemap.mjs')).includes('gunforma-admin-field-notes'));
  const gate = (s) => s.slice(s.indexOf('async function requireAdmin()'), s.indexOf('\n}\n', s.indexOf('async function requireAdmin()')) + 2).replace(/\$\('gate'\)\.innerHTML = '[^']*';/, '');
  assert.equal(gate(page), gate(await read('gunforma-admin-data.html')), 'the same requireAdmin() as the other admin pages');
  for (const f of ['gunforma-admin-creators.html', 'gunforma-admin-data.html', 'gunforma-admin-part.html', 'gunforma-admin-post.html', 'gunforma-admin-queue.html', 'gunforma-admin-field-notes.html']) {
    assert.ok((await read(f)).includes('<a href="gunforma-admin-field-notes.html" class="nav-right-link'), f + ' links the field-notes editor');
  }
  assert.ok(!/\bconfirm\s*\(/.test(page), 'in-page confirmation, never confirm()');
  assert.ok(page.includes('This opens a pull request; the change goes live when you merge it.'));
});
