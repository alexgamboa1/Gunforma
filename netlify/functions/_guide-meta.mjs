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
  { family: 'red-dots', gun: 'p365-xl',         updated: '2026-09-30' },
  { family: 'red-dots', gun: 'p365',            updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-x',          updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-xmacro',     updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-axg',        updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-xf-dh3',     updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-xf-dh3-axg', updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-fuse',       updated: '2026-10-02' },
  { family: 'red-dots', gun: 'p365-fuse-comp',  updated: '2026-10-02' },
];

// NOT declared, deliberately — each would be a near-duplicate of a page
// above rather than its own answer, and eleven near-identical pages is the
// doorway-content shape Google penalises as a cluster:
//   p365-xmacro-comp  — its gun_optic_cuts rows are the XMacro's, down to
//                       the same `likely` confidence and the same stale-Sig
//                       -spec note. The integrated comp changes the gun, not
//                       what mounts on it.
//   p365-xl-rose-comp — the XL's answer plus one -SL SKU. Rose is a product
//                       line, not a fitment fact.
// Both are in GUN_META and gun_optic_cuts, so declaring one here plus a
// content block is all it takes if that call changes.

export function guidePath(family, gun) {
  return '/fit/p365/' + family + '/' + gun;
}

// ── Gun hubs: /p365/<gun-slug> ────────────────────────────────────────────
// Page type #4. The hub is the page a fit page links UP to: one model, its
// own facts from `guns`, its cut decoder from gun_optic_cuts, and a link to
// every declared fit page for it.
//
// A hub exists only for a DECLARED gun, same principle as GUIDE_PAGES — but
// the two sets are not independent. A hub whose model has no fit page links
// to nothing, so GUN_HUBS must be exactly the set of guns appearing in
// GUIDE_PAGES. scripts/check-guide-content.mjs asserts that both ways
// rather than leaving it to whoever edits one list and not the other.
export const GUN_HUBS = [
  { gun: 'p365-xl',         updated: '2026-10-02',
    summary: 'The original optic-ready P365 at full length: one RMSc-pattern cut across every current SKU, and no compensator to shorten the barrel under it.' },
  { gun: 'p365',            updated: '2026-10-02',
    summary: 'The gun the family is named after, and the only one still in circulation with non-optic-ready slides — so the first question is whether yours is cut at all.' },
  { gun: 'p365-x',          updated: '2026-10-02',
    summary: 'The base P365 slide under an X-series grip module: the shortest slide that is optic-ready across the current line.' },
  { gun: 'p365-xmacro',     updated: '2026-10-02',
    summary: 'The 17-round carry gun, sharing its magazine with the FUSE, and the one model where our cut data for the -RXSL SKUs is marked likely rather than verified.' },
  { gun: 'p365-axg',        updated: '2026-10-02',
    summary: 'An alloy AXG grip module and an integrated compensator — the heaviest, flattest-shooting gun in the family.' },
  { gun: 'p365-xf-dh3',     updated: '2026-10-02',
    summary: 'A full-length slide over a compensated barrel, which gives it the longest sight radius in the P365 line.' },
  { gun: 'p365-xf-dh3-axg', updated: '2026-10-02',
    summary: 'The XF DH3 with an alloy AXG grip module, and one of only two models where a single optic cut covers every current SKU.' },
  { gun: 'p365-fuse',       updated: '2026-10-02',
    summary: 'The longest barrel in the line with no compensator, and the only model that leaves the factory on the SIG-LOC Compact cut by default.' },
  { gun: 'p365-fuse-comp',  updated: '2026-10-02',
    summary: 'The compensated FUSE — and, unlike the plain FUSE it shares a housing class with, an RMSc-pattern gun by default.' },
];

// The hub index. A single always-valid path, which is what lets a browser
// page link into this cluster without mirroring the registry client-side
// (see the note at the top of this file — there is still no mirror).
export const HUB_INDEX_PATH = '/p365/';

export function hubPath(gun) {
  return '/p365/' + gun;
}

export function isLiveGunHub(gun) {
  return GUN_HUBS.some((h) => h.gun === gun);
}

// Declared fit pages for one gun, in GUIDE_PAGES order — what a hub lists.
export function guidePagesForGun(gun) {
  return GUIDE_PAGES.filter((p) => p.gun === gun);
}

export function isLiveGuidePage(family, gun) {
  return GUIDE_PAGES.some((p) => p.family === family && p.gun === gun);
}
