#!/usr/bin/env node
// check-sitemap.mjs — assert /sitemap.xml, its children and their union
// against a real origin.
//
// THE ASSERTION THAT MATTERS is the last one: every /b/ URL listed must equal
// the canonical that URL actually serves. A sitemap disagreeing with a
// canonical is worse than no sitemap — it hands a crawler two URLs for one
// document and then contradicts itself on arrival. Both sides are built by
// netlify/functions/_build-url.mjs so they cannot drift in the source; this
// checks that claim against what is on the wire, which is the only place it
// is true or false.
//
// The rest guards the regression risk of replacing a hand-maintained file
// with a query: the 241 URLs indexed today must all still be there.
//
// Like check-routes.mjs this cannot be a build check — the site is not
// serving during its own build. It runs from
// .github/workflows/check-routes.yml.
//
//   node scripts/check-sitemap.mjs https://gunforma.com
//   node scripts/check-sitemap.mjs https://deploy-preview-75--velvety-stardust-4de48f.netlify.app
//
// BASELINE. The 241 URLs the static sitemap.xml carried are pinned below
// rather than re-derived, deliberately: a baseline computed from the same
// database the sitemap is computed from would agree with itself no matter
// what broke. These are the paths, with the apex prefixed at compare time so
// a preview can be checked against the URLs production will publish.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const origin = (process.argv[2] || process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!origin) {
  console.error('usage: node scripts/check-sitemap.mjs <origin>');
  process.exit(2);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://gunforma.com';

let failures = 0;
const ok = (c, label, detail) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + label + (detail !== undefined && detail !== '' ? `   [${detail}]` : ''));
  if (!c) failures++;
};
const note = (l, d) => console.log(`   ·  ${l}${d !== undefined ? ': ' + d : ''}`);

console.log(`checking ${origin}/sitemap.xml\n`);

// ── the index, and each child under it ─────────────────────────────────
// /sitemap.xml is a sitemap INDEX since 2026-10-20 (netlify/functions/
// sitemap.mjs): one <sitemap> per page type — static, hubs, fit, builds,
// profiles, parts — so Search Console reports indexing per type. The
// assertions below walk the index, fetch every child it names, check each
// is a well-formed urlset holding only URLs of ITS type, and then run the
// flat-sitemap checks over the UNION, which must still be the whole site.
// A URL under the wrong child, a child the index does not list, or a child
// that 503s while the index says 200, each fails here.
const SITEMAP_NOW = Date.now();
const WELL_FORMED = (xml, root, item, label) => {
  const decl = /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(xml.trim());
  const opens = (xml.match(new RegExp('<' + item + '>', 'g')) || []).length;
  const closes = (xml.match(new RegExp('</' + item + '>', 'g')) || []).length;
  const locs = (xml.match(/<loc>/g) || []).length;
  const bare = (xml.replace(new RegExp('</?(?:\\?xml[^>]*\\?|' + root + '[^>]*|' + item + '|loc|lastmod)>', 'g'), '')
                   .match(/[<>]/g) || []).length;
  ok(decl, `${label}: has an XML declaration`);
  ok(new RegExp('<' + root + ' xmlns="http://www\\.sitemaps\\.org/schemas/sitemap/0\\.9">').test(xml) &&
     new RegExp('</' + root + '>').test(xml), `${label}: <${root}> element with the sitemap namespace`);
  ok(opens === closes && opens === locs, `${label}: every <${item}> is closed and has one <loc>`,
     `${opens} open / ${closes} close / ${locs} loc`);
  ok(bare === 0, `${label}: no unescaped < or > outside the known tags`, bare);
  // lastmod: a valid W3C date, never in the future — and never the request
  // time, which is what "every URL got today's date" looks like on the wire.
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  const badMod = mods.find((m) => Number.isNaN(Date.parse(m)) || Date.parse(m) > SITEMAP_NOW + 60_000);
  ok(!badMod, `${label}: every lastmod parses and is not in the future`, badMod || `${mods.length} lastmod(s)`);
  const fresh = mods.filter((m) => SITEMAP_NOW - Date.parse(m) < 120_000).length;
  ok(fresh === 0, `${label}: no lastmod is the request time`, fresh ? fresh + ' within 2 min of now' : 'none');
};

