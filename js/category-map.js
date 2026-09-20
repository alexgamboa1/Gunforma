// category-map — the one source of truth for products.category -> URL segment
// on the browser side. Used to build /parts/:category/:slug links from
// catalog and armory cards.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/product-page.mjs holds a mirror of this in CATEGORY_META
// (which pairs each segment with a display label). The two are duplicated on
// purpose, for the same reason product-page.mjs duplicates affiliate.js's
// variant-axis logic: that function is ESM running on Netlify, while the
// catalog and armory load plain <script> globals with no module loader. A
// shared import would mean introducing one on pages that don't have it.
//
// The values here are copied verbatim from CATEGORY_META's first tuple slot.
// If you add or rename a category, change BOTH files — a segment that exists
// here but not there (or vice versa) ships links that 404.
//
// NOT to be confused with CATEGORY_LABELS in gunforma-parts-catalog.html,
// which is display text only ("Magazine Releases"). Lowercasing a label does
// NOT produce a valid segment: mag_release displays as "Magazine Releases"
// but its segment is "mag-releases".
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  // category -> URL segment. Order matches the products.category enum.
  global.CATEGORY_URL_SEGMENT = {
    slide:            'slides',
    barrel:           'barrels',
    frame:            'frames',
    trigger:          'triggers',
    compensator:      'compensators',
    light:            'lights',
    optic:            'optics',
    mag_release:      'mag-releases',
    magwell:          'magwells',
    basepad:          'basepads',
    slide_release:    'slide-releases',
    safety_selector:  'safety-selectors',
    takedown_lever:   'takedown-levers',
    slide_plate:      'slide-plates',
  };

  // Builds /parts/:segment/:slug, or returns null when the product can't be
  // linked (no slug yet, or a category this map doesn't know). Callers fall
  // back to unlinked markup on null rather than shipping a dead href.
  global.productPath = function (category, slug) {
    if (!slug) return null;
    var segment = global.CATEGORY_URL_SEGMENT[category];
    if (!segment) return null;
    return '/parts/' + segment + '/' + slug;
  };
})(window);
