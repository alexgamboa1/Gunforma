// field-notes-lint.mjs — the per-article checks that need nothing but the
// article's own text: front matter, the typed-$ ban, retailer and
// unreachable links, directive syntax, the heading lint, the ::picks rules,
// the voice lint and each type's required sections. ONE copy, two readers:
//
//   - scripts/check-field-notes.mjs runs it over every declared article on
//     every deploy (and adds the checks that need the catalog fixture —
//     slugs resolving, categories, OEM parts — which stay there);
//   - netlify/functions/admin-field-notes.mjs runs it on every keystroke
//     batch in the admin editor and refuses a save while it reports a FAIL.
//
// So what the editor shows red is exactly what the build would refuse.
// Pure: nothing runs on import, so the registry audit in check-all.sh does
// not count this file as a check.
//
// lintNote(src) → { meta, body, issues, blocks, headings, lines, fmLines }.
// An issue is { level: 'fail' | 'warn', line: <1-based FILE line> | null,
// msg }. The caller prefixes its own id.
import { parseFrontMatter, renderMarkdown, isDirectiveLine, parseDirective, BODY_DIRECTIVE_KINDS, collectDirectiveBody } from '../netlify/functions/_markdown.mjs';
import { GUN_META } from '../netlify/functions/_guide-meta.mjs';
import { lintVoice, lintSections, FIELD_NOTE_TYPES } from './field-notes-voice.mjs';

export const TYPED_PRICE = /\$\s*\d/;
// H2s that name nothing: a table-of-contents entry a reader cannot act on.
export const VAGUE_H2 = ['overview', 'introduction', 'details', 'conclusion'];
// Same hosts scripts/check-buy-links.mjs refuses inside an href. Kept short
// and in step by hand: that file runs on import, so it cannot export them.
export const RETAILER_HOSTS = ['opticsplanet.com', 'awin1.com', 'olight.com', 'olightstore.com', 'truepistol.com', 'brownells.com', 'primaryarms.com'];

