#!/usr/bin/env node
// check-buy-links — no buy button may point straight at a retailer.
//
// Every outbound buy link goes through /go/<affiliate_link_id> so the click is
// logged. An anchor that points at the retailer directly still WORKS — it
// sells the part, the reader never notices — it just silently records nothing,
// and the number it fails to record is the one being held against Awin's
// report. That is the failure shape this repo keeps paying for: something that
// renders perfectly and is quietly not doing its job.
//
// It also cannot be caught by a test that renders one module. There were EIGHT
// emit sites across four files when the click layer was built, and the eighth
// was in gunforma-armory.html — a parked page nobody was looking at, which is
// precisely where the previous four divergences in this repo hid.
//
// TWO RULES, because either alone has a hole:
//
//   1. Every anchor carrying rel="... sponsored ..." — the marker every buy
//      link already uses — must build its href from a /go/ path. Catches a new
//      emit site that reuses the existing shape.
//   2. No retailer or affiliate-network domain may appear inside an href
//      anywhere in these files. Catches someone hardcoding a URL rather than
//      reusing the shape, which rule 1 would miss entirely.
//
// Run: node scripts/check-buy-links.mjs
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Where buy rows are rendered. Kept explicit rather than globbed: a new file
// that renders one should be a deliberate addition here, not a silent pass.
const FILES = [
  'js/affiliate.js',
  'js/part-picker.js',
  'netlify/functions/product-page.mjs',
  'gunforma-build-detail.html',
  'gunforma-armory.html',
  'gunforma-parts-catalog.html',
  'gunforma-post-build.html',
  'gunforma-admin-post.html',
];

// Retail and affiliate-network hosts this site links to. A literal one inside
// an href means a hand-written destination that bypasses the click layer.
const RETAILER_HOSTS = [
  'opticsplanet.com',
  'awin1.com',
  'olight.com',
  'olightstore.com',
  'truepistol.com',
  'brownells.com',
  'primaryarms.com',
];

let failures = 0;
const fail = (m) => { console.log('FAIL  ' + m); failures++; };

// Anchors, with enough of the tag to see both href and rel.
const ANCHOR_RE = /<a\b[^>]*?>/gs;

let checkedAnchors = 0;
for (const rel of FILES) {
  let src;
  try { src = await readFile(join(ROOT, rel), 'utf8'); }
  catch { fail(`${rel} is listed here but does not exist — update the list or restore the file`); continue; }

  // ── rule 1: sponsored anchors must go through /go/ ──────────────────────
  for (const m of src.matchAll(ANCHOR_RE)) {
    const tag = m[0];
    if (!/sponsored/.test(tag)) continue;
    checkedAnchors++;
    const href = (tag.match(/href\s*=\s*(?:"|\\")([^"]*)/) || [])[1] || tag;
    if (!/\/go\//.test(href) && !/goUrl/.test(href)) {
      const line = src.slice(0, m.index).split('\n').length;
      fail(`${rel}:${line} a sponsored anchor does not build its href from /go/ — ` +
           `that click is not logged\n        ${tag.replace(/\s+/g, ' ').slice(0, 132)}`);
    }
  }

  // ── rule 2: no hardcoded retailer host in an href ───────────────────────
  for (const host of RETAILER_HOSTS) {
    const re = new RegExp(`href\\s*=\\s*(?:"|\\\\")[^"]*${host.replace(/\./g, '\\.')}`, 'g');
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split('\n').length;
      fail(`${rel}:${line} href points straight at ${host} — buy links go through /go/`);
    }
  }
}

console.log(`checked ${checkedAnchors} sponsored anchor(s) across ${FILES.length} files`);
console.log(failures === 0
  ? 'ok: every buy link goes through the /go/ click layer'
  : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
