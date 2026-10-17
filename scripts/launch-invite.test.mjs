// launch-invite.test.mjs — every branch of supabase/functions/launch-invite,
// run against a fake Supabase and a stubbed Resend.
//
//   node --test scripts/launch-invite.test.mjs      (Node 22.13 or newer)
//
// Run it before `supabase functions deploy launch-invite`. It is NOT a build
// check: the function is TypeScript, and stripping its types needs
// node:module's stripTypeScriptTypes, which the site build's Node 20 does not
// have. See NOT_BUILD_CHECKS in scripts/check-all.sh.
//
// What it is for. The function has three actions and most of its lines are
// refusals. Since the 7-day claim links (supabase/claim_invites.sql) it no
// longer sends through Supabase's mailer: it creates the user pre-confirmed,
// writes a claim_invites row holding sha256(token), and POSTs OUR OWN email
// to Resend carrying the raw token. So the things worth watching fail are:
//
//   - the hash in the row is the hash of the token in the email, and the raw
//     token is nowhere else — not in the row, not in the response;
//   - a re-run is an idempotent skip that sends nothing;
//   - resend needs an open invite, rotates the token, and the old one dies;
//   - release is refused the moment claimed_at is set, and otherwise hands
//     the build back without the cascade eating it (builds.user_id ->
//     profiles, profiles.id -> auth.users, build_photos.user_id -> auth.users,
//     claim_invites.user_id -> auth.users — the fake implements all four);
//   - a Resend outage is reported as a warning, never as a clean launch.
//
// global fetch is REPLACED for the whole run. Every call is recorded and only
// the Resend endpoint is answered; anything else throws. No real email can
// leave this file.
//
// What it cannot tell you: whether Supabase behaves like the fake. The one
// assumption that matters is that auth.admin.createUser with email_confirm
// refuses an address that already exists rather than returning the old user.
// That is how supabase/auth's admin handler reads (internal/api/admin.go),
// and the function tolerates either answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = join(ROOT, 'supabase/functions');
const SRC    = join(FN_DIR, 'launch-invite/index.ts');

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const BUILD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CLAIM = 'https://gunforma.com/gunforma-claim.html';
const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_KEY = 'resend-test-key';
const DAY_MS = 24 * 60 * 60 * 1000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ── the fake ────────────────────────────────────────────────────────────────
let db;
let nextId = 1;
const uid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(nextId++).padStart(12, '0')}`;

function reset() {
  nextId = 1;
  db = {
    users:    [{ id: ADMIN, email: 'admin@gunforma.test', email_confirmed_at: 'x', last_sign_in_at: 'x' }],
    profiles: [{ id: ADMIN, role: 'admin', created_at: '2026-01-01', onboarding_complete: true }],
    builds:   [{ id: BUILD, user_id: null }, { id: OTHER, user_id: null }],
    photos:   [{ id: 'p1', build_id: BUILD, user_id: ADMIN }, { id: 'p2', build_id: BUILD, user_id: ADMIN },
               { id: 'p3', build_id: OTHER, user_id: ADMIN }],
    invites:  [],          // public.claim_invites
    sent:     [],          // every Resend POST: { auth, from, to, subject, html }
    // Switches for the failures worth simulating.
    unlinkMatchesNothing: false,
    inviteInsertFails:    false,
    resendFails:          false,
  };
}

const TABLES = { builds: 'builds', build_photos: 'photos', profiles: 'profiles', claim_invites: 'invites' };

// Enough of the PostgREST query builder for what the function writes:
// select/update/insert, eq/is, order/limit, maybeSingle/single, awaited.
function from(table) {
  const key = TABLES[table];
  if (!key) throw new Error('launch-invite reached a table the fake does not have: ' + table);
  const q = { filters: [], patch: null, insertRow: null, wantRows: false, single: false, lim: null, ord: null };
  const api = {
    select()      { q.wantRows = true; return api; },
    update(patch) { q.patch = patch; q.wantRows = false; return api; },
    insert(row)   { q.insertRow = row; q.wantRows = false; return api; },
    eq(col, val)  { q.filters.push((r) => r[col] === val); return api; },
    is(col, val)  { q.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return api; },
    order(col, opt) { q.ord = [col, opt && opt.ascending === false ? -1 : 1]; return api; },
    limit(n)      { q.lim = n; return api; },
    maybeSingle() { q.single = true; return api; },
    single()      { q.single = true; return api; },
    then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  function run() {
    if (q.insertRow) {
      if (key === 'invites' && db.inviteInsertFails) {
        return { data: null, error: { message: 'insert refused (simulated)' } };
      }
      const row = {
        id: uid(), send_count: 0, redeem_count: 0, resend_count: 0, claimed_at: null,
        created_at: new Date(Date.now() + db[key].length).toISOString(),   // insertion order
        ...q.insertRow,
      };
      db[key].push(row);
      return { data: q.single ? { ...row } : [{ ...row }], error: null };
    }
    let hit = db[key].filter((r) => q.filters.every((f) => f(r)));
    if (q.patch) {
      if (key === 'builds' && db.unlinkMatchesNothing && q.patch.user_id === null) hit = [];
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
  // Mirrors supabase/auth internal/api/admin.go: an existing address is
  // refused; a new one is created, confirmed at once when email_confirm is
  // set, and handle_new_user seeds its profile unonboarded.
  async createUser({ email, email_confirm }) {
    if (db.users.find((u) => u.email === email)) {
      return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } };
    }
    const user = { id: uid(), email, email_confirmed_at: email_confirm ? 'now' : null, last_sign_in_at: null };
    db.users.push(user);
    db.profiles.push({ id: user.id, role: 'user', created_at: '2026-10-16', onboarding_complete: false });
    return { data: { user: { ...user } }, error: null };
  },
  // The four cascades, as the live schema has them.
  async deleteUser(id) {
    db.users    = db.users.filter((u) => u.id !== id);
    db.profiles = db.profiles.filter((p) => p.id !== id);
    const gone  = db.builds.filter((b) => b.user_id === id).map((b) => b.id);
    db.builds   = db.builds.filter((b) => b.user_id !== id);
    db.photos   = db.photos.filter((p) => p.user_id !== id && !gone.includes(p.build_id));
    db.invites  = db.invites.filter((i) => i.user_id !== id);
    return { data: {}, error: null };
  },
};

globalThis.__fakeSupabase = { createClient: () => ({ from, auth: { admin } }) };

// ── the network ─────────────────────────────────────────────────────────────
// Replaced for the whole run. Only Resend is answered; everything else is a
// test failure, not a request.
globalThis.fetch = async (url, init) => {
  if (String(url) !== RESEND_URL) throw new Error('launch-invite made a network call this test does not expect: ' + url);
  const body = JSON.parse(init.body);
  db.sent.push({ auth: init.headers.Authorization, from: body.from, to: body.to, subject: body.subject, html: body.html });
  if (db.resendFails) return new Response('simulated resend outage', { status: 500 });
  return new Response(JSON.stringify({ id: 'email_' + db.sent.length }), { status: 200 });
};

// ── load the real function ──────────────────────────────────────────────────
let handler;
const env = { SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'env-service-key', RESEND_API_KEY: RESEND_KEY };
globalThis.Deno = {
  env: { get: (k) => env[k] },
  serve: (fn) => { handler = fn; },
};

if (typeof nodeModule.stripTypeScriptTypes !== 'function') {
  throw new Error('launch-invite.test.mjs needs Node 22.13 or newer (node:module stripTypeScriptTypes). This is Node ' + process.version);
}
{
  const IMPORT = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';";
  const ts = await readFile(SRC, 'utf8');
  // If the import lines change, this must fail loudly rather than test a file
  // that still reaches for the real client or the real modules.
  assert.ok(ts.includes(IMPORT), 'launch-invite no longer imports supabase-js the way this test expects');
  assert.ok(ts.includes("from '../_shared/token.ts'") && ts.includes("from '../_shared/email.ts'"),
    'launch-invite no longer imports the _shared modules the way this test expects');
  const dir = await mkdtemp(join(tmpdir(), 'launch-invite-'));
  await mkdir(join(dir, '_shared'));
  // The shared modules are real: the hash the test recomputes is the hash
  // the function stores only if token.ts is the one under test.
  for (const m of ['token', 'email']) {
    const src = await readFile(join(FN_DIR, '_shared', m + '.ts'), 'utf8');
    await writeFile(join(dir, '_shared', m + '.mjs'), nodeModule.stripTypeScriptTypes(src));
  }
  const js = nodeModule.stripTypeScriptTypes(ts
    .replace(IMPORT, 'const { createClient } = globalThis.__fakeSupabase;')
    .replace("'../_shared/token.ts'", "'./_shared/token.mjs'")
    .replace("'../_shared/email.ts'", "'./_shared/email.mjs'"));
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
const invite = (email) => db.invites.find((i) => i.email === email);
const owners = (id = BUILD) => [...new Set(db.photos.filter((p) => p.build_id === id).map((p) => p.user_id))];
// What the trigger mark_claim_claimed does when onboarding completes.
const claim  = (email) => { invite(email).claimed_at = 'now'; db.profiles.find((p) => p.id === user(email).id).onboarding_complete = true; };
// The raw token, read from where it is meant to be: the emailed URL.
const tokenIn = (mail) => {
  const m = mail.html.match(/gunforma-claim\.html\?t=([A-Za-z0-9_-]+)/);
  assert.ok(m, 'the email carries no claim URL');
  return m[1];
};
const snapshot = () => JSON.stringify({ users: db.users, builds: db.builds, photos: db.photos, profiles: db.profiles, invites: db.invites });

// ── invite ──────────────────────────────────────────────────────────────────
test('invite: creates a confirmed user, links the build and its photos, stores sha256(token), emails the token', async () => {
  reset();
  const before = Date.now();
  const r = await call({ email: 'A@Example.com', build_id: BUILD, name: 'Ada', phone: '555-0100' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.resent, false);
  assert.equal(r.body.warning, undefined);

  const u = user('a@example.com');
  assert.ok(u, 'no user was created');
  assert.ok(u.email_confirmed_at, 'the user was created unconfirmed — the token, not the email, is the credential');
  assert.equal(db.profiles.find((p) => p.id === u.id).onboarding_complete, false);
  assert.equal(r.body.user_id, u.id);
  assert.equal(build().user_id, u.id);
  assert.deepEqual(owners(), [u.id]);
  assert.deepEqual(owners(OTHER), [ADMIN], 'another build\'s photos were touched');

  // One email, through Resend, with our key, to the lowercased address.
  assert.equal(db.sent.length, 1);
  const mail = db.sent[0];
  assert.equal(mail.auth, 'Bearer ' + RESEND_KEY);
  assert.equal(mail.to, 'a@example.com');
  assert.equal(mail.from, 'Gunforma <build@gunforma.com>');
  assert.equal(mail.subject, 'Your build is live on Gunforma');
  const raw = tokenIn(mail);
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/, '32 random bytes as base64url');
  assert.ok(mail.html.includes(`${CLAIM}?t=${raw}`));

  // The row holds the hash of THAT token, 7 days of life, and nothing raw.
  const inv = invite('a@example.com');
  assert.ok(inv, 'no claim_invites row');
  assert.equal(inv.token_hash, sha256(raw));
  assert.equal(inv.user_id, u.id);
  assert.equal(inv.build_id, BUILD);
  assert.equal(inv.name, 'Ada');
  assert.equal(inv.phone, '555-0100');
  assert.equal(inv.send_count, 1);
  assert.equal(inv.claimed_at, null);
  assert.ok(inv.sent_at && inv.last_sent_at);
  const life = new Date(inv.expires_at).getTime() - new Date(inv.sent_at).getTime();
  assert.ok(Math.abs(life - 7 * DAY_MS) < 5000, `expires ${life / DAY_MS} days after sending, not 7`);
  assert.ok(new Date(inv.expires_at).getTime() >= before + 7 * DAY_MS - 5000);
  assert.equal(r.body.expires_at, inv.expires_at);

  assert.ok(!JSON.stringify(db.invites).includes(raw), 'the raw token reached the database');
  assert.ok(!JSON.stringify(r.body).includes(raw), 'the raw token reached the caller');
  assert.ok(!JSON.stringify(r.body).includes(inv.token_hash), 'the token hash reached the caller');
});

test('invite: a re-run is an idempotent skip — nothing sent, nothing created, and it says who has not claimed', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const before = snapshot();

  const again = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(again.status, 200);
  assert.equal(again.body.skipped, true);
  assert.equal(again.body.unclaimed, true);
  assert.match(again.body.reason, /not claimed yet/);
  assert.equal(again.body.user_id, user('a@example.com').id);
  assert.equal(again.body.invited_at, invite('a@example.com').sent_at);
  assert.equal(db.sent.length, 1, 'a plain re-run emailed the builder again');
  assert.equal(snapshot(), before, 'a plain re-run changed something');

  claim('a@example.com');
  const claimed = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(claimed.body.skipped, true);
  assert.equal(claimed.body.unclaimed, undefined);
  assert.match(claimed.body.reason, /already claimed/);
  assert.equal(db.sent.length, 1);
});

test('invite: never overwrites a build linked to someone else, and never adopts an account it did not invite', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const owner = build().user_id;

  const stranger = await call({ email: 'b@example.com', build_id: BUILD });
  assert.equal(stranger.body.skipped, true);
  assert.match(stranger.body.reason, /refusing to overwrite/);
  assert.equal(build().user_id, owner);
  assert.equal(user('b@example.com'), undefined, 'an account was created for a refused invite');
  assert.equal(invite('b@example.com'), undefined, 'an invite row was written for a refused invite');

  // An account with no invite row — made some other way — is a question, not
  // an invite.
  db.users.push({ id: uid(), email: 'c@example.com', email_confirmed_at: 'x', last_sign_in_at: null });
  const orphan = await call({ email: 'c@example.com', build_id: OTHER });
  assert.equal(orphan.body.skipped, true);
  assert.match(orphan.body.reason, /investigate/);
  assert.equal(build(OTHER).user_id, null);

  // A build already linked to this email's account, but no invite row: the
  // half-finished shape, which --release repairs.
  db.invites = [];
  const half = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(half.body.skipped, true);
  assert.match(half.body.reason, /release it first/);

  assert.equal(db.sent.length, 1, 'a refused invite sent an email');
});

test('invite: a Resend outage is reported as a warning with the resend command, and the row stays so --resend can repair it', async () => {
  reset();
  db.resendFails = true;
  const r = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true, 'the user and build are done — this is not a failure');
  assert.match(r.body.warning, /email failed to send \(resend 500/);
  assert.match(r.body.warning, /--resend a@example\.com/);
  assert.ok(user('a@example.com'));
  assert.equal(build().user_id, user('a@example.com').id);
  assert.ok(invite('a@example.com'), 'the invite row was lost with the email');
  assert.equal(db.sent.length, 1, 'the one attempt');

  // And the repair works: a resend over a healthy Resend.
  db.resendFails = false;
  const fixed = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(fixed.body.resent, true);
  assert.equal(fixed.body.warning, undefined);
  assert.equal(invite('a@example.com').token_hash, sha256(tokenIn(db.sent[1])));
});

test('invite: a claim_invites insert that fails sends nothing and says so', async () => {
  reset();
  db.inviteInsertFails = true;
  const r = await call({ email: 'a@example.com', build_id: BUILD });
  assert.equal(r.body.success, true);
  assert.match(r.body.warning, /claim-invite row failed/);
  assert.equal(db.sent.length, 0, 'an email went out carrying a token nothing stored');
  assert.equal(db.invites.length, 0);
});

// ── resend ──────────────────────────────────────────────────────────────────
test('resend: rotates the token on the existing row, kills the old link, and changes nothing else', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  const first = { ...invite('a@example.com') };     // a copy: the row is updated in place
  const oldHash = first.token_hash;
  const oldToken = tokenIn(db.sent[0]);
  const before = JSON.stringify({ users: db.users, builds: db.builds, photos: db.photos, profiles: db.profiles });

  const r = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(r.status, 200);
  assert.equal(r.body.resent, true);
  assert.equal(r.body.warning, undefined);
  assert.equal(r.body.user_id, user('a@example.com').id);

  assert.equal(db.invites.length, 1, 'a resend made a second row');
  const inv = invite('a@example.com');
  assert.equal(inv.id, first.id);
  assert.notEqual(inv.token_hash, oldHash, 'the token was not rotated');
  assert.equal(db.sent.length, 2);
  assert.equal(db.sent[1].to, 'a@example.com');
  assert.equal(db.sent[1].subject, 'Your build is live on Gunforma');
  const newToken = tokenIn(db.sent[1]);
  assert.notEqual(newToken, oldToken);
  assert.equal(inv.token_hash, sha256(newToken), 'the emailed token is not the stored one');
  assert.equal(db.invites.some((i) => i.token_hash === sha256(oldToken)), false, 'the old link still redeems');
  assert.equal(inv.send_count, 2);
  assert.ok(new Date(inv.last_sent_at) >= new Date(first.last_sent_at));
  assert.ok(new Date(inv.expires_at) >= new Date(first.expires_at));
  assert.equal(r.body.expires_at, inv.expires_at);
  assert.equal(JSON.stringify({ users: db.users, builds: db.builds, photos: db.photos, profiles: db.profiles }), before);
});

test('resend: needs an existing, unclaimed invite', async () => {
  reset();
  const none = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(none.status, 409);
  assert.match(none.body.error, /nothing to resend/);

  await call({ email: 'a@example.com', build_id: BUILD });
  claim('a@example.com');
  const before = snapshot();
  const claimed = await call({ email: 'a@example.com', build_id: BUILD, action: 'resend' });
  assert.equal(claimed.status, 409);
  assert.equal(claimed.body.claimed, true);
  assert.match(claimed.body.error, /already claimed/);
  assert.equal(snapshot(), before, 'a refused resend changed the row');
  assert.equal(db.sent.length, 1, 'a refused resend sent an email');
});

// ── release ─────────────────────────────────────────────────────────────────
test('release: the build survives, its photos go back to the admin, the account and its invite are gone', async () => {
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
  assert.equal(invite('typo@example.com'), undefined, 'the live token outlived the account');

  // And the point of it: the right address can now be invited.
  const right = await call({ email: 'right@example.com', build_id: BUILD });
  assert.equal(right.body.success, true);
  assert.equal(build().user_id, user('right@example.com').id);
  assert.equal(db.sent.length, 2);
});

test('release: refused once claimed_at is set, and once the account has signed in', async () => {
  reset();
  await call({ email: 'a@example.com', build_id: BUILD });
  claim('a@example.com');
  let before = snapshot();
  const claimed = await call({ email: 'a@example.com', build_id: BUILD, action: 'release' });
  assert.equal(claimed.status, 409);
  assert.equal(claimed.body.claimed, true);
  assert.match(claimed.body.error, /already claimed/);
  assert.equal(snapshot(), before);

  // claimed_at is the signal, but a sign-in without it is still a person.
  reset();
  await call({ email: 'b@example.com', build_id: BUILD });
  user('b@example.com').last_sign_in_at = 'now';
  before = snapshot();
  const signedIn = await call({ email: 'b@example.com', build_id: BUILD, action: 'release' });
  assert.equal(signedIn.status, 409);
  assert.equal(signedIn.body.claimed, true);
  assert.equal(snapshot(), before);
});

test('release: refuses an unknown email and a build that is not this account\'s', async () => {
  reset();
  const unknown = await call({ email: 'a@example.com', build_id: BUILD, action: 'release' });
  assert.equal(unknown.status, 409);
  assert.match(unknown.body.error, /no account exists/);

  await call({ email: 'a@example.com', build_id: BUILD });
  const before = snapshot();
  const wrong = await call({ email: 'a@example.com', build_id: OTHER, action: 'release' });
  assert.equal(wrong.status, 409);
  assert.match(wrong.body.error, /not linked to this email/);
  assert.equal(snapshot(), before);
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
  assert.ok(invite('a@example.com'));
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
test('rejects the anon key, an unknown action, a bad body and a missing Resend key before doing anything', async () => {
  reset();
  const anon = await call({ email: 'a@example.com', build_id: BUILD }, { role: 'anon' });
  assert.equal(anon.status, 403);
  const bad = await call({ email: 'a@example.com', build_id: BUILD, action: 'delete' });
  assert.equal(bad.status, 400);
  const noBuild = await call({ email: 'a@example.com', build_id: '33333333-3333-4333-8333-333333333333' });
  assert.equal(noBuild.status, 404);

  const saved = env.RESEND_API_KEY;
  delete env.RESEND_API_KEY;
  try {
    const noKey = await call({ email: 'a@example.com', build_id: BUILD });
    assert.equal(noKey.status, 500);
    assert.match(noKey.body.error, /RESEND_API_KEY/);
  } finally {
    env.RESEND_API_KEY = saved;
  }

  assert.equal(db.users.length, 1);
  assert.equal(db.invites.length, 0);
  assert.equal(db.sent.length, 0);
});
