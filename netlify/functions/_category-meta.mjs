// _category-meta — the server's one source for everything a products.category
// value means on a page: its /parts/ URL segment and its two display names.
// Shared by every Netlify function that needs it (product-page.mjs,
// parts-index.mjs, sitemap.mjs). Import it; never redefine it.
// ─────────────────────────────────────────────────────────────────────────
// js/category-map.js is the browser's copy, with the same contents: the
// pages load plain <script> globals with no module loader, so they cannot
// import this file. scripts/check-categories.mjs compares the two on every
// deploy and fails if they differ by a single character.
//
// The plural is for headings, tabs and section titles ("Grip Modules"); the
// singular is for sentences ("Grip Module for the Sig Sauer P365", the
// JSON-LD category). "Grip Modules for the Sig Sauer P365" must not ship.
// ─────────────────────────────────────────────────────────────────────────

// category -> [URL segment, plural name, singular name], in products.category
// enum order. Callers that want a fixed display order (parts-index.mjs)
// iterate this object's own key order rather than re-deriving one.
export const CATEGORY_META = {
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

// Categories with no <category>_specs table: the product page shows no spec
// rows for them. check-categories.mjs asserts that product-page.mjs's
// SPEC_TABLES covers every other category.
export const CATEGORIES_WITHOUT_SPEC_SHEET = ['slide_plate', 'other'];
