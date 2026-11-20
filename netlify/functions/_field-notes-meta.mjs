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
// `tags` is optional: an array of lowercase slugs ("grip-modules",
// "p365-xmacro"). It drives ONE thing — the "Related field notes" footer
// (relatedNotes() below): other live articles sharing a tag, most shared
// first. It lives here rather than in the front matter for the same reason
// the dates do: the renderer ranks every other article without opening
// their files, and opens only the four it links (for title and
// description). An untagged article has no related notes, which renders as
// no section — never a list of everything.
//
// URL shape: /field-notes/<slug>. The index stays /field-notes.html.

export const FIELD_NOTES = [
  // The renderer's own fixture — every Markdown construct and both block
  // directives on real catalog slugs. scripts/field-notes.test.mjs runs the
  // handler over it, and the preview walk-through is done against it. Keep
  // it: it is what proves the plumbing before any article exists, and it
  // is a 404 on gunforma.com.
  { slug: 'renderer-check', published: '2026-10-20', updated: '2026-11-20', draft: true,
    tags: ['grip-modules', 'optics', 'p365-xmacro'],
    changelog: [
      '2026-11-20: Added the page furniture — table of contents, byline row, ItemList schema, related notes.',
      '2026-11-19: Added the v2 blocks — unlocks, colors, build — and the changes/same rank card.',
      '2026-10-25: Added the four guide blocks — picks, rank, compare, faq — and this changelog.',
      '2026-10-20: First version of the fixture.',
    ] },
  // The first real article: the XMacro grip-module buyer's guide. Published
  // 2026-10-26 on Alex's explicit "publish".
  // tags: its own front-matter category (Grip Modules) and the gun it is
  // linked from in FIELD_NOTE_LINKS below — nothing new about the article.
  { slug: 'best-p365-xmacro-grip-modules', published: '2026-10-26', updated: '2026-10-26',
    tags: ['grip-modules', 'p365-xmacro'],
    changelog: [
      '2026-11-20: Pick labels rewritten to measurable facts.',
      '2026-10-26: First published.',
    ] },
  { slug: 'admin-editor-test-draft', published: '2026-11-20', updated: '2026-11-20', draft: true,
    tags: ['grip-modules'] },
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

// The "Related field notes" footer: up to `limit` OTHER live articles that
// share at least one tag with `slug`, most shared tags first, then the
// newest reviewed (updated, else published), then slug for a stable order.
// A draft is never returned — not on the apex (it would be a dead link)
// and not on a preview either (a preview walk-through must show what
// production will). Pure over `notes`, so the test can hand it a registry.
export const RELATED_LIMIT = 4;
export function relatedNotes(slug, notes = FIELD_NOTES, limit = RELATED_LIMIT) {
  const self = notes.find((a) => a.slug === slug);
  const mine = new Set((self && self.tags) || []);
  if (!mine.size) return [];
  const reviewed = (a) => a.updated || a.published || '';
  return notes
    .filter((a) => a.slug !== slug && !a.draft)
    .map((a) => ({ a, shared: (a.tags || []).filter((t) => mine.has(t)).length }))
    .filter((x) => x.shared > 0)
    .sort((x, y) => (y.shared - x.shared)
      || (reviewed(y.a) < reviewed(x.a) ? -1 : reviewed(y.a) > reviewed(x.a) ? 1 : 0)
      || (x.a.slug < y.a.slug ? -1 : 1))
    .slice(0, limit)
    .map((x) => x.a);
}

// Where the file for a slug lives, relative to the repo root. Netlify
// bundles the directory into the function with included_files
// (netlify.toml); the path is also what netlify dev and the tests read.
export const FIELD_NOTES_DIR = 'field-notes';
export function fieldNoteFile(slug) {
  return FIELD_NOTES_DIR + '/' + slug + '.md';
}

// Contextual links from the P365 cluster into articles: gun slug → the
// articles that answer a question for that model, rendered by
// guide-page.mjs (its Related block) and gun-hub.mjs (its links row).
// Declared here, beside the draft flags, so the filter below can never be
// forgotten: a draft is a 404 on the apex, and a live page linking one
// would ship a dead link that renders perfectly — the same reasoning as
// guide-page.mjs's isLiveGunHub() gate on the hub crumb.
const FIELD_NOTE_LINKS = {
  'p365-xmacro': [
    { slug: 'best-p365-xmacro-grip-modules', label: 'Best XMacro-size grip modules, ranked' },
  ],
  'p365-fuse': [
    { slug: 'best-p365-xmacro-grip-modules', label: 'Best XMacro-size grip modules (the size the FUSE ships on), ranked' },
  ],
};

// The other direction of the same map: the guns whose hub links INTO this
// article, in declaration order. The first is the article's "model hub" —
// the one field-note.mjs's "Keep going" line links back up to.
export function gunsForFieldNote(slug) {
  return Object.keys(FIELD_NOTE_LINKS).filter((gun) => FIELD_NOTE_LINKS[gun].some((l) => l.slug === slug));
}

export function fieldNoteLinksForGun(gunSlug) {
  const live = new Set(liveFieldNotes().map((a) => a.slug));
  return (FIELD_NOTE_LINKS[gunSlug] || [])
    .filter((l) => live.has(l.slug))
    .map((l) => ({ href: fieldNotePath(l.slug), label: l.label }));
}
