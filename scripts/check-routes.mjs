#!/usr/bin/env node
// check-routes.mjs — assert routing behaviour against a REAL deployed origin.
//
// WHY THIS EXISTS, AND WHY IT CANNOT BE A BUILD CHECK
// scripts/check-all.sh proves a check exists and runs. Nothing proved a code
// path was REACHABLE, and that gap cost a whole feature:
//
//   build-og.mjs shipped an isShareRoute() branch that made the legacy
//   ?id= URL soft-serve the page instead of 404ing. It never executed. The
//   branch read x-nf-original-path, and Netlify does not set that header on
//   the rule that route uses. Two independent local suites passed, because a
//   synthetic Request carries whatever header the test author writes and
//   netlify dev is not production.
//
// A synthetic Request cannot catch that by construction: the thing under test
// IS what Netlify puts on the wire. So this runs against a URL — a deploy
// preview or production — and asks the deploy, not a mock.
//
// It cannot run in the Netlify build: the site is not serving yet at build
// time, and a check that fetched the PREVIOUS deploy would grade the wrong
// artifact. It runs from .github/workflows/check-routes.yml on every
// successful deploy, and by hand:
//
//   node scripts/check-routes.mjs https://deploy-preview-74--velvety-stardust-4de48f.netlify.app
//
// WHAT IT ASSERTS, AND WHAT IT ONLY RECORDS
// Asserted: the behaviour readers and crawlers actually get — status codes,
// one canonical, the two build URL shapes agreeing, the bare legacy path
// still serving the static file.
//
// Recorded, not asserted: which source build-og resolved the id from, read
// off the x-build-og-id-source response header. That is a fact about
// Netlify's plumbing, not a promise this repo makes, and pinning it would
// turn a Netlify change into a red build for no user-visible reason. It is
// printed on every run so the next person reasoning about a rewrite reads a
// measurement instead of guessing — which is the mistake this file exists to
// stop repeating.
const origin = (process.argv[2] || process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!origin) {
  console.error('usage: node scripts/check-routes.mjs <origin>');
  console.error('   eg: node scripts/check-routes.mjs https://gunforma.com');
  process.exit(2);
}

let failures = 0;
const ok = (c, label, detail) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + label + (detail !== undefined && detail !== '' ? `   [${detail}]` : ''));
  if (!c) failures++;
};
const note = (label, detail) => console.log(`   ·  ${label}${detail !== undefined ? ': ' + detail : ''}`);

