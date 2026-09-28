// build-og — server-renders OG/Twitter meta for /b/:id
// -----------------------------------------------------------------------------
// Crawlers (Facebook, X, Slack, iMessage, LinkedIn) do not run JavaScript, so
// a shared build link currently previews as a bare URL — no title, no image.
// That matters more than it sounds: sharing the build page IS the value for a
// builder, and we are about to invite ~20 of them.
//
// Direct sibling of profile-og.mjs, deliberately: same shape, same failure
// modes, same conventions. This sits in front of /b/:id, confirms the build is
// visible, and returns the SAME gunforma-build-detail.html with meta injected
// into <head>. The page's own JS hydrates as normal — no redirect, no flash,
// so /b/:id is the real canonical URL.
//
// ONLY APPROVED BUILDS GET A PREVIEW. Two independent mechanisms, because this
// one leaks photos of private drafts if it is wrong:
//   1. RLS. The anon key can only see rows the "Public can view approved
//      builds" policy allows (status = 'approved'), and build_photos has the
//      matching "Public can view photos of approved builds". A draft or
//      pending build returns [] to this function, exactly as it does to the
//      browser. Verified against the live API before this was written.
//   2. An explicit status=eq.approved filter below. Redundant with RLS on
//      purpose — if a policy is ever loosened, the leak does not start here.
// An unapproved or unknown id gets a genuine 404, never a soft one.
//
// Deliberately dependency-free — a plain fetch against PostgREST rather than
// @supabase/supabase-js, so there is no package.json, no install step, and
// nothing to bundle. The anon key is the same public key already shipped in
// js/supabase-client.js; this function holds no secrets.
//
// Routing lives in netlify.toml ([[redirects]] /b/* -> here with ?id=:splat).
// -----------------------------------------------------------------------------
import { readFile } from 'node:fs/promises';
import { buildUrl, buildIdFromPath } from './_build-url.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE       = 'https://gunforma.com';
const OG_DEFAULT = SITE + '/og-default.png';
const PHOTO_BASE = SB_URL + '/storage/v1/object/public/build-photos/';

// Builds are keyed by uuid. Anything that is not one 404s without a DB round
// trip, which is also what keeps path input out of the PostgREST query.
// buildIdFromPath in _build-url.mjs does the matching now — it takes the LAST
// 8-4-4-4-12 group, so /b/<uuid> and /b/<slug>-<uuid> both resolve and a slug
// full of hyphens (they all are) cannot be mistaken for the id.

const PAGE_CANDIDATES = [
  'gunforma-build-detail.html',
  './gunforma-build-detail.html',
  new URL('../../gunforma-build-detail.html', import.meta.url),
];

