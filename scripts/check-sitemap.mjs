#!/usr/bin/env node
// check-sitemap.mjs — assert /sitemap.xml against a real origin.
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

const res = await fetch(origin + '/sitemap.xml');
const xml = await res.text();
ok(res.status === 200, 'sitemap returns 200', res.status);
ok(/^application\/xml|^text\/xml/.test(res.headers.get('content-type') || ''),
   'served as XML', res.headers.get('content-type'));
ok(/max-age|s-maxage/.test(res.headers.get('cache-control') || ''),
   'cached — it changes when a build is approved, not per request',
   res.headers.get('cache-control'));

// ── parses as XML ──────────────────────────────────────────────────────
// No XML parser in the standard library and this file takes no
// dependencies, so: well-formedness is checked structurally. Mismatched or
// unescaped markup shows up as a tag-balance error here.
{
  const decl = /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(xml.trim());
  const opens = (xml.match(/<url>/g) || []).length;
  const closes = (xml.match(/<\/url>/g) || []).length;
  const locs = (xml.match(/<loc>/g) || []).length;
  const bare = (xml.replace(/<\/?(?:\?xml[^>]*\?|urlset[^>]*|url|loc|lastmod)>/g, '')
                   .match(/[<>]/g) || []).length;
  ok(decl, 'has an XML declaration');
  ok(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(xml) && /<\/urlset>/.test(xml),
     'urlset element with the sitemap namespace');
  ok(opens === closes && opens === locs, 'every <url> is closed and has one <loc>',
     `${opens} open / ${closes} close / ${locs} loc`);
  ok(bare === 0, 'no unescaped < or > outside the known tags', bare);
}

const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
note('urls in sitemap', locs.length);
ok(new Set(locs).size === locs.length, 'no duplicate URLs',
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
  '/gunforma-armory.html',  // PR #88 — Armory parked: no nav, noindex, out of the sitemap
]);

const baseline = JSON.parse(await readFile(join(ROOT, 'scripts/sitemap-baseline.json'), 'utf8'))
  .filter((p) => !RETIRED.has(p));
const missing = baseline.filter((p) => !locs.includes(SITE + p));
ok(missing.length === 0, `all ${baseline.length} URLs from the static sitemap are still present (${RETIRED.size} retired)`,
   missing.length ? missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` …(+${missing.length - 5})` : '') : 'none missing');

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
