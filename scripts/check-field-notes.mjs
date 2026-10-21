#!/usr/bin/env node
// check-field-notes.mjs — build-time guard for Field Notes articles: the
// registry (_field-notes-meta.mjs) and the files under field-notes/ must
// agree, and every file must obey the rules the pipeline was commissioned
// under (claude/ — "Field Notes article pipeline", 2026-10-16).
//
// What it catches, all of which render perfectly in a browser:
//   - a registry slug with no file (the sitemap lists a URL that 502s)
//   - a file with no registry row (prose nothing serves — someone THINKS
//     it is live)
//   - a date in the front matter: dates live in the registry, and a second
//     copy drifts
//   - a typed dollar figure in the prose. Prices render LIVE through the
//     ::price block or not at all; "$149" typed into a sentence stays wrong
//     forever while looking authoritative
//   - a directive line that does not parse (it would render as nothing)
//   - a fit directive naming a gun the registry does not know
//   - a prose link straight to a retailer — a buy link goes through the
//     ::price block and /go/, or it earns nothing and logs nothing
//   - an image under /field-notes/ — the forced rewrite swallows that
//     prefix, so the image 404s; article images live under /assets/
//   - a title, description or author that is missing or out of bounds, a
//     type outside the three the index page knows, a bad slug, a malformed
//     or inverted date pair
//   - the index page's card list (field-notes.html, FIELD_NOTE_POSTS)
//     drifting from the registry: a live article with no card, a card for
//     a draft or an undeclared slug, a card whose title, excerpt, author,
//     type, category or date is not the article's own. The page ships as a
//     file and cannot import the registry, so it holds a copy, and this is
//     what lets the copy exist (same shape as check-home-picker.mjs)
// No network: this is tree-dependent, not time-dependent. The live half —
// that every slug in a block exists in the catalog — is check-routes.mjs,
// which reads x-field-note-products / x-field-note-fits off the wire.
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { FIELD_NOTES, FIELD_NOTES_DIR, fieldNoteFile, fieldNotePath, liveFieldNotes } = await import(join(ROOT, 'netlify/functions/_field-notes-meta.mjs'));
const { parseFrontMatter, renderMarkdown, isDirectiveLine, parseDirective } = await import(join(ROOT, 'netlify/functions/_markdown.mjs'));
const { GUN_META } = await import(join(ROOT, 'netlify/functions/_guide-meta.mjs'));

