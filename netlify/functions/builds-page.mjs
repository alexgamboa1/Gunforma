// builds-page — serves gunforma-builds.html with the newest approved builds
// rendered INTO the grid, so the gallery's served HTML carries /b/ links.
// -----------------------------------------------------------------------------
// The gallery used to serve "Loading builds…" and nothing else; its cards
// were drawn by loadBuilds() in the browser, and a crawler scraping the
// page found no build at all (scripts/check-routes.mjs has a note on
// exactly that). Same fix as home-page.mjs, same shape, same rules: the
// static page from the bundle, exact-string replaces held to the page by
// scripts/check-canonical-coupling.mjs, the page's own JS hydrating over
// identical markup, and on a failed read THE STATIC PAGE at 200 (never a
// 503 — the page's script draws the grid itself, as it always did).
//
// The filters stay the page's: the server renders the default view
// (newest first, every platform, every activity), and loadBuilds() replaces
// the grid with the same cards and live like-state the moment it runs.
import { readFile } from 'node:fs/promises';
import { CDN_CACHE_PAGE } from './_cache.mjs';
import { unavailable } from './_pg.mjs';
import { fetchBuilds, fetchPriceTotals, galleryCardHtml, CARD_LIMIT } from './_build-cards.mjs';

const PAGE_CANDIDATES = [
  'gunforma-builds.html',
  './gunforma-builds.html',
  new URL('../../gunforma-builds.html', import.meta.url),
];

let cachedPage = null;
async function loadPage() {
  if (cachedPage) return cachedPage;
  for (const candidate of PAGE_CANDIDATES) {
    try {
      cachedPage = await readFile(candidate, 'utf8');
      return cachedPage;
    } catch { /* try next */ }
  }
  return null;
}

function inject(page, builds, totals) {
  if (!builds.length) return page;
  // The "Post your build" tile leads the grid, as renderGrid() draws it.
  const postTile =
    '<a class="post-tile" href="gunforma-post-build.html">' +
      '<div class="post-tile-icon">+</div>' +
      '<div class="post-tile-title">Post your build</div>' +
      '<div class="post-tile-sub">Show off your setup and parts list</div>' +
    '</a>';
  let html = page.replace('<div id="grid-container"><div class="loading">Loading builds…</div></div>',
    () => '<div id="grid-container" data-server="' + builds.length + '"><div class="builds-grid">' +
      postTile + builds.map((b) => galleryCardHtml(b, totals[b.id])).join('') + '</div></div>');
  html = html.replace('<div class="page-count" id="page-count"></div>',
    () => '<div class="page-count" id="page-count">' + builds.length + ' build' + (builds.length !== 1 ? 's' : '') + '</div>');
  return html;
}

export default async () => {
  const page = await loadPage();
  if (!page) {
    console.error('[builds-page] gunforma-builds.html not bundled — check included_files');
    // A 503, not a redirect: the page's own path is a forced rewrite to
    // THIS function, so bouncing to it would loop. unavailable() is never
    // cached and says Retry-After.
    return unavailable();
  }

  let builds = [], totals = {}, failed = false;
  try {
    builds = await fetchBuilds({ limit: CARD_LIMIT });
    totals = await fetchPriceTotals(builds);
  } catch (err) {
    console.error('[builds-page] builds lookup failed', err);
    failed = true;
    builds = []; totals = {};
  }

  return new Response(inject(page, builds, totals), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': CDN_CACHE_PAGE,
      'x-builds-page': failed ? 'static' : String(builds.length),
    },
  });
};
