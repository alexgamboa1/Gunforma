#!/usr/bin/env node
// check-category-labels — no category heading reaches a reader as a raw key,
// and no section is declared without a group to render it in.
//
// WHAT SHIPPED. gunforma-build-detail.html's categoryLabel() ended with
// `|| key`, returning the raw parts_snapshot value when the map had no entry
// for it. `mag_release` and `other_parts` both had no entry, and .part-type
// is `text-transform: uppercase` — so the heading rendered "OTHER_PARTS".
// Two live builds were showing it. It renders perfectly in a browser, which
// is the entry criterion for a guard here.
//
// WHAT IT GRADES NOW. The three pages that used to carry their own copy of
// the list read js/build-categories.js instead, so both the emitter and the
// renderer live in that one file:
//
//   emitter    CATEGORIES[].key         the section keys written into
//                                       parts_snapshot
//              CATEGORIES[].dbCategory  the raw products.category values an
//                                       Armory-saved part arrives under
//   renderer   CATEGORY_LABELS + categoryLabel()
//
// The module is EVALUATED, not pattern-matched — the whole real file, with a
// stand-in `window` — so the fallback and the derived maps are graded as the
// pages actually run them. CATEGORIES is additionally read TEXTUALLY out of
// the source, so the keys this check asserts over come from the array as
// written rather than from the same derivation it is checking.
//
// Four assertions:
//   1. Every key the emitter can produce resolves to a mapped label. Labels
//      are derived from CATEGORIES[].label, so this fails when a section is
//      added without one, or when the derivation stops covering a case.
//   2. NOTHING categoryLabel() returns contains an underscore — checked over
//      the emitter's keys AND over synthetic unmapped keys, so a key that
//      nobody has mapped still renders as words.
//   3. The legacy keys still have labels. `other_parts` and `sights` are no
//      longer offered but sit in stored snapshots, and a published build
//      renders whatever its snapshot says.
//   4. THE GROUPS COVER EVERY SECTION EXACTLY ONCE, AND IN CATEGORIES ORDER.
//      The two builder pages render group by group, so a section whose
//      `group` matches no group heading renders in no group and therefore
//      nowhere at all — invisible, with the page looking perfectly normal.
//      And if the groups' order disagreed with CATEGORIES' order, the builder
//      and the published build would list the same sections differently.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = 'js/build-categories.js';
const fail = [];

const moduleSrc = await readFile(join(ROOT, MODULE), 'utf8');

// ── the emitter: CATEGORIES, read textually ───────────────────────────────
// Sliced from `const CATEGORIES = [` to its MATCHING `]` by bracket depth,
// then scanned for key: and dbCategory:. Depth-matching rather than the first
// `\n];` at column 0, because the array lives inside the module's IIFE and is
// indented. Evaluating the slice as JS is not an option either — `custom`
// configs carry nested arrays and the point is to read the source as written.
const catBlock = (() => {
  const start = moduleSrc.indexOf('const CATEGORIES = [');
  if (start === -1) return null;
  let depth = 0;
  for (let i = moduleSrc.indexOf('[', start); i < moduleSrc.length; i++) {
    const ch = moduleSrc[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return moduleSrc.slice(start, i + 1);
    }
  }
  return null;
})();

if (!catBlock) {
  fail.push(`could not find \`const CATEGORIES = [\` … \`]\` in ${MODULE} — `
          + 'if it was renamed or moved, update this check rather than deleting it');
}

const uiKeys = new Set();
const dbKeys = new Set();
const groupRefs = [];          // the `group:` value of each entry, in source order
if (catBlock) {
  for (const m of catBlock.matchAll(/\bkey\s*:\s*'([^']+)'/g)) uiKeys.add(m[1]);
  for (const m of catBlock.matchAll(/\bdbCategory\s*:\s*\[([^\]]*)\]/g)) {
    for (const d of m[1].matchAll(/'([^']+)'/g)) dbKeys.add(d[1]);
  }
  for (const m of catBlock.matchAll(/\bgroup\s*:\s*'([^']+)'/g)) groupRefs.push(m[1]);
  if (uiKeys.size === 0) fail.push('extracted 0 CATEGORIES keys — the extraction regex has gone stale');
  if (groupRefs.length !== uiKeys.size) {
    fail.push(`extracted ${uiKeys.size} CATEGORIES keys but ${groupRefs.length} \`group:\` values — `
            + 'every section must declare exactly one group, or it renders in none');
  }
}

