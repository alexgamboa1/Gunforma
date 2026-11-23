// _markdown — the Field Notes Markdown renderer, dependency-free.
// ─────────────────────────────────────────────────────────────────────────
// An article is a Markdown file under field-notes/ (see
// _field-notes-meta.mjs). field-note.mjs reads it at request time and
// turns it into HTML with this module, which exists because the functions
// are dependency-free by house rule — no `marked`, no bundler, nothing
// installed during the site build (netlify.toml, publish = ".").
//
// WHAT IT ACCEPTS — the subset an article actually uses, nothing more:
//   front matter   a leading `---` block of `key: value` lines
//   # headings     ATX, levels 1–6, each given an id for anchors
//   paragraphs     consecutive lines, soft-wrapped
//   lists          `- ` / `* ` and `1. `, one level of nesting by indent
//   > quotes       consecutive `> ` lines
//   ``` fences     verbatim, escaped
//   | tables       GFM pipe tables with a `|---|` separator row
//   ---            a horizontal rule (three or more - or *)
//   ![alt](src)    an image; alone on a line it becomes a <figure>
//   **b** *i* `c`  bold, italic, code spans
//   [t](url)       links — http(s), site-relative, #anchor, mailto only
//   ::kind args    a BLOCK DIRECTIVE, resolved by the caller. price, fit
//                  (optic=/magazine= with gun=, or barrel=),
//                  compare, unlocks and colors are one line; picks, rank,
//                  faq and build carry a body of lines closed by a lone
//                  `::` (BODY_DIRECTIVE_KINDS)
//
// EVERYTHING IS ESCAPED. Raw HTML in the source is text, not markup: an
// article is reviewed prose, but a renderer that passes `<script>` through
// is one mistake away from an XSS, and nothing an article needs requires
// it. A javascript: or data: link is dropped to its text.
//
// DIRECTIVES are where the live data goes. `::price a, b` and
// `::fit optic=a gun=b` render as placeholders here — `<!--fn-block-N-->`
// — and field-note.mjs replaces each with HTML built from PostgREST. This
// module never touches the database; it only says where the blocks are and
// what they asked for, so it stays a pure function scripts/field-notes.test.mjs
// can run with no network.

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── front matter ─────────────────────────────────────────────────────────
// `---` on the first line, `key: value` scalars until the closing `---`.
// Scalars only, on purpose: dates live in the registry, author is one
// line, and a nested YAML parser is a dependency by another name. A value
// may be quoted; the quotes are stripped.
export function parseFrontMatter(src) {
  const text = String(src || '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

// ── directives ───────────────────────────────────────────────────────────
// Single-line:
// `::price <slug>[, <slug>…]`              the current price + buy row
// `::fit optic=<slug> gun=<gun-slug>`      does this optic fit this gun
// `::fit magazine=<slug> gun=<gun-slug>`   does this magazine fit this gun
// `::compare <category> [gun=<slug>] cols=<col,…> slugs=<slug,…>`
//                                          the spec-comparison table
// `::unlocks frame=<slug>` / `::unlocks slide=<slug>`
//                                          what this part opens up, counted
//                                          from the fit views at request time
// `::colors slugs=<slug,…> baseline=<slug>`
//                                          colour table across products, the
//                                          baseline (factory) row first
// Block-bodied (BODY_DIRECTIVE_KINDS), body lines until a lone `::`:
// `::picks`                                `<slug> | <best-for label>` per line
// `::rank <slug> best="…" rank=N [code="…"] [baseline=<slug>]`
//                                          `~ changes from factory` / `= stays
//                                          the same` per line (`+`/`-` pros and
//                                          cons still parse for old fixtures;
//                                          the build guard refuses them in a
//                                          non-fixture article)
// `::faq`                                  `Q: …` / `A: …` pairs, alternating
// `::build name="…"`                       `<role>=<slug>` per line, one per
//                                          role, roles from BUILD_ROLES
// Null for anything else, and the caller decides what a bad line means
// (the build guard refuses it; at request time it renders as nothing).
export const BODY_DIRECTIVE_KINDS = ['picks', 'rank', 'faq', 'build'];

// The roles a ::build line may name, one each. The parser owns the list
// (it is parsing vocabulary, like the directive kinds); what each role is
// called on the page and which catalog category it must resolve to live in
// _guide-blocks.mjs (BUILD_ROLE_META), and check-field-notes.mjs holds the
// two in step.
export const BUILD_ROLES = ['frame', 'slide', 'barrel', 'optic', 'light', 'magwell', 'comp', 'trigger', 'magazine'];

// Gathers a block directive's body: lines from `from` until a line that is
// exactly `::`. `closed: false` means EOF arrived first — the renderer
// tolerates that, the build guard refuses it.
export function collectDirectiveBody(lines, from) {
  const body = [];
  let j = from;
  while (j < lines.length && lines[j].trim() !== '::') body.push(lines[j++]);
  return { body, next: j < lines.length ? j + 1 : j, closed: j < lines.length };
}

// `key="value"` or `key=value` pairs after the leading tokens. Null on
// anything that is not one.
function parseArgs(rest) {
  const args = {};
  const re = /([a-z_]+)=("([^"]*)"|[^\s"]+)/g;
  let consumed = '';
  for (const m of rest.matchAll(re)) {
    args[m[1]] = m[3] != null ? m[3] : m[2];
    consumed += m[0] + ' ';
  }
  // Anything left over that is not whitespace means a token that parsed as
  // neither a pair nor a quoted value — refuse the line rather than guess.
  const leftover = rest.replace(re, '').trim();
  return leftover ? null : args;
}

