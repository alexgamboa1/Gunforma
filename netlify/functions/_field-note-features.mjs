// _field-note-features — which published Field Notes feature a product.
// ─────────────────────────────────────────────────────────────────────────
// The product page's "Featured in Field Notes" section is the mirror of an
// article's blocks: every product an article puts in front of a reader in
// a ::picks, ::rank, ::compare, ::fit barrel= or ::build block links back
// to that article from its own page. Nothing here is a hand-kept list —
// the map is derived from the article files themselves, parsed by the
// renderer's own renderMarkdown(), so what an article renders and what
// links to it cannot disagree. Add a block to an article and the product
// page links it on the next deploy; remove it and the link goes.
//
// Which blocks count, and which do not, on purpose:
//   picks, rank, compare, build   the part is the subject of the block
//   fit barrel=                   the barrel is the subject (the slides it
//                                 lists are not — they come from the view)
//   ::rank baseline=              NOT counted: the factory part the ranked
//                                 one is measured against, not a featured
//                                 part (and an OEM part is never ranked)
//   ::fit optic= / magazine=      NOT counted: a compatibility note about a
//                                 part, usually the factory one
//   ::price, ::colors, ::unlocks  NOT counted: not in the spec of this
//                                 section (next-prs.md, section B)
//
// Drafts are never returned — not on the apex, where a draft is a 404, and
// not on a preview either, so a preview shows what production will (the
// relatedNotes() rule in _field-notes-meta.mjs). A declared article whose
// file does not read, or whose front matter has no title, is skipped:
// this is navigation, not the page, and check-field-notes.mjs is what
// holds every declared file present.
//
// The files ship inside product-page through included_files
// (netlify.toml, [functions."product-page"]). The map is built once per
// function instance — a handful of small files, read on the first request.
import { readFile } from 'node:fs/promises';
import { FIELD_NOTES, fieldNoteFile, fieldNotePath } from './_field-notes-meta.mjs';
import { parseFrontMatter, renderMarkdown } from './_markdown.mjs';

export const FEATURED_LIMIT = 3;

// The product slugs one article features, from its own source text.
export function featuredSlugs(src) {
  const { body } = parseFrontMatter(String(src || ''));
  const { blocks } = renderMarkdown(body);
  const out = new Set();
  for (const b of blocks) {
    if (b.kind === 'picks') b.picks.forEach((p) => out.add(p.slug));
    else if (b.kind === 'rank') out.add(b.slug);
    else if (b.kind === 'compare') b.slugs.forEach((s) => out.add(s));
    else if (b.kind === 'fit' && b.part === 'barrel') (b.slugs || [b.slug]).forEach((s) => out.add(s));
    else if (b.kind === 'build') b.parts.forEach((p) => out.add(p.slug));
  }
  return out;
}

// Same candidates as field-note.mjs's loadSource(): the bundle's working
// directory, then relative to this module. Null when none reads.
export async function loadNoteSource(slug) {
  const rel = fieldNoteFile(slug);
  const candidates = [rel, './' + rel, new URL('../../' + rel, import.meta.url)];
  for (const c of candidates) {
    try { return await readFile(c, 'utf8'); } catch { /* next */ }
  }
  return null;
}

// product slug → the live articles featuring it, newest reviewed first
// (updated, else published, then slug for a stable order), each
// { slug, href, title, updated }. Pure over `notes` and `load`, so the test
// can hand it a registry and files.
export async function buildFeatureMap({ notes = FIELD_NOTES, load = loadNoteSource } = {}) {
  const map = new Map();
  const reviewed = (a) => a.updated || a.published || '';
  const live = notes.filter((a) => !a.draft)
    .slice()
    .sort((x, y) => (reviewed(y) < reviewed(x) ? -1 : reviewed(y) > reviewed(x) ? 1 : 0) || (x.slug < y.slug ? -1 : 1));
  for (const a of live) {
    const src = await load(a.slug);
    if (src == null) continue;
    const { meta } = parseFrontMatter(src);
    if (!meta.title) continue;
    const entry = { slug: a.slug, href: fieldNotePath(a.slug), title: meta.title, updated: reviewed(a) };
    for (const p of featuredSlugs(src)) {
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(entry);
    }
  }
  return map;
}

export function featuredNotesFrom(map, productSlug, limit = FEATURED_LIMIT) {
  return (map.get(productSlug) || []).slice(0, limit);
}

// One map per instance. A failed build is not cached, so the next request
// tries again.
let cached = null;
export async function featuredNotesFor(productSlug) {
  if (!cached) cached = buildFeatureMap().catch((e) => { cached = null; throw e; });
  return featuredNotesFrom(await cached, productSlug);
}
