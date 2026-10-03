// sitemap — /sitemap.xml, generated from the database.
// -----------------------------------------------------------------------------
// It used to be a static file: 231 product pages and 10 static pages, hand
// maintained. It listed no builds and no profiles, so the only content unique
// to this site was never submitted to anyone. A builder's build page is the
// thing worth indexing here, and Google was never told one existed.
//
// Same conventions as product-page.mjs and parts-index.mjs: dependency-free,
// a plain fetch against PostgREST with the public anon key, no build step, no
// bundler. Absolute https://gunforma.com URLs throughout — see the SEO
// invariants in CLAUDE.md; a sitemap is one of the places a non-apex URL
// would undo canonical-host.js.
//
// BUILD URLS COME FROM buildUrl(), NOT FROM STRING CONCATENATION.
// /b/<slug>-<uuid> is built by netlify/functions/_build-url.mjs, the same
// module build-og.mjs uses for the canonical tag it injects into that page.
// A sitemap that disagreed with the canonical it points at is worse than no
// sitemap — it tells a crawler two URLs for one document and then contradicts
// itself on arrival. Sharing the builder makes that impossible by
// construction rather than by review.
//
// A PARTIAL SITEMAP IS A REGRESSION, SO FAILURE IS A 500.
// If a query fails this returns 5xx rather than a sitemap with a section
// missing. A crawler keeps the last good sitemap on a 5xx; it acts on a 200,
// and a 200 that has quietly dropped 231 product URLs is how you deindex a
// catalogue without anything failing. Same reasoning as parts-index.mjs
// paginating instead of trusting PostgREST's row cap.
// -----------------------------------------------------------------------------

import { CATEGORY_META } from './_category-meta.mjs';
import { buildUrl } from './_build-url.mjs';
// Guide URLS COME FROM THE SAME REGISTRY guide-page.mjs SERVES — same
// principle as buildUrl() above: the sitemap and the page's canonical are
// derived from one module, so they cannot disagree by construction. A page
// is listed exactly when guide-page.mjs would render it, and its lastmod is
// the registry's `updated`, which is when its reviewed prose last changed
// (live prices don't move lastmod; they are live on every fetch).
import { GUIDE_PAGES, guidePath, GUN_HUBS, hubPath, HUB_INDEX_PATH } from './_guide-meta.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE = 'https://gunforma.com';

// The pages that are pages, not rows. Copied verbatim from the static file
// this replaces, in its order — these are what is indexed today and none of
// them may drop out.
const STATIC_PATHS = [
  '/',
  '/gunforma-builds.html',
  '/gunforma-parts-catalog.html',
  '/parts',
  '/field-notes.html',
  '/gunforma-legal.html',
  '/privacy-policy.html',
  '/terms-of-service.html',
  '/builder-agreement.html',
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// W3C datetime. Postgres hands back microseconds, which is valid but noisy;
// seconds is plenty for a lastmod.
function lastmod(ts) {
  if (!ts) return null;
  const s = String(ts).replace(/\.\d+/, '');
  return Number.isNaN(Date.parse(s)) ? null : s;
}

async function pgGet(path) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
  });
  if (!res.ok) throw new Error('PostgREST ' + res.status + ' on ' + path + ': ' + (await res.text()));
  return res.json();
}

// PostgREST caps a response at its configured max-rows and does so SILENTLY —
// a short array, not an error. Every row count here is small today, and
// "small today" is a fact about today; a sitemap's whole job is being
// complete. Page explicitly. (Same note as parts-index.mjs, same reason.)
async function pgAll(build) {
  const PAGE = 500;
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await pgGet(build(PAGE, offset));
    all.push(...page);
    if (page.length < PAGE) break;
    if (offset > 50000) throw new Error('sitemap: pagination exceeded 50k rows');
  }
  return all;
}

