#!/usr/bin/env node
// check-canonical-coupling — fail when build-og.mjs expects a literal that
// gunforma-build-detail.html no longer contains.
//
// THE BUG THIS CATCHES
// build-og.mjs transforms the build page with two exact-string replaces:
//
//   .replace('<link rel="canonical" href="https://gunforma.com/…" />\n', '')
//   .replace('<title>Gunforma build</title>', metaBlock(build))
//
// String.prototype.replace with a string pattern that does not occur is a
// NO-OP. It does not throw, it does not warn, it returns the input. So if
// either line in the page is edited — the spacing, the trailing newline, the
// title text — the corresponding replace silently stops doing anything:
//
//   canonical strip stops   -> every /b/ page ships TWO canonicals, the
//                              static id-less one and the injected per-build
//                              one, and renders perfectly in a browser
//   title replace stops     -> metaBlock is never injected, so every /b/ page
//                              ships with NO og:image, og:title or canonical
//                              at all, and still renders perfectly
//
// Neither failure is visible anywhere a person looks. That is the same shape
// as the PGRST201 embeds check-embeds.sh guards, and the reason this runs at
// build time rather than living in someone's head.
//
// NO THIRD COPY OF THE LITERAL. The strings are read out of build-og.mjs and
// looked for in the page. A check that hardcoded them would be a third copy
// to keep in sync — the same bug one level up.
//
// Usage: node scripts/check-canonical-coupling.mjs   0 = clean, 1 = broken
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN   = 'netlify/functions/build-og.mjs';
const PAGE = 'gunforma-build-detail.html';

const problems = [];

const fnSrc   = await readFile(join(ROOT, FN), 'utf8');
const pageSrc = await readFile(join(ROOT, PAGE), 'utf8');

// Every .replace() whose FIRST argument is a single-quoted string literal.
// A regex first argument (the escaping and truncation helpers use those) has
// no coupling to the page and is skipped by construction.
const LITERAL_ARG = /\.replace\(\s*'((?:[^'\\]|\\.)*)'/g;

// Turn the captured JS string-literal body into the string it denotes.
// Via JSON.parse so an escape this does not understand throws instead of
// silently comparing the wrong text.
function denote(raw) {
  const jsonish = raw.replace(/\\'/g, "'").replace(/"/g, '\\"');
  return JSON.parse('"' + jsonish + '"');
}

const literals = [];
for (const m of fnSrc.matchAll(LITERAL_ARG)) {
  let s;
  try { s = denote(m[1]); }
  catch (e) {
    problems.push(`could not read the string literal passed to .replace() in ${FN}: ${JSON.stringify(m[1])}\n` +
                  `  ${e.message}\n` +
                  `  This check cannot verify a literal it cannot parse — fix the check, not by deleting it.`);
    continue;
  }
  literals.push(s);
}

// Zero literals means the transform changed shape — a template literal, a
// regex, a variable. The check would then be quietly verifying nothing,
// which is precisely the failure mode it exists to prevent.
if (literals.length === 0) {
  problems.push(
    `found no .replace('…') string literals in ${FN}.\n` +
    `  Either the page transform no longer uses exact-string replaces, or this\n` +
    `  check's pattern has gone stale. Both mean it is verifying nothing.\n` +
    `  Update this check to match how the transform works now.`);
}

for (const lit of literals) {
  const n = pageSrc.split(lit).length - 1;
  const shown = JSON.stringify(lit.length > 90 ? lit.slice(0, 90) + '…' : lit);
  if (n === 0) {
    problems.push(
      `${FN} replaces a string that does not occur in ${PAGE}:\n` +
      `    ${shown}\n` +
      `  That replace is a silent no-op. Depending on which one it is, every /b/\n` +
      `  page now ships two canonicals, or ships none of its OG meta at all —\n` +
      `  and looks completely normal either way.\n` +
      `  Change the literal in ${FN} to match the page, in the same commit.`);
  } else if (n > 1) {
    problems.push(
      `${FN} replaces a string that occurs ${n} times in ${PAGE}:\n` +
      `    ${shown}\n` +
      `  .replace() with a string pattern only replaces the FIRST occurrence,\n` +
      `  so the others survive the transform.`);
  }
}

// The page must carry exactly one canonical of its own. Two would mean the
// strip removes one and leaves the other.
const canonicals = pageSrc.match(/<link[^>]+rel=["']canonical["'][^>]*>/gi) || [];
if (canonicals.length !== 1) {
  problems.push(
    `${PAGE} ships ${canonicals.length} <link rel="canonical"> tags; expected exactly 1.\n` +
    `  build-og.mjs strips one of them at /b/… — any other survives alongside\n` +
    `  the injected per-build canonical.`);
}

if (problems.length) {
  for (const p of problems) console.error('error: ' + p + '\n');
  process.exit(1);
}
console.log(`ok: ${literals.length} build-og.mjs page literal(s) still present in ${PAGE}, one canonical in the page`);
