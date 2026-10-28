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
// A read inside a displayProductName(...) call is the correct use and is
// stripped before matching. A read with no HTML on its line (a query map, a
// sort, a search haystack, a toast) is not a print and is not flagged.
//
// A second shape is flagged whatever the identifier is called: any
// identifier's `.brand` joined with the SAME identifier's `.name` on one
// emit line. That is a hand-rolled displayProductName(), and it shipped
// doubled brands on gunforma-creator.html under the identifier `x`, which
// the list above could not see.
//
// WHAT IS NOT CAUGHT, on purpose: a name read into a variable on one line
// and printed on another. The rule in CLAUDE.md ("Every product name on a
// page goes through displayProductName()") covers that; this guard catches
// the inline shapes, which are every instance that has shipped.
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
  // ── A brand line sits directly above the name on these cards, so the
  //    name is printed bare under it. Folding the two into one branded
  //    line (or keeping the brand line and printing the model alone) is a
  //    visible-layout decision for Alex (CLAUDE.md, "Verifying changes");
  //    until it is made, these print the stored name under its brand.
  { file: 'js/part-picker.js', match: "'<div class=\"part-card-name\">'  + item.name", reason: 'picker card: brand line above the name' },
  { file: 'js/part-picker.js', match: "'<div class=\"selected-part-name\">'  + part.name", reason: 'picker selected row: brand line above the name' },
  { file: 'js/part-picker.js', match: "'<span class=\"variant-step-name\">' + escAttr(item.name", reason: 'colour step title: brand span before the name' },
  { file: 'gunforma-profile.html', match: "'<div class=\"part-card-name\">'+escH(p.name)", reason: 'profile Favorite parts card: .part-card-brand line above the name' },
  { file: 'gunforma-build-detail.html', match: "var nameHtml = escH(part.name || 'Unnamed part')", reason: 'build page part card: .part-brand line above .part-model' },
  { file: 'gunforma-parts-catalog.html', match: "'<a class=\"part-card-link\" href=\"' + escAttr(href) + '\">' + esc(r.name)", reason: 'catalog card: .part-card-brand line above the name' },
  { file: 'gunforma-parts-catalog.html', match: ": esc(r.name);", reason: 'catalog card, unlinked branch of the line above' },
  { file: 'gunforma-parts-catalog.html', match: "document.getElementById('detail-title').textContent = p.name", reason: 'catalog detail panel: #detail-brand sits above #detail-title' },
  // ── Admin screens print brand and name as two fields ("<b>Brand</b> —
  //    name") for the admin who is matching a typed part to a catalog row;
  //    no reader sees them. Listed, not fixed.
  { file: 'gunforma-admin-queue.html', match: 'escH(r.brand) + \'</strong> — \' + escH(r.name)', reason: 'admin queue add-a-part picker: brand and name as two fields' },
  { file: 'gunforma-admin-queue.html', match: "escH(CATALOG.brands[pr.brand_id] || '') + '</strong> — ' + escH(pr.name)", reason: 'admin queue link-to-existing picker: brand and name as two fields' },
  { file: 'gunforma-admin-queue.html', match: 'escH(p.name || \'\')', reason: 'admin queue: quoting the builder\'s wording before it is replaced' },
  { file: 'gunforma-admin-queue.html', match: "'Add ' + escH(row.brand + ' ' + row.name)", reason: 'admin queue + Add a part button: names the part the admin is adding' },
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
  // ── The rebuilt Armory (2026-10-27): one excused print, the picked card's
  //    stored name under its own brand eyebrow — the brand-line-over-name
  //    pattern Alex ruled stays as-is (claude/display-name-decisions, same
  //    ruling as the picker cards). Everything else on the page (dropdown
  //    options, sidebar, alt text) goes through displayProductName().
  { file: 'gunforma-armory.html', match: "'<span class=\"picked-name\">' + esc(p.name) + '</span>'", reason: 'brand line directly above the name (picked card)' },
  { file: 'gunforma-armory.html', match: "'<span class=\"part-card-name\">' + esc(p.name) + '</span>'", reason: 'brand line directly above the name (picker card)' },
];

const NAME_READ = /\b(?:p|product|item|part|prod|pr|r)\.name\b/;
// Any identifier's .brand joined with the same identifier's .name on one
// line — a hand-rolled displayProductName() under a name NAME_READ's list
// does not carry.
const BRAND_NAME_JOIN = /\b(\w+)\.brand\b[^\n]{0,60}?\b\1\.name\b/;
const HTML_CONTEXT = /(['"`][^'"`]*<[a-zA-Z/][^'"`]*['"`])|\besc(?:H|Attr)?\(|\.textContent\b|\.innerHTML\b|document\.title|\balt=|aria-label=/;

// Remove every balanced displayProductName(...) call so a correct use —
// displayProductName({ name: p.name, brand }) — is not read as a raw print.
function stripHelperCalls(line) {
  let out = line;
  for (;;) {
    const at = out.indexOf('displayProductName(');
    if (at === -1) return out;
    let depth = 0, i = at + 'displayProductName'.length;
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
      if (!NAME_READ.test(line) && !BRAND_NAME_JOIN.test(line)) return;
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
  console.log(`FAIL  ${h.file}:${h.line} prints a raw product name — route it through displayProductName()\n        ${h.text.slice(0, 160)}`);
}
for (const a of ALLOWLIST) {
  if (used.has(a)) continue;
  failures++;
  console.log(`FAIL  stale allowlist entry: ${a.file} has no flagged line containing ${JSON.stringify(a.match)} — remove the entry`);
}
console.log(`scanned ${hits.length} raw-name print(s): ${excused} excused by name, ${hits.length - excused} not`);
console.log(failures === 0 ? 'ok: every product name a page prints goes through displayProductName(), or is excused by name'
                           : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