const res = await fetch(origin + '/sitemap.xml');
const xml = await res.text();
ok(res.status === 200, 'sitemap index returns 200', res.status);
ok(/^application\/xml|^text\/xml/.test(res.headers.get('content-type') || ''),
   'served as XML', res.headers.get('content-type'));
ok(/max-age|s-maxage/.test(res.headers.get('cache-control') || ''),
   'cached — it changes when a build is approved, not per request',
   res.headers.get('cache-control'));
WELL_FORMED(xml, 'sitemapindex', 'sitemap', '/sitemap.xml');
ok(!/<urlset/.test(xml), '/sitemap.xml is an index, not a flat urlset');

const { SITEMAP_CHILDREN, childPath } = await import(join(ROOT, 'netlify/functions/sitemap.mjs'));
const childLocs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(childLocs.join(' ') === SITEMAP_CHILDREN.map((k) => SITE + childPath(k)).join(' '),
   'the index lists exactly the declared children, in order',
   childLocs.map((u) => u.slice(SITE.length)).join(' '));

// What each child may contain: the prefix test for its page type.
const CHILD_RULE = {
  static:   (p) => !/^\/(p365|fit|b|u|parts|field-notes)\//.test(p) || p === '/parts',
  hubs:     (p) => p === '/p365/' || /^\/p365\/[^/]+$/.test(p),
  fit:      (p) => /^\/fit\/p365\/[^/]+\/[^/]+$/.test(p),
  'field-notes': (p) => /^\/field-notes\/[^/]+$/.test(p),
  builds:   (p) => /^\/b\/[^/]+$/.test(p),
  profiles: (p) => /^\/u\/[^/]+$/.test(p),
  parts:    (p) => /^\/parts\/[^/]+\/[^/]+$/.test(p),
};

