#!/usr/bin/env node
// check-analytics-snippet — every public page carries the Cloudflare Web
// Analytics beacon exactly once, and every excluded page carries none.
//
// The tag lives in ONE place, netlify/functions/_analytics.mjs. Static pages
// have no build step to import it with, so they hold it as a literal, and
// this check holds them to that module's string byte for byte.
//
// DISCOVERED, NOT LISTED. Root *.html files and HTML-emitting functions are
// found by scanning, the same lesson as check-buy-links.mjs: a hand-kept list
// is only as complete as the last person who remembered to update it, and the
// page nobody remembered is exactly the page that ships without the tag. A
// new page or a new function is held to the rule the moment it exists; the
// only way out is an entry in EXCLUDED below, with a reason.
//
// What it checks:
//   1. Public root pages: the exact snippet, once, immediately before
//      </body> (Cloudflare's documented placement), and no other reference
//      to cloudflareinsights — so a hand-edited second copy fails too.
//   2. Excluded root pages: no reference to cloudflareinsights at all.
//   3. Functions that emit an HTML document: import ANALYTICS_SNIPPET from
//      ./_analytics.mjs, put it before EVERY </body> they emit, and carry no
//      literal copy of the tag.
//   4. build-og.mjs and profile-og.mjs, RENDERED: their pages are the static
//      files, which already carry the tag, so a second one in the function
//      would load the beacon twice and count every /b/ and /u/ view double.
//      Reading the source cannot see that, so the handlers are run against a
//      stubbed fetch and the output must contain the tag exactly once.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ANALYTICS_SNIPPET } = await import(pathToFileURL(join(ROOT, 'netlify/functions/_analytics.mjs')).href);

// Pages and functions that must NOT carry the tag. Each needs a reason a
// future reader will accept, because the obvious "fix" is to add it.
const EXCLUDED_PAGES = [
  { match: (f) => f.startsWith('gunforma-admin-'),
    why: 'admin tools — not visitor traffic' },
  { match: (f) => f === 'auth-callback.html',
    why: 'receives the sign-in access_token in the URL hash. Today\'s beacon strips the hash and query before sending, but that is a property of a third-party script, not a guarantee: a page with a credential in its URL gets no analytics' },
  { match: (f) => f === 'gunforma-claim.html',
    why: 'receives the invite access_token in the URL hash — same grounds as auth-callback.html. Do not "fix" this' },
];
const EXCLUDED_FUNCTIONS = {
  'netlify/edge-functions/go.js': 'its only HTML is the 404 for a retired retailer link on the click-tracking path; not worth a cross-directory import into an edge function',
};

let failures = 0;
const fail = (m) => { console.log('FAIL  ' + m); failures++; };
const count = (s, needle) => s.split(needle).length - 1;

// ── 1 + 2. Root pages ─────────────────────────────────────────────────────
const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html')).sort();
let publicCount = 0;
for (const f of pages) {
  const src = await readFile(join(ROOT, f), 'utf8');
  const ex = EXCLUDED_PAGES.find((e) => e.match(f));
  if (ex) {
    if (/cloudflareinsights/i.test(src)) fail(`${f} is excluded (${ex.why}) but references cloudflareinsights`);
    else console.log(`      ${f.padEnd(34)} excluded — ${ex.why.split(/[.;—]/)[0].trim()}`);
    continue;
  }
  publicCount++;
  const n = count(src, ANALYTICS_SNIPPET);
  if (n !== 1) { fail(`${f}: expected the snippet exactly once, found ${n}`); continue; }
  if (count(src, 'cloudflareinsights') !== count(ANALYTICS_SNIPPET, 'cloudflareinsights')) {
    fail(`${f}: a second or altered cloudflareinsights reference besides the snippet`);
    continue;
  }
  const after = src.slice(src.indexOf(ANALYTICS_SNIPPET) + ANALYTICS_SNIPPET.length);
  if (!/^\s*<\/body>/.test(after)) fail(`${f}: the snippet must sit immediately before </body>`);
}
console.log(`      ${publicCount} public root pages checked, ${pages.length - publicCount} excluded`);