let cachedPage = null;
async function loadPage() {
  if (cachedPage) return cachedPage;
  for (const candidate of PAGE_CANDIDATES) {
    try {
      cachedPage = await readFile(candidate, 'utf8');
      return cachedPage;
    } catch { /* try next */ }
  }
  return null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// One line, no markup, no newlines — a description is an attribute value.
function clamp(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function buildTitle(build) {
  const platform = build.platforms && build.platforms.name;
  const name     = (build.name || '').trim() || 'Untitled build';
  // "P365 EDC Carry — SIG P365 build on Gunforma". Platform is dropped when
  // the name already carries it, so we don't ship "P365 EDC Carry — SIG P365".
  const nameHasPlatform = platform &&
    name.toLowerCase().includes(platform.toLowerCase().replace(/^sig\s+/i, ''));
  return nameHasPlatform || !platform
    ? name + ' on Gunforma'
    : name + ' — ' + platform + ' build on Gunforma';
}

function buildDescription(build) {
  // The builder's own words win when they wrote any.
  const own = clamp(build.description, 160);
  if (own) return own;

  // Otherwise a generated summary — still specific enough to be worth reading
  // in a preview card, and never an empty description tag.
  const platform = (build.platforms && build.platforms.name) || 'Custom';
  const parts    = Array.isArray(build.parts_snapshot) ? build.parts_snapshot.length : 0;
  const by       = build.profiles && build.profiles.username;
  const partsTxt = parts === 1 ? '1 part' : parts + ' parts';
  return platform + ' build with ' + partsTxt + (by ? ', by ' + by : '') + '.';
}

// Hero photo, full size — a preview card wants the big image, not the thumb.
// Falls back to any photo, then to the site default, so a build with no photo
// still previews as something rather than nothing.
function buildImage(build) {
  const photos = Array.isArray(build.build_photos) ? build.build_photos : [];
  if (!photos.length) return OG_DEFAULT;
  const hero = photos.find((p) => p.is_hero) ||
               photos.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  const path = hero && (hero.storage_path || hero.thumb_path);
  return path ? PHOTO_BASE + path : OG_DEFAULT;
}

function metaBlock(build) {
  const title = buildTitle(build);
  const desc  = buildDescription(build);
  const image = buildImage(build);
  // The shared builder, not a local string. The page re-emits this exact
  // URL from js/build-url.js once its data loads; if the two ever disagree
  // the build declares two canonicals in one page load. See _build-url.mjs.
  const url   = buildUrl(build.id, build.name);
  return [
    // The page is served at /b/<id> but every script src and nav href in it is
    // root-relative-less ("js/nav.js", "gunforma-builds.html"), which would
    // resolve against /b/ and 404. One base tag fixes all of them, and it
    // lands before any relative URL in the document. Origin-relative, not
    // absolute, so deploy previews and netlify dev resolve to themselves.
    '<base href="/"/>',
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(desc) + '"/>',
    '<meta property="og:type" content="article"/>',
    '<meta property="og:site_name" content="Gunforma"/>',
    '<meta property="og:title" content="' + esc(title) + '"/>',
    '<meta property="og:description" content="' + esc(desc) + '"/>',
    '<meta property="og:image" content="' + esc(image) + '"/>',
    '<meta property="og:url" content="' + esc(url) + '"/>',
    '<meta name="twitter:card" content="summary_large_image"/>',
    '<meta name="twitter:title" content="' + esc(title) + '"/>',
    '<meta name="twitter:description" content="' + esc(desc) + '"/>',
    '<meta name="twitter:image" content="' + esc(image) + '"/>',
    '<link rel="canonical" href="' + esc(url) + '"/>',
  ].join('\n');
}

function notFound() {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Build not found — Gunforma</title>' +
    '<meta name="robots" content="noindex"/>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
    'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
    '</head><body><div><div style="font-size:20px;font-weight:700">Build not found</div>' +
    '<div class="s">This build does not exist, or it has not been published yet.</div>' +
    '<a href="' + SITE + '/gunforma-builds.html">Browse builds &rarr;</a></div></body></html>',
    {
      status: 404,
      headers: {
        'Content-Type':  'text/html; charset=utf-8',
        // Short — a build approved a minute from now shouldn't stay 404. This
        // is the common case here, not an edge one: every build starts
        // pending and becomes shareable the moment it is approved.
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}

// Netlify's production edge does not substitute named params into a rewrite
// target's query string the way `netlify dev` does — the function gets an
// empty param and every build 404s. Rather than depend on one mechanism, read
// whichever source actually carries it.
// Every source here can carry either /b/<uuid> or /b/<slug>-<uuid>, so each
// one goes through buildIdFromPath rather than being treated as an id.
// Returns null when nothing in the request contains a uuid.
function extractId(req) {
  const url = new URL(req.url);

  const fromQuery = url.searchParams.get('id') || url.searchParams.get('splat');
  if (fromQuery) {
    const id = buildIdFromPath(decodeURIComponent(fromQuery));
    if (id) return id;
  }

  const fromPath = buildIdFromPath(decodeURIComponent(url.pathname));
  if (fromPath) return fromPath;

  // Set by Netlify to the pre-rewrite path, QUERY STRING INCLUDED — which is
  // what makes it the reliable source here rather than a backstop. Two rules
  // point at this function and neither can be trusted to deliver the id in
  // the rewrite target:
  //
  //   /b/*                       named :placeholder values are not
  //                              substituted into a rewrite target's query
  //                              string in production, though netlify dev
  //                              does substitute them, which hides it
  //                              locally (see CLAUDE.md, Netlify redirects)
  //   /gunforma-build-detail.html  matches on `query = { id = ":id" }`, and
  //                              a param matched in `from` is not guaranteed
  //                              to survive into the forwarded request
  //
  // So both the path and the query of the ORIGINAL url are searched, in that
  // order: /b/<slug>-<uuid> carries the id in the path, the legacy URL
  // carries it in ?id=.
  const original = req.headers.get('x-nf-original-path') || '';
  if (original) {
    const decoded = decodeURIComponent(original);
    const inPath = buildIdFromPath(decoded);
    if (inPath) return inPath;
    // buildIdFromPath strips ?… before matching, so the query needs its own
    // look — otherwise the legacy shape resolves to nothing here.
    const q = decoded.indexOf('?');
    if (q !== -1) {
      const idParam = new URLSearchParams(decoded.slice(q + 1)).get('id');
      const inQuery = buildIdFromPath(idParam);
      if (inQuery) return inQuery;
    }
  }

  return null;
}

// /b/<slug>-<uuid> is a share URL: a crawler that follows one to a build that
// does not exist should get a real 404, never a soft one, and that is what
// this function has always done.
//
// gunforma-build-detail.html?id=… is not that. It is the legacy URL, nothing
// links to it any more, and before this function sat in front of it a bad or
// missing id rendered the page's own "Build not found" with a 200. Turning
// that into a hard 404 would be a behaviour change to old links for no gain —
// the reason to route this URL through here at all is to strip the id-less
// canonical, not to start refusing it. So on this path a failure serves the
// page unadorned and lets the client render exactly what it rendered before.
//
// No header (a direct function invocation) is treated as the share route, the
// stricter of the two.
function isShareRoute(req) {
  const original = req.headers.get('x-nf-original-path');
  if (!original) return true;
  return original.split('?')[0].startsWith('/b/');
}

// The page exactly as it sits on disk: no meta injected, no canonical
// stripped. What the legacy URL served before this function was in front of
// it. no-store because what it represents is "we could not resolve this
// right now", which must not be cached as an answer.
async function unadorned() {
  const page = await loadPage();
  if (!page) return null;
  return new Response(page, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  const requested = extractId(req);
  const share = isShareRoute(req);

  // No uuid anywhere in the request — no DB round trip, which is also what
  // keeps path input out of the PostgREST query below. A share URL 404s; the
  // legacy URL gets the page, which is what it got before.
  if (!requested) return share ? notFound() : (await unadorned()) || notFound();

  // platforms and profiles each have exactly one FK to builds, so those bare
  // embeds are correct. profiles is named anyway because builds has two FKs
  // to it (user_id and reviewed_by) and a bare embed would be PGRST201.
  const select = [
    'id', 'name', 'description', 'parts_snapshot',
    'platforms(name)',
    'profiles!builds_user_id_fkey(username)',
    'build_photos(storage_path,thumb_path,is_hero,position)',
  ].join(',');

  let build = null;
  try {
    const res = await fetch(
      SB_URL + '/rest/v1/builds?select=' + encodeURIComponent(select) +
      '&limit=1&status=eq.approved&id=eq.' + encodeURIComponent(requested),
      { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } },
    );
    if (!res.ok) throw new Error('PostgREST ' + res.status);
    const rows = await res.json();
    build = Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[build-og] build lookup failed', err);
    // An upstream hiccup is not proof the build is absent — don't cache a 404
    // over it. Hand back the page unadorned and let the client render, which
    // re-runs the same RLS-protected query from the browser.
    const page = await loadPage();
    if (!page) return notFound();
    return new Response(page, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // Unknown, unapproved, or deleted. Same split as above.
  if (!build) return share ? notFound() : (await unadorned()) || notFound();

  const page = await loadPage();
  if (!page) {
    console.error('[build-og] gunforma-build-detail.html not bundled — check included_files');
    // NO auto-refresh here any more. It used to bounce to
    // /gunforma-build-detail.html?id=…, which was fine while that URL served
    // the file directly. It is now rewritten to THIS function, so the refresh
    // would land back here, fail to load the page again, and emit the same
    // refresh — an infinite loop in the reader's browser, on a path that only
    // opens when the deploy is misconfigured.
    //
    // The meta block is what this branch is actually for: a crawler still
    // gets the full preview. A person gets a link they can see, and the error
    // above gets logged, which is the right way for a misconfiguration to
    // behave — visible, not spinning.
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' + metaBlock(build) +
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
      'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
      '</head><body><div><div style="font-size:20px;font-weight:700">' + esc(buildTitle(build)) + '</div>' +
      '<div class="s">This build could not be rendered just now.</div>' +
      '<a href="' + SITE + '/gunforma-builds.html">Browse builds &rarr;</a></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }

  // Swap the static <title> for the generated title + meta. Single anchored
  // replace so a future edit that drops the title fails loudly in testing
  // rather than silently shipping pages with no OG tags.
  //
  // The page also ships a static <link rel="canonical"> for its direct URL
  // (/gunforma-build-detail.html). At /b/:id the injected canonical must win,
  // so strip the static one before appending the meta block.
  //
  // This is an exact-string replace, so a whitespace change to that line in
  // gunforma-build-detail.html makes it a silent no-op and the page ships
  // two canonicals. The page carries a comment saying the same thing on its
  // side; change the two together.
  //
  // That page also sets its canonical from the id at runtime, for the
  // query-string URL. At /b/:id that script finds THIS canonical and writes
  // the same URL over it, so the two must agree byte for byte — metaBlock()
  // builds SITE + '/b/' + encodeURIComponent(id), and so does the page.
  const html = page
    .replace('<link rel="canonical" href="https://gunforma.com/gunforma-build-detail.html" />\n', '')
    .replace('<title>Gunforma build</title>', metaBlock(build));

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  });
};
