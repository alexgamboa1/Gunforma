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
  { global: 'buildPath',    defines: 'js/build-url.js',     consumers: [] },
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
    const callsInline  = new RegExp(`(?<!function\\s)\\b${rule.global}\\s*\\(`).test(
      src.replace(/<script src=[^>]*><\/script>/g, ''),
    );
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
