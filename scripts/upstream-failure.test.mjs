// upstream-failure.test.mjs — a database failure is 503, never 404 or 410.
//
// The rule (CLAUDE.md, "Not found means PostgREST said zero rows"): the four
// HTML-emitting functions that look a page up by key may answer 404 — or 410
// for a build — ONLY when PostgREST positively returned an empty array. A
// network error, a timeout, a non-2xx, or a 2xx whose body is not an array
// is a failure to read, and the answer is 503 with Retry-After, after one
// retry. Google drops a 410 faster than a 404, so since #161 a live build
// mistaken for an absent one would leave the index quickly; this is what
// makes that mistake impossible rather than unlikely.
//
// No network. globalThis.fetch is replaced per case with a stub that fails
// the way the real one does — rejects, answers 5xx, answers 2xx with the
// wrong body — and the handlers are run for real against it, the same way
// check-analytics-snippet.mjs renders them. The timeout case does not wait
// out the timeout: the stub rejects with the AbortError the signal would
// have produced, and a separate assertion proves a signal is attached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const { pgRows, unavailable, UpstreamError, PG_ATTEMPTS } = await import(fn('_pg.mjs'));
const { GUIDE_PAGES, GUN_HUBS, guidePath, hubPath } = await import(fn('_guide-meta.mjs'));

const HANDLERS = {
  'build-og.mjs':     { url: 'https://gunforma.com/b/some-build-2e980fc8-3a9f-42c9-af15-efcf99584536', notFound: 410 },
  'product-page.mjs': { url: 'https://gunforma.com/parts/optics/holosun-507k-x2',                     notFound: 404 },
  'guide-page.mjs':   { url: 'https://gunforma.com' + guidePath(GUIDE_PAGES[0].family, GUIDE_PAGES[0].gun), notFound: 404 },
  'gun-hub.mjs':      { url: 'https://gunforma.com' + hubPath(GUN_HUBS[0].gun),                         notFound: 404 },
};
for (const f of Object.keys(HANDLERS)) HANDLERS[f].handler = (await import(fn(f))).default;

const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Each failure, as the real fetch would present it. `calls` counts attempts.
const FAILURES = {
  'network error (fetch rejects)':  () => { throw new TypeError('fetch failed'); },
  'timeout (abort)':                () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
  'PostgREST 500':                  () => json({ message: 'boom' }, 500),
  'PostgREST 503':                  () => json({ message: 'down' }, 503),
  'PostgREST 429':                  () => json({ message: 'slow down' }, 429),
  '2xx with an HTML body':          () => new Response('<html><body>cloudflare</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  '2xx with a JSON object body':    () => json({ message: 'not an array' }),
  '2xx with an empty body':         () => new Response('', { status: 200 }),
};
// Not retried — the same query fails the same way — but still 503, not 404.
const QUERY_BUG = { 'PostgREST 400 (PGRST201)': () => json({ code: 'PGRST201', message: 'ambiguous embed' }, 400) };

const realFetch = globalThis.fetch;
const realError = console.error;
function stubFetch(impl) {
  const seen = { calls: 0, signals: [] };
  globalThis.fetch = async (url, init) => { seen.calls++; seen.signals.push(init && init.signal); return impl(seen.calls, url, init); };
  return seen;
}
test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

for (const [file, { url, handler, notFound }] of Object.entries(HANDLERS)) {
  for (const [label, impl] of Object.entries(FAILURES)) {
    test(`${file}: ${label} → 503 with Retry-After, after one retry`, async () => {
      const seen = stubFetch(impl);
      const res = await handler(new Request(url));
      assert.equal(res.status, 503, `status was ${res.status}`);
      assert.ok(res.headers.get('retry-after'), 'Retry-After header present');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(seen.calls, PG_ATTEMPTS, `fetch attempts: ${seen.calls}`);
      assert.ok(seen.signals.every((s) => s instanceof AbortSignal), 'every attempt carries a timeout signal');
    });
  }
  for (const [label, impl] of Object.entries(QUERY_BUG)) {
    test(`${file}: ${label} → 503, one attempt`, async () => {
      const seen = stubFetch(impl);
      const res = await handler(new Request(url));
      assert.equal(res.status, 503, `status was ${res.status}`);
      assert.ok(res.headers.get('retry-after'));
      assert.equal(seen.calls, 1);
    });
  }
  test(`${file}: PostgREST says zero rows → ${notFound}, and only then`, async () => {
    const seen = stubFetch(() => json([]));
    const res = await handler(new Request(url));
    assert.equal(res.status, notFound);
    assert.equal(res.headers.get('retry-after'), null, 'a real not-found carries no Retry-After');
    assert.equal(seen.calls, 1, 'an empty array is an answer — not retried');
  });
}

// The retry recovers: first attempt fails, second returns the row, page 200.
test('build-og.mjs: one failed attempt then a row → 200, not 503', async () => {
  const UUID = '2e980fc8-3a9f-42c9-af15-efcf99584536';
  const row = { id: UUID, name: 'Fixture build', description: 'x', parts_snapshot: [],
    platforms: { name: 'SIG P365' }, profiles: { username: 'fixture' }, build_photos: [] };
  const seen = stubFetch((n) => (n === 1 ? json({ message: 'blip' }, 502) : json([row])));
  const res = await HANDLERS['build-og.mjs'].handler(new Request(HANDLERS['build-og.mjs'].url));
  assert.equal(res.status, 200);
  assert.ok(seen.calls >= 2, 'the retry ran');
});

// pgRows on its own: what it promises its callers.
test('pgRows resolves only to an array, rejects with UpstreamError otherwise', async () => {
  stubFetch(() => json([{ id: 1 }]));
  assert.deepEqual(await pgRows('x?select=id'), [{ id: 1 }]);
  stubFetch(() => json({}));
  await assert.rejects(pgRows('x', { retryDelayMs: 0 }), (e) => e instanceof UpstreamError && e.status === 200);
  stubFetch(() => json({}, 404));
  await assert.rejects(pgRows('x', { retryDelayMs: 0 }), (e) => e instanceof UpstreamError && e.status === 404 && e.retryable === false);
});

test('unavailable() is 503, no-store, Retry-After, text/plain', () => {
  const r = unavailable();
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('retry-after'), /^\d+$/);
  assert.match(r.headers.get('content-type'), /^text\/plain/);
});
