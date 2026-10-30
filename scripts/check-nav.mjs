// check-nav — every copy of the site nav carries the same links: the Armory
// on the bar (right after Parts Catalog) and in the hamburger, and "Your
// P365" as the hamburger's dropdown of gun hubs, held to GUN_HUBS.
// ─────────────────────────────────────────────────────────────────────────
// The nav exists in many places by design (CLAUDE.md, "The nav exists in 16
// places"): every public page ships a static copy so crawlers see the links
// in-source, js/nav.js renders two more variants, and three Netlify
// functions hold server copies. That is exactly how the Armory link shipped
// present on two pages and missing from every other copy (2026-10-29): the
// #218 rebuild added it to the two pages it touched, and nothing checked
// the rest. This holds every copy to one shape:
//
//   - desktop bar: Home, Builds, Parts Catalog, Armory — in that order,
//     Armory active ONLY on gunforma-armory.html, and NO flat "Your P365"
//     bar link anywhere
//   - hamburger, in three groups (Alex, 2026-10-29): Builds / Parts
//     Catalog / Armory (desktop order), then the "Your P365" dropdown as
//     its own group framed by two blue dividers (its own borders), the
//     account items nav.js appends landing below the second line — and the
//     dropdown is GUN_HUBS exactly (same hubs, same order, names from
//     GUN_META, the /p365/ index link last), the same contract
//     check-home-picker.mjs holds the homepage picker to
//   - the dropdown's CSS block is present wherever the menu is styled —
//     without it the <details> row renders as an unstyled browser default
//
// A failure renders perfectly in a browser — a page whose header quietly
// lacks a link is the orphan shape this repo keeps paying for — which is
// the entry criterion for scripts/check-all.sh. No network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUN_HUBS, GUN_META, hubPath, HUB_INDEX_PATH } from '../netlify/functions/_guide-meta.mjs';
import { navHtml, navSubHtml } from '../netlify/functions/_page-chrome.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let failures = 0;
const fail = (msg) => { console.error('FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('ok    ' + msg);

// The public pages that ship the nav as static HTML. Admin screens carry
// the Admin bar, sign-in/sign-up carry the stripped auth nav, and
// post-build renders its nav from js/nav.js — none of those are here, but
// post-build still styles the menu, so it is in CSS_FILES below.
const STATIC_PAGES = [
  'index.html', 'gunforma-builds.html', 'gunforma-parts-catalog.html',
  'gunforma-build-detail.html', 'gunforma-profile.html',
  'gunforma-notifications.html', 'field-notes.html',
  'gunforma-gun-guides.html', 'gunforma-armory.html', 'privacy-policy.html',
  'terms-of-service.html', 'builder-agreement.html', 'gunforma-legal.html',
];
const CSS_FILES = [
  ...STATIC_PAGES, 'gunforma-post-build.html',
  'netlify/functions/_page-chrome.mjs', 'netlify/functions/product-page.mjs',
  'netlify/functions/parts-index.mjs',
];

const DESKTOP = [
  ['/', 'Home'],
  ['gunforma-builds.html', 'Builds'],
  ['gunforma-parts-catalog.html', 'Parts Catalog'],
  ['gunforma-armory.html', 'Armory'],
];
const DROPDOWN = [
  ...GUN_HUBS.map((h) => [hubPath(h.gun), GUN_META[h.gun]]),
  [HUB_INDEX_PATH, 'All P365 models →'],
];
// The signed-out bottom group, below the dropdown's second blue divider
// (Alex, 2026-10-30). Shipped in every copy's markup with class="anon",
// which is the hook nav.js's signed-in paint removes (replacing them with
// the account entries) and its anon branch restores on sign-out.
const ANON_ROWS = [
  '<a class="anon" href="gunforma-signin.html">Sign in</a>',
  '<a class="anon" href="gunforma-signup.html">Create account</a>',
];
const MENU_AROUND = [
  ['gunforma-builds.html', 'Builds'],
  ['gunforma-parts-catalog.html', 'Parts Catalog'],
  ['gunforma-armory.html', 'Armory'],
  ['gunforma-signin.html', 'Sign in'],
  ['gunforma-signup.html', 'Create account'],
];
// Both states of the bottom group, checkable from source: the menu ships
// the anon pair, and nav.js both removes it when signed in and restores it
// when signed out.
const checkAnonRows = (menuText, file) => {
  let good = true;
  for (const row of ANON_ROWS) {
    if (!menuText.includes(row)) { fail(`${file}: signed-out row missing from the menu: ${row}`); good = false; }
  }
  if (good && menuText.indexOf('</details>') > menuText.indexOf(ANON_ROWS[0])) {
    fail(`${file}: the signed-out rows sit below the dropdown's second divider`); good = false;
  }
  return good;
};

// Anchors as they appear in page HTML and inside .js/.mjs string literals
// alike: the markup text is the same, only the quoting around it differs.
const links = (s) => [...s.matchAll(/href="([^"']+)"[^>]*>([^<']+)<\/a>/g)].map((m) => [m[1], m[2]]);
const region = (s, from, to, file, label) => {
  const a = s.indexOf(from);
  const b = a === -1 ? -1 : s.indexOf(to, a);
  if (a === -1 || b === -1) { fail(`${file}: no ${label} region (${from} … ${to})`); return null; }
  return s.slice(a, b);
};
const sameList = (have, want, file, label) => {
  const h = have.map((l) => l.join(' → ')), w = want.map((l) => l.join(' → '));
  for (let i = 0; i < Math.max(h.length, w.length); i++) {
    if (h[i] !== w[i]) { fail(`${file}: ${label} link ${i + 1}: expected "${w[i] ?? '(nothing)'}", found "${h[i] ?? '(nothing)'}"`); return false; }
  }
  return true;
};