let failures = 0;
const fail = (msg) => { console.error('FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('ok    ' + msg);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPED_PRICE = /\$\s*\d/;
const TYPES = ['review', 'comparison', 'guide'];
// Same hosts scripts/check-buy-links.mjs refuses inside an href. Kept short
// and in step by hand: that file runs on import, so it cannot export them.
const RETAILER_HOSTS = ['opticsplanet.com', 'awin1.com', 'olight.com', 'olightstore.com', 'truepistol.com', 'brownells.com', 'primaryarms.com'];

// ── registry ─────────────────────────────────────────────────────────────
const seen = new Set();
for (const a of FIELD_NOTES) {
  const id = a.slug || '(no slug)';
  if (!SLUG_RE.test(a.slug || '')) fail(id + ': bad slug');
  if (seen.has(a.slug)) fail(id + ': declared twice');
  seen.add(a.slug);
  if (!ISO_DATE.test(a.published || '') || Number.isNaN(Date.parse(a.published))) fail(id + ': published is not a valid YYYY-MM-DD date');
  if (a.updated != null && (!ISO_DATE.test(a.updated) || Number.isNaN(Date.parse(a.updated)))) fail(id + ': updated is not a valid YYYY-MM-DD date');
  if (a.updated && a.published && a.updated < a.published) fail(id + ': updated is before published');
  for (const k of Object.keys(a)) if (!['slug', 'published', 'updated', 'draft'].includes(k)) fail(id + ': unknown registry key "' + k + '"');
}

// ── files ↔ registry ─────────────────────────────────────────────────────
const files = (await readdir(join(ROOT, FIELD_NOTES_DIR))).filter((f) => f.endsWith('.md')).sort();
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (!seen.has(slug)) fail(FIELD_NOTES_DIR + '/' + f + ': no registry row — a file is not a page until _field-notes-meta.mjs declares it');
}

// ── each declared article ────────────────────────────────────────────────
const META = {};
for (const a of FIELD_NOTES) {
  const id = a.slug;
  const file = join(ROOT, fieldNoteFile(a.slug));
  try { await access(file); } catch { fail(id + ': declared but ' + fieldNoteFile(a.slug) + ' does not exist'); continue; }
  const src = await readFile(file, 'utf8');
  const { meta, body } = parseFrontMatter(src);
  META[a.slug] = meta;
  const before = failures;

  if (!meta.title) fail(id + ': front matter has no title');
  else if (meta.title.length > 90) fail(id + ': title over 90 chars (' + meta.title.length + ')');
  if (!meta.description) fail(id + ': front matter has no description');
  else if (meta.description.length < 50 || meta.description.length > 200) fail(id + ': description must be 50–200 chars, is ' + meta.description.length);
  if (!meta.author) fail(id + ': front matter has no author');
  if (!TYPES.includes(meta.type)) fail(id + ': type must be one of ' + TYPES.join('/') + ', is "' + (meta.type || '') + '"');
  if (!meta.category) fail(id + ': front matter has no category');
  for (const k of ['published', 'updated', 'date', 'slug']) if (k in meta) fail(id + ': "' + k + '" belongs in _field-notes-meta.mjs, not the front matter');
  if (meta.cover && !/^(https?:\/\/|\/assets\/)/.test(meta.cover)) fail(id + ': cover must be an https URL or a path under /assets/');

  if (TYPED_PRICE.test(meta.title || '') || TYPED_PRICE.test(meta.description || '')) fail(id + ': typed dollar figure in the title or description');

  const lines = body.split('\n');
  const fmLines = src.slice(0, src.length - body.length).split('\n').length - 1;   // lines the front matter took
  let inFence = false;
  lines.forEach((line, n) => {
    const where = id + ':' + (n + 1 + fmLines);
    if (/^```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    if (isDirectiveLine(line)) {
      const d = parseDirective(line);
      if (!d) { fail(where + ': directive does not parse: ' + line.trim()); return; }
      if (d.kind === 'fit' && !GUN_META[d.gun]) fail(where + ': fit directive names a gun the registry does not know: ' + d.gun);
      return;
    }
    if (TYPED_PRICE.test(line)) fail(where + ': typed dollar figure — prices render live through ::price, never in prose');
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const url = m[1];
      const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1];
      if (host && RETAILER_HOSTS.some((h) => host === h || host.endsWith('.' + h))) fail(where + ': prose link to a retailer (' + host + ') — use a ::price block');
      if (/^\/field-notes\//.test(url) && !/^\/field-notes\/[a-z0-9-]+$/.test(url)) fail(where + ': a file under /field-notes/ is unreachable (the rewrite is forced) — put images under /assets/');
    }
  });
  if (inFence) fail(id + ': unclosed code fence');

  let r;
  try { r = renderMarkdown(body); } catch (e) { fail(id + ': renderMarkdown threw: ' + (e && e.message)); continue; }
  if (!r.blocks.length && !a.draft) console.log('      ' + id + ': no live-data block (fine for an article that needs none)');
  if (failures === before) pass(id + (a.draft ? ' (draft)' : '') + ' — ' + r.blocks.length + ' block(s)');
}

// ── the index page's copy of the live set ────────────────────────────────
// field-notes.html renders its cards from FIELD_NOTE_POSTS, a JSON array
// literal between two markers. Expected: one card per LIVE article, newest
// published first, every field the article's own. The guard prints the
// exact literal on a mismatch, so fixing it is a paste.
{
  const INDEX_FILE = 'field-notes.html';
  const html = await readFile(join(ROOT, INDEX_FILE), 'utf8');
  const m = html.match(/\/\* field-notes-index:start \*\/\s*([\s\S]*?)\s*\/\* field-notes-index:end \*\//);
  let have = null;
  if (!m) fail(INDEX_FILE + ': no /* field-notes-index:start */ … /* field-notes-index:end */ markers around FIELD_NOTE_POSTS');
  else {
    try { have = JSON.parse(m[1]); } catch (e) { fail(INDEX_FILE + ': the list between the markers is not a JSON array literal: ' + (e && e.message)); }
  }
  const want = liveFieldNotes()
    .slice()
    .sort((a, b) => (b.published < a.published ? -1 : b.published > a.published ? 1 : a.slug < b.slug ? -1 : 1))
    .map((a) => {
      const meta = META[a.slug] || {};
      return { slug: a.slug, href: fieldNotePath(a.slug), type: meta.type, category: meta.category, title: meta.title,
               excerpt: meta.description, author_name: meta.author, publish_date: a.published };
    });
  if (have !== null) {
    if (!Array.isArray(have)) fail(INDEX_FILE + ': FIELD_NOTE_POSTS must be an array');
    else if (JSON.stringify(have) !== JSON.stringify(want)) {
      fail(INDEX_FILE + ': FIELD_NOTE_POSTS does not match the live registry — it must read exactly:\n' + JSON.stringify(want, null, 2));
    } else pass(INDEX_FILE + ': ' + want.length + ' card(s) match the live registry' + (want.length ? '' : ' (no live article yet; drafts stay off the index)'));
  }
}

console.log(failures === 0
  ? 'ok: ' + FIELD_NOTES.length + ' declared article(s), ' + files.length + ' file(s), every rule holds'
  : failures + ' FAILURE(S)');
process.exit(failures ? 1 : 0);
