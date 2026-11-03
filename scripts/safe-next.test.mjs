// ?next= after sign-in — where a reader may be sent, and that every page
// honours the one rule.
//
// WHY: an open redirect renders perfectly. A sign-in that forwards to
// https://evil.com looks, to the reader, like a sign-in that worked; nothing
// on the page and nothing in the console says otherwise. And the opposite
// failure — a page that quietly ignores ?next= — is how sign-in sent every
// Armory reader to the homepage for months with nobody noticing.
//
// This runs js/safe-next.js over a table of values, then the REAL inline
// scripts of gunforma-signin.html, gunforma-signup.html,
// gunforma-complete-profile.html and auth-callback.html in node:vm against
// stubbed sessions, and reads where each one sends the reader.
//
// Run: node --test scripts/safe-next.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

function moduleCtx(search = '') {
  const ctx = { URLSearchParams, encodeURIComponent, location: { search } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/safe-next.js'), ctx, { filename: 'js/safe-next.js' });
  return ctx;
}
const SN = moduleCtx().SafeNext;

// ── The rule ───────────────────────────────────────────────────────────────

const ALLOWED = [
  ['gunforma-armory.html', '/gunforma-armory.html'],
  ['/gunforma-armory.html', '/gunforma-armory.html'],
  ['gunforma-armory.html?edit=community:bbbbbbbb-0000-4000-8000-000000000002', '/gunforma-armory.html?edit=community:bbbbbbbb-0000-4000-8000-000000000002'],
  ['/gunforma-armory.html#saved-parts', '/gunforma-armory.html#saved-parts'],
  ['gunforma-profile.html', '/gunforma-profile.html'],
  ['/gunforma-post-build.html', '/gunforma-post-build.html'],
  ['/gunforma-admin-queue.html', '/gunforma-admin-queue.html'],
  ['/', '/'],
];

const REFUSED = [
  'https://evil.com',
  'https://evil.com/gunforma-armory.html',
  'http://gunforma.com/gunforma-armory.html',      // even our own host: a path, never a URL
  '//evil.com',
  '//evil.com/gunforma-armory.html',
  '/\\evil.com',
  '\\\\evil.com',
  '/%2F%2Fevil.com',
  '%2F%2Fevil.com',
  '/%5Cevil.com',
  '%2fgunforma-armory.html',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,hi',
  'evil.com',
  'evil.com/gunforma-armory.html',
  '/gunforma-armory.html/../evil.html',
  '/gunforma-armory.html?x=//evil.com',            // the query alphabet has no "/"
  '/gunforma-armory.html?x=%2F%2Fevil.com',        // ... and no "%"
  '/gunforma-armory.html?x=a b',
  '/gunforma-armory.html\n//evil.com',
  ' /gunforma-armory.html',
  '/gunforma-signin.html',                          // a real page, but not on the list
  '/gunforma-unlisted.html',
  '/GUNFORMA-ARMORY.HTML',
  '?next=/gunforma-armory.html',
  '#/gunforma-armory.html',
  '',
  null,
  undefined,
  '/' + 'a'.repeat(300) + '.html',
];

test('allowed pages go through, normalised to one leading "/"', () => {
  for (const [raw, want] of ALLOWED) assert.equal(SN.check(raw), want, JSON.stringify(raw));
});

test('anything else is refused: a scheme, //, a backslash, an encoded slash, a host, an unlisted page', () => {
  for (const raw of REFUSED) assert.equal(SN.check(raw), null, JSON.stringify(raw));
});

test('the rule holds through the URL, however it is encoded', () => {
  const cases = [
    ['?next=gunforma-armory.html', '/gunforma-armory.html'],
    ['?next=%2Fgunforma-armory.html', '/gunforma-armory.html'],
    ['?next=' + encodeURIComponent('gunforma-armory.html?edit=community:bbbbbbbb-0000-4000-8000-000000000002'),
      '/gunforma-armory.html?edit=community:bbbbbbbb-0000-4000-8000-000000000002'],
    ['?next=https%3A%2F%2Fevil.com', null],
    ['?next=%2F%2Fevil.com', null],
    ['?next=%252F%252Fevil.com', null],            // double-encoded: decodes once to %2F%2F, still refused
    ['?next=%2F%5Cevil.com', null],
    ['?next=javascript%3Aalert(1)', null],
    ['?next=/gunforma-unlisted.html', null],
    ['?next=gunforma-armory.html&next=https://evil.com', '/gunforma-armory.html'],   // the first wins, and it is checked
    ['?next=https://evil.com&next=gunforma-armory.html', null],
    ['', null],
  ];
  for (const [search, want] of cases) assert.equal(moduleCtx(search).SafeNext.fromLocation(), want, search);
});

test('every listed page exists, and the list is in ONE place', () => {
  for (const p of SN.ALLOWED_NEXT) {
    if (p === '/') continue;
    assert.ok(existsSync(join(ROOT, p.slice(1))), `${p} is a real page`);
  }
  for (const f of ['auth-callback.html', 'gunforma-signin.html', 'gunforma-signup.html', 'gunforma-complete-profile.html']) {
    const src = read(f);
    assert.doesNotMatch(src, /ALLOWED_NEXT\s*=/, `${f} keeps no copy of the list`);
    assert.match(src, /<script src="js\/safe-next\.js"><\/script>/, `${f} loads the rule`);
  }
});

test('withNext appends only a checked next, encoded', () => {
  assert.equal(SN.withNext('/gunforma-signin.html', '/gunforma-armory.html'), '/gunforma-signin.html?next=%2Fgunforma-armory.html');
  assert.equal(SN.withNext('/gunforma-signin.html', null), '/gunforma-signin.html');
  assert.equal(SN.withNext('/gunforma-signin.html', '//evil.com'), '/gunforma-signin.html', 'never forwards a refused one');
  assert.equal(SN.withNext('x.html?a=1', '/gunforma-armory.html'), 'x.html?a=1&next=%2Fgunforma-armory.html');
});

// ── The pages ──────────────────────────────────────────────────────────────

function el(id) {
  return { id, href: '', value: '', textContent: '', disabled: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, focus() {} };
}

// A page's inline scripts, run in order beside the shared modules it loads,
// against a stubbed supabase client.
function loadAuthPage(file, { search = '', hash = '', session = null, profile = {}, createClient = false } = {}) {
  const els = {};
  const nav = [];
  const sbCalls = [];
  const sb = {
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange() {},
      signInWithOAuth: (o) => { sbCalls.push(['oauth', o]); return Promise.resolve({}); },
      resetPasswordForEmail: (email, o) => { sbCalls.push(['reset', o]); return Promise.resolve({}); },
      setSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }),
      signOut: () => Promise.resolve({}),
    },
    rpc: () => ({ maybeSingle: () => Promise.resolve({ data: profile, error: null }) }),
  };
  const location = {
    search, hash, pathname: '/' + file, hostname: 'gunforma.com', origin: 'https://gunforma.com',
    set href(v) { nav.push(v); }, get href() { return 'https://gunforma.com/' + file + search + hash; },
    replace(v) { nav.push(v); },
  };
  const ctx = {
    console, Promise, URLSearchParams, encodeURIComponent,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    location, history: { replaceState() {} },
    document: { getElementById: (id) => els[id] || (els[id] = el(id)), querySelector: () => null, querySelectorAll: () => [] },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (createClient) ctx.supabase = { createClient: () => sb };
  else ctx.sb = sb;
  const html = read(file);
  const srcs = [...html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)];
  for (const [, src, body] of srcs) {
    if (src) {
      if (src === 'js/safe-next.js' || src === 'js/site-url.js') vm.runInContext(read(src), ctx, { filename: src });
      continue;   // the client, nav and Turnstile are stubbed or not needed
    }
    if (/onloadTurnstileCallback\s*=|function onloadTurnstileCallback/.test(body) && !/redirectByRole|validateNext|SafeNext/.test(body)) continue;
    vm.runInContext(body, ctx, { filename: `${file} <script>` });
  }
  return { ctx, nav, sbCalls, els };
}
const settle = () => new Promise((r) => setImmediate(r));

