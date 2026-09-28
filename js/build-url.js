// build-url — the one source of truth for a build's public URL on the
// browser side. Used by every page that renders a build card or sends a
// reader to a build.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_build-url.mjs holds a mirror of this. The two are
// duplicated on purpose, for exactly the reason js/category-map.js and
// netlify/functions/_category-meta.mjs are: that function is ESM running on
// Netlify, while the pages load plain <script> globals with no module
// loader. A shared import would mean introducing one on eleven pages that
// don't have it.
//
// KEEP THE TWO IN SYNC. They must produce byte-identical output for the same
// input — the canonical tag on a build page is emitted by the server copy
// and re-emitted by the browser copy, and if they disagree the page ships a
// canonical that contradicts itself as soon as the build data loads. That is
// the duplicate-URL problem the /b/ work exists to fix, reintroduced from the
// inside.
//
// THE UUID IS WHAT RESOLVES. The slug is decoration: renaming a build changes
// its URL but never breaks the old one, and two builds with the same name
// still get different URLs. /b/<uuid> with no slug at all keeps working
// forever — a lot of those links are already out there.
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  // Long enough to carry a real build name, short enough that the URL stays
  // pasteable. Truncation re-trims, so a cut never leaves a trailing hyphen.
  var MAX_SLUG = 60;

  // The id is always the LAST 8-4-4-4-12 group. Anchored at the end so a
  // slug that happens to contain hyphens — all of them do — or hex, or even
  // a whole second uuid, cannot be mistaken for the id.
  var TRAILING_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

  // Deterministic: the same name always gives the same slug, on both copies.
  global.buildSlug = function (name) {
    if (!name) return '';
    var s = String(name)
      // é -> e rather than é -> "-". Identical in Node and every browser
      // that ships String.prototype.normalize, which is all of them.
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s.length > MAX_SLUG) s = s.slice(0, MAX_SLUG).replace(/-+$/, '');
    return s;
  };

  // /b/<slug>-<uuid>, or /b/<uuid> when the name slugs to nothing (empty,
  // or symbols only). Returns '' with no id, so a caller cannot build a
  // dead href out of undefined.
  global.buildPath = function (id, name) {
    if (!id) return '';
    var slug = global.buildSlug(name);
    return '/b/' + (slug ? slug + '-' : '') + encodeURIComponent(id);
  };

  // The absolute form, for canonical tags and anything copied to a
  // clipboard. Apex host, never location.origin — see the SEO invariants in
  // CLAUDE.md.
  global.buildUrl = function (id, name) {
    var path = global.buildPath(id, name);
    return path ? 'https://gunforma.com' + path : '';
  };

  // Pulls the id back out of /b/<uuid>, /b/<slug>-<uuid>, or a bare splat.
  // Returns null when there isn't one, so callers can 404 rather than query
  // PostgREST with whatever was in the path.
  global.buildIdFromPath = function (input) {
    if (!input) return null;
    var s = String(input).split('#')[0].split('?')[0];
    var m = s.match(TRAILING_UUID);
    return m ? m[1] : null;
  };
})(window);