const locs = [];
const perChild = {};
let claimedTotal = 0;
for (const key of SITEMAP_CHILDREN) {
  const path = childPath(key);
  const cr = await fetch(origin + path);
  const cx = await cr.text();
  ok(cr.status === 200, `${path}: 200`, cr.status);
  ok(/^application\/xml|^text\/xml/.test(cr.headers.get('content-type') || ''), `${path}: served as XML`);
  WELL_FORMED(cx, 'urlset', 'url', path);
  const cl = [...cx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  perChild[key] = cl.length;
  claimedTotal += Number(cr.headers.get('x-sitemap-urls') || 0);
  ok(cl.length > 0, `${path}: not empty`, cl.length + ' urls');
  ok(String(cl.length) === cr.headers.get('x-sitemap-urls'), `${path}: x-sitemap-urls agrees with the body`,
     cr.headers.get('x-sitemap-urls'));
  const stray = cl.filter((u) => !u.startsWith(SITE + '/') || !CHILD_RULE[key](u.slice(SITE.length)));
  ok(stray.length === 0, `${path}: every URL is a ${key} URL`, stray.slice(0, 3).join(', ') || 'all');
  if (key === 'static') {
    const legal = cl.filter((u) => /\/(gunforma-legal|privacy-policy|terms-of-service|builder-agreement)\.html$/.test(u));
    ok(legal.length === 0, `${path}: no legal or app page is submitted`, legal.join(', ') || 'none');
  }
  if (key === 'parts' || key === 'builds' || key === 'profiles') {
    const withMod = (cx.match(/<lastmod>/g) || []).length;
    ok(withMod === cl.length, `${path}: every row-backed URL carries its row's lastmod`, `${withMod} of ${cl.length}`);
  }
  locs.push(...cl);
}
console.log('\n   ·  per child: ' + SITEMAP_CHILDREN.map((k) => `${k}=${perChild[k]}`).join('  ') + `   total=${locs.length}`);
ok(String(locs.length) === res.headers.get('x-sitemap-urls'),
   'the index\'s x-sitemap-urls equals the children\'s total', res.headers.get('x-sitemap-urls'));
ok(new Set(locs).size === locs.length, 'no URL appears in two children (or twice in one)',
   `${locs.length} total, ${new Set(locs).size} unique`);
ok(locs.every((u) => u.startsWith(SITE + '/')), 'every URL is an apex https://gunforma.com URL',
   locs.find((u) => !u.startsWith(SITE + '/')) || 'all');

// ── the 241 that are indexed today ─────────────────────────────────────
// RETIRED. A path here was in the original static sitemap and has been
// deliberately removed since. The baseline file itself is NOT edited: it is
// the pinned record of what was indexed on day one, and editing it to clear a
// failure is indistinguishable from editing it to hide a regression. Removals
// are declared here instead, with the PR that made them, so the reason sits
// where the failure would otherwise appear.
//
// Deleting an entry from this list puts that URL back under the guard — which
// is what should happen when the Armory is un-parked (see claude/loadouts-spec.md).
const RETIRED = new Set([
  // /gunforma-armory.html was here from PR #88 (Armory parked) until
  // 2026-10-30, when the launch lifted its noindex and put it back in
  // sitemap.mjs's STATIC_PATHS — so it is under the guard again.
  // 2026-10-22 — the legal pages are deliberately not submitted: a sitemap
  // says what we want indexed, and nobody searches this site for its terms
  // of service. Still served, still indexable, linked from every footer.
  '/gunforma-legal.html',
  '/privacy-policy.html',
  '/terms-of-service.html',
  '/builder-agreement.html',
  // RAMM merged its comp and non-comp P365 Leverage kits into one product.
  // Both are discontinued and 301 to ramm-tactical-leverage-trigger-p365.
  '/parts/triggers/ramm-tactical-leverage-c-p365',
  '/parts/triggers/ramm-tactical-leverage-nc-p365',
  // (The four lights discontinued on 2026-10-07 — #154 — were here until
  // 2026-10-31. A discontinued part's page is listed again now: it stays
  // live, says "Discontinued" and names the maker's successor or similar
  // parts. CLAUDE.md, "Discontinued parts". The baseline covers them again.)
  // Moved, not discontinued: filed as a basepad before the magazine category
  // existed (supabase/migrations_archive/magazine_category.sql). The sitemap lists it under
  // /parts/magazines/ now, and the old path 301s there (netlify.toml; the
  // pair is asserted in check-routes.mjs).
  '/parts/basepads/tti-xmacro-completed-mag-w-basepad',
  // The 2026-10-20 audit: Sig's P365 manual-safety kit was in the catalog
  // twice. The newer copy (added 2026-10-14, after this baseline was pinned,
  // so this line documents rather than exempts) is discontinued and 301s to
  // /parts/safety-selectors/sig-sauer-manual-safety-kit-p365 (netlify.toml;
  // the pair is asserted in check-routes.mjs).
  '/parts/safety-selectors/sig-sauer-manual-safety-parts-kit-black-p365',
  // Icarus's "311 FUSE SL" was never a product Icarus sold (created here in
  // the 2026-10-01 bulk load, after this baseline, so this line documents).
  // Discontinued 2026-10-22 and 301s to /parts/frames/icarus-precision-311-fuse
  // (netlify.toml; the pair is asserted in check-routes.mjs).
  '/parts/frames/icarus-precision-311-fuse-sl',
]);

const baseline = JSON.parse(await readFile(join(ROOT, 'scripts/sitemap-baseline.json'), 'utf8'))
  .filter((p) => !RETIRED.has(p));
const missing = baseline.filter((p) => !locs.includes(SITE + p));
ok(missing.length === 0, `all ${baseline.length} URLs from the static sitemap are still present (${RETIRED.size} retired)`,
   missing.length ? missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` …(+${missing.length - 5})` : '') : 'none missing');

