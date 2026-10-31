// sitemap — /sitemap.xml, a sitemap INDEX, plus one typed child per page
// type, all generated from the database.
// -----------------------------------------------------------------------------
// It used to be a static file: 231 product pages and 10 static pages, hand
// maintained. It listed no builds and no profiles, so the only content unique
// to this site was never submitted to anyone. A builder's build page is the
// thing worth indexing here, and Google was never told one existed.
//
// WHY AN INDEX (2026-10-20). Search Console reports indexing PER SITEMAP, and
// one flat sitemap of 319 URLs says "113 indexed, 182 not" with nothing to
// say which page type is the problem. Split by type, the Sitemaps report
// answers that on its own:
//
//   /sitemap.xml            the index — the URL Search Console already holds,
//                           so nothing has to be resubmitted
//   /sitemap-static.xml     the hand-written pages (home, gallery, catalog,
//                           /parts, legal …)
//   /sitemap-hubs.xml       /p365/ and every declared gun hub
//   /sitemap-fit.xml        every declared /fit/ guide
//   /sitemap-builds.xml     every approved build, /b/<slug>-<uuid>
//   /sitemap-profiles.xml   every profile with at least one approved build
//   /sitemap-parts.xml      every live /parts/<category>/<slug>
//
//   /sitemap-field-notes.xml  every live /field-notes/<slug> — present only
//                           once the registry holds a live article (an
//                           empty child is a sitemap that says nothing)
//
// field-notes.html itself is a static page and lives in sitemap-static.xml.
//
// THE URL SET IS THE SAME SET. The union of the children is exactly what the
// flat sitemap listed; nothing was added or dropped by the split, and
// scripts/check-sitemap.mjs asserts the union against the pinned baseline.
//
// LASTMOD IS THE ROW'S OWN DATE, NEVER THE REQUEST TIME. A lastmod that is
// always "now" tells a crawler every page changed every day, which is the
// same as telling it nothing — and it teaches it to ignore the field.
//   parts     products.updated_at
//   builds    builds.updated_at
//   profiles  the newest of that profile's approved builds
//   fit       the registry's editorial `updated` (live data needs no bump)
//   hubs      the latest change among the hub and its fit rows
//   static    none — a hand-written file has no date the server can read
// Each <sitemap> in the index carries the newest lastmod of its child.
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
// A PARTIAL SITEMAP IS A REGRESSION, SO FAILURE IS A 503.
// If a query fails this returns 5xx rather than a sitemap with a section
// missing. A crawler keeps the last good sitemap on a 5xx; it acts on a 200,
// and a 200 that has quietly dropped 231 product URLs is how you deindex a
// catalogue without anything failing. Same reasoning as parts-index.mjs
// paginating instead of trusting PostgREST's row cap.
// -----------------------------------------------------------------------------

import { CATEGORY_META } from './_category-meta.mjs';
import { PART_REDIRECTS } from './_part-redirects.mjs';
import { buildUrl } from './_build-url.mjs';
// Guide URLS COME FROM THE SAME REGISTRY guide-page.mjs SERVES — same
// principle as buildUrl() above: the sitemap and the page's canonical are
// derived from one module, so they cannot disagree by construction. A page
// is listed exactly when guide-page.mjs would render it, and its lastmod is
// the registry's `updated`, which is when its reviewed prose last changed
// (live prices don't move lastmod; they are live on every fetch).
import { GUIDE_PAGES, guidePath, GUN_HUBS, hubPath, HUB_INDEX_PATH, guidePagesForGun } from './_guide-meta.mjs';
import { CDN_CACHE_NO_STORE } from './_cache.mjs';
// Article URLs come from the registry field-note.mjs serves, same principle
// as GUIDE_PAGES above: listed exactly when the function would render
// them, drafts never, lastmod the registry's editorial `updated`.
import { liveFieldNotes, fieldNotePath } from './_field-notes-meta.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE = 'https://gunforma.com';

