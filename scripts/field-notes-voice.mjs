// field-notes-voice.mjs — the Field Notes voice, as a lint. Gunforma does
// not review or test products (field-notes/VOICE.md), so review language
// in an article is a credibility risk, and the voice is a build guard
// rather than a style note. Imported by scripts/check-field-notes.mjs
// (which runs it over every declared article on every deploy) and by
// scripts/field-notes-voice.test.mjs (which proves every rule fires).
// Pure: nothing runs on import, so the registry audit in check-all.sh
// rightly does not count this file as a check.
//
// WHAT IT SCANS: body prose (paragraphs, lists, table cells), headings,
// ::picks labels, ::rank best= labels, ~ and = lines, ::build names and
// ::faq answers. It skips fenced code, inline code spans, link URLs (the
// link TEXT is scanned) and blockquotes — a quote is an owner's own words,
// copied verbatim, and is held to a different rule: it must carry an
// attribution linking the public build it came from.
//
// Matching is whole words, case-insensitive; a multi-word phrase matches
// across any run of spaces.

// ── the two word lists, in one constant ─────────────────────────────────
// `why` is printed with every hit. FAIL breaks the build; WARN is printed.
const NO_TEST = 'gunforma doesn\u2019t test products \u2014 state a spec, a fit row, or the maker\u2019s wording';
export const VOICE_RULES = {
  fail: [
    { group: 'implied testing', why: NO_TEST,
      phrases: ['we tested', 'in our testing', 'our testing', 'at the range'],
      // "after 500 rounds", "1,000 rounds through", "2k rounds through"
      patterns: [/\bafter\s+\d[\d,.]*k?\s+rounds\b/i, /\b\d[\d,.]*k?\s+rounds\s+through\b/i] },
    { group: 'verdict', why: 'a verdict \u2014 ' + NO_TEST + '; the reader decides what a difference is worth',
      phrases: ['best overall', 'top pick', 'our favorite', 'our favourite', 'must-have', 'must have',
                'game changer', 'game-changer', 'worth it', 'we recommend', 'we love'] },
    { group: 'feel word', why: 'a feel word \u2014 ' + NO_TEST,
      phrases: ['crisp', 'snappy', 'buttery', 'feels', 'feel great'] },
    { group: 'hype', why: 'hype \u2014 ' + NO_TEST,
      phrases: ['badass'] },
  ],
  warn: [
    { group: 'unbacked quality claim', why: 'a quality claim \u2014 back it with a spec, a fit row or the maker\u2019s wording, or cut it',
      phrases: ['reliable', 'reliability', 'accurate', 'accuracy', 'durable', 'smooth', 'comfortable',
                'premium', 'solid', 'flat-shooting', 'reduces recoil'] },
    { group: 'pro/con framing', why: 'different is not worse \u2014 state the difference with its number; the reader decides what it is worth',
      phrases: ['downside', 'drawback'] },
    { group: 'vague count', why: 'a vague count \u2014 give the number, "in the gunforma catalog"',
      phrases: ['many', 'most', 'several', 'a lot of'] },
  ],
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words: a phrase may not be glued to a letter, digit or hyphen on
// either side — "must-have" matches; "smooth" does not match inside
// "smoothbore", nor "most" inside "almost".
function phraseRe(p) {
  return new RegExp('(?<![A-Za-z0-9-])' + escRe(p).replace(/\s+/g, '\\s+') + '(?![A-Za-z0-9-])', 'i');
}
const COMPILED = Object.fromEntries(['fail', 'warn'].map((level) => [level,
  VOICE_RULES[level].flatMap((r) => [
    ...(r.phrases || []).map((p) => ({ re: phraseRe(p), phrase: p, why: r.why, group: r.group })),
    ...(r.patterns || []).map((re) => ({ re, phrase: null, why: r.why, group: r.group })),
  ])]));

// The text a reader sees: inline code spans dropped, link and image
// targets dropped (their text kept), emphasis markers dropped.
export function visibleText(s) {
  return String(s)
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,2}/g, '');
}

// A label that fails the "Best" rule is reported once, as that rule, not
// again as the "best overall" verdict phrase it also contains.
function scanLabel(text, line, where, hits) {
  if (BEST_LABEL.test(String(text).trim())) {
    hits.push({ level: 'fail', line, where, phrase: String(text).trim(), group: 'verdict label',
      why: 'a "Best" label is a verdict — label the part by what it is ("Lightest aluminium module")' });
    const before = hits.length;
    scanText(text, line, where, hits);
    for (let i = hits.length - 1; i >= before; i--) if (/^best overall$/i.test(hits[i].phrase.replace(/\s+/g, ' '))) hits.splice(i, 1);
    return;
  }
  scanText(text, line, where, hits);
}

