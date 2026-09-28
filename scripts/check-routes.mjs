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

async function get(path) {
  const res = await fetch(origin + path, { redirect: 'manual' });
  const body = res.headers.get('content-type')?.includes('text/') ? await res.text() : '';
  return {
    status: res.status,
    body,
    idSource: res.headers.get('x-build-og-id-source'),
    origHeader: res.headers.get('x-build-og-orig'),
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