// The pages that are pages, not rows: the content pages. The four legal
// pages (gunforma-legal, privacy-policy, terms-of-service,
// builder-agreement) were listed until 2026-10-22 and are not any more —
// they are reachable from every footer, they are not what anyone searches
// this site for, and a sitemap is a statement of what we want indexed, not
// of what exists. They stay indexable (no noindex, no 301); they are simply
// not submitted. scripts/check-sitemap.mjs lists them under RETIRED.
const STATIC_PATHS = [
  '/',
  '/gunforma-builds.html',
  '/gunforma-parts-catalog.html',
  // Back in the sitemap 2026-10-30 (Armory launch: noindex lifted, out of
  // RETIRED in check-sitemap.mjs). gunforma-gun-guides.html is NOT listed:
  // still noindex, launching on Alex's own go.
  '/gunforma-armory.html',
  '/parts',
  '/field-notes.html',
];

// The children, in the order the index lists them. The key is the path
// segment: /sitemap-<key>.xml. check-sitemap.mjs holds every URL in a child
// to that child's prefix test, so a URL cannot be filed under the wrong type.
// 'field-notes' appears only while the registry holds a live article: an
// empty child is a sitemap that says nothing, and check-sitemap.mjs refuses
// an empty one. The list is computed at module load, so it is one fact
// here and in the guard that imports it.
export const SITEMAP_CHILDREN = ['static', 'hubs', 'fit',
  ...(liveFieldNotes().length ? ['field-notes'] : []),
  'builds', 'profiles', 'parts'];

export function childPath(key) {
  return '/sitemap-' + key + '.xml';
}

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

// The newest of a list of lastmods, compared as instants (a bare YYYY-MM-DD
// and a full timestamp can sit in one list). Null when none.
function newest(list) {
  let best = null;
  for (const v of list) {
    if (!v) continue;
    if (!best || Date.parse(v) > Date.parse(best)) best = v;
  }
  return best;
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

// ── the children ─────────────────────────────────────────────────────────
function staticUrls() {
  // No lastmod: a hand-written file has no date the server can read, and
  // inventing one (the deploy time, the request time) is the lie this file's
  // header rules out.
  return STATIC_PATHS.map((p) => ({ loc: SITE + (p === '/' ? '/' : p) }));
}

function hubUrls() {
  // A hub's lastmod is the latest change among the hub itself and the fit
  // rows it lists — a fit page's prose changing changes the hub that links
  // to it. The index page moves with the newest hub.
  const hubs = GUN_HUBS.map((h) => ({
    loc: SITE + hubPath(h.gun),
    lastmod: newest([h.updated, ...guidePagesForGun(h.gun).map((g) => g.updated)]),
  }));
  return [{ loc: SITE + HUB_INDEX_PATH, lastmod: newest(hubs.map((h) => h.lastmod)) }, ...hubs];
}

function fitUrls() {
  return GUIDE_PAGES.map((g) => ({ loc: SITE + guidePath(g.family, g.gun), lastmod: g.updated }));
}

function fieldNoteUrls() {
  return liveFieldNotes().map((a) => ({ loc: SITE + fieldNotePath(a.slug), lastmod: a.updated || a.published }));
}

async function productUrls() {
  const rows = await pgAll((limit, offset) =>
    'products?select=' + encodeURIComponent('slug,category,updated_at') +
    // Discontinued parts INCLUDED (Alex, 2026-10-30): the page stays live —
    // "Discontinued", with the maker's successor or similar parts — and it
    // keeps its search traffic. What stays out is an address that 301s
    // (PART_REDIRECTS): a sitemap must not list a URL that redirects.
    '&order=name.asc&limit=' + limit + '&offset=' + offset);
  const out = [];
  for (const p of rows) {
    if (!p.slug) continue;                       // unlinked product, same as the catalog
    const meta = CATEGORY_META[p.category];
    if (!meta) continue;                         // category this map doesn't know — see CLAUDE.md
    const path = '/parts/' + meta[0] + '/' + p.slug;
    if (PART_REDIRECTS.has(path)) continue;      // a merged or never-real row; its address 301s
    out.push({ loc: SITE + path, lastmod: lastmod(p.updated_at) });
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

// One child's entries. Only the queries that child needs run, so a crawler
// fetching sitemap-fit.xml does not wait on the products table.
async function childEntries(key) {
  switch (key) {
    case 'static':   return staticUrls();
    case 'hubs':     return hubUrls();
    case 'fit':      return fitUrls();
    case 'field-notes': return fieldNoteUrls();
    case 'parts':    return productUrls();
    case 'builds':   return (await buildAndProfileUrls()).builds;
    case 'profiles': return (await buildAndProfileUrls()).profiles;
    default:         return null;
  }
}

// ── XML ──────────────────────────────────────────────────────────────────
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

function urlsetXml(entries) {
  const body = entries.map((e) =>
    '  <url><loc>' + esc(e.loc) + '</loc>' +
    (e.lastmod ? '<lastmod>' + esc(e.lastmod) + '</lastmod>' : '') +
    '</url>'
  ).join('\n');
  return XML_HEAD + '<urlset xmlns="' + NS + '">\n' + body + '\n</urlset>\n';
}

function indexXml(children) {
  const body = children.map((c) =>
    '  <sitemap><loc>' + esc(c.loc) + '</loc>' +
    (c.lastmod ? '<lastmod>' + esc(c.lastmod) + '</lastmod>' : '') +
    '</sitemap>'
  ).join('\n');
  return XML_HEAD + '<sitemapindex xmlns="' + NS + '">\n' + body + '\n</sitemapindex>\n';
}

// ── routing ──────────────────────────────────────────────────────────────
// A function receives the ORIGINAL request URL (CLAUDE.md, "Netlify
// redirects"), so the pathname says which document was asked for. The
// ?child= query is what `netlify dev` substitutes; production does not, and
// the pathname is read first either way.
function whichDocument(req) {
  const url = new URL(req.url);
  if (/^\/sitemap\.xml$/.test(url.pathname)) return { index: true };
  const m = url.pathname.match(/^\/sitemap-([a-z-]+)\.xml$/) ||
            ('/' + (url.searchParams.get('child') || '')).match(/^\/([a-z-]+)(?:\.xml)?$/);
  if (m && SITEMAP_CHILDREN.includes(m[1])) return { index: false, key: m[1] };
  return null;
}

function xmlResponse(xml, extra) {
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // It changes when a build is approved, not per request. An hour at the
      // edge is well inside how often a crawler refetches a sitemap.
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
      ...extra,
    },
  });
}

