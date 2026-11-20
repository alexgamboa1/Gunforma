// _field-notes-admin — the pure text surgery behind the admin field-notes
// editor (admin-field-notes.mjs): edit ONE registry row in
// _field-notes-meta.mjs, insert a new one, add or remove ONE card in
// field-notes.html, and read the skill's ```registry-row``` block. No
// network, no filesystem — every function takes the file's text and
// returns new text, so scripts/admin-field-notes.test.mjs can hold each to
// "every other byte unchanged".
//
// WHY TEXT, NOT A SERIALISER. _field-notes-meta.mjs is hand-written
// JavaScript with comments between rows; re-printing the whole array from
// data would drop them all. So a row is FOUND (a string- and
// comment-aware scan of the FIELD_NOTES array) and only its own text is
// rewritten. Every edit then goes through verifyRegistryEdit(), which
// IMPORTS the edited file (a data: URL — the module imports nothing) and
// refuses unless every other row is deep-equal to before and the edited
// row is exactly what was asked. A row whose text is not in the house
// shape is refused in words rather than guessed at.

export const REGISTRY_PATH = 'netlify/functions/_field-notes-meta.mjs';
export const INDEX_PATH = 'field-notes.html';
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const notePath = (slug) => 'field-notes/' + slug + '.md';

// The only paths a save may write (admin-field-notes.mjs refuses anything
// else). field-notes.html is written by publish/unpublish only, and only
// the one card — the guard requires a live article's card in the same
// commit that flips its draft flag.
export function isWritablePath(path) {
  if (path === REGISTRY_PATH || path === INDEX_PATH) return true;
  const m = String(path).match(/^field-notes\/([^/]+)\.md$/);
  return !!(m && SLUG_RE.test(m[1]));
}

// ── scanning the registry ────────────────────────────────────────────────
// Skips '…' "…" `…` strings and // /* */ comments, so a `}` inside a
// changelog line or a comment can never end a row.
function skipNonCode(s, i) {
  const c = s[i];
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); return j === -1 ? s.length : j; }
  if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); return j === -1 ? s.length : j + 2; }
  return i;
}

