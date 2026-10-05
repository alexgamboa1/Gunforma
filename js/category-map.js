// category-map — the browser's one source for everything a products.category
// value means on a page: its /parts/ URL segment and its two display names.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_category-meta.mjs is the server's copy, with the same
// contents. Two copies on purpose: the functions are ESM on Netlify and these
// pages load plain <script> globals with no module loader, so neither can
// import the other — the same split as js/build-url.js ↔ _build-url.mjs.
// scripts/check-categories.mjs compares the two on every deploy and fails if
// they differ by a single character, and fails when any page carries its own
// category list instead of reading this one.
//
// TWO NAMES PER CATEGORY. The plural is for headings, tabs and section
// titles ("Grip Modules"); the singular is for sentences ("Grip Module for
// the Sig Sauer P365", "A slide belongs to exactly one platform"). One name
// per category everywhere: the builder's names won ("Grip Modules", not
// "Frame Modules"; "Basepads", not "Base plate").
//
// A URL segment is not a lowercased name: mag_release reads "Magazine
// Releases" but lives at "mag-releases". Segments are permanent addresses.
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  // category -> [URL segment, plural name, singular name], in products.category
  // enum order.
  var CATEGORIES = {
    slide:            ['slides',            'Slides',            'Slide'],
    barrel:           ['barrels',           'Barrels',           'Barrel'],
    frame:            ['frames',            'Grip Modules',      'Grip Module'],
    trigger:          ['triggers',          'Triggers',          'Trigger'],
    compensator:      ['compensators',      'Compensators',      'Compensator'],
    light:            ['lights',            'Weapon Lights',     'Weapon Light'],
    optic:            ['optics',            'Optics',            'Optic'],
    mag_release:      ['mag-releases',      'Magazine Releases', 'Magazine Release'],
    magwell:          ['magwells',          'Magwells',          'Magwell'],
    basepad:          ['basepads',          'Basepads',          'Basepad'],
    slide_release:    ['slide-releases',    'Slide Releases',    'Slide Release'],
    safety_selector:  ['safety-selectors',  'Safety Selectors',  'Safety Selector'],
    takedown_lever:   ['takedown-levers',   'Takedown Levers',   'Takedown Lever'],
    slide_plate:      ['slide-plates',      'Slide Plates',      'Slide Plate'],
    recoil_spring:    ['recoil-springs',    'Recoil Springs',    'Recoil Spring'],
    sight:            ['sights',            'Sights',            'Sight'],
    // Catalog parts that fit no other category. A product here also carries
    // products.part_type ("thumb ledge"), which pages prefer in a sentence.
    other:            ['other-parts',       'Other Parts',       'Other Part'],
  };

  global.PRODUCT_CATEGORIES = CATEGORIES;
  global.CATEGORY_KEYS = Object.keys(CATEGORIES);

  // category -> URL segment. Kept under its old name: every page builds
  // links through productPath() below, and a few read this map directly.
  global.CATEGORY_URL_SEGMENT = {};
  global.CATEGORY_KEYS.forEach(function (k) { global.CATEGORY_URL_SEGMENT[k] = CATEGORIES[k][0]; });

  // An unknown value must never reach a reader verbatim ("MAG_RELEASE");
  // prettify it instead, so a value added to the enum before this file still
  // reads as words.
  function pretty(c) {
    return String(c == null ? '' : c).replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  global.categoryPlural = function (c) { return CATEGORIES[c] ? CATEGORIES[c][1] : pretty(c); };
  global.categorySingular = function (c) { return CATEGORIES[c] ? CATEGORIES[c][2] : pretty(c); };

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