function scanText(text, line, where, hits) {
  const t = visibleText(text);
  const found = [];
  for (const level of ['fail', 'warn']) {
    for (const c of COMPILED[level]) {
      const m = t.match(c.re);
      if (m) found.push({ level, line, where, phrase: m[0], group: c.group, why: c.why, from: m.index, to: m.index + m[0].length });
    }
  }
  // One hit per span: "in our testing" is not also reported as "our
  // testing", nor "feel great" as anything shorter inside it.
  for (const f of found) {
    if (found.some((g) => g !== f && g.from <= f.from && g.to >= f.to && (g.to - g.from) > (f.to - f.from))) continue;
    const { from, to, ...hit } = f;
    hits.push(hit);
  }
}

const PROS_CONS_HEADING = /^(pros|cons)(\s*(and|&)\s*(pros|cons))?\s*:?$/i;
const BEST_LABEL = /^best(\s+overall\b.*)?$/i;
// A build page: /b/<slug>-<uuid>, site-relative or on the apex.
const BUILD_LINK = /\]\((https:\/\/gunforma\.com)?\/b\/[a-z0-9-]+\)/i;

// lintVoice(bodyLines, { nameCheck }) → hits: { level, line (0-based in
// bodyLines), where, phrase, group, why }. `nameCheck(slug, paragraph)`
// says whether a ::rank card's following prose paragraph names its
// product (the caller has the catalog); omitted, that check is skipped.
export function lintVoice(lines, { nameCheck } = {}) {
  const hits = [];
  const fail = (line, where, phrase, group, why) => hits.push({ level: 'fail', line, where, phrase, group, why });
  const warn = (line, where, phrase, group, why) => hits.push({ level: 'warn', line, where, phrase, group, why });
  let inFence = false;
  let n = 0;
  while (n < lines.length) {
    const line = lines[n];
    if (/^```/.test(line)) { inFence = !inFence; n++; continue; }
    if (inFence) { n++; continue; }

    // blockquote: skipped for language, held to the attribution rule —
    // a link to the build it came from, on its last line or the next one
    if (/^>\s?/.test(line)) {
      const start = n;
      while (n < lines.length && /^>\s?/.test(lines[n])) n++;
      const last = lines[n - 1];
      let next = n;
      while (next < lines.length && /^\s*$/.test(lines[next])) next++;
      const after = next < lines.length && next - n <= 1 ? lines[next] : '';
      if (!BUILD_LINK.test(last) && !BUILD_LINK.test(after)) {
        fail(start, 'blockquote', null, 'unattributed quote',
          'owner opinions appear only as a quote copied verbatim from a public build and linked to it (/b/\u2026) \u2014 add the attribution');
      }
      continue;
    }

    // directives: only the authored text in them
    const d = line.match(/^::([a-z]+)\b(.*)$/);
    if (d) {
      const kind = d[1];
      const label = (k) => { const m = d[2].match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
      if (kind === 'rank') {
        const best = label('best');
        if (best != null) scanLabel(best, n, '::rank best=', hits);
      }
      if (kind === 'build') { const nm = label('name'); if (nm != null) scanText(nm, n, '::build name', hits); }
      const bodied = ['picks', 'rank', 'faq', 'build'].includes(kind);
      const slug = kind === 'rank' ? (d[2].trim().match(/^([a-z0-9-]+)/) || [])[1] : null;
      n++;
      if (!bodied) continue;
      while (n < lines.length && lines[n].trim() !== '::') {
        const b = lines[n];
        if (kind === 'picks') {
          const p = b.match(/\|\s*(.+?)\s*$/);
          if (p) scanLabel(p[1], n, '::picks label', hits);
        } else if (kind === 'rank') {
          const p = b.match(/^\s*[~=]\s+(.+)$/);
          if (p) scanText(p[1], n, b.trim()[0] === '~' ? '~ line' : '= line', hits);
        } else if (kind === 'faq') {
          const p = b.match(/^\s*A:\s+(.+)$/);
          if (p) scanText(p[1], n, '::faq answer', hits);
        }
        n++;
      }
      n++;   // the closing ::
      // A ::rank card's prose: the paragraph right after the card. It
      // should name its product in full; a card's text that only says
      // "it" reads as the previous card's.
      if (kind === 'rank' && slug && nameCheck) {
        let p = n;
        while (p < lines.length && /^\s*$/.test(lines[p])) p++;
        const para = [];
        const at = p;
        while (p < lines.length && !/^\s*$/.test(lines[p]) && !/^(::|#|>|```)/.test(lines[p])) para.push(lines[p++]);
        if (para.length && !nameCheck(slug, visibleText(para.join(' ')))) {
          warn(at, '::rank prose', null, 'unnamed product', 'the paragraph after the ' + slug + ' card never names the product \u2014 name it in full (brand + product + model) at first mention');
        }
      }
      continue;
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const text = h[2].replace(/\s*\{toc="[^"]*"\}\s*$/, '');
      if (PROS_CONS_HEADING.test(visibleText(text).trim())) fail(n, 'heading', text.trim(), 'pros/cons heading', 'Field Notes don\u2019t use pros/cons \u2014 describe how the part differs from the factory part');
      scanText(text, n, 'heading', hits);
      n++; continue;
    }

    // everything else a reader sees as prose: paragraphs, list items, table cells
    if (!/^\s*$/.test(line)) scanText(line, n, 'prose', hits);
    n++;
  }
  return hits;
}