async function productUrls() {
  const rows = await pgAll((limit, offset) =>
    'products?select=' + encodeURIComponent('slug,category') +
    '&order=name.asc&limit=' + limit + '&offset=' + offset);
  const out = [];
  for (const p of rows) {
    if (!p.slug) continue;                       // unlinked product, same as the catalog
    const meta = CATEGORY_META[p.category];
    if (!meta) continue;                         // category this map doesn't know — see CLAUDE.md
    out.push({ loc: SITE + '/parts/' + meta[0] + '/' + p.slug });
  }
  return out;
}

async function buildAndProfileUrls() {
  // status=eq.approved is redundant with RLS — the anon key can only see
  // approved builds anyway — and it is here for the same reason build-og.mjs
  // carries it: if a policy is ever loosened, the leak does not start here.
  // An unapproved build must never be submitted to a crawler.
  //
  // The profiles embed is NAMED. builds has two FKs to profiles (user_id and
  // reviewed_by), so a bare profiles(...) embed is PGRST201 and takes the
  // whole query down. See CLAUDE.md.
  const rows = await pgAll((limit, offset) =>
    'builds?select=' + encodeURIComponent('id,name,updated_at,profiles!builds_user_id_fkey(username)') +
    '&status=eq.approved&order=updated_at.desc&limit=' + limit + '&offset=' + offset);

  const builds = [];
  // A profile page with no approved build on it is a thin page, so profiles
  // are derived from the builds themselves rather than listed separately —
  // "has at least one approved build" then holds by construction. lastmod is
  // the most recent of their builds, which is when that page last changed.
  const byUser = new Map();

  for (const b of rows) {
    if (!b.id) continue;
    builds.push({ loc: buildUrl(b.id, b.name), lastmod: lastmod(b.updated_at) });

    const username = b.profiles && b.profiles.username;
    if (!username) continue;                     // unclaimed build — /u/ would 404
    const prev = byUser.get(username);
    const ts = lastmod(b.updated_at);
    if (!prev || (ts && prev < ts)) byUser.set(username, ts);
  }

  const profiles = [...byUser.entries()].map(([username, ts]) => ({
    loc: SITE + '/u/' + encodeURIComponent(username),
    lastmod: ts,
  }));

  return { builds, profiles };
}

function toXml(entries) {
  const body = entries.map((e) =>
    '  <url><loc>' + esc(e.loc) + '</loc>' +
    (e.lastmod ? '<lastmod>' + esc(e.lastmod) + '</lastmod>' : '') +
    '</url>'
  ).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
         '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
         body + '\n</urlset>\n';
}

export default async () => {
  let entries;
  try {
    const [products, { builds, profiles }] = await Promise.all([
      productUrls(),
      buildAndProfileUrls(),
    ]);
    entries = [
      ...STATIC_PATHS.map((p) => ({ loc: SITE + (p === '/' ? '/' : p) })),
      ...GUIDE_PAGES.map((g) => ({ loc: SITE + guidePath(g.family, g.gun), lastmod: g.updated })),
      // Gun hubs and their index. Declared set only, same as the fit
      // pages above — gun-hub.mjs 404s anything not in GUN_HUBS, so
      // emitting a wider set here would list URLs that do not resolve.
      { loc: SITE + HUB_INDEX_PATH, lastmod: GUN_HUBS.map((h) => h.updated).sort().pop() },
      ...GUN_HUBS.map((h) => ({ loc: SITE + hubPath(h.gun), lastmod: h.updated })),
      ...products,
      ...builds,
      ...profiles,
    ];
  } catch (err) {
    console.error('[sitemap] generation failed', err);
    // Deliberately not a partial sitemap — see the header.
    return new Response('sitemap temporarily unavailable\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  return new Response(toXml(entries), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // It changes when a build is approved, not per request. An hour at the
      // edge is well inside how often a crawler refetches a sitemap.
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
      // Same reasoning as build-og's x-build-og-* headers: make the thing
      // observable from outside instead of inferable from behaviour.
      'x-sitemap-urls': String(entries.length),
    },
  });
};
