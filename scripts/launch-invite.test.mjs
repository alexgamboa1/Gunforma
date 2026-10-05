// launch-invite.test.mjs — every branch of supabase/functions/launch-invite,
// run against a fake Supabase.
//
//   node --test scripts/launch-invite.test.mjs      (Node 22.13 or newer)
//
// Run it before `supabase functions deploy launch-invite`. It is NOT a build
// check: the function is TypeScript, and stripping its types needs
// node:module's stripTypeScriptTypes, which the site build's Node 20 does not
// have. See NOT_BUILD_CHECKS in scripts/check-all.sh.
//
// What it is for. The function has three actions and most of its lines are
// refusals. `release` deletes an auth user, and three foreign keys cascade
// from that delete: builds.user_id -> profiles, profiles.id -> auth.users and
// build_photos.user_id -> auth.users. The fake below implements that cascade,
// so "the build survives a release" is something this file can watch fail.
//
// What it cannot tell you: whether Supabase behaves like the fake. The one
// assumption that matters is that inviteUserByEmail RE-SENDS to an existing
// unconfirmed address instead of refusing it. That is how supabase/auth's
// invite handler reads (internal/api/invite.go), and it is not proven here.
// Prove it once on a real address before relying on --resend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = join(ROOT, 'supabase/functions/launch-invite/index.ts');

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const BUILD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CLAIM = 'https://gunforma.com/gunforma-claim.html';