export function parseDirective(line, bodyLines) {
  const m = String(line).match(/^::([a-z]+)\s*(.*?)\s*$/);
  if (!m) return null;
  const kind = m[1], rest = m[2];
  if (kind === 'price') {
    const slugs = rest.split(/[\s,]+/).filter(Boolean);
    if (!slugs.length || !slugs.every((s) => SLUG_RE.test(s))) return null;
    return { kind, slugs: [...new Set(slugs)] };
  }
  if (kind === 'fit') {
    const args = {};
    for (const tok of rest.split(/\s+/).filter(Boolean)) {
      const kv = tok.match(/^([a-z]+)=([a-z0-9-]+)$/);
      if (!kv) return null;
      args[kv[1]] = kv[2];
    }
    // optic= and magazine= are judged against a pistol, so gun= is
    // required; barrel= lists the slides v_barrel_slide_fit says fit, which
    // no pistol narrows — gun= is accepted there and ignored.
    const parts = ['optic', 'magazine', 'barrel'].filter((k) => args[k]);
    if (parts.length !== 1) return null;
    const part = parts[0];
    if (part !== 'barrel' && !args.gun) return null;
    const keys = Object.keys(args).filter((k) => k !== 'gun' && k !== part);
    if (keys.length) return null;
    if (!SLUG_RE.test(args[part]) || (args.gun && !SLUG_RE.test(args.gun))) return null;
    return { kind, part, slug: args[part], gun: args.gun || null };
  }
  if (kind === 'compare') {
    // ::compare <category> [gun=<slug>] cols=<col,…> slugs=<slug,…>
    const first = rest.match(/^([a-z_]+)\s+(.*)$/);
    if (!first) return null;
    const args = parseArgs(first[2]);
    if (!args) return null;
    for (const k of Object.keys(args)) if (!['gun', 'cols', 'slugs'].includes(k)) return null;
    const cols = (args.cols || '').split(',').map((c) => c.trim()).filter(Boolean);
    const slugs = (args.slugs || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!cols.length || !slugs.length || !slugs.every((s) => SLUG_RE.test(s))) return null;
    if (!cols.every((c) => /^[a-z0-9_]+$/.test(c))) return null;
    if (args.gun && !SLUG_RE.test(args.gun)) return null;
    return { kind, category: first[1], gun: args.gun || null, cols, slugs: [...new Set(slugs)] };
  }
  if (kind === 'picks') {
    // No args on the line; one `<slug> | <label>` per body line.
    if (rest) return null;
    const picks = [];
    for (const raw of bodyLines || []) {
      if (/^\s*$/.test(raw)) continue;
      const p = raw.match(/^\s*([a-z0-9-]+)\s*\|\s*(.+?)\s*$/);
      if (!p || !SLUG_RE.test(p[1])) return null;
      picks.push({ slug: p[1], label: p[2] });
    }
    if (!picks.length) return null;
    if (new Set(picks.map((p) => p.slug)).size !== picks.length) return null;
    return { kind, picks };
  }
  if (kind === 'rank') {
    // ::rank <slug> best="…" rank=N [code="…"] [baseline=<slug>]; the body
    // is `~ what changes from the factory part` / `= what stays the same`
    // (and the retired `+ pro` / `- con`, still parsed so old fixtures
    // render — the build guard refuses them outside a fixture).
    const first = rest.match(/^([a-z0-9-]+)\s+(.*)$/);
    if (!first || !SLUG_RE.test(first[1])) return null;
    const args = parseArgs(first[2]);
    if (!args) return null;
    for (const k of Object.keys(args)) if (!['best', 'rank', 'code', 'baseline'].includes(k)) return null;
    const rank = Number(args.rank);
    if (!args.best || !Number.isInteger(rank) || rank < 1 || rank > 9) return null;
    if (args.code != null && !/^[A-Za-z0-9-]{2,32}$/.test(args.code)) return null;
    if (args.baseline != null && !SLUG_RE.test(args.baseline)) return null;
    const pros = [], cons = [], changes = [], same = [];
    const by = { '+': pros, '-': cons, '~': changes, '=': same };
    for (const raw of bodyLines || []) {
      if (/^\s*$/.test(raw)) continue;
      const pm = raw.match(/^\s*([+\-~=])\s+(.+?)\s*$/);
      if (!pm) return null;
      by[pm[1]].push(pm[2]);
    }
    return { kind, slug: first[1], best: args.best, rank, code: args.code || null,
             baseline: args.baseline || null, pros, cons, changes, same };
  }
  if (kind === 'unlocks') {
    // ::unlocks frame=<slug> | ::unlocks slide=<slug> — exactly one key.
    const kv = rest.match(/^(frame|slide)=([a-z0-9-]+)$/);
    if (!kv || !SLUG_RE.test(kv[2])) return null;
    return { kind, part: kv[1], slug: kv[2] };
  }
  if (kind === 'colors') {
    // ::colors slugs=<slug,…> baseline=<slug> — the baseline (factory) row
    // renders first; it is not repeated if also listed under slugs.
    const args = parseArgs(rest);
    if (!args) return null;
    for (const k of Object.keys(args)) if (!['slugs', 'baseline'].includes(k)) return null;
    if (!args.baseline || !SLUG_RE.test(args.baseline)) return null;
    const slugs = (args.slugs || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!slugs.length || !slugs.every((s) => SLUG_RE.test(s))) return null;
    const deduped = [...new Set(slugs)].filter((s) => s !== args.baseline);
    if (!deduped.length) return null;
    return { kind, baseline: args.baseline, slugs: deduped };
  }
  if (kind === 'build') {
    // ::build name="…" with one <role>=<slug> body line per role.
    const args = parseArgs(rest);
    if (!args) return null;
    for (const k of Object.keys(args)) if (k !== 'name') return null;
    if (!args.name || !args.name.trim()) return null;
    const parts = [];
    const seenRoles = new Set();
    for (const raw of bodyLines || []) {
      if (/^\s*$/.test(raw)) continue;
      const pm = raw.match(/^\s*([a-z]+)\s*=\s*([a-z0-9-]+)\s*$/);
      if (!pm || !BUILD_ROLES.includes(pm[1]) || !SLUG_RE.test(pm[2])) return null;
      if (seenRoles.has(pm[1])) return null;   // one part per role
      seenRoles.add(pm[1]);
      parts.push({ role: pm[1], slug: pm[2] });
    }
    if (!parts.length) return null;
    return { kind, name: args.name.trim(), parts };
  }
  if (kind === 'faq') {
    // Q:/A: pairs, strictly alternating, one line each — answers are one or
    // two sentences by the authoring rules, and a strict shape is what the
    // guard can hold.
    if (rest) return null;
    const qas = [];
    let q = null;
    for (const raw of bodyLines || []) {
      if (/^\s*$/.test(raw)) continue;
      const qm = raw.match(/^\s*Q:\s+(.+?)\s*$/);
      const am = raw.match(/^\s*A:\s+(.+?)\s*$/);
      if (qm) { if (q != null) return null; q = qm[1]; continue; }
      if (am) { if (q == null) return null; qas.push({ q, a: am[1] }); q = null; continue; }
      return null;
    }
    if (q != null || !qas.length) return null;
    return { kind, qas };
  }
  return null;
}