function failed(err) {
  console.error('[sitemap] generation failed', err);
  // Deliberately not a partial sitemap — see the header. Never cached.
  return new Response('sitemap temporarily unavailable\n', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
               'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE, 'Retry-After': '60' },
  });
}

export default async (req) => {
  const doc = whichDocument(req);
  if (!doc) {
    return new Response('no such sitemap\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
                 'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE },
    });
  }

  if (!doc.index) {
    let entries;
    try { entries = await childEntries(doc.key); }
    catch (err) { return failed(err); }
    return xmlResponse(urlsetXml(entries), {
      // Same reasoning as build-og's x-build-og-* headers: make the thing
      // observable from outside instead of inferable from behaviour.
      'x-sitemap': doc.key,
      'x-sitemap-urls': String(entries.length),
    });
  }

  // The index. It carries each child's newest lastmod, so it needs the same
  // data the children do — one pass, and a failure anywhere is a 503 for the
  // whole index rather than an index pointing at a child that will 503.
  let children;
  try {
    const [products, { builds, profiles }] = await Promise.all([productUrls(), buildAndProfileUrls()]);
    const sets = { static: staticUrls(), hubs: hubUrls(), fit: fitUrls(), 'field-notes': fieldNoteUrls(), builds, profiles, parts: products };
    children = SITEMAP_CHILDREN.map((key) => ({
      key,
      loc: SITE + childPath(key),
      lastmod: newest(sets[key].map((e) => e.lastmod)),
      count: sets[key].length,
    }));
  } catch (err) {
    return failed(err);
  }

  return xmlResponse(indexXml(children), {
    'x-sitemap': 'index',
    'x-sitemap-children': String(children.length),
    'x-sitemap-urls': String(children.reduce((n, c) => n + c.count, 0)),
  });
};
