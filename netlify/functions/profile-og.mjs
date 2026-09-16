// profile-og — server-renders OG/Twitter meta for /u/:username
// -----------------------------------------------------------------------------
// Crawlers (Facebook, X, Slack, iMessage, LinkedIn) do not run JavaScript, so
// the client-rendered profile page has no usable title/description/image when
// its URL is pasted anywhere. This function sits in front of /u/:username,
// confirms the profile exists, and returns the SAME gunforma-profile.html with
// meta tags injected into <head>. The page's own JS then hydrates as normal —
// no redirect, no flash, so /u/:username is the real canonical URL.
//
// A username with no matching profile returns a genuine 404: /u/madeupname
// must not render as a valid page (soft-404s get indexed).
//
// Deliberately dependency-free — a plain fetch against PostgREST rather than
// @supabase/supabase-js, so there is no package.json, no install step, and
// nothing to bundle. The anon key is the same public key already shipped in
// js/supabase-client.js; this function holds no secrets.
//
// Routing lives in netlify.toml ([[redirects]] /u/:username -> here with
// ?username=:username), alongside the site's other :param rewrites.
// -----------------------------------------------------------------------------
import { readFile } from 'node:fs/promises';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE        = 'https://gunforma.com';
const OG_IMAGE    = SITE + '/og-default.png';
const DESCRIPTION = 'Real builds. Real parts. Real data.';

// Matches the username rule the account form enforces, widened slightly so a
// legacy row can still resolve. Anything outside it 404s without a DB round
// trip — this is also what keeps path input out of the PostgREST query.
const USERNAME_RE = /^[A-Za-z0-9_]{1,32}$/;

const PAGE_CANDIDATES = [
  'gunforma-profile.html',
  './gunforma-profile.html',
  new URL('../../gunforma-profile.html', import.meta.url),
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

function metaBlock(username) {
  const u     = esc(username);
  const title = u + ' on Gunforma';
  const url   = SITE + '/u/' + encodeURIComponent(username);
  return [
    // The page is served at /u/<username> but every script src and nav href in
    // it is root-relative-less ("js/nav.js", "gunforma-builds.html"), which
    // would resolve against /u/ and 404. One base tag fixes all of them, and
    // it lands before any relative URL in the document. Origin-relative, not
    // absolute, so deploy previews and netlify dev resolve to themselves.
    '<base href="/"/>',
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(DESCRIPTION) + '"/>',
    '<meta property="og:type" content="profile"/>',
    '<meta property="og:title" content="' + esc(title) + '"/>',
    '<meta property="og:description" content="' + esc(DESCRIPTION) + '"/>',
    '<meta property="og:image" content="' + esc(OG_IMAGE) + '"/>',
    '<meta property="og:url" content="' + esc(url) + '"/>',
    '<meta name="twitter:card" content="summary_large_image"/>',
    '<meta name="twitter:title" content="' + esc(title) + '"/>',
    '<meta name="twitter:description" content="' + esc(DESCRIPTION) + '"/>',
    '<meta name="twitter:image" content="' + esc(OG_IMAGE) + '"/>',
    '<link rel="canonical" href="' + esc(url) + '"/>',
  ].join('\n');
}

function notFound(username) {
  const u = esc(username || '');
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Profile not found — Gunforma</title>' +
    '<meta name="robots" content="noindex"/>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
    'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
    '</head><body><div><div style="font-size:20px;font-weight:700">Profile not found</div>' +
    '<div class="s">' + (u ? 'No Gunforma member goes by &ldquo;' + u + '&rdquo;.' : 'That profile link is not valid.') + '</div>' +
    '<a href="' + SITE + '/gunforma-builds.html">Browse builds &rarr;</a></div></body></html>',
    {
      status: 404,
      headers: {
        'Content-Type':  'text/html; charset=utf-8',
        // Short — a username registered a minute from now shouldn't stay 404.
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}

// Netlify's production edge does not substitute :username into a rewrite
// target's query string the way `netlify dev` does — the function gets an
// empty param and every profile 404s. Rather than depend on one mechanism,
// read whichever source actually carries it.
function extractUsername(req) {
  const url = new URL(req.url);

  const fromQuery = url.searchParams.get('username') || url.searchParams.get('splat');
  if (fromQuery) return fromQuery;

  const fromPath = url.pathname.match(/^\/u\/([^/]+)\/?$/);
  if (fromPath) return decodeURIComponent(fromPath[1]);

  // Set by Netlify to the pre-rewrite path.
  const original = req.headers.get('x-nf-original-path') || '';
  const fromHeader = original.match(/^\/u\/([^/?#]+)/);
  if (fromHeader) return decodeURIComponent(fromHeader[1]);

  return '';
}

export default async (req) => {
  const requested = extractUsername(req);

  if (!USERNAME_RE.test(requested)) return notFound(requested);

  // Existence check. maybeSingle equivalent: ask for one row, read the array.
  let row = null;
  try {
    const res = await fetch(
      SB_URL + '/rest/v1/profiles?select=username&limit=1&username=eq.' + encodeURIComponent(requested),
      { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON } },
    );
    if (!res.ok) throw new Error('PostgREST ' + res.status);
    const rows = await res.json();
    row = Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[profile-og] profile lookup failed', err);
    // Upstream hiccup is not proof the profile is absent — don't cache a 404
    // over it. Hand back the page unadorned and let the client render.
    const page = await loadPage();
    if (!page) return notFound(requested);
    return new Response(page, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (!row) return notFound(requested);

  // Use the DB's canonical casing, not whatever the URL happened to carry.
  const username = row.username;

  const page = await loadPage();
  if (!page) {
    console.error('[profile-og] gunforma-profile.html not bundled — check included_files');
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' + metaBlock(username) +
      '<meta http-equiv="refresh" content="0;url=' + SITE + '/gunforma-profile.html?u=' + encodeURIComponent(username) + '"/>' +
      '</head><body></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
    );
  }

  // Swap the static <title> for the generated title + meta. Single anchored
  // replace so a future edit that drops the title fails loudly in testing
  // rather than silently shipping pages with no OG tags.
  const html = page.replace('<title>Profile — Gunforma</title>', metaBlock(username));

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  });
};
