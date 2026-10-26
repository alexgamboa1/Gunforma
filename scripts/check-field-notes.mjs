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
//   - a directive line that does not parse (it would render as nothing),
//     and a ::picks/::rank/::faq block left unclosed
//   - a fit or compare directive naming a gun the registry does not know
//   - a guide-block slug that is not a live catalog product (against the
//     catalog fixture; the live half is check-routes.mjs) — a missing card
//     is a visible gap at request time, and must never ship
//   - ::picks outside 3–7 entries, or naming a part with no ::rank card on
//     the page; a ::compare column or category _guide-blocks.mjs does not
//     declare, a compare of fewer than 2 parts, or one mixing categories
//   - a typed dollar figure in a directive's args or body — the ban covers
//     a best="…" label, a pros/cons line and an FAQ answer exactly as prose
//   - a malformed registry changelog entry (not "YYYY-MM-DD: what changed")
//   - a prose link straight to a retailer — a buy link goes through the
//     ::price block and /go/, or it earns nothing and logs nothing
//   - an image under /field-notes/ — the forced rewrite swallows that
//     prefix, so the image 404s; article images live under /assets/
//   - a title, description or author that is missing or out of bounds, a
//     type outside the three the index page knows, a bad slug, a malformed
//     or inverted date pair
// No network: this is tree-dependent, not time-dependent. The live half —
// that every slug in a block exists in the catalog — is check-routes.mjs,
// which reads x-field-note-products / x-field-note-fits off the wire.
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { FIELD_NOTES, FIELD_NOTES_DIR, fieldNoteFile } = await import(join(ROOT, 'netlify/functions/_field-notes-meta.mjs'));
const { parseFrontMatter, renderMarkdown, isDirectiveLine, parseDirective, BODY_DIRECTIVE_KINDS, collectDirectiveBody } = await import(join(ROOT, 'netlify/functions/_markdown.mjs'));
const { GUN_META } = await import(join(ROOT, 'netlify/functions/_guide-meta.mjs'));
const { GUIDE_SPECS, colMeta } = await import(join(ROOT, 'netlify/functions/_guide-blocks.mjs'));

// The OFFLINE half of "every slug in a block resolves to a live product":
// the catalog as read with the public key, captured by display-name.test.mjs
// (`node scripts/display-name.test.mjs --refresh-fixture` rewrites it; it
// already excludes discontinued parts). The live half — the served page's
// x-field-note-products header — is check-routes.mjs. A part added to the
// catalog after the capture fails here until the fixture refreshes, which
// is the same friction display-name.test.mjs already carries.
const CATALOG = JSON.parse(await readFile(join(ROOT, 'scripts/fixtures/product-names.json'), 'utf8')).products;
const CATALOG_CATEGORY = new Map(CATALOG.map((p) => [p.slug, p.category]));

// Gunforma guides rank aftermarket parts only (CLAUDE.md, Field Notes
// evidence rules; Alex, 2026-10-26, on the XMacro grip guide). The catalog
// has no per-product OEM flag — manufacturers.is_oem marks the brand, which
// also sells rankable accessories — so this enforces the half the naming
// convention carries: a ::picks/::rank slug whose brand is an OEM's AND
// whose stored name holds the standalone word "OEM" is a factory part.
// Aftermarket names that merely mention OEM ("… OEM Style Mag Release",
// "… for SIG P365 OEM Grip") belong to other brands and pass. A factory
// part the convention does not mark (the factory magazines, the
// manual-safety kit) is carried by the doc rule, not this check.
const OEM_BRANDS = ['Sig Sauer'];
const CATALOG_FACTORY = new Map(CATALOG.map((p) => [p.slug,
  OEM_BRANDS.includes(p.brand) && /\bOEM\b/.test(p.name || '')]));

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
  if (a.changelog != null) {
    if (!Array.isArray(a.changelog) || !a.changelog.length) fail(id + ': changelog must be a non-empty array of strings');
    else for (const e of a.changelog) {
      if (typeof e !== 'string' || !/^\d{4}-\d{2}-\d{2}: .+$/.test(e) || Number.isNaN(Date.parse(e.slice(0, 10)))) {
        fail(id + ': changelog entry is not "YYYY-MM-DD: what changed": ' + JSON.stringify(e));
      } else if (TYPED_PRICE.test(e)) fail(id + ': typed dollar figure in a changelog entry');
    }
  }
  for (const k of Object.keys(a)) if (!['slug', 'published', 'updated', 'draft', 'changelog'].includes(k)) fail(id + ': unknown registry key "' + k + '"');
}

