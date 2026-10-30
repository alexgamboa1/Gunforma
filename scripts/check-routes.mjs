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
// 301ing to the gallery, 410 on a uuid that is no build and 404 on no id.
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
    hubGun: res.headers.get('x-gun-hub'),
    hubGuides: res.headers.get('x-gun-hub-guides'),
    hubMags: res.headers.get('x-gun-hub-mags'),
    fieldNote: res.headers.get('x-field-note'),
    fnSource: res.headers.get('x-field-note-source'),
    fnProducts: res.headers.get('x-field-note-products'),
    fnFits: res.headers.get('x-field-note-fits'),
    fitSection: res.headers.get('x-fit-section'),
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
    `${SB_URL}/rest/v1/builds?select=id,name,parts_snapshot&status=eq.approved&limit=1`,
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const { id, name, parts_snapshot } = rows[0];
  // The slug form is built the same way the site builds it, so this exercises
  // the real URL a reader would follow rather than a hand-made one.
  const { buildPath } = await import('../netlify/functions/_build-url.mjs');
  const partRefIds = (Array.isArray(parts_snapshot) ? parts_snapshot : [])
    .map((p) => p && p.refId).filter(Boolean);
  return { id, name, partRefIds, path: buildPath(id, name), bare: '/b/' + id };
}

// Same escaping build-og.mjs applies before writing a build's name into the
// page, so the assertion below looks for the exact bytes the server emits.
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

console.log(`checking routes on ${origin}\n`);

