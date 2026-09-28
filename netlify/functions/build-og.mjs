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

// The card size every scraper except Twitter picks from the image's ACTUAL
// pixels: roughly 1.91:1 and at least 600px wide gets the full-width card,
// anything portrait or square gets a ~160px thumbnail with text beside it.
// twitter:card=summary_large_image is Twitter-only and does not help Facebook,
// iMessage, Slack or LinkedIn. Build photos come off phones and are mostly
// portrait, so every shared build was rendering as the thumbnail.
//
// One pair of constants because three things have to agree: the transform,
// og:image:width and og:image:height. A declared size that does not match the
// bytes is a worse lie than no declaration.
// 4:3, not 1.91:1. Compared at 630, 800, 900 and 1200 against a real
// portrait hero: 630 crops too hard, 900 keeps 56% of a 1201x1600 frame, and
// 1200 wide still clears every platform's threshold for the large card.
// iMessage and Slack honour the taller ratio; Twitter centre-crops back to
// 1.91:1, which is no worse than it was.
//
// Exported so scripts/check-og-image.mjs asserts THESE numbers rather than a
// hardcoded pair of its own — a check with its own copy of the expected size
// fails on correct output the day this changes, which is the failure mode
// that makes people delete checks.
export const OG_W = 1200;
export const OG_H = 900;

// og-default.png's real size. It is a designed 1200x630 graphic served
// unmodified, and the meta tags say so when it is the card — see buildImage.
export const OG_DEFAULT_W = 1200;
export const OG_DEFAULT_H = 630;

// Netlify Image CDN. The source host is allowlisted in netlify.toml under
// [images] — scoped to the build-photos object path, not the whole Supabase
// host. Absolute apex URL, per the SEO invariants in CLAUDE.md: og:image is
// one of the places a non-apex URL would undo canonical-host.js.
//
// NOTE FOR PREVIEWS: this points at gunforma.com even when served from a
// deploy preview, which is correct — but it means the transform a preview
// emits is executed by PRODUCTION. To check a preview's own transform, swap
// the origin. scripts/check-og-image.mjs does exactly that.
function ogTransform(sourceUrl, fit = 'cover') {
  return SITE + '/.netlify/images?url=' + encodeURIComponent(sourceUrl) +
         '&w=' + OG_W + '&h=' + OG_H + '&fit=' + fit;
}

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
// The hero photo's own URL, or null when there isn't one.
//
// storage_path ONLY — thumb_path is deliberately not a fallback any more.
// Measured: storage_path images are up to 1600px on the long edge (1201x1600
// for the portrait hero used in testing), thumb_path images are capped at 480
// (360x480 for the same photo). Feeding a 480px thumb to w=1200 upscales it
// 3.3x, and a blurry card is worse than the thumbnail card this change
// exists to fix. og-default.png is 1200x630 and sharp, so falling through to
// it is strictly better than upscaling.
//
// Not a live branch either way: no build_photos row has a null storage_path,
// and processFile in js/photos.js uploads the display copy before it writes
// the row. This is about what happens if that ever stops being true.
function heroPhotoUrl(build) {
  const photos = Array.isArray(build.build_photos) ? build.build_photos : [];
  if (!photos.length) return null;
  const hero = photos.find((p) => p.is_hero) ||
               photos.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  return hero && hero.storage_path ? PHOTO_BASE + hero.storage_path : null;
}

// The card image AND its true dimensions, together, because they must not be
// able to disagree.
//
// og-default.png stays 1200x630 and stays untransformed. The alternatives
// were worse: regenerating it at 1200x900 means redrawing a designed graphic,
// and routing it through the transform would upscale a 1200-wide source and
// crop 270px off a composition with a logo in it. Leaving the asset alone
// only created a problem while the meta tags were hardcoded — so the tags
// follow the image instead. A declared size the bytes do not have is the one
// thing this whole change is trying not to ship.
function buildImage(build) {
  const photo = heroPhotoUrl(build);
  return photo
    ? { url: ogTransform(photo), w: OG_W,         h: OG_H }
    : { url: OG_DEFAULT,         w: OG_DEFAULT_W, h: OG_DEFAULT_H };
}

