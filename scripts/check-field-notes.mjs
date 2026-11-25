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
//   - a `+ pro` / `- con` line in a ::rank card outside the draft fixture —
//     Field Notes use `~` (changes from factory) and `=` (stays the same)
//   - an ::unlocks, ::colors or ::build slug that is not a live catalog
//     product, an ::unlocks or ::build slug in the wrong category for its
//     role, or a ::build with an unknown or repeated role (it fails parsing)
//   - a malformed registry changelog entry (not "YYYY-MM-DD: what changed")
//   - a prose link straight to a retailer — a buy link goes through the
//     ::price block and /go/, or it earns nothing and logs nothing
//   - an image under /field-notes/ — the forced rewrite swallows that
//     prefix, so the image 404s; article images live under /assets/
//   - a title, description or author that is missing or out of bounds, a
//     type outside FIELD_NOTE_TYPES (field-notes-voice.mjs), a bad slug, a malformed
//     or inverted date pair
// No network: this is tree-dependent, not time-dependent. The live half —
// that every slug in a block exists in the catalog — is check-routes.mjs,
// which reads x-field-note-products / x-field-note-fits off the wire.
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { FIELD_NOTES, FIELD_NOTES_DIR, fieldNoteFile } = await import(join(ROOT, 'netlify/functions/_field-notes-meta.mjs'));
const { parseFrontMatter, renderMarkdown, isDirectiveLine, parseDirective, BODY_DIRECTIVE_KINDS, collectDirectiveBody, BUILD_ROLES } = await import(join(ROOT, 'netlify/functions/_markdown.mjs'));
const { GUN_META } = await import(join(ROOT, 'netlify/functions/_guide-meta.mjs'));
const { GUIDE_SPECS, colMeta, BUILD_ROLE_META } = await import(join(ROOT, 'netlify/functions/_guide-blocks.mjs'));
// The per-article text checks — front matter, $ ban, links, directive
// syntax, headings, ::picks, the voice and the type's sections — are ONE
// module shared with the admin editor; TYPED_PRICE also covers the
// registry changelog below.
const { lintNote, TYPED_PRICE } = await import(join(ROOT, 'scripts/field-notes-lint.mjs'));

// The OFFLINE half of "every slug in a block resolves to a live product":
// the catalog as read with the public key, captured by display-name.test.mjs
// (`node scripts/display-name.test.mjs --refresh-fixture` rewrites it; it
// already excludes discontinued parts). The live half — the served page's
// x-field-note-products header — is check-routes.mjs. A part added to the
// catalog after the capture fails here until the fixture refreshes, which
// is the same friction display-name.test.mjs already carries.
const CATALOG = JSON.parse(await readFile(join(ROOT, 'scripts/fixtures/product-names.json'), 'utf8')).products;
const CATALOG_CATEGORY = new Map(CATALOG.map((p) => [p.slug, p.category]));

// Every barrel's fitting slides (v_barrel_slide_fit, fit_status = 'fits',
// slide approved and not discontinued), captured by fit-barrel-block.test.mjs
// (`node scripts/fit-barrel-block.test.mjs --refresh-fixture`). A
// ::fit barrel=a,b group is one box, so its barrels must fit EXACTLY the
// same slides — a group must never hide a difference. The renderer
// re-checks this live and refuses a group whose sets have since diverged.
const BARREL_FITS = JSON.parse(await readFile(join(ROOT, 'scripts/fixtures/barrel-slide-fit.json'), 'utf8')).fits;
// The slide side (::fit slide= against=frame|barrel): the grip classes each
// slide fits, captured by fit-slide-block.test.mjs --refresh-fixture, and
// the barrel fixture turned around. A group is one box, so its slides must
// share ONE fit set.
const { barrelsBySlide, SLIDE_REFRESH_COMMAND } = await import('./slide-fit-fixture.mjs');
const SLIDE_FRAME_FITS = JSON.parse(await readFile(join(ROOT, 'scripts/fixtures/slide-frame-fit.json'), 'utf8')).fits;
const SLIDE_BARRELS = barrelsBySlide(BARREL_FITS);

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