// ── the fake ────────────────────────────────────────────────────────────────
let db;
let nextId = 1;
const uid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(nextId++).padStart(12, '0')}`;

function reset() {
  nextId = 1;
  db = {
    users:    [{ id: ADMIN, email: 'admin@gunforma.test', email_confirmed_at: 'x', last_sign_in_at: 'x' }],
    profiles: [{ id: ADMIN, role: 'admin', created_at: '2026-01-01' }],
    builds:   [{ id: BUILD, user_id: null }, { id: OTHER, user_id: null }],
    photos:   [{ id: 'p1', build_id: BUILD, user_id: ADMIN }, { id: 'p2', build_id: BUILD, user_id: ADMIN },
               { id: 'p3', build_id: OTHER, user_id: ADMIN }],
    sent:     [],          // every invite email: { email, redirectTo, userId }
    // Switches for the failures worth simulating.
    unlinkMatchesNothing: false,
  };
}

const TABLES = { builds: 'builds', build_photos: 'photos', profiles: 'profiles' };

function from(table) {
  const rows = () => db[TABLES[table]];
  const q = { filters: [], patch: null, wantRows: false, single: false, lim: null, ord: null };
  const api = {
    select() { q.wantRows = true; return api; },
    update(patch) { q.patch = patch; q.wantRows = false; return api; },
    eq(col, val) { q.filters.push([col, val]); return api; },
    order(col, opt) { q.ord = [col, opt && opt.ascending === false ? -1 : 1]; return api; },
    limit(n) { q.lim = n; return api; },
    maybeSingle() { q.single = true; return api; },
    then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
  };
  function run() {
    let hit = rows().filter((r) => q.filters.every(([c, v]) => r[c] === v));
    if (q.patch) {
      if (table === 'builds' && db.unlinkMatchesNothing && q.patch.user_id === null) hit = [];
      hit.forEach((r) => Object.assign(r, q.patch));
      return { data: q.wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    if (q.ord) hit = hit.slice().sort((a, b) => (a[q.ord[0]] < b[q.ord[0]] ? -1 : 1) * q.ord[1]);
    if (q.lim != null) hit = hit.slice(0, q.lim);
    if (q.single) return { data: hit[0] ? { ...hit[0] } : null, error: null };
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
  return api;
}

const admin = {
  async listUsers({ page, perPage }) {
    const start = (page - 1) * perPage;
    return { data: { users: db.users.slice(start, start + perPage).map((u) => ({ ...u })) }, error: null };
  },
  // Mirrors supabase/auth internal/api/invite.go: a confirmed address is
  // refused, an unconfirmed one is re-sent to, a new one is created.
  async inviteUserByEmail(email, opts) {
    let user = db.users.find((u) => u.email === email);
    if (user && user.email_confirmed_at) {
      return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } };
    }
    if (!user) {
      user = { id: uid(), email, email_confirmed_at: null, last_sign_in_at: null, invited_at: 'now' };
      db.users.push(user);
      db.profiles.push({ id: user.id, role: 'user', created_at: '2026-10-05' });   // handle_new_user
    }
    db.sent.push({ email, redirectTo: opts && opts.redirectTo, userId: user.id });
    return { data: { user: { ...user } }, error: null };
  },
  // The three cascades, as the live schema has them.
  async deleteUser(id) {
    db.users    = db.users.filter((u) => u.id !== id);
    db.profiles = db.profiles.filter((p) => p.id !== id);
    const gone  = db.builds.filter((b) => b.user_id === id).map((b) => b.id);
    db.builds   = db.builds.filter((b) => b.user_id !== id);
    db.photos   = db.photos.filter((p) => p.user_id !== id && !gone.includes(p.build_id));
    return { data: {}, error: null };
  },
};

globalThis.__fakeSupabase = { createClient: () => ({ from, auth: { admin } }) };

// ── load the real function ──────────────────────────────────────────────────
let handler;
globalThis.Deno = {
  env: { get: (k) => (k === 'SUPABASE_URL' ? 'http://fake' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'env-service-key' : undefined) },
  serve: (fn) => { handler = fn; },
};

if (typeof nodeModule.stripTypeScriptTypes !== 'function') {
  throw new Error('launch-invite.test.mjs needs Node 22.13 or newer (node:module stripTypeScriptTypes). This is Node ' + process.version);
}
{
  const IMPORT = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';";
  const ts = await readFile(SRC, 'utf8');
  // If the import line changes, this must fail loudly rather than test a file
  // that still reaches for the real client.
  assert.ok(ts.includes(IMPORT), 'launch-invite no longer imports supabase-js the way this test expects');
  const js = nodeModule.stripTypeScriptTypes(ts.replace(IMPORT, 'const { createClient } = globalThis.__fakeSupabase;'));
  const dir = await mkdtemp(join(tmpdir(), 'launch-invite-'));
  const out = join(dir, 'index.mjs');
  await writeFile(out, js);
  await import(pathToFileURL(out).href);
  assert.equal(typeof handler, 'function', 'the function never called Deno.serve');
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `h.${b64({ role })}.s`;

async function call(body, { role = 'service_role' } = {}) {
  const res = await handler(new Request('http://fn/launch-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt(role)}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

const build  = (id = BUILD) => db.builds.find((b) => b.id === id);
const user   = (email) => db.users.find((u) => u.email === email);
const owners = (id = BUILD) => [...new Set(db.photos.filter((p) => p.build_id === id).map((p) => p.user_id))];
const claim  = (email) => { user(email).email_confirmed_at = 'now'; user(email).last_sign_in_at = 'now'; };

// ── invite ──────────────────────────────────────────────────────────────────
test('invite: creates the user, links the build and its photo rows, sends one email', async () => {
  reset();
  const r = await call({ email: 'A@Example.com', build_id: BUILD });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.warning, undefined);
  const u = user('a@example.com');
  assert.equal(build().user_id, u.id);
  assert.deepEqual(owners(), [u.id]);
  assert.deepEqual(owners(OTHER), [ADMIN], 'another build\'s photos were touched');
  assert.deepEqual(db.sent, [{ email: 'a@example.com', redirectTo: CLAIM, userId: u.id }]);
});

test('invite: a re-run sends nothing and says who has not claimed', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const again = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(again.body.skipped, true);
  assert.equal(again.body.unclaimed, true);
  assert.match(again.body.reason, /not claimed yet/);
  assert.equal(db.sent.length, 1, 'a plain re-run emailed the builder again');

  claim('a@example.com');
  const claimed = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(claimed.body.skipped, true);
  assert.equal(claimed.body.unclaimed, undefined);
  assert.match(claimed.body.reason, /already claimed/);
  assert.equal(db.sent.length, 1);
});

test('invite: never overwrites a build linked to someone else, or adopts an existing account', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const owner = build().user_id;

  const stranger = await call({ email: 'b@example.com', build_id: BUILD });
  assert.equal(stranger.body.skipped, true);
  assert.match(stranger.body.reason, /refusing to overwrite/);
  assert.equal(build().user_id, owner);
  assert.equal(user('b@example.com'), undefined, 'an account was created for a refused invite');

  const sameEmailOtherBuild = await call({ email: 'a@example.com', build_id: OTHER });
  assert.equal(sameEmailOtherBuild.body.skipped, true);
  assert.equal(sameEmailOtherBuild.body.reason, 'already exists');
  assert.equal(build(OTHER).user_id, null);
  assert.equal(db.sent.length, 1);
});

// ── resend ──────────────────────────────────────────────────────────────────
test('resend: a fresh email to the same account, and nothing else changes', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const before = JSON.stringify({ users: db.users, builds: db.builds, photos: db.photos, profiles: db.profiles });

  const r = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(r.status, 200);
  assert.equal(r.body.resent, true);
  assert.equal(r.body.warning, undefined);
  assert.equal(r.body.user_id, user('a@example.com').id);
  assert.equal(db.sent.length, 2);
  assert.equal(db.sent[1].redirectTo, CLAIM);
  assert.equal(db.sent[1].userId, db.sent[0].userId, 'the resend went to a different account');
  assert.equal(JSON.stringify({ users: db.users, builds: db.builds, photos: db.photos, profiles: db.profiles }), before);
});

test('resend: refuses a claimed builder, an unknown email, an unlinked build and a mismatched pair', async () => {
  reset();
  const unknown = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(unknown.status, 409);
  assert.match(unknown.body.error, /no account exists/);

  await call({ email: 'a@example.com', build_id: BUILD });
  const wrongBuild = await call({ email: 'a@example.com', build_id: OTHER, action: 'resend' });
  assert.equal(wrongBuild.status, 409);
  assert.match(wrongBuild.body.error, /no builder linked/);

  await call({ email: 'b@example.com', build_id: OTHER });
  const crossed = await call({ email: 'b@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(crossed.status, 409);
  assert.match(crossed.body.error, /different account/);

  claim('a@example.com');
  const claimed = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(claimed.status, 409);
  assert.equal(claimed.body.claimed, true);

  assert.equal(db.sent.length, 2, 'a refused resend sent an email');
});

// ── release ─────────────────────────────────────────────────────────────────
test('release: the build survives, its photos go back to the admin, the account is gone', async () => {
  reset();
  await call({ email: 'typo@example.com', build_id: BUILD });
  const invited = user('typo@example.com').id;

  const r = await call({ email: 'typo@example.com', build_id: BUILD, action: 'release' });
  assert.equal(r.status, 200);
  assert.equal(r.body.released, true);
  assert.equal(r.body.warning, undefined);
  assert.equal(r.body.deleted_user_id, invited);

  assert.ok(build(), 'the build was deleted with the account');
  assert.equal(build().user_id, null);
  assert.deepEqual(owners(), [ADMIN]);
  assert.equal(db.photos.filter((p) => p.build_id === BUILD).length, 2, 'photo rows were lost');
  assert.equal(user('typo@example.com'), undefined);
  assert.equal(db.profiles.find((p) => p.id === invited), undefined);

  // And the point of it: the right address can now be invited.
  const right = await call({ email: 'right@example.com', build_id: BUILD });
  assert.equal(right.body.success, true);
  assert.equal(build().user_id, user('right@example.com').id);
});

test('release: never touches a claimed account', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  claim('a@example.com');
  const before = JSON.stringify(db);
  const r = await call({ email: 'a@example.com', build_id: BUILD, action: 'release' });
  assert.equal(r.status, 409);
  assert.equal(r.body.claimed, true);
  assert.equal(JSON.stringify(db), before);
});

test('release: refuses an unknown email and a build that is not this account\'s', async () => {
  reset();
  const unknown = await call({ email: 'a@example.com', build_id: BUILD, action: 'release' });
  assert.equal(unknown.status, 409);

  await call({ email: 'a@example.com', build_id: BUILD });
  const before = JSON.stringify(db);
  const wrong = await call({ email: 'a@example.com', build_id: OTHER, action: 'release' });
  assert.equal(wrong.status, 409);
  assert.equal(JSON.stringify(db), before);
});

test('release: an unlink that silently matches nothing keeps the account, so nothing cascades', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  db.unlinkMatchesNothing = true;
  const r = await call({ email: 'a@example.com', build_id: BUILD, action: 'release' });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /matched no row/);
  assert.ok(user('a@example.com'), 'the account was deleted while still linked to the build');
  assert.ok(build(), 'the build was deleted');
});

test('release: an account that still owns something else is not deleted', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const id = user('a@example.com').id;
  build(OTHER).user_id = id;                       // a second build, linked by hand
  const r = await call({ email: 'a@example.com', build_id: BUILD, action: 'release' });
  assert.equal(r.status, 200);
  assert.match(r.body.warning, /NOT deleted/);
  assert.equal(r.body.released, undefined);
  assert.ok(user('a@example.com'));
  assert.ok(build(OTHER), 'the other build was deleted');
  assert.equal(build().user_id, null);
});

// ── the door ────────────────────────────────────────────────────────────────
test('rejects the anon key, an unknown action and a bad body before doing anything', async () => {
  reset();
  const anon = await call({ email: 'a@example.com', build_id: BUILD }, { role: 'anon' });
  assert.equal(anon.status, 403);
  const bad = await call({ email: 'a@example.com', build_id: BUILD, action: 'delete' });
  assert.equal(bad.status, 400);
  const noBuild = await call({ email: 'a@example.com', build_id: '33333333-3333-4333-8333-333333333333' });
  assert.equal(noBuild.status, 404);
  assert.equal(db.users.length, 1);
  assert.equal(db.sent.length, 0);
});