// Describes the IMAGE, not the page — so it says what the card is showing
// rather than repeating the title a scraper already has.
function buildImageAlt(build) {
  const platform = build.platforms && build.platforms.name;
  const name     = (build.name || '').trim() || 'Untitled build';
  const suffix   = platform ? ', a ' + platform + ' build' : '';
  return heroPhotoUrl(build)
    ? 'Photo of ' + name + suffix
    : name + suffix + ' on Gunforma';
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
    '<meta property="og:image" content="' + esc(image.url) + '"/>',
    // Declared so a scraper can lay the card out before it has fetched the
    // image, and so the ones that trust the declaration over a fetch get the
    // large card rather than guessing from a portrait source.
    '<meta property="og:image:width" content="' + image.w + '"/>',
    '<meta property="og:image:height" content="' + image.h + '"/>',
    '<meta property="og:image:alt" content="' + esc(buildImageAlt(build)) + '"/>',
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
//
// Returns { id, source }. The source is not decoration: which of these
// actually fires in production was guessed wrong once already (see the
// x-nf-original-path note in CLAUDE.md, "Netlify redirects"), and a guess
// about routing is not something this file should be carrying. It is echoed
// on the response as x-build-og-id-source so the answer can be read off a
// real deploy with curl -I instead of inferred from behaviour.
function extractId(req) {
  const url = new URL(req.url);

  // The forwarded query. /b/* puts the id here via :splat; the legacy rule's
  // `query = { id = ":id" }` match is forwarded here too.
  const fromQuery = url.searchParams.get('id') || url.searchParams.get('splat');
  if (fromQuery) {
    const id = buildIdFromPath(decodeURIComponent(fromQuery));
    if (id) return { id, source: 'query' };
  }

  const fromPath = buildIdFromPath(decodeURIComponent(url.pathname));
  if (fromPath) return { id: fromPath, source: 'path' };

  // Netlify sets this to the pre-rewrite path on SOME rewrites. Measured on a
  // deploy preview: absent on the forced exact-path rule with a query
  // condition. Whether it is set on the /b/* splat rewrite is what
  // x-build-og-id-source now answers rather than asserts.
  const original = req.headers.get('x-nf-original-path') || '';
  if (original) {
    const decoded = decodeURIComponent(original);
    const inPath = buildIdFromPath(decoded);
    if (inPath) return { id: inPath, source: 'header-path' };
    // buildIdFromPath strips ?… before matching, so the query needs its own
    // look.
    const q = decoded.indexOf('?');
    if (q !== -1) {
      const idParam = new URLSearchParams(decoded.slice(q + 1)).get('id');
      const inQuery = buildIdFromPath(idParam);
      if (inQuery) return { id: inQuery, source: 'header-query' };
    }
  }

  return { id: null, source: 'none' };
}

// Both routes 404 on an id that cannot be resolved.
//
// There used to be a split here: /b/… hard-404, and the legacy
// gunforma-build-detail.html?id=… soft-serving the page so the client could
// render its own "Build not found", on the reasoning that an old link should
// not start refusing. Two things killed it.
//
// It never ran. isShareRoute() read x-nf-original-path to tell the routes
// apart, and that header is absent on the legacy rule in production — so the
// function always took the share branch and the soft path was unreachable
// from the moment it shipped. A synthetic Request supplies whatever header
// the test author writes, so both the local suite and the reviewer's saw the
// 200 that production never produced.
//
// And it was wrong anyway. A 200 carrying "Build not found" is a soft 404,
// which Google penalises. Nothing links to the legacy shape any more, so
// there is no old link to protect that is worth a soft 404 to protect it.
//
// The dead branch is gone rather than fixed. See CLAUDE.md, "Netlify
// redirects".

// Copies a response, adding the diagnostics that make the routing observable
// from outside. Cheap, non-secret, and the only way this file's assumptions
// about Netlify can be checked against Netlify.
function withDiag(res, source, req) {
  const headers = new Headers(res.headers);
  headers.set('x-build-og-id-source', source);
  headers.set('x-build-og-orig', req.headers.get('x-nf-original-path') ? 'set' : 'absent');
  return new Response(res.body, { status: res.status, headers });
}

export default async (req) => {
  const { id: requested, source } = extractId(req);
  const diag = (res) => withDiag(res, source, req);

  // No uuid anywhere in the request — 404 without a DB round trip, which is
  // also what keeps path input out of the PostgREST query below.
  if (!requested) return diag(notFound());

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
    if (!page) return diag(notFound());
    return diag(new Response(page, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    }));
  }

  // Unknown, unapproved, or deleted.
  if (!build) return diag(notFound());

  const page = await loadPage();
  if (!page) {
    console.error('[build-og] gunforma-build-detail.html not bundled — check included_files');
    // NO auto-refresh here. It used to bounce to
    // /gunforma-build-detail.html?id=…, which was fine while that URL served
    // the file directly. That URL is now rewritten to THIS function, so the
    // refresh would land back here, fail to load the page again, and emit the
    // same refresh — an infinite loop in the reader's browser, on a path that
    // only opens when the deploy is misconfigured.
    //
    // The meta block is what this branch is actually for: a crawler still
    // gets the full preview. A person gets a link they can see, and the error
    // above gets logged, which is the right way for a misconfiguration to
    // behave — visible, not spinning.
    return diag(new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' + metaBlock(build) +
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
      'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
      '</head><body><div><div style="font-size:20px;font-weight:700">' + esc(buildTitle(build)) + '</div>' +
      '<div class="s">This build could not be rendered just now.</div>' +
      '<a href="' + SITE + '/gunforma-builds.html">Browse builds &rarr;</a></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    ));
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

  return diag(new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  }));
};