// ── 3. HTML-emitting functions ───────────────────────────────────────────
const fnDirs = ['netlify/functions', 'netlify/edge-functions'];
const emitters = [];
for (const dir of fnDirs) {
  for (const f of (await readdir(join(ROOT, dir))).sort()) {
    if (!/\.(m?js|ts)$/.test(f) || f.startsWith('_')) continue;   // _modules are libraries
    const rel = dir + '/' + f;
    const src = await readFile(join(ROOT, rel), 'utf8');
    if (!/<!doctype html/i.test(src)) continue;                     // emits no document
    if (EXCLUDED_FUNCTIONS[rel]) {
      if (/ANALYTICS_SNIPPET|cloudflareinsights/i.test(src)) fail(`${rel} is excluded (${EXCLUDED_FUNCTIONS[rel]}) but carries the tag`);
      else console.log(`      ${rel.padEnd(42)} excluded — ${EXCLUDED_FUNCTIONS[rel].split(/[;—]/)[0].trim()}`);
      continue;
    }
    emitters.push(rel);
    if (!/import\s*\{\s*ANALYTICS_SNIPPET\s*\}\s*from\s*'\.\/_analytics\.mjs'/.test(src)) {
      fail(`${rel} emits HTML but does not import ANALYTICS_SNIPPET from ./_analytics.mjs`);
    }
    if (/cloudflareinsights/i.test(src)) fail(`${rel} carries a literal copy of the tag — import it instead`);
    // Every document end must be preceded by the snippet: `ANALYTICS_SNIPPET + '</body>`.
    const ends = count(src, '</body>');
    const guarded = (src.match(/ANALYTICS_SNIPPET\s*\+\s*'<\/body>/g) || []).length;
    if (ends !== guarded) fail(`${rel}: ${ends} </body> emitted, only ${guarded} preceded by ANALYTICS_SNIPPET`);
  }
}
console.log(`      ${emitters.length} HTML-emitting functions: ${emitters.map((e) => e.split('/').pop()).join(', ')}`);

// ── 4. Rendered /b/ and /u/ — exactly once ───────────────────────────────
// The handlers fetch one row from PostgREST, then serve the static page with
// meta injected. Stub that one fetch and run them for real.
const realFetch = globalThis.fetch;
async function render(fnFile, url, rows) {
  globalThis.fetch = async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const mod = await import(pathToFileURL(join(ROOT, 'netlify/functions', fnFile)).href);
    const res = await mod.default(new Request(url));
    return { status: res.status, html: await res.text() };
  } finally { globalThis.fetch = realFetch; }
}
const UUID = '2e980fc8-3a9f-42c9-af15-efcf99584536';
const cases = [
  ['build-og.mjs',   `https://gunforma.com/b/fixture-build-${UUID}`,
    [{ id: UUID, name: 'Fixture build', description: 'x', parts_snapshot: [], platforms: { name: 'SIG P365' }, profiles: { username: 'fixture' }, build_photos: [] }]],
  ['build-og.mjs',   `https://gunforma.com/b/no-such-build-${UUID}`, []],
  ['profile-og.mjs', 'https://gunforma.com/u/fixture', [{ username: 'fixture' }]],
  ['profile-og.mjs', 'https://gunforma.com/u/nosuchuser', []],
];
const quiet = console.error; console.error = () => {};               // handlers log on 404
try {
  for (const [fn, url, rows] of cases) {
    const { status, html } = await render(fn, url, rows);
    const n = count(html, ANALYTICS_SNIPPET);
    const label = `${fn} ${new URL(url).pathname} (${status})`;
    if (!/<\/body>/.test(html)) fail(`${label}: rendered no document`);
    else if (n !== 1) fail(`${label}: rendered page carries the snippet ${n} times — expected exactly once`);
    else console.log(`      rendered ${label.padEnd(58)} snippet x1`);
  }
} finally { console.error = quiet; }

console.log(failures === 0
  ? `ok: the analytics snippet is on every public page once, and on no excluded page`
  : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