// ── the static pages ──────────────────────────────────────────────────────
for (const file of STATIC_PAGES) {
  const t = read(file);
  let good = true;

  const bar = region(t, 'class="nav-links"', 'class="nav-right"', file, 'desktop bar');
  if (bar) {
    good = sameList(links(bar), DESKTOP, file, 'desktop') && good;
    const armoryActive = /class="nav-link active" href="gunforma-armory\.html"/.test(bar);
    const wantActive = file === 'gunforma-armory.html';
    if (armoryActive !== wantActive) {
      fail(`${file}: Armory bar link ${wantActive ? 'must be' : 'must NOT be'} active`); good = false;
    }
  } else good = false;

  const menu = region(t, 'class="nav-menu"', '</nav>', file, 'hamburger menu');
  if (menu) {
    const sub = region(menu, '<details class="nav-sub">', '</details>', file, 'Your P365 dropdown');
    if (sub) {
      if ((menu.match(/<summary>Your P365<\/summary>/g) || []).length !== 1) { fail(`${file}: exactly one <summary>Your P365</summary>`); good = false; }
      good = sameList(links(sub), DROPDOWN, file, 'dropdown') && good;
      const around = links(menu.replace(sub + '</details>', '\u0000'));
      good = sameList(around, MENU_AROUND, file, 'menu') && good;
      if (menu.indexOf('Armory</a>') > menu.indexOf('<details')) {
        fail(`${file}: the dropdown is its own group after Builds / Parts Catalog / Armory`); good = false;
      }
      good = checkAnonRows(menu, file) && good;
    } else good = false;
  } else good = false;

  if (t.includes('>Your P365</a>')) { fail(`${file}: a flat "Your P365" link survives — it lives only in the dropdown`); good = false; }
  if (good) pass(`${file}: bar and menu carry the shape`);
}

// ── js/nav.js: the rendered variants ──────────────────────────────────────
{
  const file = 'js/nav.js';
  const t = read(file);
  let good = true;
  const sub = region(t, '<details class="nav-sub">', '</details>', file, 'NAV_P365_SUB');
  if (sub) good = sameList(links(sub), DROPDOWN, file, 'NAV_P365_SUB') && good; else good = false;
  const menu = region(t, 'class="nav-menu"', '</div>\';', file, 'NAV_MENU');
  if (menu) {
    const idx = ['Builds</a>', 'Parts Catalog</a>', 'Armory</a>', 'NAV_P365_SUB', 'Sign in</a>', 'Create account</a>'].map((m) => menu.indexOf(m));
    if (idx.some((i) => i === -1) || idx.some((i, n) => n && i < idx[n - 1])) { fail(`${file}: NAV_MENU is not Builds, Parts Catalog, Armory, the dropdown, the signed-out rows`); good = false; }
  } else good = false;
  // Both states: the signed-in paint must remove the anon rows, and the
  // anon branch must restore them, or a sign-in shows both groups at once
  // and a sign-out shows neither.
  if (!t.includes("'.nav-menu .acct, .nav-menu .admin, .nav-menu .anon'")) {
    fail(`${file}: the signed-in sweep does not remove the .anon rows`); good = false;
  }
  if (!t.includes('ANON_LINKS.forEach')) {
    fail(`${file}: the anon branch does not restore the signed-out rows`); good = false;
  }
  const armoryBars = (t.match(/activeIf\('gunforma-armory\.html'\) \+ '" href="gunforma-armory\.html">Armory<\/a>'/g) || []).length;
  if (armoryBars !== 2) { fail(`${file}: the full and full-authed bars each carry Armory with activeIf (found ${armoryBars})`); good = false; }
  if (t.includes('>Your P365</a>')) { fail(`${file}: a flat "Your P365" link survives`); good = false; }
  if (good) pass(`${file}: NAV_P365_SUB, NAV_MENU and both bar variants carry the shape`);
}