// The parser's role list and the page's role meta are two files; a role in
// one and not the other would parse and then render as its raw key (or
// resolve against no category), so they are held in step here.
{
  const metaKeys = Object.keys(BUILD_ROLE_META).sort().join(',');
  const roleKeys = BUILD_ROLES.slice().sort().join(',');
  if (metaKeys !== roleKeys) fail('_markdown.mjs BUILD_ROLES and _guide-blocks.mjs BUILD_ROLE_META disagree: [' + roleKeys + '] vs [' + metaKeys + ']');
}

// The live articles written under the pros/cons shape before the
// changes/same rule landed (2026-11-19). See the rank check below.
const PROS_CONS_GRANDFATHERED = new Set(['best-p365-xmacro-grip-modules']);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (a.tags != null) {
    if (!Array.isArray(a.tags) || !a.tags.length) fail(id + ': tags must be a non-empty array of slugs (omit the key for none)');
    else {
      for (const t of a.tags) if (typeof t !== 'string' || !SLUG_RE.test(t)) fail(id + ': tag is not a lowercase slug: ' + JSON.stringify(t));
      if (new Set(a.tags).size !== a.tags.length) fail(id + ': a tag is listed twice');
    }
  }
  for (const k of Object.keys(a)) if (!['slug', 'published', 'updated', 'draft', 'changelog', 'tags'].includes(k)) fail(id + ': unknown registry key "' + k + '"');
}

// ── files ↔ registry ─────────────────────────────────────────────────────
// Documents that live beside the articles and are not articles: the voice
// rules every note is written to. Named, not pattern-matched — any other
// stray .md is still a file nothing serves. (Never a page either way: a
// non-slug name like VOICE is a 404 under the forced /field-notes/* rule.)
const DOC_FILES = new Set(['VOICE.md']);
const files = (await readdir(join(ROOT, FIELD_NOTES_DIR))).filter((f) => f.endsWith('.md') && !DOC_FILES.has(f)).sort();
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (!seen.has(slug)) fail(FIELD_NOTES_DIR + '/' + f + ': no registry row — a file is not a page until _field-notes-meta.mjs declares it');
}