test('sign-in: after signing in, a reader goes to ?next= — an admin too; a refused next is today\'s routing', async () => {
  const go = async (search, profile) => {
    const p = loadAuthPage('gunforma-signin.html', { search, profile });
    await p.ctx.redirectByRole();
    return p.nav.at(-1);
  };
  const reader = { onboarding_complete: true, role: 'user' };
  const admin = { onboarding_complete: true, role: 'admin' };
  assert.equal(await go('?next=gunforma-armory.html', reader), '/gunforma-armory.html');
  assert.equal(await go('?next=gunforma-armory.html', admin), '/gunforma-armory.html');
  assert.equal(await go('?next=gunforma-profile.html', reader), '/gunforma-profile.html');
  assert.equal(await go('', reader), 'index.html');
  assert.equal(await go('', admin), 'gunforma-admin-queue.html');
  for (const bad of ['https://evil.com', '//evil.com', '/%5Cevil.com', '%252F%252Fevil.com', 'javascript:alert(1)', '/gunforma-unlisted.html']) {
    assert.equal(await go('?next=' + encodeURIComponent(bad), reader), 'index.html', bad);
    assert.equal(await go('?next=' + encodeURIComponent(bad), admin), 'gunforma-admin-queue.html', bad);
  }
  // Not onboarded yet: the username step first, carrying next on.
  assert.equal(await go('?next=gunforma-armory.html', { onboarding_complete: false }),
    'gunforma-complete-profile.html?next=%2Fgunforma-armory.html');
  assert.equal(await go('?next=%2F%2Fevil.com', { onboarding_complete: false }), 'gunforma-complete-profile.html');
});