async function get(path, headers) {
  const res = await fetch(origin + path, { redirect: 'manual', headers: headers || {} });
  const body = res.headers.get('content-type')?.includes('text/') ? await res.text() : '';
  return {
    status: res.status,
    body,
    location: res.headers.get('location'),
    goLog: res.headers.get('x-go-log'),
    goKey: res.headers.get('x-go-key'),
    cacheControl: res.headers.get('cache-control'),
    idSource: res.headers.get('x-build-og-id-source'),
    origHeader: res.headers.get('x-build-og-orig'),
    guideOptics: res.headers.get('x-guide-optics'),
    guideFresh: res.headers.get('x-guide-fresh-priced'),
    canon: [...body.matchAll(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/g)].map(m => m[1]),
    hasOg: /property=["']og:image["']/.test(body),
  };
}

// A build that is live on the site. Asked of PostgREST, not scraped from
// /gunforma-builds.html — that page renders its cards in the browser, so its
// served HTML contains no /b/ link at all and a scrape finds nothing while
// looking like it worked.
//
// Same anon key and same status=eq.approved filter build-og.mjs uses, and
// the same dependency-free fetch: RLS means this can only see what a
// visitor can see. Without a build the route shapes cannot be exercised at
// all, so a miss is a hard failure rather than a skip — a check that quietly
// tests nothing is the thing this file exists to prevent.
// Every /go/ request this script makes carries this. Our own tooling must not
// show up in link_clicks: 493 of that table's 537 rows are a link sweep from
// one of our sessions, and seven more are this script's own scheduled runs.
// See netlify/edge-functions/go.js for why the caller declares itself instead
// of us filtering the rows afterwards.
const NO_LOG = { 'x-go-no-log': '1' };

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

async function pickLiveBuild() {
  const res = await fetch(
    `${SB_URL}/rest/v1/builds?select=id,name&status=eq.approved&limit=1`,
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const { id, name } = rows[0];
  // The slug form is built the same way the site builds it, so this exercises
  // the real URL a reader would follow rather than a hand-made one.
  const { buildPath } = await import('../netlify/functions/_build-url.mjs');
  return { id, path: buildPath(id, name), bare: '/b/' + id };
}

console.log(`checking routes on ${origin}\n`);

// ── the legacy bare path must stay the static file ─────────────────────
{
  const r = await get('/gunforma-build-detail.html');
  ok(r.status === 200, 'bare /gunforma-build-detail.html: 200', r.status);
  ok(r.idSource === null,
     'bare path is served as a FILE, not through build-og',
     r.idSource === null ? 'no function headers' : 'id-source=' + r.idSource);
  ok(!r.hasOg, 'and carries no injected og meta');
  ok(r.canon.length === 1, 'exactly one canonical', r.canon.length);
}

// ── a build that actually exists ───────────────────────────────────────
const live = await pickLiveBuild();
if (!live) {
  ok(false, 'found a live build to exercise the routes with',
     'no /b/<uuid> link on /gunforma-builds.html — cannot check the routes');
} else {
  note('using build', live.id);
  const legacy = '/gunforma-build-detail.html?id=' + live.id;

  const a = await get(live.path);
  const b = await get(legacy);
  const bare = await get(live.bare);

  ok(a.status === 200, `${live.path}: 200`, a.status);
  ok(a.canon.length === 1, 'slug URL: exactly one canonical', a.canon.length);
  ok(a.hasOg, 'slug URL: og meta server-rendered');

  ok(b.status === 200, 'legacy ?id=: 200', b.status);
  ok(b.canon.length === 1, 'legacy ?id=: exactly one canonical', b.canon.length);
  ok(b.hasOg, 'legacy ?id=: og meta server-rendered');

  ok(a.canon[0] === b.canon[0], 'both shapes emit the IDENTICAL canonical', a.canon[0]);
  ok((a.canon[0] || '').includes('/b/'), 'and it is the /b/ form', a.canon[0]);
  ok(!(a.body + b.body).includes('href="https://gunforma.com/gunforma-build-detail.html"'),
     'the id-less canonical is stripped on both');

  ok(bare.status === 200 && bare.canon[0] === a.canon[0],
     '/b/<bare uuid> resolves to the same build and canonical', bare.status + ' ' + bare.canon[0]);

  // Recorded, not asserted — see the header of this file.
  note('id source, /b/ slug   ', `${a.idSource}   (x-nf-original-path ${a.origHeader})`);
  note('id source, /b/ bare   ', `${bare.idSource}   (x-nf-original-path ${bare.origHeader})`);
  note('id source, legacy ?id=', `${b.idSource}   (x-nf-original-path ${b.origHeader})`);
}

// ── an id that resolves to nothing: BOTH routes 404 ────────────────────
// This is the assertion the previous release got wrong. A 200 carrying
// "Build not found" is a soft 404 and Google penalises it.
const GONE = '00000000-0000-4000-8000-000000000000';
for (const [label, path] of [
  ['/b/<unknown uuid>',        '/b/' + GONE],
  ['/b/<slug>-<unknown uuid>', '/b/some-build-' + GONE],
  ['/b/not-a-uuid',            '/b/not-a-uuid'],
  ['legacy ?id=<unknown uuid>', '/gunforma-build-detail.html?id=' + GONE],
  ['legacy ?id=garbage',        '/gunforma-build-detail.html?id=not-a-uuid'],
]) {
  const r = await get(path);
  ok(r.status === 404, `${label}: hard 404, not a soft one`, r.status +
     (r.status === 200 && /Build not found/i.test(r.body) ? ' — SOFT 404' : ''));
}


// ── /go/ — the outbound click layer ────────────────────────────────────
// Asserted against a REAL deploy, not locally, for the reason this whole file
// exists: a rewrite's behaviour is not verified until it has been observed on
// one, and this repo has been burned twice believing otherwise. An edge
// function is worse than a redirect rule that way — netlify dev runs it in a
// different runtime from production's.
//
// UNKNOWN AND RETIRED CONVERGE. The lookup carries retired_at=is.null, so a
// retired link returns zero rows exactly as an unknown id does and falls
// through the same branch. There were zero retired links when this was
// written, so the retired case cannot be exercised with real data — the
// assertion below covers the branch they share, and the filter itself is
// asserted by reading the function's source rather than claimed.
{
  const goLive = await (async () => {
    const res = await fetch(
      `${SB_URL}/rest/v1/affiliate_links?select=id,url,affiliate_url&retired_at=is.null&limit=1`,
      { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  })();

  console.log('\n── /go/ click layer');
  ok(!!goLive, 'found a live affiliate link to exercise /go/ with');

  if (goLive) {
    const expected = goLive.affiliate_url || goLive.url;
    // x-go-no-log, so this check does not spend a click on itself. It used to:
    // seven of the stray rows in link_clicks on 2026-10-01 are this script's
    // scheduled runs, one per run, each indistinguishable from a reader.
    const r = await get('/go/' + goLive.id, NO_LOG);
    ok(r.status === 302, `/go/<live id>: 302, not 200 and not a rewrite`, r.status);
    // Byte-for-byte. A tracking URL that loses or reorders a query parameter
    // still resolves to the right product page and silently stops earning.
    ok(r.location === expected, '302 Location is affiliate_url byte for byte',
       r.location === expected ? 'identical' : `got ${r.location}\n        want ${expected}`);
    ok(/no-store/.test(r.cacheControl || ''),
       'not cacheable — the sync can re-point a link under the same id', r.cacheControl);
    // Reports what happened to the LOGGING, never to the redirect. 'skipped'
    // is the answer to x-go-no-log and proves two things at once: the skip
    // works, and the logging block still runs far enough to decide — a
    // 'no-service-key' here would mean the redirect worked and the config is
    // broken, which must not be silent.
    ok(r.goLog === 'skipped', 'click was NOT logged (x-go-no-log honoured)', r.goLog);

    // THE ONE THING THE SKIP WOULD OTHERWISE STOP TELLING US. Logging depends
    // on SUPABASE_SERVICE_ROLE_KEY being set in Netlify's env, and a normal
    // click reports its absence as x-go-log: no-service-key. This check no
    // longer makes a normal click, so without asking the key could go missing
    // — an env change, a context that does not inherit it, a rotation that
    // only landed in one place — and the only symptom would be a click table
    // that quietly stopped growing. Nobody watches a number for not going up.
    //
    // Asserted, not recorded: an unset key means every buy click since it went
    // is unrecorded and unrecoverable, which is worth a red build.
    ok(r.goKey === 'ok', 'SUPABASE_SERVICE_ROLE_KEY is configured — logging would work', r.goKey);

    // WHAT THE LINE ABOVE GIVES UP, AND HOW TO GET IT BACK.
    // Asserting 'skipped' on every run no longer exercises the path a real
    // click takes. There is no free way to cover it: logging means writing a
    // row, and this script running daily is how the table filled with its own
    // traffic in the first place. So it is deliberate and opt-in — one row,
    // when a person asks for it:
    //
    //   GO_LOG_CHECK=1 node scripts/check-routes.mjs <origin>
    //
    // 'queued' still only means the insert was HANDED to waitUntil, never
    // that it landed. x-go-debug: 1 is the header that awaits and reports it.
    if (process.env.GO_LOG_CHECK === '1') {
      const rl = await get('/go/' + goLive.id);
      ok(rl.status === 302, 'GO_LOG_CHECK: a normal request still redirects', rl.status);
      ok(rl.goLog === 'queued', 'GO_LOG_CHECK: a normal request still logs', rl.goLog);
    } else {
      note('logging path not exercised (costs one link_clicks row)', 'set GO_LOG_CHECK=1 to include it');
    }
  }

  for (const [label, path] of [
    ['/go/nope (not a uuid)',   '/go/nope'],
    ['/go/<unknown uuid>',      '/go/00000000-0000-4000-8000-000000000000'],
    ['/go/ (no id at all)',     '/go/'],
  ]) {
    // None of these reach the logging block at all — they 404 before it — but
    // the header goes on every /go/ request this script makes, so there is no
    // call site to remember to update if that ever changes.
    const r = await get(path, NO_LOG);
    ok(r.status === 404, `${label}: hard 404, never a redirect home`,
       r.status + (r.status >= 300 && r.status < 400 ? ` — REDIRECTED to ${r.location}` : ''));
  }
}

// ── /fit/ — the guide pages ────────────────────────────────────────────
// The live set comes from the same registry guide-page.mjs serves and
// sitemap.mjs lists, so this exercises exactly the pages that claim to
// exist — a page added to the registry without content (or vice versa)
// fails the build earlier, in scripts/check-guide-content.mjs.
{
  console.log('\n── /fit/ guide pages');
  const { GUIDE_PAGES, guidePath } = await import('../netlify/functions/_guide-meta.mjs');

  for (const p of GUIDE_PAGES) {
    const path = guidePath(p.family, p.gun);
    const r = await get(path);
    ok(r.status === 200, `${path}: 200`, r.status);
    ok(r.canon.length === 1, `${path}: exactly one canonical`, r.canon.length);
    ok(r.canon[0] === 'https://gunforma.com' + path,
       `${path}: canonical is the apex /fit/ form`, r.canon[0]);
    ok(/application\/ld\+json/.test(r.body), `${path}: JSON-LD present`);
    ok(r.body.includes('href="/go/'), `${path}: buy links go through /go/`);
    // Recorded, not asserted — live counts are time-dependent facts.
    note('optics on page', r.guideOptics + ' (' + r.guideFresh + ' fresh-priced)');
  }

  for (const [label, path] of [
    ['/fit/p365/red-dots/<unknown gun>', '/fit/p365/red-dots/p999'],
    ['/fit/p365/<unknown family>/p365-xl', '/fit/p365/nope/p365-xl'],
    ['/fit/<wrong platform>/red-dots/p365-xl', '/fit/glock/red-dots/p365-xl'],
    ['/fit/p365/red-dots (no gun)', '/fit/p365/red-dots'],
  ]) {
    const r = await get(path);
    ok(r.status === 404, `${label}: hard 404`, r.status);
  }
}

// ── every category that has a product is on every list ───────────────────
// scripts/check-categories.mjs holds the lists to one another at build time,
// but the build cannot see the database (the API description is closed to
// the public key). This is the live half: read every products.category in
// use, with the same public key and the same visibility a visitor has, and
// fail when one is missing from _category-meta.mjs — its products would have
// no /parts/ address, no catalog name and no builder section. A category
// with no products cannot be hidden from anyone, so it is not asserted.
// Then one product per category must answer 200 at its /parts/ address.
{
  console.log('\n── categories in use');
  const { CATEGORY_META } = await import('../netlify/functions/_category-meta.mjs');
  const res = await fetch(`${SB_URL}/rest/v1/products?select=category,slug&order=slug.asc&limit=5000`,
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
  const rows = res.ok ? await res.json() : null;
  ok(Array.isArray(rows) && rows.length > 0, 'products readable with the public key', res.status);
  const firstByCat = new Map();
  for (const r of rows || []) if (!firstByCat.has(r.category) && r.slug) firstByCat.set(r.category, r.slug);
  for (const cat of [...new Set((rows || []).map((r) => r.category))].sort()) {
    ok(Boolean(CATEGORY_META[cat]), `category '${cat}' (has products) is in the category lists`,
       CATEGORY_META[cat] ? CATEGORY_META[cat][1] : 'MISSING');
  }
  for (const [cat, slug] of firstByCat) {
    if (!CATEGORY_META[cat]) continue;
    const path = '/parts/' + CATEGORY_META[cat][0] + '/' + slug;
    const r = await get(path);
    ok(r.status === 200, `${path}: 200`, r.status);
  }
  note('categories with products', [...firstByCat.keys()].length + ' of ' + Object.keys(CATEGORY_META).length);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