// ── discontinued parts ─────────────────────────────────────────────────
// Every discontinued part is listed — its page stays live (CLAUDE.md,
// "Discontinued parts") — except a row whose address 301s, which no sitemap
// may list (PART_REDIRECTS, held to netlify.toml by discontinued.test.mjs).
{
  const { PART_REDIRECTS } = await import(join(ROOT, 'netlify/functions/_part-redirects.mjs'));
  const { CATEGORY_META } = await import(join(ROOT, 'netlify/functions/_category-meta.mjs'));
  const SBU = 'https://lagjjcpclvzrjlrswojt.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';
  const r = await fetch(SBU + '/rest/v1/products?select=slug,category&is_discontinued=eq.true',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  const disc = r.ok ? await r.json() : null;
  ok(Array.isArray(disc), 'read the discontinued parts', r.status);
  const paths = (disc || []).filter((p) => p.slug && CATEGORY_META[p.category])
    .map((p) => '/parts/' + CATEGORY_META[p.category][0] + '/' + p.slug);
  const live = paths.filter((p) => !PART_REDIRECTS.has(p));
  const unlisted = live.filter((p) => !locs.includes(SITE + p));
  ok(unlisted.length === 0, `every discontinued part's page is listed (${live.length})`, unlisted.join(', ') || 'all listed');
  const redirected = [...PART_REDIRECTS].filter((p) => locs.includes(SITE + p));
  ok(redirected.length === 0, 'no address that 301s is listed', redirected.join(', ') || 'none');
}

// ── builds ─────────────────────────────────────────────────────────────
const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';
const pg = async (p) => {
  const r = await fetch(SB_URL + '/rest/v1/' + p, { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } });
  if (!r.ok) throw new Error('PostgREST ' + r.status);
  return r.json();
};
const { buildUrl } = await import(join(ROOT, 'netlify/functions/_build-url.mjs'));

const approved = await pg('builds?select=id,name,status,profiles!builds_user_id_fkey(username)&status=eq.approved&limit=1000');
const sitemapBuilds = locs.filter((u) => u.startsWith(SITE + '/b/'));
note('approved builds', approved.length);

ok(sitemapBuilds.length === approved.length,
   'every approved build appears exactly once',
   `${sitemapBuilds.length} in sitemap, ${approved.length} approved`);
for (const b of approved) {
  const want = buildUrl(b.id, b.name);
  ok(sitemapBuilds.filter((u) => u === want).length === 1,
     `  ${b.name || '(unnamed)'} listed once`, want);
}
// An unapproved build must never appear. RLS already hides them from this
// key, so the strongest available check is that no listed uuid is absent
// from the approved set.
const approvedIds = new Set(approved.map((b) => b.id));
const strays = sitemapBuilds.filter((u) => {
  const m = u.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return !m || !approvedIds.has(m[1]);
});
ok(strays.length === 0, 'no listed build is outside the approved set', strays.join(', ') || 'none');

// ── profiles ───────────────────────────────────────────────────────────
const wantUsers = new Set(approved.map((b) => b.profiles && b.profiles.username).filter(Boolean));
const sitemapUsers = locs.filter((u) => u.startsWith(SITE + '/u/'));
ok(sitemapUsers.length === wantUsers.size,
   'one /u/ entry per profile with an approved build — no thin pages',
   `${sitemapUsers.length} in sitemap, ${wantUsers.size} expected`);
for (const u of wantUsers) {
  ok(sitemapUsers.includes(SITE + '/u/' + encodeURIComponent(u)), `  /u/${u} listed`);
}

// ── THE ONE THAT MATTERS ───────────────────────────────────────────────
console.log('\n── every /b/ URL must equal the canonical that URL serves');
for (const loc of sitemapBuilds) {
  const path = loc.slice(SITE.length);
  const r = await fetch(origin + path);
  const body = await r.text();
  const canon = (body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/) || [])[1];
  ok(r.status === 200 && canon === loc,
     `  ${path}`, r.status + ' canonical=' + (canon || 'none'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