test('sign-in: already signed in, the page forwards to ?next= on arrival', async () => {
  const p = loadAuthPage('gunforma-signin.html', { search: '?next=gunforma-armory.html', session: { user: { id: 'u' } },
    profile: { onboarding_complete: true, role: 'user' } });
  await settle(); await settle();
  assert.deepEqual(p.nav, ['/gunforma-armory.html']);
});

test('sign-in: next rides through Google, the reset email and "Create one free" — and a refused one never does', async () => {
  const p = loadAuthPage('gunforma-signin.html', { search: '?next=gunforma-armory.html' });
  await p.ctx.handleGoogleSignIn();
  assert.equal(p.sbCalls[0][1].options.redirectTo, 'https://gunforma.com/gunforma-signin.html?next=%2Fgunforma-armory.html');
  p.ctx.getTurnstileToken = () => 'tok';
  p.els['reset-email'] = Object.assign(el('reset-email'), { value: 'a@b.co' });
  await p.ctx.handleReset();
  assert.equal(p.sbCalls[1][1].redirectTo, 'https://gunforma.com/gunforma-signin.html?next=%2Fgunforma-armory.html');
  assert.equal(p.els['signup-link'].href, 'gunforma-signup.html?next=%2Fgunforma-armory.html');

  const bad = loadAuthPage('gunforma-signin.html', { search: '?next=' + encodeURIComponent('https://evil.com') });
  await bad.ctx.handleGoogleSignIn();
  assert.equal(bad.sbCalls[0][1].options.redirectTo, 'https://gunforma.com/gunforma-signin.html');
  assert.equal(bad.els['signup-link'].href, 'gunforma-signup.html');
});