// ── files ↔ registry ─────────────────────────────────────────────────────
const files = (await readdir(join(ROOT, FIELD_NOTES_DIR))).filter((f) => f.endsWith('.md')).sort();
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (!seen.has(slug)) fail(FIELD_NOTES_DIR + '/' + f + ': no registry row — a file is not a page until _field-notes-meta.mjs declares it');
}

// ── each declared article ────────────────────────────────────────────────
for (const a of FIELD_NOTES) {
  const id = a.slug;
  const file = join(ROOT, fieldNoteFile(a.slug));
  try { await access(file); } catch { fail(id + ': declared but ' + fieldNoteFile(a.slug) + ' does not exist'); continue; }
  const src = await readFile(file, 'utf8');
  const { meta, body } = parseFrontMatter(src);
  const before = failures;

  if (!meta.title) fail(id + ': front matter has no title');
  else if (meta.title.length > 90) fail(id + ': title over 90 chars (' + meta.title.length + ')');
  if (!meta.description) fail(id + ': front matter has no description');
  else if (meta.description.length < 50 || meta.description.length > 200) fail(id + ': description must be 50–200 chars, is ' + meta.description.length);
  // author is optional (no byline is rendered without one — never a
  // placeholder), but a credential with no author under it renders nothing.
  if (meta.author_credential && !meta.author) fail(id + ': author_credential without an author');
  if (!TYPES.includes(meta.type)) fail(id + ': type must be one of ' + TYPES.join('/') + ', is "' + (meta.type || '') + '"');
  if (!meta.category) fail(id + ': front matter has no category');
  for (const k of ['published', 'updated', 'date', 'slug']) if (k in meta) fail(id + ': "' + k + '" belongs in _field-notes-meta.mjs, not the front matter');
  if (meta.cover && !/^(https?:\/\/|\/assets\/)/.test(meta.cover)) fail(id + ': cover must be an https URL or a path under /assets/');

  if (TYPED_PRICE.test(meta.title || '') || TYPED_PRICE.test(meta.description || '')) fail(id + ': typed dollar figure in the title or description');

  const lines = body.split('\n');
  const fmLines = src.slice(0, src.length - body.length).split('\n').length - 1;   // lines the front matter took
  const whereAt = (n) => id + ':' + (n + 1 + fmLines);
  const scanProse = (line, where) => {
    if (TYPED_PRICE.test(line)) fail(where + ': typed dollar figure — prices render live through ::price, never typed');
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const url = m[1];
      const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1];
      if (host && RETAILER_HOSTS.some((h) => host === h || host.endsWith('.' + h))) fail(where + ': prose link to a retailer (' + host + ') — use a ::price block');
      if (/^\/field-notes\//.test(url) && !/^\/field-notes\/[a-z0-9-]+$/.test(url)) fail(where + ': a file under /field-notes/ is unreachable (the rewrite is forced) — put images under /assets/');
    }
  };
  let inFence = false;
  let n = 0;
  while (n < lines.length) {
    const line = lines[n];
    const where = whereAt(n);
    if (/^```/.test(line)) { inFence = !inFence; n++; continue; }
    if (inFence) { n++; continue; }
    if (isDirectiveLine(line)) {
      const kind = (line.match(/^::([a-z]+)/) || [])[1];
      // The $-figure ban covers a directive's ARGS too (a best="…" label,
      // a coupon code) — the forEach this replaced skipped directive lines.
      if (TYPED_PRICE.test(line)) fail(where + ': typed dollar figure in a directive\'s arguments');
      let dirBody;
      if (BODY_DIRECTIVE_KINDS.includes(kind)) {
        const c = collectDirectiveBody(lines, n + 1);
        if (!c.closed) fail(where + ': ::' + kind + ' block is not closed with a lone "::"');
        dirBody = c.body;
        // …and every BODY line: a pros/cons line, a picks label, an FAQ
        // answer. Same prose rules, same reasons.
        dirBody.forEach((bl, k) => scanProse(bl, whereAt(n + 1 + k)));
        n = c.next;
      } else n++;
      const d = parseDirective(line, dirBody);
      if (!d) { fail(where + ': directive does not parse: ' + line.trim()); continue; }
      if (d.kind === 'fit' && !GUN_META[d.gun]) fail(where + ': fit directive names a gun the registry does not know: ' + d.gun);
      if (d.kind === 'compare' && d.gun && !GUN_META[d.gun]) fail(where + ': compare directive names a gun the registry does not know: ' + d.gun);
      continue;
    }
    scanProse(line, where);
    n++;
  }
  if (inFence) fail(id + ': unclosed code fence');

  let r;
  try { r = renderMarkdown(body); } catch (e) { fail(id + ': renderMarkdown threw: ' + (e && e.message)); continue; }

  // ── the guide blocks, structurally ─────────────────────────────────────
  // A slug that does not resolve to a live product is a BUILD failure, not
  // a silently skipped card (the page renders a visible missing line, but
  // that must never ship). Resolution is against the catalog fixture — see
  // the CATALOG comment above for the offline/live split.
  const mustResolve = (slug, what) => {
    if (!CATALOG_CATEGORY.has(slug)) fail(id + ': ' + what + ' names a slug not in the live catalog (fixture): ' + slug);
  };
  // Ranked and picked means recommended, and Gunforma never recommends the
  // factory part over the aftermarket field it baselines — see the comment
  // on CATALOG_FACTORY above for what this can and cannot see.
  const mustBeAftermarket = (slug, what) => {
    if (CATALOG_FACTORY.get(slug)) fail(id + ': ' + what + ' names a factory part (' + slug + ') — Gunforma guides rank aftermarket parts only; an OEM part may appear in ::fit blocks and as baseline prose');
  };
  const rankSlugs = new Set(r.blocks.filter((b) => b.kind === 'rank').map((b) => b.slug));
  for (const b of r.blocks) {
    if (b.kind === 'picks') {
      if (b.picks.length < 3 || b.picks.length > 7) fail(id + ': ::picks has ' + b.picks.length + ' pick(s) — it takes 3–7');
      for (const p of b.picks) {
        mustResolve(p.slug, '::picks');
        mustBeAftermarket(p.slug, '::picks');
        if (!rankSlugs.has(p.slug)) fail(id + ': ::picks names ' + p.slug + ' with no ::rank card for it on the page — the jump link would land nowhere');
      }
    }
    if (b.kind === 'rank') {
      mustResolve(b.slug, '::rank');
      mustBeAftermarket(b.slug, '::rank');
      const cat = CATALOG_CATEGORY.get(b.slug);
      if (cat && !GUIDE_SPECS[cat]) fail(id + ': ::rank ' + b.slug + ' is a ' + cat + ', a category _guide-blocks.mjs declares no spec columns for — add its entry there');
    }
    if (b.kind === 'compare') {
      if (!GUIDE_SPECS[b.category]) fail(id + ': ::compare names category "' + b.category + '", which _guide-blocks.mjs does not declare (valid: ' + Object.keys(GUIDE_SPECS).join(', ') + ')');
      else for (const c of b.cols) if (!colMeta(b.category, c)) fail(id + ': ::compare column "' + c + '" is not declared for ' + b.category + ' in _guide-blocks.mjs');
      if (b.slugs.length < 2) fail(id + ': ::compare lists ' + b.slugs.length + ' part — a comparison takes at least 2');
      for (const s of b.slugs) {
        mustResolve(s, '::compare');
        const cat = CATALOG_CATEGORY.get(s);
        if (cat && cat !== b.category) fail(id + ': ::compare is a ' + b.category + ' table but ' + s + ' is a ' + cat);
      }
    }
  }

  if (!r.blocks.length && !a.draft) console.log('      ' + id + ': no live-data block (fine for an article that needs none)');
  if (failures === before) pass(id + (a.draft ? ' (draft)' : '') + ' — ' + r.blocks.length + ' block(s)');
}

console.log(failures === 0
  ? 'ok: ' + FIELD_NOTES.length + ' declared article(s), ' + files.length + ' file(s), every rule holds'
  : failures + ' FAILURE(S)');
process.exit(failures ? 1 : 0);