// ── the legacy bare path is a 301 to the gallery ────────────────────────
// A build page with no build served the static file at 200, and Search
// Console called it a soft 404 (2026-10-12). netlify.toml now 301s it to the
// gallery, at the gallery's own canonical URL so the redirect lands on a page
// that does not point elsewhere. The redirect rule — not build-og — answers
// it, so no function header may be present; and the ?id= rule above it in
// netlify.toml must still win when an id IS present, which the "legacy ?id=:
// 200" assertion below is what proves. Both halves, because a rule with no
// query condition matches any query string: this 301 ordered first would
// swallow every ?id= link and the second assertion is the one that would
// catch it.
{
  const r = await get('/gunforma-build-detail.html');
  ok(r.status === 301, 'bare /gunforma-build-detail.html: 301, not a 200 empty page', r.status);
  ok(r.location === '/gunforma-builds.html' || r.location === origin + '/gunforma-builds.html',
     'Location is the gallery at its canonical URL', r.location);
  ok(r.idSource === null,
     'answered by the redirect rule, not through build-og',
     r.idSource === null ? 'no function headers' : 'id-source=' + r.idSource);
  const t = await get('/gunforma-builds.html');
  ok(t.status === 200, 'and the gallery answers 200', t.status);
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

  // ── the body is server-rendered, not the "—" shell ──────────────────
  // Google's first fetch does not run JS, so the ranking content has to be
  // in these bytes: the real H1 (not the placeholder), and — when the build
  // lists catalog parts — at least one /parts/ link in the parts list.
  ok(!a.body.includes('<h1 class="build-title" id="build-title">—</h1>'),
     'slug URL: H1 is server-rendered, not the — placeholder');
  ok(a.body.includes(escHtml(live.name)),
     'slug URL: build name present in the served HTML', JSON.stringify(live.name));
  ok(!a.body.includes('<div id="parts-container"></div>'),
     'slug URL: parts container is server-rendered, not empty');
  if (live.partRefIds.length) {
    ok(/href="\/parts\//.test(a.body),
       'slug URL: at least one /parts/ link in the server-rendered parts list',
       (a.body.match(/href="\/parts\//g) || []).length + ' links');
  } else {
    note('parts links', 'build has no catalog parts — link assertion skipped');
  }
  ok(a.body.includes('application/ld+json'),
     'slug URL: JSON-LD present');

  // Recorded, not asserted — see the header of this file.
  note('id source, /b/ slug   ', `${a.idSource}   (x-nf-original-path ${a.origHeader})`);
  note('id source, /b/ bare   ', `${bare.idSource}   (x-nf-original-path ${bare.origHeader})`);
  note('id source, legacy ?id=', `${b.idSource}   (x-nf-original-path ${b.origHeader})`);
}

// ── an id that resolves to nothing: BOTH routes refuse it ──────────────
// This is the assertion the previous release got wrong. A 200 carrying
// "Build not found" is a soft 404 and Google penalises it.
//
// A uuid that is not an approved build is 410 Gone — Search Console listed
// two deleted builds as 404s it kept re-crawling (2026-10-12), and 410 is
// what tells it to stop. A request with no uuid in it at all stays 404:
// nothing was ever there. The split is build-og.mjs's notFound(); this
// asserts it on the wire, where the status is what a crawler actually gets.
const GONE = '00000000-0000-4000-8000-000000000000';
for (const [label, path, want] of [
  ['/b/<unknown uuid>',        '/b/' + GONE,                                    410],
  ['/b/<slug>-<unknown uuid>', '/b/some-build-' + GONE,                         410],
  ['/b/not-a-uuid',            '/b/not-a-uuid',                                 404],
  ['legacy ?id=<unknown uuid>', '/gunforma-build-detail.html?id=' + GONE,       410],
  ['legacy ?id=garbage',        '/gunforma-build-detail.html?id=not-a-uuid',    404],
]) {
  const r = await get(path);
  ok(r.status === want, `${label}: hard ${want}, not a soft one`, r.status +
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

  // ── /go/part/<product id> — the unpaid link to a part's own store ──────
  // Same edge function, second shape. The destination is products.url, read
  // from the database; a discontinued part and an unknown id share the 404.
  // x-go-no-log on every request, as above: a maker click is a number we
  // take to that maker, and this script must not be in it.
  console.log('\n── /go/part/ click layer');
  const partLive = await (async () => {
    const res = await fetch(
      `${SB_URL}/rest/v1/products?select=id,url&is_discontinued=eq.false&url=like.http*&limit=1`,
      { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  })();
  const partGone = await (async () => {
    const res = await fetch(
      `${SB_URL}/rest/v1/products?select=id,url&is_discontinued=eq.true&url=like.http*&limit=1`,
      { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  })();
  ok(!!partLive, 'found a live part with a url to exercise /go/part/ with');
  if (partLive) {
    const r = await get('/go/part/' + partLive.id, NO_LOG);
    ok(r.status === 302, '/go/part/<live id>: 302', r.status);
    ok(r.location === partLive.url, '302 Location is products.url byte for byte',
       r.location === partLive.url ? 'identical' : `got ${r.location}\n        want ${partLive.url}`);
    ok(/no-store/.test(r.cacheControl || ''), 'not cacheable', r.cacheControl);
    ok(r.goLog === 'skipped', 'click was NOT logged (x-go-no-log honoured)', r.goLog);
    ok(r.goKey === 'ok', 'service key still reported on this shape', r.goKey);
  }
  // A discontinued part still has a product page (old builds keep their
  // links) but no buy button — so its /go/part/ must be a 404, not a
  // redirect to a page for something nobody can buy. Two exist today; if
  // none did, this would be a skip and say so, not a silent pass.
  if (partGone) {
    const r = await get('/go/part/' + partGone.id, NO_LOG);
    ok(r.status === 404, '/go/part/<discontinued id>: hard 404', r.status +
       (r.status >= 300 && r.status < 400 ? ` — REDIRECTED to ${r.location}` : ''));
  } else {
    note('discontinued case not exercised', 'no discontinued product with a url');
  }
  for (const [label, path] of [
    ['/go/part/<unknown uuid>',   '/go/part/00000000-0000-4000-8000-000000000000'],
    ['/go/part/nope',             '/go/part/nope'],
    ['/go/part (no id)',          '/go/part'],
    ['/go/x/<uuid> (not a shape)', '/go/x/00000000-0000-4000-8000-000000000000'],
  ]) {
    const r = await get(path, NO_LOG);
    ok(r.status === 404, `${label}: hard 404, never a redirect home`,
       r.status + (r.status >= 300 && r.status < 400 ? ` — REDIRECTED to ${r.location}` : ''));
  }
}

// ── buy rows on the served part page: no dead ends, honest disclosure ───
// Three parts are picked from the database with the public key — one with no
// partner listing at all, one with a listing on some options only, one with
// a listing on every option — and the SERVED HTML of each is read. Asserted:
// a part with a url never renders "No listing yet"; a maker button goes
// through /go/part/ and is nofollow without sponsored; the disclosure line
// matches what the buy area contains. The functions build this at request
// time, so only the wire can confirm it — same reason as everything above.
{
  console.log('\n── part pages: maker buttons and disclosure');
  const { CATEGORY_META } = await import('../netlify/functions/_category-meta.mjs');
  const res = await fetch(`${SB_URL}/rest/v1/products?select=id,slug,category,url,` +
    encodeURIComponent('product_variants!product_variants_product_id_fkey(id,affiliate_links(id))') +
    '&is_discontinued=eq.false&product_variants.retired_at=is.null&product_variants.affiliate_links.retired_at=is.null' +
    '&order=slug.asc&limit=5000',
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
  const rows = res.ok ? await res.json() : [];
  ok(Array.isArray(rows) && rows.length > 0, 'products with their listings readable with the public key', res.status);

  const classify = (p) => {
    const vs = p.product_variants || [];
    const listed = vs.filter((v) => (v.affiliate_links || []).length).length;
    if (!vs.length) return null;
    if (listed === 0) return 'maker-only';
    if (listed === vs.length) return 'partner-only';
    return 'mixed';
  };
  const hasUrl = (p) => /^https?:\/\//i.test(p.url || '');
  const pick = (kind, needUrl) => rows.find((p) => classify(p) === kind && (!needUrl || hasUrl(p)) && CATEGORY_META[p.category]);
  const EXPECT = {
    'maker-only':   "These links go straight to the seller&#39;s own store. Gunforma earns nothing on them.",
    'mixed':        "Gunforma may earn a commission on retailer links. Links to a maker&#39;s own store earn us nothing.",
    'partner-only': 'Gunforma may earn a commission on purchases made through these links.',
  };
  const ALL = Object.values(EXPECT);

  for (const kind of ['maker-only', 'mixed', 'partner-only']) {
    const p = pick(kind, kind !== 'partner-only');
    if (!p) { ok(false, `found a ${kind} part to check`, 'none in the catalog'); continue; }
    const path = '/parts/' + CATEGORY_META[p.category][0] + '/' + p.slug;
    const r = await get(path);
    ok(r.status === 200, `${kind}: ${path}: 200`, r.status);
    const makerTags   = [...r.body.matchAll(/<a\b[^>]*href="\/go\/part\/[^>]*>/g)].map((m) => m[0]);
    const partnerTags = [...r.body.matchAll(/<a\b[^>]*href="\/go\/(?!part\/)[^>]*>/g)].map((m) => m[0]);
    if (kind !== 'partner-only') {
      ok(!r.body.includes('No listing yet'), `${kind}: never renders "No listing yet" when a url exists`);
      ok(makerTags.length > 0, `${kind}: renders a /go/part/ button`, makerTags.length);
      ok(makerTags.every((t) => /rel="noopener nofollow"/.test(t) && !/sponsored/.test(t)),
         `${kind}: maker buttons are nofollow and never sponsored`, makerTags[0]);
      ok(makerTags.every((t) => t.includes('/go/part/' + p.id)), `${kind}: maker buttons name THIS product`, p.id);
      // Verbatim from the page: the label the reader sees.
      note('maker label', (r.body.match(/\/go\/part\/[^>]*>([^<]+)</) || [])[1]);
    } else {
      ok(makerTags.length === 0, `${kind}: no /go/part/ button on a fully-listed part`, makerTags.length);
    }
    ok((kind === 'maker-only') === (partnerTags.length === 0),
       `${kind}: partner buttons ${kind === 'maker-only' ? 'absent' : 'present'}`, partnerTags.length);
    ok(partnerTags.every((t) => /rel="noopener sponsored nofollow"/.test(t)),
       `${kind}: partner buttons keep their rel unchanged`);
    const found = ALL.filter((t) => r.body.includes(t));
    ok(found.length === 1 && found[0] === EXPECT[kind],
       `${kind}: disclosure line matches the buy area`, found.length ? found.map((t) => t.slice(0, 40) + '…').join(' | ') : 'no disclosure');
    note('part', p.slug);
  }

  // The one live part with no listing AND no url keeps its non-link state —
  // and no disclosure at all, because there is nothing to disclose.
  const bare = rows.find((p) => classify(p) === 'maker-only' && !hasUrl(p) && CATEGORY_META[p.category]);
  if (bare) {
    const path = '/parts/' + CATEGORY_META[bare.category][0] + '/' + bare.slug;
    const r = await get(path);
    ok(r.status === 200 && r.body.includes('No listing yet') && !r.body.includes('/go/'),
       `no-url part keeps "No listing yet" and no /go/ link`, bare.slug);
    ok(!ALL.some((t) => r.body.includes(t)), 'no-url part carries no disclosure line');
  } else {
    note('no-url case not exercised', 'every unlisted part has a url now');
  }
}

// ── /fit/ — the guide pages ────────────────────────────────────────────
// The live set comes from the same registry guide-page.mjs serves and
// sitemap.mjs lists, so this exercises exactly the pages that claim to
// exist — a page added to the registry without content (or vice versa)
// fails the build earlier, in scripts/check-guide-content.mjs.
{
  console.log('\n── /fit/ guide pages');
  const { GUIDE_PAGES, guidePath, hubPath, isLiveGunHub } = await import('../netlify/functions/_guide-meta.mjs');

  for (const p of GUIDE_PAGES) {
    const path = guidePath(p.family, p.gun);
    const r = await get(path);
    ok(r.status === 200, `${path}: 200`, r.status);
    ok(r.canon.length === 1, `${path}: exactly one canonical`, r.canon.length);
    ok(r.canon[0] === 'https://gunforma.com' + path,
       `${path}: canonical is the apex /fit/ form`, r.canon[0]);
    ok(/application\/ld\+json/.test(r.body), `${path}: JSON-LD present`);
    ok(r.body.includes('href="/go/'), `${path}: buy links go through /go/`);
    // The other direction of "links in both directions": a fit page links UP
    // to its hub. #120 asserted hub → fit and shipped without this one, so
    // the hub was reachable from nowhere a fit-page reader could see.
    if (isLiveGunHub(p.gun)) {
      ok(r.body.includes('href="' + hubPath(p.gun) + '"'),
         `${path}: links up to its hub ${hubPath(p.gun)}`);
    }
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

// ── /p365/ — the gun hubs ──────────────────────────────────────────────
// The hubs are what un-orphan the /fit/ pages, so the assertion that
// matters is not just "the hub renders" but "the hub links DOWN to its
// declared fit pages and the fit page is reachable from it". A hub that
// 200s with no links is the same orphan problem one level up.
{
  console.log('\n── /p365/ gun hubs');
  const { GUN_HUBS, GUIDE_PAGES, hubPath, guidePath, HUB_INDEX_PATH } =
    await import('../netlify/functions/_guide-meta.mjs');
  const { brandForms, hasDoubledBrand } = await import('../netlify/functions/_display-name.mjs');
  // The brands a row may open with, read with the public key. When the
  // read fails the brand assertions are skipped and said to be — never
  // passed on a guess.
  const BRANDS = await (async () => {
    const res = await fetch(`${SB_URL}/rest/v1/manufacturers?select=name&order=name.asc&limit=1000`,
      { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
    const rows = res.ok ? await res.json() : null;
    const names = Array.isArray(rows) ? rows.map((m) => m && m.name).filter(Boolean) : null;
    ok(Array.isArray(names) && names.length > 0, 'manufacturers readable with the public key', res.status + ', ' + (names ? names.length : 0) + ' brands');
    return names && names.length ? names : null;
  })();
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  const idx = await get(HUB_INDEX_PATH);
  ok(idx.status === 200, `${HUB_INDEX_PATH}: 200`, idx.status);
  ok(idx.canon.length === 1, `${HUB_INDEX_PATH}: exactly one canonical`, idx.canon.length);
  ok(idx.canon[0] === 'https://gunforma.com' + HUB_INDEX_PATH,
     `${HUB_INDEX_PATH}: canonical is the apex form`, idx.canon[0]);
  for (const h of GUN_HUBS) {
    ok(idx.body.includes('href="' + hubPath(h.gun) + '"'),
       `${HUB_INDEX_PATH}: links to ${h.gun}`);
  }

  for (const h of GUN_HUBS) {
    const path = hubPath(h.gun);
    const r = await get(path);
    ok(r.status === 200, `${path}: 200`, r.status);
    ok(r.canon.length === 1, `${path}: exactly one canonical`, r.canon.length);
    ok(r.canon[0] === 'https://gunforma.com' + path,
       `${path}: canonical is the apex /p365/ form`, r.canon[0]);
    ok(/application\/ld\+json/.test(r.body), `${path}: JSON-LD present`);
    // The point of the page: every declared fit page for this gun is linked.
    for (const g of GUIDE_PAGES.filter((p) => p.gun === h.gun)) {
      ok(r.body.includes('href="' + guidePath(g.family, g.gun) + '"'),
         `${path}: links down to ${guidePath(g.family, g.gun)}`);
    }
    note('hub guides linked', r.hubGuides);

    // Magazines that fit: when the function served fit rows (the header
    // counts them), the section must be in the HTML with at least one
    // product link that answers 200 — a header that says "3/2" over a page
    // with no section is the exact silent failure this file exists for.
    // Zero rows (the table not applied yet, or a model with none) is noted,
    // not failed: the rule is "render nothing", and nothing is what it is.
    const magCounts = (r.hubMags || '0/0').split('/').map(Number);
    note('magazine rows served (fit/doesn\'t fit)', r.hubMags || 'header absent');
    if (magCounts[0] > 0) {
      ok(r.body.includes('id="magazines"'), `${path}: magazine section served`);
      // Every row names its brand, exactly once. "AMAG 15 SG9 15rd" told a
      // reader nothing; "Magpul Magpul AMAG …" is the fix gone wrong. Both
      // render perfectly, so the served text of each .mag-name link and
      // each "doesn't fit" link is held to open with a form of a brand in
      // `manufacturers` (full name, first word, initials or a listed alias
      // — _display-name.mjs) and to not open with that brand twice. The
      // row count must match the header: a header that says 7 over 5 rows
      // is the silent failure this file exists for.
      const rowNames = [...r.body.matchAll(/<a class="mag-name" href="[^"]*">([^<]*)<\/a>/g)].map((m) => unesc(m[1]));
      ok(rowNames.length === magCounts[0], `${path}: one .mag-name per served fit row`, rowNames.length + ' rows, header ' + magCounts[0]);
      const noFitBlock = (r.body.match(/<p class="mag-nofit">[\s\S]*?<\/p>/) || [''])[0];
      const noFitNames = [...noFitBlock.matchAll(/<a href="\/parts\/magazines\/[^"]*">([^<]*)<\/a>/g)].map((m) => unesc(m[1]));
      ok(noFitNames.length === magCounts[1], `${path}: one "doesn't fit" link per served not-compatible row`, noFitNames.length + ' links, header ' + magCounts[1]);
      if (BRANDS) {
        for (const name of [...rowNames, ...noFitNames]) {
          const brand = BRANDS.find((b) => brandForms(b).some((f) => new RegExp('^' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i').test(name)));
          ok(Boolean(brand), `${path}: "${name}" starts with a known brand`, brand || 'NONE');
          if (brand) ok(!hasDoubledBrand(name, brand), `${path}: "${name}" does not double its brand`, brand);
        }
        note('magazine row names', [...rowNames, ...noFitNames].join(' | '));
      }
      const magLinks = [...new Set([...r.body.matchAll(/href="(\/parts\/magazines\/[^"#?]+)"/g)].map((m) => m[1]))];
      ok(magLinks.length >= 1, `${path}: magazine section links to a product page`, magLinks.length + ' linked');
      ok(magLinks.length >= magCounts[0], `${path}: every served fit row is linked`, magLinks.length + ' of ' + magCounts[0]);
      if (magLinks.length) {
        const pr = await get(magLinks[0]);
        ok(pr.status === 200, `${path}: first magazine link ${magLinks[0]} answers 200`, pr.status);
      }
      if (magCounts[1] > 0) ok(/Doesn.{0,8}t fit the /.test(r.body), `${path}: "doesn't fit" line served for the not-compatible rows`);
    }
  }

  for (const [label, path] of [
    ['/p365/<undeclared gun>',  '/p365/p365-xmacro-comp'],
    ['/p365/<unknown slug>',    '/p365/not-a-pistol'],
    ['/p365/<too deep>',        '/p365/p365-xl/extra'],
  ]) {
    const r = await get(path);
    ok(r.status === 404, `${label}: hard 404`, r.status);
  }
}

// ── every product name goes through displayProductName() ───────────────
// The rule exists in two copies — netlify/functions/_display-name.mjs and
// js/display-name.js — and scripts/display-name.test.mjs holds them equal
// over a fixture of the catalog. This is the live half: both copies over
// every product the public key can read today, so a part added after the
// fixture was captured is covered; then the served /parts index and a
// product page, where the rule lands on the wire. "AMAG 15 SG9 …" with no
// Magpul, and "… by Magpul" after a name that already says Magpul, both
// render perfectly.
{
  console.log('\n── product names: both copies, live catalog, served pages');
  const server = await import('../netlify/functions/_display-name.mjs');
  const browser = await (async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../js/display-name.js', import.meta.url), 'utf8');
    const g = {};
    new Function('window', src)(g);
    return g;
  })();
  const res = await fetch(`${SB_URL}/rest/v1/products?select=slug,category,name,manufacturers!products_brand_id_fkey(name)&is_discontinued=eq.false&order=slug.asc&limit=1000`,
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
  const products = res.ok ? await res.json() : null;
  ok(Array.isArray(products) && products.length > 0, 'live products readable with the public key', res.status + ', ' + (products ? products.length : 0) + ' products');
  if (Array.isArray(products) && products.length) {
    let disagree = 0, changed = 0, doubled = 0;
    for (const p of products) {
      const brand = p.manufacturers ? p.manufacturers.name : null;
      const s = server.displayProductName({ name: p.name, brand });
      const b = browser.displayProductName({ name: p.name, brand });
      if (s !== b) { disagree++; note(`copies disagree on ${p.slug}`, `server "${s}" / browser "${b}"`); }
      if (s !== p.name) changed++;
      if (server.hasDoubledBrand(s, brand) && !server.hasDoubledBrand(p.name, brand)) { doubled++; note(`doubled brand on ${p.slug}`, s); }
    }
    ok(disagree === 0, 'js/display-name.js and _display-name.mjs agree on every live product', disagree + ' disagreement(s) over ' + products.length);
    ok(doubled === 0, 'the rule never introduces a doubled brand on a live product', doubled);
    note('live names the rule prefixes with a brand', changed + ' of ' + products.length);

    // The served /parts index: one link per product, each reading as the
    // rule says, and no trailing "— Brand" span (it would double the brand).
    const idx = await get('/parts');
    ok(idx.status === 200, '/parts: 200', idx.status);
    const unesc = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const served = new Map([...idx.body.matchAll(/<li><a href="\/parts\/[^/"]+\/([^"]+)">([^<]*)<\/a><\/li>/g)].map((m) => [m[1], unesc(m[2])]));
    ok(!idx.body.includes('<span class="brand">'), '/parts: no trailing "— Brand" span on any row');
    let wrong = 0;
    for (const p of products) {
      const want = server.displayProductName({ name: p.name, brand: p.manufacturers ? String(p.manufacturers.name).replace(/\s*\([^)]*\)\s*$/, '').trim() : null });
      const got = served.get(p.slug);
      if (got !== want) { wrong++; if (wrong <= 5) note(`/parts row for ${p.slug}`, `served "${got}", expected "${want}"`); }
    }
    ok(wrong === 0, '/parts: every live product is served under its display name', wrong + ' wrong of ' + products.length);

    // A product page whose stored name lacks its brand: the title opens
    // with the brand and never says "by <brand>" after a name that has it.
    const unbranded = products.find((p) => p.manufacturers && server.displayProductName({ name: p.name, brand: p.manufacturers.name }) !== p.name);
    const branded   = products.find((p) => p.manufacturers && server.nameCarriesBrand(p.name, p.manufacturers.name));
    for (const p of [unbranded, branded].filter(Boolean)) {
      const { CATEGORY_META } = await import('../netlify/functions/_category-meta.mjs');
      const path = '/parts/' + CATEGORY_META[p.category][0] + '/' + p.slug;
      const r = await get(path);
      const want = server.displayProductName({ name: p.name, brand: p.manufacturers.name });
      const title = unesc((r.body.match(/<title>([^<]*)<\/title>/) || ['', ''])[1]);
      ok(r.status === 200, `${path}: 200`, r.status);
      ok(title === want + ' | Gunforma', `${path}: <title> is the display name`, title);
      ok(r.body.includes('<meta property="og:title" content="' + want.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + ' | Gunforma"/>'), `${path}: og:title matches`);
      const ld = (r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
      let ldName = null; try { ldName = JSON.parse(ld).name; } catch (e) { /* asserted below */ }
      ok(ldName === want, `${path}: JSON-LD Product.name is the display name`, ldName);
      // Decided 2026-10-21: the H1 is the display name too, and the "by
      // <maker>" line that used to sit under it is gone — with the brand in
      // the H1 it named the same maker twice.
      const h1 = unesc((r.body.match(/<h1>([^<]*)<\/h1>/) || ['', ''])[1]);
      ok(h1 === want, `${path}: <h1> is the display name`, h1);
      ok(!r.body.includes('class="brand-line"'), `${path}: no "by <maker>" line under the H1`);
      ok(!server.hasDoubledBrand(h1, p.manufacturers.name), `${path}: <h1> does not double its brand`, h1);
    }
  }
}

// ── the front door: the nav's dropdown and Armory link, the picker on / ─
// The /p365/ cluster was reachable by crawlers (sitemap) and by nobody
// else: no nav item, no homepage link. This asserts the way in on the
// wire, on a static page, a hub, a guide AND a function-rendered product
// page (the function copies are the ones a sweep of *.html misses), and
// every hub button of the homepage picker. Since 2026-10-29 the nav item
// is a hamburger-menu dropdown — one <summary>, every hub link, the index
// link — and the Armory holds the old bar slot, desktop and mobile. The
// build holds the picker and every dropdown copy to GUN_HUBS
// (scripts/check-home-picker.mjs, scripts/check-nav.mjs); this is the
// live half, so the front door cannot quietly disappear from what a
// reader is actually served.
{
  console.log('\n── front door to /p365/ and the Armory');
  const { GUN_HUBS, GUIDE_PAGES, hubPath, guidePath, HUB_INDEX_PATH } =
    await import('../netlify/functions/_guide-meta.mjs');
  const ARMORY_LINK = 'href="gunforma-armory.html">Armory</a>';
  const g0 = GUIDE_PAGES[0];
  for (const [label, path] of [
    ['static page',   '/gunforma-builds.html'],
    ['gun hub',       hubPath(GUN_HUBS[0].gun)],
    ['fit guide',     guidePath(g0.family, g0.gun)],
    ['product page',  '/parts/optics/holosun-507k-x2'],
    ['parts index',   '/parts'],
  ]) {
    const r = await get(path);
    const armory = r.body.split(ARMORY_LINK).length - 1;
    ok(r.status === 200 && armory >= 2, `${label} ${path}: Armory in desktop nav and mobile menu`, `${r.status}, ${armory} link(s)`);
    const summaries = r.body.split('<summary>Your P365</summary>').length - 1;
    ok(summaries === 1, `${label} ${path}: one "Your P365" dropdown in the menu`, `${summaries} dropdown(s)`);
    const missing = GUN_HUBS.filter((h) => !r.body.includes('href="' + hubPath(h.gun) + '">'));
    ok(missing.length === 0 && r.body.includes('href="' + HUB_INDEX_PATH + '">All P365 models'),
       `${label} ${path}: the dropdown links every hub and the index`,
       missing.length ? 'missing ' + missing.map((h) => h.gun).join(', ') : undefined);
    ok(!r.body.includes('href="/p365/">Your P365</a>'), `${label} ${path}: no flat "Your P365" bar link`);
  }
  const home = await get('/');
  ok(home.status === 200, '/: 200', home.status);
  ok(home.body.includes('What fits your P365?'), '/: picker heading in served HTML');
  for (const h of GUN_HUBS) {
    ok(home.body.includes('class="model-btn" href="' + hubPath(h.gun) + '"'), `/: picker links to ${hubPath(h.gun)}`);
  }
  ok(home.body.includes('class="model-btn more" href="' + HUB_INDEX_PATH + '"'), `/: picker links to ${HUB_INDEX_PATH}`);
  // A no-JS user agent sees the same bytes; the point is that nothing here
  // is injected after load.
  const bot = await get('/', { 'User-Agent': 'GPTBot' });
  ok(bot.status === 200 && bot.body.includes('class="model-btn" href="' + hubPath(GUN_HUBS[0].gun) + '"'),
     '/: picker present for a non-browser user agent', bot.status);
}

// ── the /fit/ cluster is no longer orphaned ────────────────────────────
// The defect this PR fixes, asserted on the wire rather than in review:
// a product page for an optic must link INTO a fit guide.
{
  console.log('\n── inbound links to /fit/');
  const { GUIDE_PAGES, guidePath } = await import('../netlify/functions/_guide-meta.mjs');
  const r = await get('/parts/optics/holosun-507k-x2');
  ok(r.status === 200, '/parts/optics/holosun-507k-x2: 200', r.status);
  const linked = GUIDE_PAGES.filter((g) => r.body.includes('href="' + guidePath(g.family, g.gun) + '"'));
  ok(linked.length > 0,
     'an optic product page links to at least one fit guide', linked.length + ' linked');
  note('fit guides linked from that product page', linked.map((g) => g.gun).join(', '));
  // Since 2026-10-20 the same "Fits these pistols" card also links UP to the
  // gun's hub — before, an optic page reached no hub but the nav index, so
  // the hubs had inbound links from the homepage picker and nothing else.
  const { hubPath, GUN_HUBS } = await import('../netlify/functions/_guide-meta.mjs');
  const hubs = GUN_HUBS.filter((h) => r.body.includes('class="fg-gun" href="' + hubPath(h.gun) + '"'));
  ok(hubs.length > 0 && hubs.length === linked.length,
     'and to the hub of every one of those models', hubs.length + ' hub links, ' + linked.length + ' guide links');
}

// ── Field Notes articles: /field-notes/<slug> ───────────────────────────
// field-note.mjs serves a declared article from a Markdown file bundled
// with the function (included_files) behind a FORCED rewrite. Three things
// here can only be seen on the wire: that the forced rule beats the static
// file and the raw .md is not served; that the bundle actually carries the
// file (x-field-note-source: file, not missing); and that every part and
// pistol the blocks name exists in the catalog this origin reads
// (x-field-note-products / -fits, found/asked). A draft is asserted both
// ways: a 404 on the apex, a page on a preview.
{
  console.log('\n── field notes');
  const { FIELD_NOTES, fieldNotePath } = await import('../netlify/functions/_field-notes-meta.mjs');
  const apex = origin === 'https://gunforma.com';
  const NAV_LINK = 'href="gunforma-armory.html">Armory</a>';
  const NOINDEX = /<meta[^>]+name=["']robots["'][^>]+noindex/i;
  const same = (ratio) => { const [a, b] = String(ratio || '').split('/'); return a !== undefined && a === b; };

  let r = await get('/field-notes/not-an-article');
  ok(r.status === 404 && r.fieldNote === 'none', '/field-notes/<undeclared>: the function\'s own 404', `${r.status}, x-field-note=${r.fieldNote}`);
  for (const a of FIELD_NOTES) {
    const raw = fieldNotePath(a.slug) + '.md';
    r = await get(raw);
    ok(r.status === 404 && r.fieldNote === 'none', `${raw}: the Markdown source is not served`, `${r.status}, x-field-note=${r.fieldNote}`);
  }
  for (const a of FIELD_NOTES) {
    const path = fieldNotePath(a.slug);
    r = await get(path);
    if (a.draft && apex) { ok(r.status === 404, `${path}: a draft is a 404 on the apex`, r.status); continue; }
    ok(r.status === 200, `${path}: 200${a.draft ? ' (draft, off the apex)' : ''}`, r.status);
    ok(r.fnSource === 'file', `${path}: the Markdown file is in the bundle`, `x-field-note-source=${r.fnSource}`);
    ok(r.canon.length === 1 && r.canon[0] === 'https://gunforma.com' + path, `${path}: one apex canonical`, r.canon.join(' | ') || 'none');
    ok(r.body.split(NAV_LINK).length - 1 >= 2, `${path}: the shared nav, desktop and mobile`);
    ok(r.body.includes('"@type":"Article"'), `${path}: Article JSON-LD`);
    ok(r.body.split('cloudflareinsights').length - 1 === 1, `${path}: analytics tag once`);
    ok(same(r.fnProducts), `${path}: every part a block names is in the catalog`, `x-field-note-products=${r.fnProducts}`);
    ok(same(r.fnFits), `${path}: every fit block resolved its part and pistol`, `x-field-note-fits=${r.fnFits}`);
    if (a.draft) ok(NOINDEX.test(r.body) && r.cacheControl === 'no-store', `${path}: draft is noindex and no-store`, r.cacheControl);
    else ok(!NOINDEX.test(r.body) && /s-maxage/.test(r.cacheControl || ''), `${path}: live article is indexable and cached`, r.cacheControl);
  }
}

// ── one URL per page: the bare forms 301 to the .html canonical ──────────
// Every static page declares its .html form canonical, and Netlify also
// answered the extensionless form at 200, so each content page had two live
// addresses (2026-10-20). The bare form is a forced 301 in netlify.toml now;
// the home page goes the other way (/index.html → /). The /builds, /build
// and /field-notes aliases, which pointed at indexable content, are 301s
// too. Asserted on the wire because a forced rule is the only kind that
// beats Netlify's implicit .html lookup, and whether it does is not
// something a local run can see.
{
  console.log('\n── one URL per page');
  for (const [from, to] of [
    ['/index.html',             '/'],
    ['/gunforma-builds',        '/gunforma-builds.html'],
    ['/gunforma-parts-catalog', '/gunforma-parts-catalog.html'],
    ['/gunforma-legal',         '/gunforma-legal.html'],
    ['/privacy-policy',         '/privacy-policy.html'],
    ['/terms-of-service',       '/terms-of-service.html'],
    ['/builder-agreement',      '/builder-agreement.html'],
    ['/field-notes',            '/field-notes.html'],
    ['/field-notes/',           '/field-notes.html'],
    ['/builds',                 '/gunforma-builds.html'],
    ['/build',                  '/gunforma-builds.html'],
    ['/gunforma-post-build-v6.html', '/gunforma-post-build.html'],
  ]) {
    const r = await get(from);
    const loc = (r.location || '').replace(/^https?:\/\/[^/]+/, '');
    ok(r.status === 301, `${from}: 301`, r.status);
    ok(loc === to, `  -> ${to}`, r.location);
  }
  for (const p of ['/gunforma-builds.html', '/gunforma-parts-catalog.html', '/gunforma-legal.html', '/field-notes.html']) {
    const r = await get(p);
    ok(r.status === 200 && r.canon[0] === 'https://gunforma.com' + p, `${p}: 200 and canonical to itself`, r.status + ' ' + (r.canon[0] || 'none'));
  }
}

// ── app screens are noindex; content is not ──────────────────────────────
// A noindex that lands on a content page is the quietest way to lose it,
// and the bare profile page (an app screen) is the same file /u/<username>
// is served from — profile-og.mjs must strip the tag it carries.
{
  console.log('\n── robots meta');
  const NOINDEX = /<meta[^>]+name=["']robots["'][^>]+noindex/i;
  for (const p of ['/gunforma-signin.html', '/gunforma-post-build.html', '/gunforma-profile.html', '/gunforma-admin-queue.html']) {
    const r = await get(p);
    ok(r.status === 200 && NOINDEX.test(r.body), `${p}: noindex`, r.status);
  }
  const { GUN_HUBS, hubPath } = await import('../netlify/functions/_guide-meta.mjs');
  for (const p of [hubPath(GUN_HUBS[0].gun), '/parts/optics/holosun-507k-x2', '/gunforma-builds.html']) {
    const r = await get(p);
    ok(r.status === 200 && !NOINDEX.test(r.body), `${p}: no noindex`, r.status);
  }
}

// ── magazines link back up to the hubs ─────────────────────────────────
// The mirror of the hub section: a magazine product page with fit rows
// must serve its "Fits" links, each to a live hub that answers 200. Asked
// of PostgREST first with the public key, so the assertion is conditional
// on rows existing (the table may not be applied yet) and never on a guess.
{
  console.log('\n── magazines → hubs');
  const slug = 'sig-sauer-p365-17rd-mag';
  const pres = await fetch(`${SB_URL}/rest/v1/magazine_housing_fit?select=housing_class,fit,products!magazine_housing_fit_magazine_product_id_fkey(slug)&products.slug=eq.${slug}`,
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
  const fitRows = pres.ok ? (await pres.json()).filter((x) => x.products && x.fit !== 'not_compatible') : [];
  note('fit rows for ' + slug + ' (PostgREST ' + pres.status + ')', fitRows.length);
  const r = await get('/parts/magazines/' + slug);
  ok(r.status === 200, `/parts/magazines/${slug}: 200`, r.status);
  if (fitRows.length) {
    ok(r.body.includes('class="fitguides mag-fits"'), `/parts/magazines/${slug}: "Fits" section served`);
    const hubLinks = [...new Set([...r.body.matchAll(/class="fitguides mag-fits"[\s\S]*?<\/div>/g)].flatMap((m) => [...m[0].matchAll(/href="(\/p365\/[^"]+)"/g)].map((x) => x[1])))];
    ok(hubLinks.length >= 1, `/parts/magazines/${slug}: links up to at least one hub`, hubLinks.length + ' linked');
    for (const h of hubLinks) {
      const hr = await get(h);
      ok(hr.status === 200, `/parts/magazines/${slug}: hub ${h} answers 200`, hr.status);
    }
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
// Then one product per category must answer 200 at its /parts/ address —
// a live one: a discontinued part may 301 to its successor (netlify.toml).
{
  console.log('\n── categories in use');
  const { CATEGORY_META } = await import('../netlify/functions/_category-meta.mjs');
  const res = await fetch(`${SB_URL}/rest/v1/products?select=category,slug&is_discontinued=eq.false&order=slug.asc&limit=5000`,
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

// ── discontinued parts redirect to their successor; moved parts to their ──
// ── new address ─────────────────────────────────────────────────────────
// The rules are exact paths in netlify.toml, above the /parts/* rewrite. If
// one slips below it, product-page.mjs answers instead and the old page
// renders at 200 — so assert the 301 and its target on the wire. The TTI
// pair is a category move (basepad -> magazine), not a discontinuation.
{
  console.log('\n── discontinued and moved parts');
  for (const [from, to] of [
    ['/parts/triggers/ramm-tactical-leverage-c-p365',  '/parts/triggers/ramm-tactical-leverage-trigger-p365'],
    ['/parts/triggers/ramm-tactical-leverage-nc-p365', '/parts/triggers/ramm-tactical-leverage-trigger-p365'],
    ['/parts/basepads/tti-xmacro-completed-mag-w-basepad', '/parts/magazines/tti-xmacro-completed-mag-w-basepad'],
    ['/parts/safety-selectors/sig-sauer-manual-safety-parts-kit-black-p365', '/parts/safety-selectors/sig-sauer-manual-safety-kit-p365'],
    ['/parts/frames/icarus-precision-311-fuse-sl', '/parts/frames/icarus-precision-311-fuse'],
    // The ARC Reactor 365F is a FUSE slide; the fitment-tiers migration moves
    // its slug off ...-p365-xmacro. The redirect deploys with the code, so the
    // target answers 404 until `supabase db push --linked` runs — a scheduled
    // red here in that window means the push is overdue, which is the point.
    ['/parts/slides/arc-division-reactor-365f-p365-xmacro', '/parts/slides/arc-division-reactor-365f-p365-fuse'],
  ]) {
    const r = await get(from);
    const loc = (r.location || '').replace(/^https?:\/\/[^/]+/, '');
    ok(r.status === 301, `${from}: 301`, r.status);
    ok(loc === to, `  -> ${to}`, r.location);
    const t = await get(to);
    ok(t.status === 200, `  and ${to} answers 200`, t.status);
  }
}

// ── a variant's photo is its own: no two colours share one ─────────────
// Live data, so it lives here and not in check-all.sh (same reasoning as
// check-variant-image-sku.mjs, which only sees a sibling's SKU in a
// filename). The rule from the 2026-10-21 audit: a photo sits on a variant
// only if it is the maker's image of that colour and finish; a variant with
// no real photo carries none and the pages draw its swatch. So two live
// variants of one product with a DIFFERENT colour or finish must never
// share a primary_image_url. Same colour and finish may (a 2 MOA and a 6
// MOA optic are one housing). A group shot that is the only photo a product
// has may stay on named variants, listed here with the variants and the
// reason. The variants are part of the ruling: a group that holds any other
// variant fails. (Until 2026-10-30 an entry passed any group that held the
// default, so the Anarchy composite sat on all five colours while its note
// said Black alone — catalog_approvals_photos.sql made the note true, and
// naming the variants keeps it true.)
{
  console.log('\n── variant photos: one colour, one photo');
  const SHARED_PHOTO_ALLOWED = {
    // Fdez's group shot of all four finishes (image 4458). Gold and Copper
    // (the default) keep it: Fdez photographs neither on its own, and the
    // shot shows every finish, so neither is misleading. Black DLC and
    // Stainless have their own photos. Alex's ruling, 2026-10-22.
    'fdez-werx-p365-xl-ported-barrel': {
      variants: ['fdez-werx-p365-xl-ported-barrel-copper-high-polished-copper', 'fdez-werx-p365-xl-ported-barrel-gold-high-polished-gold-tin'],
      reason: 'four-finish group shot kept on Gold and Copper (default), which Fdez never photographs alone (Alex, 2026-10-22)',
    },
    // OpticsPlanet's five-plate composite stays on Black (the default);
    // Purple has its own photo and Blue, Gold and Red show the swatch.
    // One variant cannot share with itself, so this entry never excuses a
    // group: it records the ruling, and any second colour on the composite
    // fails.
    'anarchy-outdoors-slide-plate-p365': {
      variants: ['anarchy-outdoors-slide-plate-p365-black'],
      reason: 'five-colour composite kept on the default variant only (audit 2026-10-21, item 3; Alex, 2026-10-30)',
    },
    // Fdez's group photo of all four finishes (image 4496: copper, gold,
    // stainless, black). Black DLC, Copper (the default) and Stainless
    // share it; Gold keeps its own photo (4500). Alex's choice, 2026-10-22.
    'fdez-werx-p365-fuse-ported-barrel': {
      variants: ['fdez-werx-p365-fuse-ported-barrel-black-high-polished-black-dlc', 'fdez-werx-p365-fuse-ported-barrel-copper-high-polished-copper-rose', 'fdez-werx-p365-fuse-ported-barrel-stainless-steel-high-polished-stainless'],
      reason: 'four-finish group photo shared by Black DLC, Copper (default) and Stainless; Gold has its own (Alex, 2026-10-22)',
    },
  };
  const res = await fetch(`${SB_URL}/rest/v1/product_variants?select=slug,color,finish,is_default,primary_image_url,products!product_variants_product_id_fkey(slug,is_discontinued)&retired_at=is.null&primary_image_url=not.is.null&limit=3000`,
    { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
  const variants = res.ok ? await res.json() : null;
  ok(Array.isArray(variants) && variants.length > 0, 'live variants with a photo readable with the public key', res.status + ', ' + (variants ? variants.length : 0) + ' variants');
  if (Array.isArray(variants) && variants.length) {
    const byProduct = new Map();
    for (const v of variants) {
      const p = v.products;
      if (!p || p.is_discontinued) continue;
      if (!byProduct.has(p.slug)) byProduct.set(p.slug, []);
      byProduct.get(p.slug).push(v);
    }
    const key = (v) => (v.color || '').trim().toLowerCase() + '|' + (v.finish || '').trim().toLowerCase();
    let shared = 0, allowed = 0;
    for (const [slug, vs] of byProduct) {
      const byUrl = new Map();
      for (const v of vs) { if (!byUrl.has(v.primary_image_url)) byUrl.set(v.primary_image_url, []); byUrl.get(v.primary_image_url).push(v); }
      for (const [url, group] of byUrl) {
        const colours = new Set(group.map(key));
        if (colours.size < 2) continue;
        const rule = SHARED_PHOTO_ALLOWED[slug];
        if (rule && group.every((v) => rule.variants.includes(v.slug))) { allowed++; note(`${slug}: allowed`, rule.reason); continue; }
        shared++;
        note(`${slug}: ${group.map((v) => v.slug).join(', ')} share one photo`, url);
      }
    }
    ok(shared === 0, 'no two variants of different colour or finish share a primary_image_url', shared + ' shared photo(s) over ' + byProduct.size + ' products, ' + allowed + ' allowlisted');
  }
}

// ── barrels and slides say which fit each other ─────────────────────────────
// product-page.mjs lists, on a slide, the barrels that fit it and, on a
// barrel, the slides it fits (v_barrel_slide_fit, fit_status 'fits').
// Asserted on the wire because the one thing that must never happen — a
// barrel the maker locks to other slides listed under one it is not locked
// to — renders as an ordinary row. Parts are picked through PostgREST, not
// typed here, so a part leaving the catalog does not turn this red.
{
  const H = { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` } };
  const rest = async (q) => { const r = await fetch(`${SB_URL}/rest/v1/${q}`, H); return r.ok ? r.json() : null; };
  const listed = (body, segment) => [...new Set([...body.matchAll(new RegExp('<li class="fit-row"><span><a href="/parts/' + segment + '/([a-z0-9-]+)"', 'g'))].map((m) => m[1]))];

  // EVERY live locked barrel: the heading and a lock line are always
  // served — "Only these slides …" over the slides it lists, or "Only for
  // specific <brand> slides …" when none is listed — and every slide it
  // lists is a 'fits' pair, never a blocked one. Locks are read the way the
  // page reads them, through barrel_specs.
  const lockedBarrels = await rest('barrel_specs?select=' + encodeURIComponent(
    'product_id,p:products!barrel_specs_product_id_fkey!inner(slug,is_discontinued),' +
    'locks:barrel_slide_requirements!barrel_slide_requirements_barrel_product_id_fkey!inner(slide_product_id)') +
    '&p.is_discontinued=is.false');
  ok(Array.isArray(lockedBarrels) && lockedBarrels.length > 0, 'live locked barrels readable with the public key',
    lockedBarrels ? lockedBarrels.length + ' locked barrels' : 'no answer');
  const fitPairs = await rest('v_barrel_slide_fit?fit_status=eq.fits&select=barrel_product_id,' + encodeURIComponent(
    'slide:products!slide_specs_product_id_fkey!inner(slug)'));
  ok(Array.isArray(fitPairs), 'fit pairs readable with the public key', fitPairs ? fitPairs.length + ' pairs' : 'no answer');
  for (const b of lockedBarrels || []) {
    const slug = b.p.slug;
    const fitsFor = new Set((fitPairs || []).filter((r) => r.barrel_product_id === b.product_id).map((r) => r.slide.slug));
    const r = await get('/parts/barrels/' + slug);
    note('x-fit-section on /parts/barrels/' + slug, r.fitSection);
    ok(r.status === 200 && /;locked$/.test(r.fitSection || ''), 'locked barrel ' + slug + ': the page knows it is locked', r.fitSection);
    const hasHeading = r.body.includes('<div class="section-title">Slides this barrel fits</div>');
    const listedLine = r.body.includes('<div class="fit-lock">Only these slides &mdash; the maker says this barrel should not be used in any other slide.</div>');
    const noneLine = /<div class="fit-lock">Only for specific [^<]*slides &mdash; the maker says this barrel should not be used in any other slide\.<\/div>/.test(r.body);
    const shown = listed(r.body, 'slides');
    ok(hasHeading && (shown.length ? listedLine : noneLine), 'locked barrel ' + slug + ': heading and warning always served',
      shown.length ? shown.length + ' listed' : 'none listed');
    ok(shown.every((s) => fitsFor.has(s)), 'locked barrel ' + slug + ': every slide listed is a "fits" pair, none blocked',
      shown.filter((s) => !fitsFor.has(s)).join(', ') || 'ok');
  }

  // A live slide whose maker says no to threaded barrels lists none.
  const noThread = await rest('slide_specs?threaded_barrel_ok=is.false&select=' +
    encodeURIComponent('p:products!slide_specs_product_id_fkey!inner(slug,is_discontinued)') + '&p.is_discontinued=is.false&limit=1');
  if (Array.isArray(noThread) && noThread.length) {
    const slug = noThread[0].p.slug;
    const r = await get('/parts/slides/' + slug);
    note('x-fit-section on /parts/slides/' + slug, r.fitSection);
    ok(r.status === 200 && /^listed:\d+$/.test(r.fitSection || ''), 'slide that takes no threaded barrel: the fit section was read', r.fitSection);
    ok(!r.body.includes('<div class="fit-group">Threaded</div>'), 'slide that takes no threaded barrel: lists no threaded barrel', slug);
  } else {
    note('no live slide with threaded_barrel_ok false; thread exclusion not exercised');
  }
}

// ── every build and every hub the sitemap submits is served whole ────────
// Cheap insurance (2026-10-22): on 2026-10-20 cloud fetches saw 404s on
// /p365/ hubs and an empty shell on one /b/ page. That was the durable
// edge cache from #182 warming, not a routing bug — but a crawler that
// is handed a sitemap URL and gets a "—" H1 or a 404 is the exact thing
// the sitemap exists to prevent, so every URL it lists is fetched here.
{
  console.log('\n── every /b/ and /p365/ URL in the sitemap is served whole');
  const SITE = 'https://gunforma.com';
  const locsOf = async (child) => {
    const r = await fetch(origin + child);
    const xml = r.status === 200 ? await r.text() : '';
    ok(r.status === 200, `${child}: 200`, r.status);
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(SITE + '/')).map((u) => u.slice(SITE.length));
  };
  const builds = await locsOf('/sitemap-builds.xml');
  ok(builds.length > 0, '/sitemap-builds.xml lists at least one build', builds.length);
  // The stored descriptions, read with the public key, so "printed exactly
  // once" is judged against what the builder wrote and not against what
  // the page happened to print. Every assertion in this loop runs on the
  // RAW FETCHED HTML (get() is a fetch, never a DOM): crawlers do not
  // hydrate, and a fix that only lands after the page's JS runs is not a
  // fix for them.
  const DESC_BY_ID = await (async () => {
    const res = await fetch(`${SB_URL}/rest/v1/builds?select=id,description&status=eq.approved&limit=1000`,
      { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
    const rows = res.ok ? await res.json() : [];
    return Object.fromEntries((Array.isArray(rows) ? rows : []).map((b) => [b.id, b.description]));
  })();
  const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
  for (const path of builds) {
    const r = await get(path);

    // ── one gun, one name: crumb, kicker and chip say the same model ─────
    // Found on the preview 2026-10-22: a crumb and kicker saying "P365
    // XMacro Comp" over a chip still saying "SIG P365". The chip is the
    // first .build-tag.blue in #build-tags; the kicker's model is its first
    // " · " segment; the crumb's is the span's text with its hub link
    // stripped. All three from the served bytes.
    const crumbModel = stripTags((r.body.match(/<span id="breadcrumb-platform">(.*?)<\/span>/) || ['', ''])[1]);
    const kickerModel = ((r.body.match(/<div class="build-kicker" id="build-kicker">([^<]*)<\/div>/) || ['', ''])[1]).split(' · ')[0];
    const chipModel = (r.body.match(/<div class="build-tags" id="build-tags"><span class="build-tag blue">([^<]*)<\/span>/) || ['', ''])[1];
    ok(crumbModel && crumbModel === kickerModel && kickerModel === chipModel,
       `${path}: crumb, kicker and chip name the same model (served HTML)`,
       `crumb=${JSON.stringify(crumbModel)} kicker=${JSON.stringify(kickerModel)} chip=${JSON.stringify(chipModel)}`);

    // ── the builder's description prints exactly once ────────────────────
    // Found on the same walk: the answer block quoted it and the description
    // line printed it again. Judged against the STORED text (DESC_BY_ID),
    // escaped the way the server escapes it. A description shorter than 15
    // characters can legitimately recur as a part's words, so for those
    // the assertion is "at least once, in its own line" and the count is
    // noted rather than failed.
    const id = (path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i) || [])[1];
    const stored = (id && DESC_BY_ID[id] ? String(DESC_BY_ID[id]) : '').trim();
    if (stored) {
      const needle = escHtml(stored).replace(/\s+/g, ' ');
      const occurrences = r.body.replace(/\s+/g, ' ').split(needle).length - 1;
      const inOwnLine = r.body.replace(/\s+/g, ' ').includes('<div class="build-desc" id="build-desc">' + needle + '</div>');
      if (stored.length >= 15) {
        ok(occurrences === 1 && inOwnLine, `${path}: the builder's description appears exactly once, in its own line (served HTML)`,
           `${occurrences} occurrence(s)`);
      } else {
        ok(occurrences >= 1 && inOwnLine, `${path}: the builder's short description is in its own line (served HTML)`,
           `${occurrences} occurrence(s) of ${JSON.stringify(stored)}`);
      }
      ok(!r.body.includes('The builder says:'), `${path}: the answer block does not quote the description`);
    } else {
      note(`${path}: no description stored — nothing to print once`);
    }
    const h1 = (r.body.match(/<h1 class="build-title" id="build-title">([^<]*)<\/h1>/) || [])[1];
    ok(r.status === 200 && h1 !== undefined && h1 !== '—' && h1.trim() !== '',
       `${path}: 200 with a real H1`, `${r.status} h1=${JSON.stringify(h1)}`);
    // The model crumb and the kicker are server-rendered on every build —
    // not the "—" placeholder, not an empty element — and no photo on the
    // page ships an empty alt.
    const crumb = (r.body.match(/<span id="breadcrumb-platform">(.*?)<\/span>/) || [])[1];
    ok(crumb && crumb !== '—', `${path}: model crumb server-rendered`, crumb);
    const kicker = (r.body.match(/<div class="build-kicker" id="build-kicker">([^<]*)<\/div>/) || [])[1];
    ok(kicker && kicker.length > 0, `${path}: kicker server-rendered`, kicker);
    const answer = (r.body.match(/<p class="build-answer" id="build-answer">([^<]*)<\/p>/) || [])[1];
    ok(answer && answer.length > 0, `${path}: answer block server-rendered`, (answer || '').slice(0, 60));
    const photoAlts = [...r.body.matchAll(/<div class="build-hero"[\s\S]*?<\/div>|<div class="build-gallery"[\s\S]*?<\/div>/g)]
      .flatMap((m) => [...m[0].matchAll(/<img[^>]*alt="([^"]*)"/g)].map((a) => a[1]));
    ok(photoAlts.every((a) => a.trim().length > 0), `${path}: no build photo with an empty alt`, photoAlts.length + ' photo alt(s)');
    const title = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    ok(/ build: | build — by | build \| Gunforma$|FCU build/.test(title), `${path}: title opens with the model`, title.slice(0, 80));
    ok(r.body.includes('"@type":"BreadcrumbList"'), `${path}: BreadcrumbList in the JSON-LD`);
  }
  const hubs = await locsOf('/sitemap-hubs.xml');
  ok(hubs.length > 0, '/sitemap-hubs.xml lists at least one hub', hubs.length);
  for (const path of hubs) {
    const r = await get(path);
    ok(r.status === 200, `${path}: 200`, r.status);
  }
}

// ── builds are linked from the front door: /, the gallery, the hubs ──────
// Measured 2026-10-22: the homepage's raw HTML held zero /b/ links and the
// gallery served "Loading builds…"; every build page was an orphan reachable
// only through the sitemap. home-page.mjs and builds-page.mjs now render
// the newest approved builds into both, and a hub lists the builds recorded
// as its model. Each function says what it served in a header; the body is
// held to it, so a header saying 9 over a page with no card fails.
{
  console.log('\n── builds linked from /, the gallery and the hubs');
  const approvedCount = await (async () => {
    const res = await fetch(`${SB_URL}/rest/v1/builds?select=id&status=eq.approved&limit=1000`,
      { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
    const rows = res.ok ? await res.json() : null;
    return Array.isArray(rows) ? rows.length : null;
  })();
  note('approved builds', approvedCount);
  const bLinks = (body) => [...new Set([...body.matchAll(/href="(\/b\/[^"]+)"/g)].map((m) => m[1]))];

  const home = await fetch(origin + '/');
  const homeBody = await home.text();
  const homeServed = home.headers.get('x-home-builds');
  ok(home.status === 200, '/: 200', home.status);
  ok(homeServed !== null && homeServed !== 'static', '/: served by home-page.mjs with builds rendered in', homeServed);
  const homeLinks = bLinks(homeBody);
  ok(homeLinks.length === Math.min(Number(homeServed) || 0, approvedCount ?? Infinity) && homeLinks.length > 0,
     '/: one /b/ link per served build', `${homeLinks.length} links, header ${homeServed}`);
  ok(homeBody.includes('id="featured-builds" data-server="'), '/: the featured row is marked server-rendered');
  const counts = home.headers.get('x-home-counts');
  note('x-home-counts', counts);
  ok(counts && counts !== 'static' && !/<span class="hero-stat-num" id="stat-parts">—<\/span>/.test(homeBody),
     '/: hero counts server-rendered, not dashes', counts);
  ok(!homeBody.includes('Platform roadmap') && !/\bGlock\b/.test(homeBody), '/: no platform roadmap');
  ok(/<meta name="description" content="Real SIG P365 builds from owners, with exact parts, fitment and live prices\." \/>/.test(homeBody),
     '/: meta description is the owners-builds line');

  const gal = await fetch(origin + '/gunforma-builds.html');
  const galBody = await gal.text();
  const galServed = gal.headers.get('x-builds-page');
  ok(gal.status === 200, '/gunforma-builds.html: 200', gal.status);
  ok(galServed !== null && galServed !== 'static', '/gunforma-builds.html: served by builds-page.mjs with builds rendered in', galServed);
  const galLinks = bLinks(galBody);
  ok(galLinks.length === (Number(galServed) || 0) && galLinks.length > 0,
     '/gunforma-builds.html: one /b/ link per served build', `${galLinks.length} links, header ${galServed}`);
  ok(!galBody.includes('<div class="loading">Loading builds…</div>'), '/gunforma-builds.html: no "Loading builds…" shell');

  // ── one build, one total ─────────────────────────────────────────────
  // The gallery card, the homepage card and the build page's kicker all
  // print priceTotal() from _build-cards.mjs. Found on the preview
  // 2026-10-22: the cards summed MSRPs ("~$1176") while the kicker used the
  // catalog's price rules ("$1,017"), and the same build showed two
  // figures. Held on the wire: the card's text IS the kicker's figure (or
  // the card says "—" / parts and the kicker carries no figure).
  const kickerTotal = (body) => {
    const k = (body.match(/<div class="build-kicker" id="build-kicker">([^<]*)<\/div>/) || ['', ''])[1];
    const m = k.match(/(\$[\d,]+\+?) at today/);
    return m ? m[1] : null;
  };
  const galCards = [...galBody.matchAll(/<a class="build-card" href="(\/b\/[^"]+)">[\s\S]*?<div class="build-card-total">([^<]*)<\/div>/g)]
    .map((m) => ({ path: m[1], total: m[2] === '—' ? null : m[2] }));
  const homeCards = [...homeBody.matchAll(/<a href="(\/b\/[^"]+)" style="[^"]*"><div class="build-card">[\s\S]*?<span class="build-price">([^<]*)<\/span>/g)]
    .map((m) => ({ path: m[1], total: (m[2].match(/^(\$[\d,]+\+?) today$/) || [])[1] || null }));
  ok(galCards.length === galLinks.length, '/gunforma-builds.html: every served card carries a total cell', galCards.length);
  for (const c of galCards) {
    const r = await get(c.path);
    const kt = kickerTotal(r.body);
    ok(r.status === 200 && kt === c.total, `  ${c.path}: gallery card total equals the page kicker`, `card ${c.total} / kicker ${kt}`);
    const hc = homeCards.find((h) => h.path === c.path);
    if (hc) ok(hc.total === kt, `  ${c.path}: homepage card total equals the page kicker`, `card ${hc.total} / kicker ${kt}`);
  }

  // Every hub: the header's count and the body agree, and each card's
  // build answers 200.
  const { GUN_HUBS, hubPath } = await import('../netlify/functions/_guide-meta.mjs');
  let hubsWithBuilds = 0;
  for (const h of GUN_HUBS) {
    const res = await fetch(origin + hubPath(h.gun));
    const body = await res.text();
    const n = Number(res.headers.get('x-gun-hub-builds') || 0);
    const cards = (body.match(/class="bcard"/g) || []).length;
    ok(res.status === 200 && cards === n, `${hubPath(h.gun)}: owner-build cards match x-gun-hub-builds`, `${cards} cards, header ${n}`);
    if (n > 0) {
      hubsWithBuilds++;
      ok(body.includes('id="builds"'), `${hubPath(h.gun)}: owner builds section served`);
      const first = bLinks(body.slice(body.indexOf('id="builds"')))[0];
      const br = await get(first);
      ok(br.status === 200, `${hubPath(h.gun)}: first owner build ${first} answers 200`, br.status);
    }
  }
  note('hubs with owner builds', hubsWithBuilds);
}

// ── internal links say .html on the wire, on static pages too ────────────
// Netlify's Pretty URLs post-processing rewrote every href="x.html" in the
// STATIC pages to href='/x' on the wire — so the homepage linked
// /gunforma-builds while the function-rendered pages linked
// /gunforma-builds.html, and with the one-URL rules above the bare form is
// a 301 hop on every nav click. netlify.toml turns it off
// ([build.processing.html] pretty_urls = false); this is the wire half.
{
  console.log('\n── static pages serve .html links (Pretty URLs off)');
  for (const p of ['/', '/gunforma-builds.html', '/gunforma-parts-catalog.html', '/field-notes.html']) {
    const r = await get(p);
    const bare = (r.body.match(/href=['"]\/gunforma-(?:builds|parts-catalog|legal|signin|post-build)['"]/g) || []).length;
    ok(r.status === 200 && bare === 0, `${p}: no bare /gunforma-* link in the served HTML`, bare + ' bare link(s)');
    ok(r.body.includes('href="gunforma-parts-catalog.html"') || r.body.includes('href="/gunforma-parts-catalog.html"'),
       `${p}: Parts Catalog link is the .html form`);
  }
}

// ── /llms.txt: present, plain text, every URL in it answers 200 ──────────
{
  console.log('\n── /llms.txt');
  const r = await fetch(origin + '/llms.txt');
  const body = r.status === 200 ? await r.text() : '';
  ok(r.status === 200, '/llms.txt: 200', r.status);
  ok(/^text\/plain/.test(r.headers.get('content-type') || ''), '/llms.txt: text/plain', r.headers.get('content-type'));
  ok(body.startsWith('# Gunforma'), '/llms.txt: opens with the site name');
  const urls = [...new Set([...body.matchAll(/https:\/\/gunforma\.com[^\s)]*/g)].map((m) => m[0].replace(/[.,]$/, '')))];
  ok(urls.length >= 10, '/llms.txt: names at least ten site URLs', urls.length);
  for (const u of urls) {
    const path = u.slice('https://gunforma.com'.length).split('#')[0];
    const res = await fetch(origin + path, { redirect: 'manual' });
    ok(res.status === 200, `  ${path}: 200`, res.status);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