// ── _page-chrome.mjs: executed, not grepped ───────────────────────────────
{
  const file = 'netlify/functions/_page-chrome.mjs';
  let good = true;
  good = sameList(links(region(navSubHtml(), '<details', '</details>', file, 'navSubHtml') || ''), DROPDOWN, file, 'navSubHtml') && good;
  const html = navHtml({ active: 'armory' });
  const bar = region(html, 'class="nav-links"', 'class="nav-right"', file, 'desktop bar');
  if (bar) {
    good = sameList(links(bar), DESKTOP, file, 'desktop') && good;
    if (!/class="nav-link active" href="gunforma-armory\.html"/.test(bar)) { fail(`${file}: active 'armory' does not light the Armory item`); good = false; }
  } else good = false;
  const menu = region(html, 'class="nav-menu"', '</nav>', file, 'hamburger menu');
  if (!menu || !menu.includes('<summary>Your P365</summary>') || menu.indexOf('Parts Catalog</a>') > menu.indexOf('Armory</a>') || menu.indexOf('Armory</a>') > menu.indexOf('<details')) {
    fail(`${file}: navHtml menu is not Builds, Parts Catalog, Armory, the dropdown`); good = false;
  }
  if (menu) good = checkAnonRows(menu, file) && good;
  if (html.includes('>Your P365</a>')) { fail(`${file}: a flat "Your P365" link survives`); good = false; }
  if (good) pass(`${file}: navHtml() and navSubHtml() render the shape`);
}

// ── product-page.mjs and parts-index.mjs: their own copies ────────────────
for (const file of ['netlify/functions/product-page.mjs', 'netlify/functions/parts-index.mjs']) {
  const t = read(file);
  let good = true;
  const bar = region(t, 'class="nav-links"', 'class="nav-right"', file, 'desktop bar');
  if (bar) good = sameList(links(bar), DESKTOP, file, 'desktop') && good; else good = false;
  const menu = region(t, 'class="nav-menu" id="nav-menu"', '</nav>', file, 'hamburger menu');
  if (menu) {
    const idx = ['Builds</a>', 'Parts Catalog</a>', 'Armory</a>', 'navSubHtml()', 'Sign in</a>', 'Create account</a>'].map((m) => menu.indexOf(m));
    if (idx.some((i) => i === -1) || idx.some((i, n) => n && i < idx[n - 1])) { fail(`${file}: menu is not Builds, Parts Catalog, Armory, navSubHtml(), the signed-out rows`); good = false; }
  } else good = false;
  if (t.includes('>Your P365</a>')) { fail(`${file}: a flat "Your P365" link survives`); good = false; }
  if (good) pass(`${file}: bar and menu carry the shape`);
}

// ── the dropdown's CSS rides with every styled menu, byte for byte ────────
// `display: block` on the links is load-bearing, not styling: the flat menu
// links are flex children (blockified), the dropdown's are not, so without
// it they flow inline and overlap — found on the first preview walkthrough.
const CSS_RULES = [
  // The two blue group dividers (Alex, 2026-10-29): the dropdown is its own
  // menu group — site links above its top border, the account items nav.js
  // appends land below its bottom border. #4a9edd is the site's accent blue
  // (the "+ Post your build" button), not a new colour.
  '.nav-menu .nav-sub { border-top: 2px solid #4a9edd; border-bottom: 2px solid #4a9edd; }',
  '.nav-menu .nav-sub summary { padding: 13px 28px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #ffffff; cursor: pointer; list-style: none; border-bottom: 0.5px solid #1a1b1e; }',
  '.nav-menu .nav-sub summary::-webkit-details-marker { display: none; }',
  '.nav-menu .nav-sub summary::after { content: " ▾"; color: #6a6b6e; }',
  '.nav-menu .nav-sub[open] summary::after { content: " ▴"; }',
  '.nav-menu .nav-sub a { display: block; padding-left: 44px; }',
];
for (const file of CSS_FILES) {
  const t = read(file);
  for (const rule of CSS_RULES) {
    if (!t.includes(rule)) fail(`${file}: .nav-sub CSS rule missing or drifted: ${rule.slice(0, 40)}…`);
  }
}
pass('dropdown CSS block identical in every file that styles the menu (or failures above name them)');

if (failures) {
  console.error('\n' + failures + ' nav failure(s). Every nav copy must carry Home/Builds/Parts Catalog/Armory on the bar and the "Your P365" GUN_HUBS dropdown in the hamburger — see scripts/check-nav.mjs header.');
  process.exit(1);
}
console.log('\nevery nav copy carries the Armory link and the Your P365 dropdown.');