// ── the renderer: the real module, evaluated ──────────────────────────────
// The file is `(function (global) { … })(window)`, so a stand-in object
// passed as `window` collects the global it publishes.
const api = (() => {
  try {
    const sandbox = {};
    new Function('window', moduleSrc)(sandbox);
    if (!sandbox.BuildCategories) {
      fail.push(`${MODULE} evaluated but published no window.BuildCategories`);
      return null;
    }
    return sandbox.BuildCategories;
  } catch (e) {
    fail.push(`${MODULE} does not evaluate: ${e.message}`);
    return null;
  }
})();
const categoryLabel = api && api.categoryLabel;
const LABELS = (api && api.CATEGORY_LABELS) || {};

// ── 1. every emitted key has a real label ─────────────────────────────────
if (categoryLabel) {
  for (const [label, keys] of [['section key', uiKeys], ['products.category', dbKeys]]) {
    for (const key of [...keys].sort()) {
      // Map MEMBERSHIP, not a comparison against the prettifier's output.
      // Inferring it from the output flags every key whose real label happens
      // to equal its prettified form — 'optics' -> 'Optics' is mapped and
      // would have read as a miss.
      if (!Object.prototype.hasOwnProperty.call(LABELS, key) || !LABELS[key]) {
        fail.push(`${label} '${key}' has no CATEGORY_LABELS entry in ${MODULE} — `
                + `it falls back to '${categoryLabel(key)}'`);
      }
    }
  }

  // ── 2. nothing ever renders with an underscore ──────────────────────────
  // Over the real keys, and over keys nobody has mapped — which is what keeps
  // this guard useful after today's entries are added.
  const synthetic = ['some_new_thing', 'a_b_c', '__x__'];
  for (const key of new Set([...uiKeys, ...dbKeys, ...synthetic])) {
    const out = categoryLabel(key);
    if (String(out).includes('_')) {
      fail.push(`categoryLabel('${key}') returns '${out}', which contains an underscore — `
              + `.part-type is text-transform: uppercase, so a reader sees '${String(out).toUpperCase()}'`);
    }
  }

  // ── 3. keys that are no longer offered but are still stored ─────────────
  // These are not in CATEGORIES, so assertion 1 cannot see them. A published
  // build renders whatever its snapshot says, and these two are in snapshots.
  for (const legacy of ['other_parts', 'sights']) {
    if (!Object.prototype.hasOwnProperty.call(LABELS, legacy) || !LABELS[legacy]) {
      fail.push(`legacy key '${legacy}' has no label in ${MODULE} — it still occurs in stored `
              + 'parts_snapshot rows, so a published build would render it unmapped');
    }
  }
}

// ── 4. the groups cover every section, exactly once, in the same order ────
if (api && catBlock) {
  const groups = api.CATEGORY_GROUPS || [];
  const groupKeys = groups.map((g) => g.key);
  const grouped = api.GROUPED_CATEGORIES || [];

  for (const g of groups) {
    if (!g.label) fail.push(`group '${g.key}' has no label — the heading would render empty`);
    if (!g.blurb) fail.push(`group '${g.key}' has no blurb — the heading would render with no description`);
  }

  for (const ref of new Set(groupRefs)) {
    if (!groupKeys.includes(ref)) {
      fail.push(`CATEGORIES declares group '${ref}', which is not in CATEGORY_GROUPS — every section `
              + 'in it would render under no heading, which on the builder pages means not at all');
    }
  }
  for (const key of groupKeys) {
    if (!groupRefs.includes(key)) {
      fail.push(`group '${key}' has no sections — it would render as a heading over nothing`);
    }
  }

  // GROUPED_CATEGORIES is what the builder pages render; CATEGORIES is what
  // the published build orders by. Flattening the first must reproduce the
  // second exactly, or the same build lists its sections two different ways.
  const flatGrouped = grouped.flatMap((g) => g.categories.map((c) => c.key));
  const declared = (api.CATEGORIES || []).map((c) => c.key);
  if (flatGrouped.join('|') !== declared.join('|')) {
    fail.push('flattening GROUPED_CATEGORIES does not reproduce CATEGORIES order — the builder pages '
            + 'and a published build would list the same sections differently.\n'
            + `      grouped:  ${flatGrouped.join(', ')}\n`
            + `      declared: ${declared.join(', ')}`);
  }
  if (new Set(declared).size !== declared.length) {
    fail.push('CATEGORIES has a duplicate key — two sections would collect the same parts');
  }
}

if (fail.length) {
  console.error('category label check FAILED:\n');
  for (const f of fail) console.error(`  - ${f}`);
  console.error(`\n${fail.length} problem(s).`);
  process.exit(1);
}
console.log(`ok: ${uiKeys.size} section keys and ${dbKeys.size} products.category values all map to a label, `
          + 'no category renders with an underscore, and the '
          + `${(api.CATEGORY_GROUPS || []).length} groups cover every section once, in CATEGORIES order`);