test('sign-in: a reset link with ?next= still shows "Choose a new password", and goes on to next once saved', async () => {
  const p = loadAuthPage('gunforma-signin.html', { search: '?next=gunforma-armory.html', hash: '#access_token=x&type=recovery',
    session: { user: { id: 'u', email: 'a@b.co' } }, profile: { onboarding_complete: true, role: 'user' } });
  await settle(); await settle();
  assert.deepEqual(p.nav, [], 'held on the page, not forwarded');
  assert.equal(p.els['hero-title'].textContent, 'Choose a new password');
  p.els['new-password'].value = 'a-long-password';
  p.ctx.sb.auth.updateUser = () => Promise.resolve({ error: null });
  await p.ctx.handleNewPassword();
  assert.deepEqual(p.nav, ['/gunforma-armory.html']);
});

test('sign-up: next goes back to sign-in through Google, the confirmation email and "Sign in"', async () => {
  const p = loadAuthPage('gunforma-signup.html', { search: '?next=%2Fgunforma-armory.html' });
  assert.equal(p.els['signin-link'].href, 'gunforma-signin.html?next=%2Fgunforma-armory.html');
  const src = read('gunforma-signup.html');
  assert.match(src, /emailRedirectTo: siteBaseUrl\(\) \+ window\.SafeNext\.withNext\('\/gunforma-signin\.html', NEXT\)/);
  await p.ctx.handleGoogleSignIn();
  assert.equal(p.sbCalls[0][1].options.redirectTo, 'https://gunforma.com/gunforma-signin.html?next=%2Fgunforma-armory.html');
});

test('complete-profile: an onboarded reader goes to next; next naming this page is ignored, not looped', async () => {
  const run = async (search) => {
    const p = loadAuthPage('gunforma-complete-profile.html', { search, session: { user: { id: 'u' } }, profile: { onboarding_complete: true } });
    await settle(); await settle();
    return p.nav;
  };
  assert.deepEqual(await run('?next=%2Fgunforma-armory.html'), ['/gunforma-armory.html']);
  assert.deepEqual(await run(''), ['index.html']);
  assert.deepEqual(await run('?next=%2Fgunforma-complete-profile.html'), ['index.html']);
  assert.deepEqual(await run('?next=%2F%2Fevil.com'), ['index.html']);
  assert.match(read('gunforma-complete-profile.html'), /window\.location\.href = NEXT \|\| 'index\.html';\n\}/, 'and after the username is saved');
});

test('auth-callback: a magic link goes to a checked next, else "/"', async () => {
  const run = async (search) => {
    const p = loadAuthPage('auth-callback.html', { search, hash: '#access_token=a&refresh_token=r', createClient: true });
    await settle(); await settle();
    return p.nav;
  };
  assert.deepEqual(await run('?next=%2Fgunforma-post-build.html'), ['/gunforma-post-build.html']);
  assert.deepEqual(await run('?next=gunforma-armory.html'), ['/gunforma-armory.html']);
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '%2F%2Fevil.com', 'javascript:alert(1)', '/gunforma-unlisted.html']) {
    assert.deepEqual(await run('?next=' + encodeURIComponent(bad)), ['/'], bad);
  }
});

test('every page that links to sign-in with ?next= names a page the rule lets through', () => {
  const found = [];
  for (const f of ['gunforma-armory.html', 'gunforma-profile.html']) {
    for (const m of read(f).matchAll(/gunforma-signin\.html\?next=([^'"]+)['"]/g)) found.push([f, m[1]]);
  }
  assert.ok(found.length >= 4, 'the Armory\'s links and the profile\'s');
  for (const [f, raw] of found) {
    const value = new URLSearchParams('next=' + raw).get('next');
    assert.ok(SN.check(value), `${f}: ${raw}`);
  }
  // The Armory's go back to the Armory, where a held build is restored.
  assert.ok(found.filter(([f]) => f === 'gunforma-armory.html').every(([, raw]) => /^gunforma-armory\.html/.test(raw)));
  // The ?edit= link's next is built with encodeURIComponent, which the rule takes.
  assert.equal(SN.check('gunforma-armory.html?edit=community:bbbbbbbb-0000-4000-8000-000000000002'),
    '/gunforma-armory.html?edit=community:bbbbbbbb-0000-4000-8000-000000000002');
});
