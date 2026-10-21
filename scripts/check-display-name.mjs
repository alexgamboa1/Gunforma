#!/usr/bin/env node
// check-display-name — every product name a page prints goes through
// displayProductName(), never a raw `p.name`.
//
// products.name carries the brand only when the maker writes it that way
// (63 of 277 live names do not — every magazine, every light, the short
// forms). _display-name.mjs / js/display-name.js hold the one rule that
// prefixes the brand when the name lacks it, and a page that prints the
// stored name instead ships "AMAG 15 SG9 P365 9mm 15rd Magazine" with
// nothing saying Magpul. That renders perfectly, which is why it is a build
// guard: a new section or category is branded by default, not by habit.
//
// WHAT IS FLAGGED. In every render file — root *.html, js/*.js,
// netlify/functions/*.mjs, netlify/edge-functions/*.js — a line that reads a
// product-shaped `.name` (p, product, item, part, prod, pr, r) AND emits
// HTML or DOM text on the same line (a tag in a string, esc()/escH()/
// escAttr(), textContent, innerHTML, document.title, alt= or aria-label=).
// A read inside a displayProductName(...) or displayProductParts(...) call
// is the correct use and is stripped before matching. A read with no HTML on
// its line (a query map, a sort, a search haystack, a toast) is not a print
// and is not flagged.
//
// WHAT IS NOT CAUGHT, on purpose: a name read into a variable on one line
// and printed on another. The rule in CLAUDE.md ("Every product name on a
// page goes through displayProductName()") covers that; this guard catches
// the common inline shape, which is every instance that existed when it
// was written.
//
// THE ALLOWLIST is per line, with a reason, and a stale entry fails the
// build: an entry that matches nothing means the line it excused is gone
// and the excuse should go with it.
//
// Run: node scripts/check-display-name.mjs
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// { file, match, reason } — `match` is a substring of the offending line.
export const ALLOWLIST = [
  // ── Admin screens print brand and name as two fields ("<b>Brand</b> —
  //    name") for the admin who is matching a typed part to a catalog row;
  //    no reader sees them. Listed, not fixed.
  { file: 'gunforma-admin-queue.html', match: 'escH(r.brand) + \'</strong> — \' + escH(r.name)', reason: 'admin queue add-a-part picker: brand and name as two fields' },
  { file: 'gunforma-admin-queue.html', match: "escH(CATALOG.brands[pr.brand_id] || '') + '</strong> — ' + escH(pr.name)", reason: 'admin queue link-to-existing picker: brand and name as two fields' },
  { file: 'gunforma-admin-queue.html', match: 'escH(p.name || \'\')', reason: 'admin queue: quoting the builder\'s wording before it is replaced' },
  { file: 'gunforma-admin-data.html', match: "esc(p.brand) + '</strong> — ' + esc(p.name)", reason: 'needs-data page: brand and name as two fields' },
  { file: 'gunforma-admin-data.html', match: '<span class="tag">\' + esc(p.name)', reason: 'needs-data page: parts grouped under a brand heading' },
  { file: 'gunforma-admin-part.html', match: "esc(p.name) + (p.is_live ?", reason: 'add-a-part: platform checkbox list (p is a platform, not a product)' },
  { file: 'gunforma-admin-part.html', match: "esc(b.part.name || '')", reason: 'add-a-part: the pending typed part being added, brand shown in the form' },
  { file: 'gunforma-admin-part.html', match: "esc(p.name)) +", reason: 'add-a-part: "already in the catalog?" list, brand in the row' },
  { file: 'gunforma-admin-part.html', match: "esc(brandName(p.brand_id)) + ' — ' + esc(p.name)", reason: 'add-a-part: fits-with checklist, brand and name as two fields' },
  { file: 'gunforma-admin-part.html', match: "esc(S.product.name) + ' is in the catalog'", reason: 'add-a-part: save confirmation names the product the admin just typed' },
  // ── `p` is a platform or a partner on these lines, not a product. The
  //    identifier is what the scan keys on, so they are excused by name.
  { file: 'gunforma-admin-part.html', match: "input('data-p=\"name\" autocomplete=\"off\"', p.name)", reason: 'the product-name INPUT on the add-a-part form, not a print' },
  { file: 'gunforma-admin-part.html', match: "input('readonly', p ? p.name : '')", reason: 'p is a platform' },
  { file: 'gunforma-admin-part.html', match: "'>' + esc(p.name) + '</option>'", reason: 'p is a partner (retailer dropdown)' },
  { file: 'gunforma-admin-post.html', match: "selectPlatform(\\''+p.id+'\\')\">'+p.name+'</button>'", reason: 'p is a platform' },
  { file: 'gunforma-post-build.html', match: "selectPlatform(\\''+p.id+'\\')\">'+p.name+'</button>'", reason: 'p is a platform' },
  { file: 'gunforma-post-build.html', match: "getElementById('platform-selected-name').textContent = p.name", reason: 'p is a platform' },
  { file: 'gunforma-armory.html', match: "class=\"platform-btn' + (isActive ? ' active' : '') + '\" data-id=\"' + p.id + '\">' + esc(p.name)", reason: 'p is a platform' },
  // ── The Armory is parked (CLAUDE.md, "The Armory is parked"): hidden,
  //    noindex, restored by one revert. Its prints are listed, not fixed.
  { file: 'gunforma-armory.html', match: "alt=\"' + escAttr(p.brand + ' ' + p.name)", reason: 'parked Armory' },
  { file: 'gunforma-armory.html', match: "'<div class=\"selected-part-name\">'  + esc(p.name)", reason: 'parked Armory' },
  { file: 'gunforma-armory.html', match: "aria-label=\"Variant or colour for ' + escAttr(p.name)", reason: 'parked Armory' },
  { file: 'gunforma-armory.html', match: "'\">' + esc(p.name) + '</a>'", reason: 'parked Armory' },
  { file: 'gunforma-armory.html', match: ": esc(p.name);", reason: 'parked Armory' },
  { file: 'gunforma-armory.html', match: "esc(part.brand || '') + '</strong> ' + esc(part.name || '')", reason: 'parked Armory guide rows' },
];

