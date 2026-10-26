// _field-notes-meta — the registry of Field Notes articles: which slugs
// are pages, when each was published and last reviewed, and which are
// drafts that only a preview may serve.
// ─────────────────────────────────────────────────────────────────────────
// Same principle as _guide-meta.mjs: a page is a deliberate act. A file
// under field-notes/ does NOT become a page by existing — field-note.mjs
// 404s any slug not declared here, and sitemap.mjs lists exactly the live
// set. scripts/check-field-notes.mjs holds the two in step both ways (a
// declared slug with no file, a file with no row) on every deploy.
//
// WHAT LIVES HERE AND WHAT LIVES IN THE FILE. Dates live HERE and nowhere
// else: the sitemap needs them without reading a file, and a second copy
// in the front matter is drift waiting to happen (the guard refuses one).
// Title, description, author, type and category live in the file's front
// matter, where the writing tools expect them.
//
// `draft: true` is served ONLY off the apex — a deploy preview, a branch
// deploy, netlify dev — and answers 404 on gunforma.com, so the renderer
// and its blocks can be walked on a preview without putting a URL in
// front of a crawler (the 2026-10-15 indexing diagnosis: stop adding
// URLs). A draft is never in the sitemap and carries noindex besides.
// field-note.mjs reads the hostname off req.url, which is the ORIGINAL
// request URL (CLAUDE.md, "Netlify redirects") — the same thing
// canonical-host.js and js/site-url.js branch on.
//
// `updated` is the editorial review date: it drives dateModified, the
// sitemap lastmod AND the "Last reviewed <Month YYYY>" line in the page
// header, so bump it when the PROSE changes. Live prices and fit verdicts
// need no bump; they are live on every fetch. (This IS the "reviewed" date
// of the trust layer — one date, not a second copy in the front matter,
// which the guard refuses.)
//
// `changelog` is optional: an array of "YYYY-MM-DD: what changed" strings,
// rendered as the article's "Latest updates" section, newest first — the
// freshness signal a reader (and a crawler) can hold against `updated`.
// Dollar figures are banned here as everywhere; the guard checks each
// entry's shape.
//
// URL shape: /field-notes/<slug>. The index stays /field-notes.html.

export const FIELD_NOTES = [
  // The renderer's own fixture — every Markdown construct and both block
  // directives on real catalog slugs. scripts/field-notes.test.mjs runs the
  // handler over it, and the preview walk-through is done against it. Keep
  // it: it is what proves the plumbing before any article exists, and it
  // is a 404 on gunforma.com.
  { slug: 'renderer-check', published: '2026-10-20', updated: '2026-10-25', draft: true,
    changelog: [
      '2026-10-25: Added the four guide blocks — picks, rank, compare, faq — and this changelog.',
      '2026-10-20: First version of the fixture.',
    ] },
  // The first real article: the XMacro grip-module buyer's guide. Published
  // 2026-10-26 on Alex's explicit "publish".
  { slug: 'best-p365-xmacro-grip-modules', published: '2026-10-26', updated: '2026-10-26',
    changelog: [
      '2026-10-26: First published.',
    ] },
];

export const FIELD_NOTES_INDEX_PATH = '/field-notes.html';

export function fieldNotePath(slug) {
  return '/field-notes/' + slug;
}

export function fieldNote(slug) {
  return FIELD_NOTES.find((a) => a.slug === slug) || null;
}

// The articles a crawler may be told about.
export function liveFieldNotes() {
  return FIELD_NOTES.filter((a) => !a.draft);
}

// Where the file for a slug lives, relative to the repo root. Netlify
// bundles the directory into the function with included_files
// (netlify.toml); the path is also what netlify dev and the tests read.
export const FIELD_NOTES_DIR = 'field-notes';
export function fieldNoteFile(slug) {
  return FIELD_NOTES_DIR + '/' + slug + '.md';
}
