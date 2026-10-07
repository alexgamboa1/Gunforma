#!/usr/bin/env node
// check-script-order — a page that uses a shared global must load the file
// that defines it, FIRST.
//
// js/affiliate.js and gunforma-build-detail.html call window.variantLabel at
// render time. A page that loads affiliate.js without js/variant-label.js
// throws "variantLabel is not a function" deep inside a render, which on
// these pages means the buy row silently renders empty — the same shape as
// every other failure in this repo's notes: the page looks fine and the
// thing you wanted is just absent.
//
// It cannot be caught by loading the module in isolation (it parses and
// exports correctly) and it cannot be caught by a unit test (there is no
// page in one). It is a property of the HTML, so it is checked in the HTML.
//
// Ordering matters as well as presence: these are classic <script> tags, so
// a definition that comes after the file that uses it at load time is not
// there yet. affiliate.js reads the global at CALL time so it would survive
// a wrong order today — the check still enforces it, because "it happens to
// work because of when we call it" is not a thing to leave to memory.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// global -> [file that defines it, files that consume it]
const RULES = [
  { global: 'variantLabel', defines: 'js/variant-label.js',
    consumers: ['js/affiliate.js', 'js/variant-swatch.js', 'js/part-picker.js'] },
  // variant-swatch.js calls window.variantLabel for its alt text, and
  // part-picker.js calls window.variantMediaHtml for the color step. Both are
  // call-time reads, so a wrong ORDER survives today — the check enforces it
  // anyway, because "it happens to work because of when we call it" is not a
  // thing to leave to memory.
  { global: 'variantMediaHtml', defines: 'js/variant-swatch.js', consumers: ['js/part-picker.js'] },
  // The spec line beside a variant's label. part-picker.js reads it at render
  // time; the two builder pages call it inline in loadCatalog() and
  // addPartWithVariant(), and the build page in resolveVariant().
  { global: 'variantSpecs', defines: 'js/variant-label.js', consumers: ['js/part-picker.js'] },
  { global: 'buildPath',    defines: 'js/build-url.js',     consumers: [] },
  // The maker-link label and the disclosure wording. affiliate.js reads
  // window.makerLink / window.buyDisclosure / window.MAKER_REL at call time;
  // gunforma-build-detail.html calls window.makerLink inline from
  // loadAffiliates(). A page that loads affiliate.js without this throws
  // inside loadFor() and the buy rows silently render empty — the exact
  // shape the rule above describes.
  { global: 'makerLink',    defines: 'js/maker-link.js',    consumers: ['js/affiliate.js'] },
  // BuildCategories is an OBJECT, not a function, so the inline-call regex
  // below cannot see it — `BuildCategories.CATEGORIES` is a member read. It
  // gets an explicit `pattern` instead.
  //
  // And unlike the rules above, this one is a PARSE-TIME read on all three
  // pages: each does `const CATEGORIES = window.BuildCategories.CATEGORIES`
  // at the top of its inline script. A wrong order here does not survive —
  // it throws "Cannot read properties of undefined" before any render, and
  // the whole page is blank.
  { global: 'BuildCategories', defines: 'js/build-categories.js', consumers: [],
    pattern: /\bBuildCategories\s*\./ },
  // build-categories.js names its sections from category-map.js AT PARSE
  // TIME (label: name('frame')), and throws if it is missing — so on the
  // pages that load it, a wrong order blanks the page, exactly as above.
  { global: 'categoryPlural', defines: 'js/category-map.js', consumers: ['js/build-categories.js'] },
];

const html = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
let failures = 0;
const fail = (m) => { console.log('FAIL  ' + m); failures++; };

for (const rule of RULES) {
  const defTag = `src="${rule.defines}"`;
  for (const file of html) {
    const src = await readFile(join(ROOT, file), 'utf8');

    // Does this page pull in a consumer, or call the global inline itself?
    const consumerTags = rule.consumers.filter((c) => src.includes(`src="${c}"`));
    const inlineSrc = src.replace(/<script src=[^>]*><\/script>/g, '');
    const callsInline = rule.pattern
      ? rule.pattern.test(inlineSrc)
      : new RegExp(`(?<!function\\s)\\b${rule.global}\\s*\\(`).test(inlineSrc);
    if (!consumerTags.length && !callsInline) continue;

    const defAt = src.indexOf(defTag);
    if (defAt === -1) {
      fail(`${file} uses window.${rule.global} but never loads ${rule.defines}` +
           (consumerTags.length ? `  [via ${consumerTags.join(', ')}]` : '  [inline call]'));
      continue;
    }
    for (const c of consumerTags) {
      const conAt = src.indexOf(`src="${c}"`);
      if (conAt < defAt) {
        fail(`${file} loads ${c} BEFORE ${rule.defines} — the global is not defined yet`);
      }
    }
    console.log(`PASS  ${file} loads ${rule.defines} before it needs window.${rule.global}`);
  }
}

console.log(failures === 0 ? 'ok: every page that uses a shared global loads its definition first'
                           : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