// The FIELD_NOTES array's rows: [{ slug, start, end }] where src.slice(start,
// end) is the object literal `{ … }`, plus the index of the array's `]`.
export function registryRows(src) {
  const open = src.indexOf('export const FIELD_NOTES = [');
  if (open === -1) throw new Error('registry: FIELD_NOTES array not found');
  let i = open + 'export const FIELD_NOTES = ['.length;
  const rows = [];
  let depth = 0, rowStart = -1;
  while (i < src.length) {
    const j = skipNonCode(src, i);
    if (j !== i) { i = j; continue; }
    const c = src[i];
    if (c === '{' || c === '[') { if (depth === 0 && c === '{') rowStart = i; depth++; }
    else if (c === '}' || c === ']') {
      if (depth === 0 && c === ']') {
        return { rows: rows.map((r) => ({ ...r, slug: (src.slice(r.start, r.end).match(/^\{\s*slug:\s*'([^']+)'/) || [])[1] || null })), arrayEnd: i };
      }
      depth--;
      if (depth === 0 && c === '}') rows.push({ start: rowStart, end: i + 1 });
    }
    i++;
  }
  throw new Error('registry: FIELD_NOTES array is not closed');
}

export function findRow(src, slug) {
  const { rows } = registryRows(src);
  const r = rows.find((x) => x.slug === slug);
  if (!r) throw new Error('registry: no row for ' + slug);
  return r;
}

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

// The house shape of a row's first line: `{ slug: 'x', published: 'd',
// updated: 'd'[, draft: true],`. Every edit below works on that line or on
// the changelog array; anything else is refused.
const HEAD_RE = /^\{ slug: '([a-z0-9-]+)', published: '(\d{4}-\d{2}-\d{2})'(, updated: '(\d{4}-\d{2}-\d{2})')?(, draft: true)?/;
function rowParts(src, slug) {
  const r = findRow(src, slug);
  const text = src.slice(r.start, r.end);
  if (!HEAD_RE.test(text)) throw new Error('registry: the row for ' + slug + ' is not in the house shape ({ slug, published, updated[, draft: true] on its first line) — edit it by hand');
  return { r, text };
}
const replaceRow = (src, r, text) => src.slice(0, r.start) + text + src.slice(r.end);

export function setDraft(src, slug, draft) {
  const { r, text } = rowParts(src, slug);
  const has = /^\{[^\n]*?, draft: true/.test(text);
  if (has === !!draft) return src;
  const next = draft
    ? text.replace(/^(\{ slug: '[^']+', published: '[^']+'(?:, updated: '[^']+')?)/, '$1, draft: true')
    : text.replace(/^(\{[^\n]*?), draft: true/, '$1');
  return replaceRow(src, r, next);
}

export function setDate(src, slug, key, date) {
  if (!['published', 'updated'].includes(key) || !ISO_DATE.test(date)) throw new Error('registry: bad date edit');
  const { r, text } = rowParts(src, slug);
  let next;
  if (new RegExp('^\\{[^\\n]*?' + key + ": '\\d{4}-\\d{2}-\\d{2}'").test(text)) {
    next = text.replace(new RegExp('^(\\{[^\\n]*?' + key + ": ')\\d{4}-\\d{2}-\\d{2}(')"), '$1' + date + '$2');
  } else if (key === 'updated') {
    next = text.replace(/^(\{ slug: '[^']+', published: '[^']+')/, "$1, updated: " + q(date));
  } else throw new Error('registry: row has no published date');
  return replaceRow(src, r, next);
}

// Newest first, as every row is written: the entry goes at the top.
export function addChangelog(src, slug, entry) {
  if (!/^\d{4}-\d{2}-\d{2}: .+$/.test(entry)) throw new Error('registry: changelog entry must be "YYYY-MM-DD: what changed"');
  const { r, text } = rowParts(src, slug);
  let next;
  const m = text.match(/\n(\s*)changelog: \[\n(\s*)/);
  if (m) {
    next = text.replace(/\n(\s*)changelog: \[\n/, (all, ind) => '\n' + ind + 'changelog: [\n' + ind + '  ' + q(entry) + ',\n');
  } else {
    // No changelog yet: one goes before the row's closing brace.
    const body = text.slice(0, -1).replace(/[\s,]*$/, '');
    next = body + ',\n    changelog: [\n      ' + q(entry) + ',\n    ] }';
  }
  return replaceRow(src, r, next);
}

// A new row, in the house shape, appended as the array's last row.
export function serializeRow(row) {
  let s = '  { slug: ' + q(row.slug) + ', published: ' + q(row.published) + (row.updated ? ', updated: ' + q(row.updated) : '') + (row.draft ? ', draft: true' : '');
  const tail = [];
  if (row.tags && row.tags.length) tail.push('    tags: [' + row.tags.map(q).join(', ') + ']');
  if (row.changelog && row.changelog.length) tail.push('    changelog: [\n' + row.changelog.map((e) => '      ' + q(e) + ',\n').join('') + '    ]');
  if (!tail.length) return s + ' },\n';
  return s + ',\n' + tail.join(',\n') + ' },\n';
}

export function insertRow(src, row) {
  const { rows, arrayEnd } = registryRows(src);
  if (rows.some((x) => x.slug === row.slug)) throw new Error('registry: ' + row.slug + ' is already declared');
  const lineStart = src.lastIndexOf('\n', arrayEnd) + 1;   // the "];" line
  return src.slice(0, lineStart) + serializeRow(row) + src.slice(lineStart);
}

// Import the registry text as a module. It imports nothing, so a data: URL
// evaluates it exactly as Netlify will.
export async function loadRegistry(src) {
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
  return mod.FIELD_NOTES;
}

// Deep equality that ignores object key order (a row's keys may be written
// in any order) but not array order (rows and changelog entries are ordered).
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// The check every registry write passes before it is committed: the file
// still imports; every OTHER row is deep-equal to before (and in the same
// order); the target row is exactly `expected` (null = must not exist);
// and every byte outside the target row is unchanged.
export async function verifyRegistryEdit(before, after, slug, expected) {
  const a = await loadRegistry(before);
  const b = await loadRegistry(after);
  const others = (list) => list.filter((x) => x.slug !== slug);
  if (!sameJson(others(a), others(b))) throw new Error('registry: an edit to ' + slug + ' changed another row — refused');
  const got = b.find((x) => x.slug === slug) || null;
  if (!sameJson(got, expected)) throw new Error('registry: the ' + slug + ' row came out as ' + JSON.stringify(got) + ', not ' + JSON.stringify(expected) + ' — refused');
  const rb = registryRows(before), ra = registryRows(after);
  const r1 = rb.rows.find((x) => x.slug === slug), r2 = ra.rows.find((x) => x.slug === slug);
  if (r1 && r2) {
    if (before.slice(0, r1.start) !== after.slice(0, r2.start) || before.slice(r1.end) !== after.slice(r2.end)) throw new Error('registry: bytes outside the ' + slug + ' row changed — refused');
  } else if (!r1 && r2) {
    const at = before.lastIndexOf('\n', rb.arrayEnd) + 1;
    if (before.slice(0, at) !== after.slice(0, at) || before.slice(at) !== after.slice(at + (after.length - before.length))) throw new Error('registry: bytes outside the new ' + slug + ' row changed — refused');
  }
  return b;
}

// ── field-notes.html: one card per live article, newest first ───────────
const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtShort = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

// The card markup, as the live article's card is written by hand (the
// index is static HTML on purpose — crawlers do not run JS).
export function cardHtml({ slug, meta, published }) {
  const badge = meta.type === 'comparison' ? ['comparison', 'Comparison'] : ['guide', 'Guide'];
  const img = meta.cover
    ? '<div class="card-img" style="background-image:url(\'' + escH(meta.cover).replace(/\(|\)/g, encodeURIComponent) + '\');background-size:cover;background-position:center;">'
    : '<div class="card-img">';
  return (
    '      <a href="/field-notes/' + slug + '" class="post-card" data-category="' + escH(meta.category) + '">\n' +
    '        ' + img + '\n' +
    '          <span class="card-type-badge ' + badge[0] + '">' + badge[1] + '</span>\n' +
    '        </div>\n' +
    '        <div class="card-body">\n' +
    '          <div class="card-category">' + escH(meta.category) + '</div>\n' +
    '          <div class="card-title">' + escH(meta.title) + '</div>\n' +
    '          <p class="card-excerpt">' + escH(meta.description) + '</p>\n' +
    '          <div class="card-meta">\n' +
    '            <span class="card-author-date">' + escH(meta.author || 'Gunforma') + ' &middot; ' + fmtShort(published) + '</span>\n' +
    '          </div>\n' +
    '        </div>\n' +
    '      </a>\n'
  );
}

const GRID_OPEN = '<div class="posts-grid" id="postsGrid">\n';
function cardSpans(html) {
  const g = html.indexOf(GRID_OPEN);
  if (g === -1) throw new Error('field-notes.html: the posts grid is not where it should be');
  const spans = [];
  const re = /      <a href="\/field-notes\/([a-z0-9-]+)" class="post-card"[\s\S]*?\n      <\/a>\n/g;
  re.lastIndex = g;
  let m;
  const gridEnd = html.indexOf('\n    </div>', g);
  while ((m = re.exec(html)) && m.index < gridEnd) spans.push({ slug: m[1], start: m.index, end: m.index + m[0].length });
  return { gridBody: g + GRID_OPEN.length, gridEnd: gridEnd + 1, spans };
}

// `publishedOf(slug)` gives each existing card's published date, from the
// registry: the new card goes above the first card older than it.
export function insertCard(html, card, slug, published, publishedOf) {
  const { gridBody, gridEnd, spans } = cardSpans(html);
  if (spans.some((s) => s.slug === slug)) return html;
  const before = spans.find((s) => (publishedOf(s.slug) || '') < published);
  const at = before ? before.start : (spans.length ? spans[spans.length - 1].end : gridBody);
  if (at > gridEnd) throw new Error('field-notes.html: card position outside the grid');
  return html.slice(0, at) + card + html.slice(at);
}

export function removeCard(html, slug) {
  const { spans } = cardSpans(html);
  const s = spans.find((x) => x.slug === slug);
  return s ? html.slice(0, s.start) + html.slice(s.end) : html;
}

// ── the gunforma-field-note skill's ```registry-row``` block ────────────
// The skill ends a draft with a fenced registry-row block: a JS row
// (`{ slug: '…', published: '…', updated: '…', draft: true, tags: […] }`)
// or `key: value` lines. Returns { text, row } — the draft without the
// block, and the row as data — or throws in words.
export function splitRegistryRow(full) {
  const text = String(full).replace(/\r\n?/g, '\n');
  const m = text.match(/\n```registry-row[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (!m) throw new Error('no ```registry-row``` block at the end of the draft');
  const raw = m[1].trim();
  const body = text.slice(0, m.index).replace(/\s+$/, '') + '\n';
  const get = (k) => { const x = raw.match(new RegExp('\\b' + k + "\\s*:\\s*['\"]?([^'\",\\n}]+)")); return x ? x[1].trim() : null; };
  const tagsM = raw.match(/\btags\s*:\s*\[([^\]]*)\]/);
  const row = {
    slug: get('slug'),
    published: get('published'),
    updated: get('updated'),
    tags: tagsM ? tagsM[1].split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null,
  };
  if (!row.slug || !SLUG_RE.test(row.slug)) throw new Error('registry-row: slug is missing or not URL-safe (lowercase letters, digits and single hyphens)');
  if (!row.published || !ISO_DATE.test(row.published)) throw new Error('registry-row: published must be a YYYY-MM-DD date');
  if (row.updated && !ISO_DATE.test(row.updated)) throw new Error('registry-row: updated must be a YYYY-MM-DD date');
  if (row.tags) for (const t of row.tags) if (!SLUG_RE.test(t)) throw new Error('registry-row: tag "' + t + '" is not a lowercase slug');
  return { text: body, row };
}
