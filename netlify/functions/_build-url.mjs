// _build-url — the one source of truth for a build's public URL on the
// server side, shared by every Netlify function that needs it (build-og.mjs
// today).
// ─────────────────────────────────────────────────────────────────────────
// js/build-url.js holds the browser-side mirror of this, for the same reason
// js/category-map.js mirrors _category-meta.mjs: the pages load plain
// <script> globals with no module loader, and this is ESM on Netlify.
//
// KEEP THE TWO IN SYNC — and this pair is stricter than the category one.
// A category out of sync ships a link that 404s, which someone notices. This
// pair produces the CANONICAL TAG: build-og.mjs emits it server-side and the
// page re-emits it from the browser copy once the build data loads. If the
// two disagree by one character, the page silently declares two different
// canonical URLs for the same build over the course of one page load, looks
// completely normal in a browser, and quietly re-creates the duplicate-URL
// problem the /b/ work exists to fix.
//
// scripts/build-url.test.mjs runs both copies over the same inputs and fails
// if they differ. Run it after touching either.
//
// THE UUID IS WHAT RESOLVES. The slug is decoration: renaming a build changes
// its URL but never breaks the old one, and two builds with the same name
// still get different URLs. /b/<uuid> with no slug at all keeps working
// forever — a lot of those links are already out there.
// ─────────────────────────────────────────────────────────────────────────

const MAX_SLUG = 60;

// The id is always the LAST 8-4-4-4-12 group. Anchored at the end so a slug
// that happens to contain hyphens — all of them do — or hex, or even a whole
// second uuid, cannot be mistaken for the id.
const TRAILING_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export const SITE = 'https://gunforma.com';

// Deterministic: the same name always gives the same slug, on both copies.
export function buildSlug(name) {
  if (!name) return '';
  let s = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > MAX_SLUG) s = s.slice(0, MAX_SLUG).replace(/-+$/, '');
  return s;
}

// /b/<slug>-<uuid>, or /b/<uuid> when the name slugs to nothing.
export function buildPath(id, name) {
  if (!id) return '';
  const slug = buildSlug(name);
  return '/b/' + (slug ? slug + '-' : '') + encodeURIComponent(id);
}

// The absolute form, for canonical and og:url. Apex host always — see the
// SEO invariants in CLAUDE.md.
export function buildUrl(id, name) {
  const path = buildPath(id, name);
  return path ? SITE + path : '';
}

// Pulls the id back out of /b/<uuid>, /b/<slug>-<uuid>, or a bare splat.
// Returns null when there isn't one, so callers 404 rather than query
// PostgREST with whatever was in the path.
export function buildIdFromPath(input) {
  if (!input) return null;
  const s = String(input).split('#')[0].split('?')[0];
  const m = s.match(TRAILING_UUID);
  return m ? m[1] : null;
}
