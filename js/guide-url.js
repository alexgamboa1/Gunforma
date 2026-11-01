// guide-url — a Gun Guide's public URL on the browser side: the card title
// links on Gun Guides, and the Share buttons there and in the Armory.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_guide-url.mjs is the server copy (the canonical
// guide-share.mjs emits, the URL sitemap.mjs submits). Duplicated for the
// reason js/build-url.js is: the pages load plain <script> globals with no
// module loader. scripts/guide-url.test.mjs runs both copies over the same
// inputs and fails if they differ — a Share button copying one URL while
// the page declares another canonical is the duplicate-URL problem /gg/
// exists not to have.
//
// /gg/<slug>-<uuid>. The uuid at the end is what resolves; the slug is
// decoration, built by the same rule as a build's (buildSlug — the test
// pins that too, so this copy stands alone without loading build-url.js).
(function (global) {
  var MAX_SLUG = 60;
  var TRAILING_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

  global.gunGuideSlug = function (title) {
    if (!title) return '';
    var s = String(title)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s.length > MAX_SLUG) s = s.slice(0, MAX_SLUG).replace(/-+$/, '');
    return s;
  };

  global.gunGuidePath = function (id, title) {
    if (!id) return '';
    var slug = global.gunGuideSlug(title);
    return '/gg/' + (slug ? slug + '-' : '') + encodeURIComponent(id);
  };

  // Apex host, never location.origin — a copied link is a canonical URL.
  global.gunGuideUrl = function (id, title) {
    var path = global.gunGuidePath(id, title);
    return path ? 'https://gunforma.com' + path : '';
  };

  global.gunGuideIdFromPath = function (input) {
    if (!input) return null;
    var s = String(input).split('#')[0].split('?')[0];
    var m = s.match(TRAILING_UUID);
    return m ? m[1].toLowerCase() : null;
  };
})(window);