// ── each declared article ────────────────────────────────────────────────
const liveCategories = new Set();   // front-matter categories of live articles
for (const a of FIELD_NOTES) {
  const id = a.slug;
  const file = join(ROOT, fieldNoteFile(a.slug));
  try { await access(file); } catch { fail(id + ': declared but ' + fieldNoteFile(a.slug) + ' does not exist'); continue; }
  const src = await readFile(file, 'utf8');
  const { meta, body } = parseFrontMatter(src);
  const before = failures;

  // The per-article checks that need only the article text live in ONE
  // module, shared with the admin editor (scripts/field-notes-lint.mjs):
  // front matter, the typed-$ ban, retailer and unreachable links, directive
  // syntax, the heading lint, the ::picks rules, the voice lint (FAILs) and
  // the type's sections (WARNs). The checks below it need the catalog.
  const nameCheck = (slug, para) => {
    const p = CATALOG.find((x) => x.slug === slug);
    if (!p) return true;   // a missing slug is already a failure below
    const low = para.toLowerCase();
    return [p.brand, p.name].filter(Boolean).some((s) => low.includes(String(s).toLowerCase()));
  };
  const linted = lintNote(src, { nameCheck });
  for (const is of linted.issues) {
    const where = id + (is.line ? ':' + is.line : '');
    if (is.level === 'fail') fail(where + ': ' + is.msg);
    else console.log('warn  ' + where + ': ' + is.msg);
  }
  if (!a.draft && meta.category) liveCategories.add(meta.category);
  const r = { blocks: linted.blocks, headings: linted.headings };

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
  for (const b of r.blocks) {
    if (b.kind === 'picks') {
      for (const p of b.picks) {
        mustResolve(p.slug, '::picks');
        mustBeAftermarket(p.slug, '::picks');
      }
    }
    if (b.kind === 'rank') {
      mustResolve(b.slug, '::rank');
      mustBeAftermarket(b.slug, '::rank');
      const cat = CATALOG_CATEGORY.get(b.slug);
      if (cat && !GUIDE_SPECS[cat]) fail(id + ': ::rank ' + b.slug + ' is a ' + cat + ', a category _guide-blocks.mjs declares no spec columns for — add its entry there');
      // The baseline is the factory part a changes/same card compares
      // against — it must resolve, and the aftermarket rule deliberately
      // does NOT apply to it (naming the factory part is its point).
      if (b.baseline) mustResolve(b.baseline, '::rank baseline');
      // Pros/cons are the retired shape: they still parse so the renderer
      // fixture keeps the old path covered, but a real article may not use
      // them. The fixture is a draft (a 404 on the apex), which is the line.
      // ONE live article predates the rule (2026-11-19) and this PR may not
      // edit prose, so it is grandfathered BY SLUG until Alex converts its
      // lines — remove its entry here in the commit that does. No new slug
      // may be added without the same conversation.
      const grandfathered = PROS_CONS_GRANDFATHERED.has(a.slug);
      if (!a.draft && !grandfathered && (b.pros.length || b.cons.length)) {
        fail(id + ": ::rank " + b.slug + " uses +/- lines — Field Notes don't use pros/cons — use ~ (changes from factory) and = (stays the same).");
      }
    }
    if (b.kind === 'unlocks') {
      mustResolve(b.slug, '::unlocks');
      const cat = CATALOG_CATEGORY.get(b.slug);
      if (cat && cat !== b.part) fail(id + ': ::unlocks ' + b.part + '= names ' + b.slug + ', which is a ' + cat + ', not a ' + b.part);
    }
    if (b.kind === 'fit' && b.part === 'barrel') {
      // ::fit barrel= lists the fitting slides — every slug must be a live
      // product, and a barrel; a group's barrels must fit the same slides.
      for (const s of b.slugs) {
        mustResolve(s, '::fit barrel=');
        const cat = CATALOG_CATEGORY.get(s);
        if (cat && cat !== 'barrel') fail(id + ': ::fit barrel= names ' + s + ', which is a ' + cat + ', not a barrel');
      }
      if (b.slugs.length > 1) {
        const missing = b.slugs.filter((s) => CATALOG_CATEGORY.get(s) === 'barrel' && !BARREL_FITS[s]);
        if (missing.length) fail(id + ': ::fit barrel= group names ' + missing.join(', ') + ', which scripts/fixtures/barrel-slide-fit.json does not carry — refresh it: node scripts/fit-barrel-block.test.mjs --refresh-fixture');
        else {
          const sets = b.slugs.map((s) => new Set(BARREL_FITS[s] || []));
          const all = [...new Set(sets.flatMap((x) => [...x]))].sort();
          const diff = all.filter((sl) => !sets.every((x) => x.has(sl)));
          if (diff.length) fail(id + ': ::fit barrel=' + b.slugs.join(',') + ' groups barrels that do not fit the same slides — ' +
            diff.map((sl) => sl + ' fits ' + b.slugs.filter((s, i) => sets[i].has(sl)).join(' + ') + ' only').join('; ') +
            '. Split the group, or refresh the fixture if the fit data changed.');
        }
      }
    }
    if (b.kind === 'fit' && b.part === 'slide') {
      // ::fit slide= against=frame|barrel — every slug a live slide; a
      // group's slides must share one fit set (grip class → verdict, or the
      // barrels they take).
      const what = '::fit slide= against=' + b.against;
      for (const s of b.slugs) {
        mustResolve(s, what);
        const cat = CATALOG_CATEGORY.get(s);
        if (cat && cat !== 'slide') fail(id + ': ' + what + ' names ' + s + ', which is a ' + cat + ', not a slide');
      }
      const isSlide = (s) => CATALOG_CATEGORY.get(s) === 'slide';
      if (b.against === 'frame') {
        const missing = b.slugs.filter((s) => isSlide(s) && !SLIDE_FRAME_FITS[s]);
        if (missing.length) fail(id + ': ' + what + ' names ' + missing.join(', ') + ', which scripts/fixtures/slide-frame-fit.json does not carry — refresh it: ' + SLIDE_REFRESH_COMMAND);
        else if (b.slugs.length > 1) {
          const key = (s) => JSON.stringify(SLIDE_FRAME_FITS[s] || {});
          const odd = b.slugs.filter((s) => isSlide(s) && key(s) !== key(b.slugs[0]));
          if (odd.length) fail(id + ': ' + what + ' groups slides that do not fit the same grips — ' + odd.join(', ') + ' differ from ' + b.slugs[0] +
            ' (' + odd.map((s) => Object.keys({ ...SLIDE_FRAME_FITS[s], ...SLIDE_FRAME_FITS[b.slugs[0]] })
              .filter((c) => (SLIDE_FRAME_FITS[s] || {})[c] !== (SLIDE_FRAME_FITS[b.slugs[0]] || {})[c]).join(', ')).join('; ') +
            '). Split the group, or refresh the fixture if the fit data changed.');
        }
      } else if (b.slugs.length > 1) {
        const sets = b.slugs.map((s) => new Set(SLIDE_BARRELS[s] || []));
        const all = [...new Set(sets.flatMap((x) => [...x]))].sort();
        const diff = all.filter((br) => !sets.every((x) => x.has(br)));
        if (diff.length) fail(id + ': ' + what + ' groups slides that do not take the same barrels — ' +
          diff.map((br) => br + ' fits ' + b.slugs.filter((s, i) => sets[i].has(br)).join(' + ') + ' only').join('; ') +
          '. Split the group, or refresh the fixture if the fit data changed.');
      }
    }
    if (b.kind === 'colors') {
      if (b.baseline) mustResolve(b.baseline, '::colors baseline');
      for (const s of b.slugs) mustResolve(s, '::colors');
    }
    if (b.kind === 'build') {
      for (const p of b.parts) {
        mustResolve(p.slug, '::build ' + p.role + '=');
        const want = (BUILD_ROLE_META[p.role] || {}).category;
        const cat = CATALOG_CATEGORY.get(p.slug);
        if (cat && want && cat !== want) fail(id + ': ::build ' + p.role + '= names ' + p.slug + ', which is a ' + cat + ', not a ' + want);
      }
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

// The index page's cards are static HTML (crawlers do not run JS), so
// field-notes.html and the registry must agree in both directions: every
// live article is linked — the first one shipped with no inbound link but
// the sitemap, the /fit/ orphan shape all over again — and no draft is,
// because a draft is a 404 on the apex and a linked one is a dead link
// that renders perfectly. Order is part of the contract too: newest first.
{
  const indexHtml = await readFile(join(ROOT, 'field-notes.html'), 'utf8');
  const posOf = (a) => indexHtml.indexOf('href="/field-notes/' + a.slug + '"');
  for (const a of FIELD_NOTES) {
    const pos = posOf(a);
    if (!a.draft && pos === -1) fail('field-notes.html has no card linking /field-notes/' + a.slug + ' — the index lists every live article; add its card (and keep newest first)');
    if (a.draft && pos !== -1) fail('field-notes.html links the DRAFT /field-notes/' + a.slug + ' — a draft is a 404 on the apex; the card ships in the commit that flips the flag');
  }
  const live = FIELD_NOTES.filter((a) => !a.draft && posOf(a) !== -1)
    .sort((x, y) => (x.published < y.published ? 1 : x.published > y.published ? -1 : 0));
  for (let i = 1; i < live.length; i++) {
    if (posOf(live[i]) < posOf(live[i - 1])) {
      fail('field-notes.html lists ' + live[i].slug + ' (published ' + live[i].published + ') above ' + live[i - 1].slug + ' (published ' + live[i - 1].published + ') — the index is newest first');
      break;
    }
  }
  // The category tabs derive in the browser from the cards' data-category
  // values ("All" is the only tab in markup), so a tab naming a category
  // with zero live articles can only come from two places, and both fail:
  // a card whose data-category no live article carries, or a hardcoded
  // category tab reintroduced into the markup.
  for (const m of indexHtml.matchAll(/data-category="([^"]*)"/g)) {
    if (!liveCategories.has(m[1])) fail('field-notes.html: a card carries data-category="' + m[1] + '", a category no live article has — the derived tab would name an empty category');
  }
  for (const m of indexHtml.matchAll(/data-filter="category:([^"]*)"/g)) {
    if (!liveCategories.has(m[1])) fail('field-notes.html: hardcoded tab for category "' + m[1] + '" with zero live articles — tabs derive from the cards; only "All" belongs in the markup');
  }
  if (!failures) pass('field-notes.html lists every live article, no draft, newest first; every category named has a live article');
}

console.log(failures === 0
  ? 'ok: ' + FIELD_NOTES.length + ' declared article(s), ' + files.length + ' file(s), every rule holds'
  : failures + ' FAILURE(S)');
process.exit(failures ? 1 : 0);
