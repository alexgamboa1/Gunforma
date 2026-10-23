// home-page — serves index.html at / with the newest approved builds and
// the hero counts rendered INTO it, so the homepage's served HTML carries
// real /b/ links and real numbers instead of a call-to-action tile and
// three dashes.
// -----------------------------------------------------------------------------
// Measured 2026-10-22: the raw HTML of https://gunforma.com/ held zero /b/
// links. Every build card was written by loadFeatured() in the browser, so
// to a crawler the builds — the only content unique to this site — were
// reachable through the sitemap and through nothing else. Same orphan shape
// the /fit/ cluster had before the hubs (CLAUDE.md, "Server-rendered
// pages"), one level up.
//
// SAME SHAPE AS build-og.mjs, deliberately: the static page is read from
// the bundle (included_files in netlify.toml), the placeholders it ships
// are replaced by exact string, and the page's own JS runs over the result.
// Every literal below is held to index.html byte-for-byte by
// scripts/check-canonical-coupling.mjs — edit a placeholder there and the
// matching literal here in the same commit, or the build refuses to ship.
// Replacements are arrow functions (a plain string interprets `$`, and a
// build is named whatever its builder typed).
//
// WHAT IS DIFFERENT FROM build-og.mjs: a failure to read PostgREST serves
// THE STATIC PAGE, UNCHANGED, at 200 — never a 503. A build page that
// cannot be read must not be mistaken for a build that is gone (that is
// the 410 rule _pg.mjs exists for); the homepage has no such trap, and
// what it serves on failure is exactly what it served before this function
// existed: the page, whose JS then draws the cards itself. The response
// says which happened in x-home-builds (a count, or "static").
//
// Twenty-four newest, not three random. The page's loadFeatured() picked
// three at random on every load so an old build got the same front-page
// odds as a new one; a crawler needs the links to be THERE, and a page
// that reshuffled under the first paint would be served one set of cards
// and show another. index.html's script now leaves a server-rendered row
// alone (data-server) and falls back to its own pick only when the row is
// the static tile — i.e. when this function served the fallback.
//
// Cached at the edge for an hour, durable (CDN_CACHE_PAGE): a build
// approved now is on the homepage within the hour, which is the brief's
// bound for every server-rendered page.
import { readFile } from 'node:fs/promises';
import { CDN_CACHE_PAGE } from './_cache.mjs';
import { pgRows, unavailable } from './_pg.mjs';
import { fetchBuilds, fetchPriceTotals, homeCardHtml, CARD_LIMIT } from './_build-cards.mjs';

const PAGE_CANDIDATES = [
  'index.html',
  './index.html',
  new URL('../../index.html', import.meta.url),
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

// The three hero counts, under the same definitions the page's
// loadHeroStats() uses so the number it writes over these is the same
// number: parts = products not discontinued (what /parts lists), brands =
// distinct brand_id across those rows, listings = affiliate_links not
// retired. Counted from rows rather than a HEAD count because pgRows is
// the one reader (an array, or a throw) and the sets are small; PostgREST's
// row cap is above both today, and a capped read would still be a count
// of what was read, never an invented number.
async function fetchHeroCounts() {
  const [products, links] = await Promise.all([
    pgRows('products?select=brand_id&is_discontinued=eq.false&limit=5000'),
    pgRows('affiliate_links?select=id&retired_at=is.null&limit=10000'),
  ]);
  const brands = new Set(products.map((p) => p && p.brand_id).filter(Boolean));
  return { parts: products.length, brands: brands.size, listings: links.length };
}

const fmt = (n) => Number(n).toLocaleString('en-US');

function inject(page, builds, totals, counts) {
  let html = page;

  // The featured row. The static tile is the pre-JS state; it is replaced
  // whole so the page's script sees a server-rendered row and leaves it.
  // Fewer than three builds: the builds, then the tile in the next cell —
  // the page's own rule.
  if (builds.length) {
    const CTA_TILE =
      '<a class="build-cta" href="gunforma-post-build.html">' +
        '<span class="build-cta-title">Post your build</span>' +
        '<span class="build-cta-sub">Your parts, your photos — on the record.</span>' +
      '</a>';
    html = html.replace('<div class="builds-row" id="featured-builds"><a class="build-cta" href="gunforma-post-build.html"><span class="build-cta-title">Post your build</span><span class="build-cta-sub">Your parts, your photos — on the record.</span></a></div>',
      () => '<div class="builds-row" id="featured-builds" data-server="' + builds.length + '">' +
        builds.map((b) => homeCardHtml(b, totals[b.id])).join('') +
        (builds.length < 3 ? CTA_TILE : '') +
      '</div>');
  }

  // The counts. A count of zero is left as the dash for the page's script
  // to remove, exactly as a failed count is.
  if (counts) {
    if (counts.parts > 0) {
      html = html.replace('<span class="hero-stat-num" id="stat-parts">—</span>',
        () => '<span class="hero-stat-num" id="stat-parts">' + fmt(counts.parts) + '</span>');
    }
    if (counts.brands > 0) {
      html = html.replace('<span class="hero-stat-num" id="stat-brands">—</span>',
        () => '<span class="hero-stat-num" id="stat-brands">' + fmt(counts.brands) + '</span>');
    }
    if (counts.listings > 0) {
      html = html.replace('<span class="hero-stat-num" id="stat-listings">—</span>',
        () => '<span class="hero-stat-num" id="stat-listings">' + fmt(counts.listings) + '</span>');
    }
  }
  return html;
}

function serve(html, extra) {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': CDN_CACHE_PAGE,
      ...extra,
    },
  });
}

export default async () => {
  const page = await loadPage();
  if (!page) {
    // index.html not bundled: a misconfiguration, loud in the log, and a
    // reader still gets a page that works.
    console.error('[home-page] index.html not bundled — check included_files');
    // A 503, not a redirect: the page's own path is a forced rewrite to
    // THIS function, so bouncing to it would loop. unavailable() is never
    // cached and says Retry-After.
    return unavailable();
  }

  let builds = [], totals = {}, counts = null;
  const errors = [];
  try {
    builds = await fetchBuilds({ limit: CARD_LIMIT });
    totals = await fetchPriceTotals(builds);
  } catch (err) {
    console.error('[home-page] builds lookup failed', err);
    errors.push('builds');
    builds = []; totals = {};
  }
  try {
    counts = await fetchHeroCounts();
  } catch (err) {
    console.error('[home-page] counts lookup failed', err);
    errors.push('counts');
  }

  return serve(inject(page, builds, totals, counts), {
    // Observable from outside (check-routes.mjs): how many cards were
    // served, or "static" when the builds read failed and the page's own
    // script will draw them.
    'x-home-builds': errors.includes('builds') ? 'static' : String(builds.length),
    'x-home-counts': counts ? counts.parts + '/' + counts.brands + '/' + counts.listings : 'static',
  });
};
