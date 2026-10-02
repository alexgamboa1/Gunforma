// _guide-meta — the registry of guide ("fit") pages: which families exist,
// which gun slugs exist, and which (family, gun) pages are LIVE.
// ─────────────────────────────────────────────────────────────────────────
// Server-only, no browser mirror needed: guide pages are fully
// server-rendered and generate their own internal links, so unlike
// _category-meta.mjs ↔ js/category-map.js there is no second copy to keep
// in sync. Do not create one.
//
// A page exists only if it is declared in GUIDE_PAGES below — a new row in
// `guns` does NOT spawn a page by itself. That is deliberate: every guide
// page ships with editorial content in _guide-content.mjs, and a page with
// live data but empty prose is a thin page. guide-page.mjs 404s any
// (family, gun) pair not declared here, and sitemap.mjs emits exactly the
// declared set. scripts/check-guide-content.mjs asserts the two files agree.
//
// URL shape: /fit/p365/<family-segment>/<gun-slug>
// Family segments use SEARCH phrasing ("red-dots"), not catalog category
// keys ("optics") — people type "red dot", not "optic". The catalog's
// category maps are untouched.

// gun slug -> display name. Slugs are guns.slug values, copied from the
// live table 2026-09-30 — the set changes when Sig ships a pistol, i.e.
// rarely, and a page needs a declared entry here anyway.
export const GUN_META = {
  'p365':              'P365',
  'p365-x':            'P365 X',
  'p365-xl':           'P365 XL',
  'p365-xl-rose-comp': 'P365 XL Rose Comp',
  'p365-xmacro':       'P365 XMacro',
  'p365-xmacro-comp':  'P365 XMacro Comp',
  'p365-axg':          'P365 AXG Legion',
  'p365-xf-dh3':       'P365 XF DH3',
  'p365-xf-dh3-axg':   'P365 XF DH3 AXG',
  'p365-fuse':         'P365 FUSE',
  'p365-fuse-comp':    'P365 FUSE Comp',
};

// family segment -> { label used in copy, catalog category the family draws
// from (for the /parts/<segment> related link) }
export const GUIDE_FAMILIES = {
  'red-dots': { label: 'Red Dots', category: 'optic', categorySegment: 'optics' },
};

// The live pages. Stage 2 ships exactly one; Stage 3 adds the rest one PR
// per cluster. `updated` is the page's editorial review date — it drives
// "Last reviewed", Article dateModified, and the sitemap lastmod, so bump
// it when the PROSE changes (live data needs no bump; it is live).
export const GUIDE_PAGES = [
  { family: 'red-dots', gun: 'p365-xl', updated: '2026-09-30' },
];

export function guidePath(family, gun) {
  return '/fit/p365/' + family + '/' + gun;
}

export function isLiveGuidePage(family, gun) {
  return GUIDE_PAGES.some((p) => p.family === family && p.gun === gun);
}
