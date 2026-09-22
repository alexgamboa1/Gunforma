// _category-meta — the one source of truth for products.category -> [URL
// segment, display label] on the server side, shared by every Netlify
// function that needs it (product-page.mjs, parts-index.mjs).
// ─────────────────────────────────────────────────────────────────────────
// This is NOT the same situation as affiliate.js's variant-axis logic or
// js/category-map.js's browser-side segment map, both of which are
// duplicated on purpose because the browser side ships as a plain <script>
// global with no module loader. product-page.mjs and parts-index.mjs are
// both plain ESM Netlify functions — there's no bundler boundary between
// them — so there is no excuse for a second hand-copy here. Import this
// instead of redefining it.
//
// js/category-map.js still holds its own browser-side mirror
// (window.CATEGORY_URL_SEGMENT) for the catalog/armory cards, and that one
// still has to be kept in sync by hand for the reason explained in its own
// file header. Add or rename a category in BOTH this file and
// js/category-map.js — a segment that exists in only one of them ships
// links that 404.
// ─────────────────────────────────────────────────────────────────────────

// category -> [URL segment, display label]. Order matches the
// products.category enum, and callers that want a fixed display order
// (parts-index.mjs's category grouping) should iterate this object's own
// key order rather than re-deriving one.
export const CATEGORY_META = {
  slide:            ['slides',            'Slide'],
  barrel:           ['barrels',           'Barrel'],
  frame:            ['frames',            'Frame'],
  trigger:          ['triggers',          'Trigger'],
  compensator:      ['compensators',      'Compensator'],
  light:            ['lights',            'Light'],
  optic:            ['optics',            'Optic'],
  mag_release:      ['mag-releases',      'Mag Release'],
  magwell:          ['magwells',          'Magwell'],
  basepad:          ['basepads',          'Basepad'],
  slide_release:    ['slide-releases',    'Slide Release'],
  safety_selector:  ['safety-selectors',  'Safety Selector'],
  takedown_lever:   ['takedown-levers',   'Takedown Lever'],
  slide_plate:      ['slide-plates',      'Slide Plate'],
};
