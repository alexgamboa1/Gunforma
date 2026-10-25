// go-redirect.test.mjs — the /go/ edge function's section tracking and its
// PGRST204 ladder, run for real under Node: go.js imported with a stubbed
// Deno and a stubbed fetch, the way the ladder was proved before the first
// preview existed (and the way scripts/go-bot.test.mjs already covers the
// classifier it imports).
//
// What it pins:
//   - ?s= and ?loc= are read on the LOGGED path and written as source and
//     section; s is cut to 128 characters; loc outside the whitelist
//     (picks/rank/compare/price) is NOT stored as sent — the row simply has
//     no section
//   - neither param ever reaches the outbound retailer URL: the Location
//     header is byte-for-byte the stored destination
//   - the PGRST204 ladder: full (source/section included) → bot (the #176
//     client columns) → legacy (target + referrer), descending ONLY on
//     PGRST204, with x-go-insert-shape reporting which rung landed; a click
//     with no s/loc params still makes at most two attempts
//   - x-go-no-log writes nothing, params or not
//   - both shapes track: /go/<link> writes link_id, /go/part/<product>
//     writes product_id, each beside source/section
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// go.js reads the service key through Deno.env; under Node we supply it.
globalThis.Deno = { env: { get: (k) => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'test-service-key' : '') } };
const handler = (await import(pathToFileURL(join(ROOT, 'netlify/edge-functions/go.js')).href)).default;

const LINK = '11111111-2222-3333-4444-555555555555';
const PART = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const DEST_LINK = 'https://www.awin1.com/cread.php?a=1&b=2';
const DEST_PART = 'https://maker.example/the-part';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

// Stubs the lookup GETs and captures every POST; `postImpl(n, row)` decides
// each insert's answer (n counts posts, 1-based).
function stub(postImpl) {
  const seen = { posts: [] };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!init || !init.method || init.method === 'GET') {
      if (u.includes('/rest/v1/affiliate_links')) {
        return new Response(JSON.stringify([{ url: 'https://www.opticsplanet.com/x', affiliate_url: DEST_LINK }]), { status: 200 });
      }
      if (u.includes('/rest/v1/products')) {
        return new Response(JSON.stringify([{ url: DEST_PART }]), { status: 200 });
      }
      throw new Error('unexpected GET in test: ' + u);
    }
    assert.ok(u.includes('/rest/v1/link_clicks'), 'inserts go to link_clicks');
    const row = JSON.parse(init.body);
    seen.posts.push(row);
    return postImpl(seen.posts.length, row);
  };
  return seen;
}
const ok = () => new Response('', { status: 201 });
const pgrst204 = () => new Response(JSON.stringify({ code: 'PGRST204', message: "could not find the 'source' column" }), { status: 400 });

// A reader-shaped request; x-go-debug awaits the insert so the headers are
// facts, not guesses.
const req = (path, headers = {}) => new Request('https://gunforma.com' + path, {
  headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'sec-fetch-mode': 'navigate', 'sec-fetch-user': '?1',
    referer: 'https://gunforma.com/field-notes/renderer-check',
    'x-go-debug': '1',
    ...headers,
  },
});

test('s and loc are written as source and section; the redirect never carries them', async () => {
  const seen = stub(ok);
  const res = await handler(req('/go/' + LINK + '?s=renderer-check&loc=picks'), {});
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), DEST_LINK, 'the destination is the stored URL, params and all OURS stripped — nothing appended');
  assert.equal(res.headers.get('x-go-insert-shape'), 'full');
  assert.equal(seen.posts.length, 1);
  const row = seen.posts[0];
  assert.equal(row.link_id, LINK);
  assert.equal(row.source, 'renderer-check');
  assert.equal(row.section, 'picks');
  assert.equal(row.referrer_path, '/field-notes/renderer-check');
  assert.ok(row.user_agent && row.sec_fetch === 'navigate/?1' && row.is_bot === false, 'the #176 client columns ride along');
});

test('the /go/part/ shape tracks the same way, against product_id', async () => {
  const seen = stub(ok);
  const res = await handler(req('/go/part/' + PART + '?s=renderer-check&loc=rank'), {});
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), DEST_PART);
  assert.equal(seen.posts[0].product_id, PART);
  assert.equal(seen.posts[0].section, 'rank');
  assert.ok(!('link_id' in seen.posts[0]));
});

test('loc outside the whitelist is not stored; s is cut to 128 characters', async () => {
  const seen = stub(ok);
  const long = 'x'.repeat(200);
  await handler(req('/go/' + LINK + '?s=' + long + '&loc=sidebar'), {});
  const row = seen.posts[0];
  assert.equal(row.source, 'x'.repeat(128));
  assert.ok(!('section' in row), 'an unlisted loc is NOT stored as sent');
});

test('no params → no source/section keys, and at most two attempts as before', async () => {
  const seen = stub((n) => (n === 1 ? pgrst204() : ok()));
  const res = await handler(req('/go/' + LINK), {});
  assert.equal(res.headers.get('x-go-insert-shape'), 'legacy', 'without s/loc the first row IS the bot shape, so the one retry is legacy');
  assert.equal(seen.posts.length, 2);
  assert.ok(!('source' in seen.posts[0]) && !('section' in seen.posts[0]));
  assert.ok(!('user_agent' in seen.posts[1]), 'the legacy retry is the old shape');
});

test('PGRST204 descends the ladder: full → bot → legacy', async () => {
  // Rung 2 lands: the section columns are missing (today's production),
  // the client columns are not.
  let seen = stub((n) => (n === 1 ? pgrst204() : ok()));
  let res = await handler(req('/go/' + LINK + '?s=renderer-check&loc=compare'), {});
  assert.equal(res.headers.get('x-go-insert-shape'), 'bot');
  assert.equal(seen.posts.length, 2);
  assert.ok('source' in seen.posts[0] && !('source' in seen.posts[1]));
  assert.ok('user_agent' in seen.posts[1], 'the bot rung keeps the client columns');

  // Rung 3: both migrations missing (a fresh environment).
  seen = stub((n) => (n <= 2 ? pgrst204() : ok()));
  res = await handler(req('/go/' + LINK + '?s=renderer-check&loc=compare'), {});
  assert.equal(res.headers.get('x-go-insert-shape'), 'legacy');
  assert.equal(seen.posts.length, 3);
  assert.deepEqual(Object.keys(seen.posts[2]).sort(), ['link_id', 'referrer_path']);
});

test('a refusal that is not PGRST204 is reported, never retried', async () => {
  const seen = stub(() => new Response(JSON.stringify({ code: '23514', message: 'check constraint' }), { status: 400 }));
  const res = await handler(req('/go/' + LINK + '?s=a&loc=price'), {});
  assert.equal(res.status, 302, 'the redirect is never broken by logging');
  assert.equal(res.headers.get('x-go-insert-shape'), 'full');
  assert.equal(res.headers.get('x-go-insert-status'), '400');
  assert.equal(seen.posts.length, 1);
});

test('x-go-no-log writes nothing, params or not', async () => {
  const seen = stub(() => { throw new Error('must not insert'); });
  const res = await handler(req('/go/' + LINK + '?s=a&loc=picks', { 'x-go-no-log': '1' }), {});
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('x-go-log'), 'skipped');
  assert.equal(seen.posts.length, 0);
});
