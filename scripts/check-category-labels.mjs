#!/usr/bin/env node
// check-category-labels — no category heading reaches a reader as a raw key.
//
// WHAT SHIPPED. gunforma-build-detail.html's categoryLabel() ended with
// `|| key`, returning the raw parts_snapshot value when the map had no entry
// for it. `mag_release` and `other_parts` both had no entry, and .part-type
// is `text-transform: uppercase` — so the heading rendered "OTHER_PARTS".
// Two live builds were showing it. It renders perfectly in a browser, which
// is the entry criterion for a guard here.
//
// WHY THE CHECK READS THE SOURCE INSTEAD OF LISTING THE KEYS. A guard that
// carried its own copy of the category list would be a fourth vocabulary to
// keep in sync, and would pass while the real emitter grew a key nobody
// mapped. So both sides are extracted:
//
//   emitter  gunforma-post-build.html      CATEGORIES[].key    (the UI keys
//            written into parts_snapshot) and CATEGORIES[].dbCategory[] (the
//            raw products.category values an Armory-saved part arrives under,
//            since the build page does not normalize on read)
//   renderer gunforma-build-detail.html    CATEGORY_LABELS + categoryLabel()
//
// The renderer's own function is executed, not pattern-matched, so the
// fallback is graded as the page actually runs it.
//
// Two assertions, and the second is the one that outlives this fix:
//   1. Every key the emitter can produce resolves to a mapped label.
//   2. NOTHING categoryLabel() returns contains an underscore — checked over
//      the emitter's keys AND over synthetic unmapped keys, so a future key
//      added to CATEGORIES without a label here still renders as words.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];

const postBuild = await readFile(join(ROOT, 'gunforma-post-build.html'), 'utf8');
const buildPage = await readFile(join(ROOT, 'gunforma-build-detail.html'), 'utf8');

// ── the emitter: gunforma-post-build.html's CATEGORIES ────────────────────
// Sliced from `const CATEGORIES = [` to its closing `];` at column 0, then
// scanned for key: and dbCategory:. Parsing the array as JS would mean
// evaluating a page that expects a DOM, so the two fields are read textually.
const catBlock = (() => {
  const start = postBuild.indexOf('const CATEGORIES = [');
  if (start === -1) return null;
  const end = postBuild.indexOf('\n];', start);
  return end === -1 ? null : postBuild.slice(start, end);
})();

if (!catBlock) {
  fail.push('could not find `const CATEGORIES = [` … `];` in gunforma-post-build.html — '
          + 'if it was renamed or moved, update this check rather than deleting it');
}

const uiKeys = new Set();
const dbKeys = new Set();
if (catBlock) {
  for (const m of catBlock.matchAll(/\bkey\s*:\s*'([^']+)'/g)) uiKeys.add(m[1]);
  for (const m of catBlock.matchAll(/\bdbCategory\s*:\s*\[([^\]]*)\]/g)) {
    for (const d of m[1].matchAll(/'([^']+)'/g)) dbKeys.add(d[1]);
  }
  if (uiKeys.size === 0) fail.push('extracted 0 CATEGORIES keys — the extraction regex has gone stale');
}

// ── the renderer: gunforma-build-detail.html's categoryLabel ──────────────
// CATEGORY_LABELS and the function are lifted out and evaluated together, so
// the fallback is graded as written rather than as described.
const renderer = (() => {
  const mapStart = buildPage.indexOf('const CATEGORY_LABELS = {');
  const mapEnd = buildPage.indexOf('\n};', mapStart);
  const fnStart = buildPage.indexOf('function categoryLabel(', mapEnd);
  const fnEnd = buildPage.indexOf('\n}', fnStart);
  if (mapStart === -1 || mapEnd === -1 || fnStart === -1 || fnEnd === -1) {
    fail.push('could not extract CATEGORY_LABELS / categoryLabel from gunforma-build-detail.html');
    return null;
  }
  const src = buildPage.slice(mapStart, mapEnd + 3) + '\n'
            + buildPage.slice(fnStart, fnEnd + 2) + '\n'
            + 'return { CATEGORY_LABELS: CATEGORY_LABELS, categoryLabel: categoryLabel };';
  try {
    return new Function(src)();
  } catch (e) {
    fail.push(`extracted categoryLabel does not evaluate: ${e.message}`);
    return null;
  }
})();
const categoryLabel = renderer && renderer.categoryLabel;
const LABELS = (renderer && renderer.CATEGORY_LABELS) || {};

// ── 1. every emitted key has a real label ─────────────────────────────────
if (categoryLabel) {
  for (const [label, keys] of [['UI key', uiKeys], ['products.category', dbKeys]]) {
    for (const key of [...keys].sort()) {
      // Map MEMBERSHIP, not a comparison against the prettifier's output.
      // Inferring it from the output flags every key whose real label happens
      // to equal its prettified form — 'optics' -> 'Optics' is mapped and
      // would have read as a miss.
      if (!Object.prototype.hasOwnProperty.call(LABELS, key)) {
        fail.push(`${label} '${key}' has no CATEGORY_LABELS entry in gunforma-build-detail.html — `
                + `it falls back to '${categoryLabel(key)}'`);
      }
    }
  }

  // ── 2. nothing ever renders with an underscore ──────────────────────────
  // Over the real keys, and over keys nobody has mapped — which is what keeps
  // this guard useful after today's two entries are added.
  const synthetic = ['some_new_thing', 'a_b_c', '__x__'];
  for (const key of new Set([...uiKeys, ...dbKeys, ...synthetic])) {
    const out = categoryLabel(key);
    if (String(out).includes('_')) {
      fail.push(`categoryLabel('${key}') returns '${out}', which contains an underscore — `
              + `.part-type is text-transform: uppercase, so a reader sees '${String(out).toUpperCase()}'`);
    }
  }
}

if (fail.length) {
  console.error('category label check FAILED:\n');
  for (const f of fail) console.error(`  - ${f}`);
  console.error(`\n${fail.length} problem(s).`);
  process.exit(1);
}
console.log(`ok: ${uiKeys.size} UI keys and ${dbKeys.size} products.category values all map to a label, `
          + 'and no category renders with an underscore');