// ── required sections per type (WARN only) ──────────────────────────────
// What each article type needs to do its job. `doc` is { title, blocks,
// headings } from parseFrontMatter + renderMarkdown.
export const FIELD_NOTE_TYPES = ['fit', 'trap', 'comparison', 'roundup', 'explainer', 'builds', 'new-part'];
const QUESTION_TITLE = /^(what|which|will|does|can|how)\b/i;

export function lintSections({ type, title, blocks, headings }) {
  const out = [];
  const need = (cond, msg) => { if (!cond) out.push(msg); };
  const count = (k) => blocks.filter((b) => b.kind === k).length;
  const h2 = headings.filter((h) => h.level === 2).map((h) => h.text.trim());
  const faqs = blocks.filter((b) => b.kind === 'faq');
  need(faqs.length === 1, 'every type: exactly one ::faq (has ' + faqs.length + ')');
  if (faqs.length === 1) need(faqs[0].qas.length >= 5 && faqs[0].qas.length <= 8, 'every type: the ::faq takes 5\u20138 entries (has ' + faqs[0].qas.length + ')');
  need(!QUESTION_TITLE.test(String(title || '').trim()), 'every type: the title starts with a question word \u2014 a question title loses the head search term up front');
  if (type === 'roundup') {
    need(count('picks') >= 1, 'roundup: a ::picks box');
    need(count('compare') >= 1, 'roundup: a ::compare table');
    need(count('rank') >= 3, 'roundup: at least 3 ::rank cards (has ' + count('rank') + ')');
    need(count('unlocks') >= 1, 'roundup: at least one ::unlocks');
    need(count('build') >= 1, 'roundup: at least one ::build');
    need(h2.some((t) => / vs /i.test(t)), 'roundup: an H2 containing " vs "');
  }
  if (type === 'comparison') {
    need(/ vs /i.test(String(title || '')), 'comparison: the title contains " vs "');
    need(count('compare') >= 1, 'comparison: a ::compare table');
    need(count('unlocks') >= 2, 'comparison: at least 2 ::unlocks (has ' + count('unlocks') + ')');
  }
  if (type === 'fit') {
    need(h2.some((t) => /\bfit/i.test(t) && /\?\s*$/.test(t)), 'fit: an H2 question containing "fit"');
    need(h2.some((t) => /^how fit was checked$/i.test(t)), 'fit: an H2 "How fit was checked"');
    need(count('fit') >= 1, 'fit: a ::fit block');
  }
  if (type === 'trap') {
    need(h2.some((t) => /\bneed/i.test(t)), 'trap: an H2 containing "need"');
    need(count('build') >= 1, 'trap: at least one ::build');
  }
  if (type === 'explainer') {
    need(/^what (is|are)\b/i.test(h2[0] || ''), 'explainer: the first H2 starts "What is" or "What are"');
  }
  if (type === 'builds') {
    need(h2.some((t) => /\bbuilders?\b|\bbuilds\b/i.test(t)), 'builds: an H2 containing "builders" or "builds"');
  }
  return out;
}