const NAME_READ = /\b(?:p|product|item|part|prod|pr|r)\.name\b/;
const HTML_CONTEXT = /(['"`][^'"`]*<[a-zA-Z/][^'"`]*['"`])|\besc(?:H|Attr)?\(|\.textContent\b|\.innerHTML\b|document\.title|\balt=|aria-label=/;

// Remove every balanced displayProductName(...) / displayProductParts(...)
// call so a correct use — displayProductParts({ name: p.name, brand }) — is
// not read as a raw print.
const HELPERS = ['displayProductName', 'displayProductParts'];
function stripHelperCalls(line) {
  let out = line;
  for (;;) {
    let at = -1, fn = null;
    for (const h of HELPERS) {
      const i = out.indexOf(h + '(');
      if (i !== -1 && (at === -1 || i < at)) { at = i; fn = h; }
    }
    if (at === -1) return out;
    let depth = 0, i = at + fn.length;
    for (; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')' && --depth === 0) { i++; break; }
    }
    out = out.slice(0, at) + 'DISPLAY_NAME_OK' + out.slice(i);
  }
}

async function renderFiles() {
  const files = [];
  for (const f of await readdir(ROOT)) if (f.endsWith('.html')) files.push(f);
  for (const f of await readdir(join(ROOT, 'js'))) if (f.endsWith('.js')) files.push('js/' + f);
  for (const f of await readdir(join(ROOT, 'netlify/functions'))) if (f.endsWith('.mjs')) files.push('netlify/functions/' + f);
  for (const f of await readdir(join(ROOT, 'netlify/edge-functions'))) if (f.endsWith('.js')) files.push('netlify/edge-functions/' + f);
  return files.sort();
}

export async function scan() {
  const hits = [];
  for (const file of await renderFiles()) {
    const lines = (await readFile(join(ROOT, file), 'utf8')).split('\n');
    lines.forEach((raw, i) => {
      const line = stripHelperCalls(raw);
      if (!NAME_READ.test(line)) return;
      if (!HTML_CONTEXT.test(line)) return;
      hits.push({ file, line: i + 1, text: raw.trim() });
    });
  }
  return hits;
}

const hits = await scan();
let failures = 0;
const used = new Set();
let excused = 0;
for (const h of hits) {
  const entry = ALLOWLIST.find((a) => a.file === h.file && h.text.includes(a.match));
  if (entry) { used.add(entry); excused++; continue; }
  failures++;
  console.log(`FAIL  ${h.file}:${h.line} prints a raw product name — route it through displayProductName() or displayProductParts()\n        ${h.text.slice(0, 160)}`);
}
for (const a of ALLOWLIST) {
  if (used.has(a)) continue;
  failures++;
  console.log(`FAIL  stale allowlist entry: ${a.file} has no flagged line containing ${JSON.stringify(a.match)} — remove the entry`);
}
console.log(`scanned ${hits.length} raw-name print(s): ${excused} excused by name, ${hits.length - excused} not`);
console.log(failures === 0 ? 'ok: every product name a page prints goes through displayProductName() or displayProductParts(), or is excused by name'
                           : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
