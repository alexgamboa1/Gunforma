#!/usr/bin/env node
// check-snapshot-fields — the four parts_snapshot whitelists must name the
// same optional fields.
//
// WHY THIS EXISTS
// parts_snapshot is written by two pages and round-tripped by a third, and
// every one of them enumerates its fields by hand:
//
//   gunforma-post-build.html   buildPartsSnapshot()   writes
//   gunforma-admin-post.html   buildPartsSnapshot()   writes
//   gunforma-armory.html       buildPartsSnapshot()   writes
//   gunforma-armory.html       loadBuildById()        reads  (rebuilds STATE.parts)
//   gunforma-armory.html       remixGuide()           reads  (clones a guide)
//
// A field missing from any of them is not "left alone" — it is DELETED, on
// the next armory save of any draft that carried it, with no error. That has
// already happened once: `finish` was written by post-build and named by none
// of the armory's whitelists, so the Paint Job & Finish object was silently
// dropped until #86.
//
// It cannot be caught by a unit test (the functions are inline in HTML) or by
// looking at a page (it renders perfectly either way). It is a property of
// four field lists agreeing, so that is what is checked.
//
// The five required fields (category, refId, brand, name, pending) are in a
// base object literal in each writer and are not the risk. The OPTIONAL ones
// are: they are the `if (p.x) row.x = p.x` / `x: part.x || undefined` lines,
// and they are what gets forgotten.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Writers: `if (p.foo) row.foo = p.foo;` — matched as a pair so a mismatched
// line (row.a = p.b) is not silently counted as either.
const WRITE_RE = /if\s*\(\s*p\.(\w+)\s*\)\s*row\.(\w+)\s*=\s*p\.(\w+)\s*;/g;
// Readers: `foo: part.foo || undefined,`
const READ_RE  = /(\w+)\s*:\s*part\.(\w+)\s*\|\|\s*undefined/g;

const SOURCES = [
  { file: 'gunforma-post-build.html', kind: 'write', label: 'post-build buildPartsSnapshot()' },
  { file: 'gunforma-admin-post.html', kind: 'write', label: 'admin-post buildPartsSnapshot()' },
  { file: 'gunforma-armory.html',     kind: 'write', label: 'armory buildPartsSnapshot()' },
  { file: 'gunforma-armory.html',     kind: 'read',  label: 'armory readers (loadBuildById + remixGuide)' },
];

let failures = 0;
const fail = (m) => { console.log('FAIL  ' + m); failures++; };
const sets = [];

for (const src of SOURCES) {
  const text = await readFile(join(ROOT, src.file), 'utf8');
  const re = src.kind === 'write' ? WRITE_RE : READ_RE;
  re.lastIndex = 0;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, a, b, c] = m;
    if (a !== b || (c !== undefined && a !== c)) {
      fail(`${src.label}: field names disagree within one line — ${m[0].trim()}`);
      continue;
    }
    found.add(a);
  }
  if (!found.size) fail(`${src.label}: no optional snapshot fields found — did the pattern change?`);
  sets.push({ ...src, fields: found });
  console.log(`      ${src.label.padEnd(46)} ${[...found].sort().join(', ')}`);
}

// The union is the contract; every list must carry all of it.
const union = new Set(sets.flatMap((s) => [...s.fields]));
for (const s of sets) {
  const missing = [...union].filter((f) => !s.fields.has(f)).sort();
  if (missing.length) {
    fail(`${s.label} is missing: ${missing.join(', ')}` +
         (s.kind === 'read'
           ? '  — a field absent here is dropped from STATE.parts, so the writer never sees it'
           : '  — a field absent here is deleted from the row on save'));
  }
}

// The armory read side must never be narrower than what the two post pages
// write, which is the specific direction that has already cost a field.
const writes = sets.filter((s) => s.kind === 'write' && s.file !== 'gunforma-armory.html');
const reads  = sets.find((s) => s.kind === 'read');
if (reads) {
  for (const w of writes) {
    const lost = [...w.fields].filter((f) => !reads.fields.has(f)).sort();
    if (lost.length) fail(`${w.label} writes ${lost.join(', ')} but the armory reader drops it — silent data loss on the next armory save`);
  }
}

console.log(failures === 0
  ? `ok: all ${sets.length} parts_snapshot whitelists name the same ${union.size} optional fields`
  : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