// `nameCheck(slug, paragraph)` — optional; says whether a ::rank card's
// paragraph names its product. The guard passes one built from the catalog
// fixture; the admin function, which has no catalog, passes none (the
// check is a WARN either way).
export function lintNote(src, { nameCheck } = {}) {
  const issues = [];
  const fail = (line, msg) => issues.push({ level: 'fail', line, msg });
  const warn = (line, msg) => issues.push({ level: 'warn', line, msg });
  const { meta, body } = parseFrontMatter(src);
  const lines = body.split('\n');
  const fmLines = String(src).replace(/\r\n?/g, '\n').slice(0, String(src).replace(/\r\n?/g, '\n').length - body.length).split('\n').length - 1;
  const at = (n) => n + 1 + fmLines;   // 0-based body line → 1-based file line

  // ── front matter ──
  if (!meta.title) fail(null, 'front matter has no title');
  else if (meta.title.length > 90) fail(null, 'title over 90 chars (' + meta.title.length + ')');
  if (!meta.description) fail(null, 'front matter has no description');
  else if (meta.description.length < 50 || meta.description.length > 200) fail(null, 'description must be 50–200 chars, is ' + meta.description.length);
  // author is optional (no byline is rendered without one — never a
  // placeholder), but a credential with no author under it renders nothing.
  if (meta.author_credential && !meta.author) fail(null, 'author_credential without an author');
  if (!FIELD_NOTE_TYPES.includes(meta.type)) fail(null, 'front-matter type is required, one of ' + FIELD_NOTE_TYPES.join(' | ') + ', is "' + (meta.type || '') + '"');
  if (!meta.category) fail(null, 'front matter has no category');
  for (const k of ['published', 'updated', 'date', 'slug']) if (k in meta) fail(null, '"' + k + '" belongs in _field-notes-meta.mjs, not the front matter');
  if (meta.cover && !/^(https?:\/\/|\/assets\/)/.test(meta.cover)) fail(null, 'cover must be an https URL or a path under /assets/');
  if (TYPED_PRICE.test(meta.title || '') || TYPED_PRICE.test(meta.description || '')) fail(null, 'typed dollar figure in the title or description');

  // ── prose and directive syntax ──
  const scanProse = (line, n) => {
    if (TYPED_PRICE.test(line)) fail(at(n), 'typed dollar figure — prices render live through ::price, never typed');
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const url = m[1];
      const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1];
      if (host && RETAILER_HOSTS.some((h) => host === h || host.endsWith('.' + h))) fail(at(n), 'prose link to a retailer (' + host + ') — use a ::price block');
      if (/^\/field-notes\//.test(url) && !/^\/field-notes\/[a-z0-9-]+$/.test(url)) fail(at(n), 'a file under /field-notes/ is unreachable (the rewrite is forced) — put images under /assets/');
    }
  };
  let inFence = false;
  let n = 0;
  while (n < lines.length) {
    const line = lines[n];
    if (/^```/.test(line)) { inFence = !inFence; n++; continue; }
    if (inFence) { n++; continue; }
    if (isDirectiveLine(line)) {
      const kind = (line.match(/^::([a-z]+)/) || [])[1];
      const start = n;
      // The $-figure ban covers a directive's ARGS too (a best="…" label,
      // a coupon code), and every body line (a picks label, a ~/= line, an
      // FAQ answer) — same prose rules, same reasons.
      if (TYPED_PRICE.test(line)) fail(at(n), 'typed dollar figure in a directive\'s arguments');
      let dirBody;
      if (BODY_DIRECTIVE_KINDS.includes(kind)) {
        const c = collectDirectiveBody(lines, n + 1);
        if (!c.closed) fail(at(n), '::' + kind + ' block is not closed with a lone "::"');
        dirBody = c.body;
        dirBody.forEach((bl, k) => scanProse(bl, n + 1 + k));
        n = c.next;
      } else n++;
      const d = parseDirective(line, dirBody);
      if (!d) { fail(at(start), 'directive does not parse: ' + line.trim()); continue; }
      if (d.kind === 'fit' && (d.part !== 'barrel' || d.gun) && !GUN_META[d.gun]) fail(at(start), 'fit directive names a gun the registry does not know: ' + d.gun);
      if (d.kind === 'compare' && d.gun && !GUN_META[d.gun]) fail(at(start), 'compare directive names a gun the registry does not know: ' + d.gun);
      continue;
    }
    scanProse(line, n);
    n++;
  }
  if (inFence) fail(null, 'unclosed code fence');

  // ── fit-box placement (Alex, 2026-11-25) ──
  // A ::fit box closes its group: it goes after the LAST product card of
  // the parts it covers, never between cards. So within one H2 section a
  // ::fit followed by a ::rank fails (an H3 sub-group resets it) — the box would sit under one card
  // while describing several, or repeat once per card.
  {
    let fence = false, fitAt = null;
    for (const [k, line] of lines.entries()) {
      if (/^```/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      // An H3 starts a group too: one H2 may hold several sub-groups
      // ("Compensated slides" → one H3 per barrel system), each closed by
      // its own box.
      if (/^#{2,3}\s/.test(line)) { fitAt = null; continue; }
      if (/^::fit\b/.test(line)) { if (fitAt == null) fitAt = k; continue; }
      if (/^::rank\b/.test(line) && fitAt != null) {
        fail(at(k), '::rank after a ::fit box in the same H2 section (box at line ' + at(fitAt) + ') — a fit box goes after the last product card of its group, never between cards');
        fitAt = null;
      }
    }
  }

  let r;
  try { r = renderMarkdown(body); } catch (e) { fail(null, 'renderMarkdown threw: ' + (e && e.message)); return { meta, body, issues, blocks: [], headings: [], lines, fmLines }; }

  // ── the heading lint ──
  // The page's one <h1> is the front-matter title, rendered by field-note.mjs;
  // a `# ` heading in the body is a second one. The table of contents lists
  // every H2, so an H2 that names nothing ("Overview") is a TOC entry that
  // tells a reader nothing. An H3 outside a ::rank card is allowed but
  // flagged: the TOC skips H3s.
  const headingLine = (text) => { const k = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(text)); return k === -1 ? null : at(k); };
  for (const h of r.headings) {
    if (h.level === 1) fail(headingLine(h.text), 'a "# " heading in the body — the title is the page’s one H1; use "##"');
    if (h.level === 2 && VAGUE_H2.includes(h.text.trim().toLowerCase())) fail(headingLine(h.text), 'H2 "' + h.text.trim() + '" names nothing — the table of contents lists it; say what the section answers');
    if (h.level === 3) warn(headingLine(h.text), 'H3 "' + h.text.trim() + '" — the table of contents skips H3s (fine for a sub-point; promote it if readers will jump to it)');
    if (h.toc != null && (h.toc.length > 40 || TYPED_PRICE.test(h.toc))) fail(headingLine(h.text), '{toc="' + h.toc + '"} must be a short label (≤ 40 chars, no $ figure)');
  }
  // A {toc=…} the renderer could not split would reach the page as text.
  for (const [k, line] of lines.entries()) {
    if (/^#{1,6}\s/.test(line) && /\{toc=/.test(line) && !/\{toc="[^"]*"\}\s*$/.test(line)) fail(at(k), 'malformed {toc="…"} label — it must close the heading line exactly as {toc="Short label"}');
  }

  // ── ::picks, structurally (no catalog needed) ──
  const rankSlugs = new Set(r.blocks.filter((b) => b.kind === 'rank').map((b) => b.slug));
  for (const b of r.blocks) {
    if (b.kind !== 'picks') continue;
    if (b.picks.length < 3 || b.picks.length > 7) fail(null, '::picks has ' + b.picks.length + ' pick(s) — it takes 3–7');
    for (const p of b.picks) if (!rankSlugs.has(p.slug)) fail(null, '::picks names ' + p.slug + ' with no ::rank card for it on the page — the jump link would land nowhere');
  }

  // ── the voice (field-notes/VOICE.md) and the type's sections ──
  for (const hit of lintVoice(lines, { nameCheck })) {
    const what = hit.where + (hit.phrase ? ' "' + hit.phrase + '"' : '') + ' (' + hit.group + ') — ' + hit.why;
    (hit.level === 'fail' ? fail : warn)(at(hit.line), what);
  }
  for (const msg of lintSections({ type: meta.type, title: meta.title, blocks: r.blocks, headings: r.headings })) {
    warn(null, '[' + (meta.type || 'no type') + '] missing — ' + msg);
  }

  return { meta, body, issues, blocks: r.blocks, headings: r.headings, lines, fmLines };
}