export function isDirectiveLine(line) {
  return /^::[a-z]+(\s|$)/.test(line);
}

// ── inline ───────────────────────────────────────────────────────────────
const SAFE_URL = /^(https?:\/\/|\/(?!\/)|#|mailto:)/i;

function linkAttrs(href) {
  // Off-site links open in a new tab and carry noopener; a site link is a
  // plain anchor. Links are reviewed prose, so no nofollow here — a buy link
  // never goes through prose, it goes through the ::price block and /go/.
  return /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?gunforma\.com(\/|$)/i.test(href)
    ? ' target="_blank" rel="noopener"' : '';
}

export function inline(text) {
  let s = esc(text);
  const held = [];
  const hold = (html) => { held.push(html); return '\u0000' + (held.length - 1) + '\u0000'; };
  // Code spans first, so nothing inside one is read as markup.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold('<code>' + c + '</code>'));
  // Images, then links (an image's `![` must not be left for the link rule).
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, alt, src) =>
    SAFE_URL.test(src) ? hold('<img src="' + src + '" alt="' + alt + '" loading="lazy"/>') : alt);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, t, href) =>
    SAFE_URL.test(href) ? hold('<a href="' + href + '"' + linkAttrs(href) + '>' + t + '</a>') : t);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Emphasis opens and closes against a non-space, so "2 * 3 * 4" stays
  // arithmetic and *this* is italic.
  s = s.replace(/(^|[^*\w])\*(\S(?:[^*\n]*?\S)?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(\S(?:[^_\n]*?\S)?)_(?=[^_\w]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  return s;
}

export function headingId(text) {
  return String(text).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

// Ids the page renderer gives its own sections (field-note.mjs): the
// changelog, the related-notes footer, the table of contents. A heading
// that slugs to one of them is numbered past it ("Latest updates" in the
// prose becomes latest-updates-2), so the page never carries two elements
// with one id and a table-of-contents link always lands where it says.
export const RESERVED_IDS = ['latest-updates', 'related-field-notes', 'on-this-page'];

// `## Long heading {toc="Short label"}` — an optional short label for the
// table of contents. The suffix is stripped before the heading is rendered
// or slugged, so the id and the visible text are the long heading's.
const TOC_LABEL = /\s*\{toc="([^"]*)"\}\s*$/;
export function splitTocLabel(text) {
  const m = String(text).match(TOC_LABEL);
  return m ? { text: String(text).slice(0, m.index), toc: m[1].trim() || null } : { text: String(text), toc: null };
}

// ── blocks ───────────────────────────────────────────────────────────────
// Returns { html, blocks, headings, blockSections }: the HTML with one
// `<!--fn-block-N-->` placeholder per directive, the parsed directives in
// order (index N), the h1–h3 headings (for the table of contents, the
// heading lint, a test), and for each block the text of the H2 it sits
// under (null before the first) — what names a ranked group's ItemList.
export function renderMarkdown(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const blocks = [];
  const blockSections = [];
  const headings = [];
  // dedupe heading ids: second "Verdict" is verdict-2. The renderer's own
  // section ids are taken before the first heading is read.
  const ids = new Map(RESERVED_IDS.map((r) => [r, 1]));
  let lastH2 = null;
  let i = 0;

  const uniqueId = (base) => {
    const n = (ids.get(base) || 0) + 1;
    ids.set(base, n);
    return n === 1 ? base : base + '-' + n;
  };
  const isBlank = (l) => /^\s*$/.test(l);
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSeparator = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const listItem = (l) => l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    // directive — a body-bearing kind consumes its lines up to a lone `::`
    if (isDirectiveLine(line)) {
      const kind = (line.match(/^::([a-z]+)/) || [])[1];
      let body;
      if (BODY_DIRECTIVE_KINDS.includes(kind)) {
        const c = collectDirectiveBody(lines, i + 1);
        body = c.body; i = c.next;
      } else i++;
      const d = parseDirective(line, body);
      if (d) { blocks.push(d); blockSections.push(lastH2); out.push('<!--fn-block-' + (blocks.length - 1) + '-->'); }
      else out.push('<!-- unparseable directive dropped -->');
      continue;
    }

    // fenced code
    const fence = line.match(/^```/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;   // closing fence (or EOF)
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const { text, toc } = splitTocLabel(h[2]);
      const html = inline(text);
      const id = uniqueId(headingId(text));
      if (level <= 3) headings.push({ level, id, text, toc });
      if (level === 2) lastH2 = text;
      out.push('<h' + level + ' id="' + id + '">' + html + '</h' + level + '>');
      i++; continue;
    }

    // horizontal rule
    if (/^\s*([-*])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      const inner = renderMarkdown(buf.join('\n'));
      // A directive inside a quote is not supported; its placeholder would
      // be unreachable to the caller. Render the quote's prose only.
      out.push('<blockquote>' + inner.html.replace(/<!--fn-block-\d+-->/g, '') + '</blockquote>');
      continue;
    }

    // table
    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => '<' + tag + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c) + '</' + tag + '>';
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c, k) => td('th', c, k)).join('') + '</tr></thead>' +
        '<tbody>' + rows.map((r) => '<tr>' + head.map((_, k) => td('td', r[k] == null ? '' : r[k], k)).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    // list (one level of nesting by indentation)
    const li0 = listItem(line);
    if (li0 && li0[1].length === 0) {
      const ordered = /\d+\./.test(li0[2]);
      const items = [];   // { html, children: [{ordered, items}] }
      while (i < lines.length) {
        const m = listItem(lines[i]);
        if (!m) break;
        if (m[1].length === 0) {
          if (/\d+\./.test(m[2]) !== ordered) break;
          items.push({ html: inline(m[3]), children: null });
          i++;
        } else {
          if (!items.length) break;
          const subOrdered = /\d+\./.test(m[2]);
          const last = items[items.length - 1];
          if (!last.children) last.children = { ordered: subOrdered, items: [] };
          last.children.items.push(inline(m[3]));
          i++;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map((it) =>
        '<li>' + it.html + (it.children
          ? '<' + (it.children.ordered ? 'ol' : 'ul') + '>' + it.children.items.map((c) => '<li>' + c + '</li>').join('') + '</' + (it.children.ordered ? 'ol' : 'ul') + '>'
          : '') + '</li>').join('') + '</' + tag + '>');
      continue;
    }

    // image alone on a line → figure (with an optional caption in alt)
    const img = line.match(/^!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)\s*$/);
    if (img && SAFE_URL.test(img[2])) {
      out.push('<figure><img src="' + esc(img[2]) + '" alt="' + esc(img[1]) + '" loading="lazy"/>' +
        (img[1] ? '<figcaption>' + esc(img[1]) + '</figcaption>' : '') + '</figure>');
      i++; continue;
    }

    // paragraph: run until a blank line or the start of another block
    const buf = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !isDirectiveLine(lines[i]) &&
           !/^(#{1,6}\s|```|>\s?|\s*\|)/.test(lines[i]) && !listItem(lines[i]) &&
           !/^\s*([-*])(\s*\1){2,}\s*$/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }

  return { html: out.join('\n'), blocks, headings, blockSections };
}

// Plain text of the rendered HTML — what a meta description or a test
// compares against. Collapses whitespace.
export function textOf(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
