// parts-index — server-renders /parts: a plain, always-visible index of
// every product on the site, grouped by category and linking to each one's
// /parts/:category/:slug page.
// -----------------------------------------------------------------------------
// Why this exists: gunforma-parts-catalog.html is client-rendered — it shows
// a "Loading parts…" shell until Supabase resolves in the browser. Google
// and Bing execute JS and eventually see the real catalog, but GPTBot,
// ClaudeBot, and PerplexityBot largely don't wait around, so they only ever
// see the loading shell. The individual product pages are already
// crawlable (product-page.mjs) and already in sitemap.xml, but there was no
// single page enumerating all of them for a crawler that doesn't run JS.
// This is that page — a manifest, not a replacement for the interactive
// catalog. It links back to the real catalog for anyone who actually wants
// to filter/sort.
//
// Same conventions as product-page.mjs and profile-og.mjs on purpose:
// dependency-free PostgREST fetch with the public anon key, no build step,
// no bundler. Unlike those two, there's no per-record slug to extract —
// this route takes no parameters and always renders the same (cached) page.
// -----------------------------------------------------------------------------

import { CATEGORY_META } from './_category-meta.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE = 'https://gunforma.com';
const CANONICAL = SITE + '/parts';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function displayPartnerName(name) {
  // Mirrors product-page.mjs's own helper of the same name — manufacturer
  // records occasionally carry a parenthetical suffix (e.g. distributor
  // notes) that isn't meant for display.
  if (!name) return name;
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

async function pgGet(path) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
  });
  if (!res.ok) throw new Error('PostgREST ' + res.status + ' for ' + path);
  return res.json();
}

async function fetchAllProducts() {
  // slug + name + category is all a link needs; manufacturer name is the
  // one extra field worth carrying, since it disambiguates products that
  // share a generic name across brands and gives crawlers a little more
  // text to work with per entry. No pricing or specs here — that's what
  // the product page itself is for; this page's job is being a link
  // manifest, not a second copy of the catalog.
  const cols = [
    'id', 'slug', 'name', 'category',
    'manufacturers!products_brand_id_fkey(name)',
  ].join(',');
  return pgGet('products?select=' + encodeURIComponent(cols) + '&order=name.asc');
}

function groupByCategory(products) {
  const byCategory = new Map();
  for (const p of products) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  }
  return byCategory;
}

function renderPage(products) {
  const byCategory = groupByCategory(products);

  // Iterate CATEGORY_META's own key order (matches the products.category
  // enum) rather than alphabetical or discovery order, so the page layout
  // is stable across requests regardless of query result ordering and
  // matches the category ordering used elsewhere in the codebase.
  const categoryEntries = Object.entries(CATEGORY_META)
    .map(([category, [segment, label]]) => ({ category, segment, label, items: byCategory.get(category) || [] }))
    .filter((c) => c.items.length);

  const jumpNavHtml = categoryEntries
    .map((c) => '<a class="jump-link" href="#' + esc(c.segment) + '">' + esc(c.label) + ' (' + c.items.length + ')</a>')
    .join('');

  const sectionsHtml = categoryEntries.map((c) => {
    const itemsHtml = c.items.map((p) => {
      const brand = displayPartnerName(p.manufacturers ? p.manufacturers.name : null);
      const href = '/parts/' + c.segment + '/' + p.slug;
      return '<li><a href="' + esc(href) + '">' + esc(p.name) +
        (brand ? ' <span class="brand">— ' + esc(brand) + '</span>' : '') +
        '</a></li>';
    }).join('');
    return '<section id="' + esc(c.segment) + '" class="category">' +
      '<h2>' + esc(c.label) + ' <span class="count">(' + c.items.length + ')</span></h2>' +
      '<ul>' + itemsHtml + '</ul>' +
    '</section>';
  }).join('');

  const totalCount = products.length;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'CollectionPage',
    name: 'Gunforma Parts Index',
    description: 'Every P365 part listed on Gunforma, grouped by category.',
    url: CANONICAL,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: totalCount,
      itemListElement: products.map((p, i) => {
        const [segment] = CATEGORY_META[p.category] || [p.category];
        return {
          '@type': 'ListItem',
          position: i + 1,
          url: SITE + '/parts/' + segment + '/' + p.slug,
          name: p.name,
        };
      }),
    },
  };

  const title = 'Every P365 Part — Gunforma Parts Index';
  const metaDescription = 'A complete index of all ' + totalCount +
    ' P365 parts on Gunforma — slides, barrels, frames, triggers, optics, and more — grouped by category.';

  return '<!DOCTYPE html><html lang="en"><head>' +
'<meta charset="UTF-8"/>' +
'<base href="/"/>' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
'<link rel="icon" type="image/png" href="/favicon-96x96.png?v=12026" sizes="96x96" />' +
'<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=12026" />' +
'<link rel="shortcut icon" href="/favicon.ico?v=12026" />' +
'<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=12026" />' +
'<link rel="manifest" href="/site.webmanifest?v=12026" />' +
'<title>' + esc(title) + '</title>' +
'<link rel="canonical" href="' + esc(CANONICAL) + '" />' +
'<meta name="description" content="' + esc(metaDescription) + '"/>' +
'<meta property="og:type" content="website"/>' +
'<meta property="og:title" content="' + esc(title) + '"/>' +
'<meta property="og:description" content="' + esc(metaDescription) + '"/>' +
'<meta property="og:url" content="' + esc(CANONICAL) + '"/>' +
'<meta name="twitter:card" content="summary"/>' +
'<meta name="twitter:title" content="' + esc(title) + '"/>' +
'<meta name="twitter:description" content="' + esc(metaDescription) + '"/>' +
'<script type="application/ld+json">' + JSON.stringify(jsonLd).replace(/</g, '\\u003c') + '</script>' +
'<style>' +
'* { box-sizing: border-box; margin: 0; padding: 0; }' +
'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafaf8; color: #1a1a1a; min-height: 100vh; }' +
'.nav { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; height: 52px; border-bottom: 0.5px solid #2a2b2e; background: #0e0f11; }' +
'.nav-logo { font-size: 15px; font-weight: 600; color: #e8e6e1; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; }' +
'.nav-logo span { color: #4a9edd; }' +
'.nav-links { display: flex; gap: 28px; }' +
'.nav-link { font-size: 12px; color: #888780; letter-spacing: 0.06em; text-transform: uppercase; text-decoration: none; }' +
'.nav-link:hover, .nav-link.active { color: #e8e6e1; }' +
'.nav-right { display: flex; align-items: center; gap: 14px; }' +
'.nav-btn { font-size: 11px; color: #888780; border: 0.5px solid #2a2b2e; padding: 5px 12px; border-radius: 4px; cursor: pointer; text-decoration: none; }' +
'.nav-btn.cta { color: #4a9edd; border-color: #4a9edd; }' +
'.page { max-width: 900px; margin: 0 auto; padding: 28px 24px 64px; }' +
'.intro { margin-bottom: 22px; }' +
'.eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #4a9edd; font-weight: 700; margin-bottom: 6px; }' +
'h1 { font-size: 26px; line-height: 1.25; margin-bottom: 8px; }' +
'.sub { font-size: 13px; color: #666; line-height: 1.5; }' +
'.sub a { color: #4a9edd; }' +
'.jump-nav { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 20px 0 28px; padding: 14px; background: #fff; border: 0.5px solid #e5e5e5; border-radius: 8px; }' +
'.jump-link { font-size: 12px; color: #345; text-decoration: none; background: #eef2f6; padding: 4px 10px; border-radius: 20px; }' +
'.category { margin-bottom: 26px; }' +
'.category h2 { font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #1a1a1a; margin-bottom: 10px; padding-top: 8px; border-top: 0.5px solid #ececec; }' +
'.category h2 .count { color: #999; font-weight: 400; text-transform: none; letter-spacing: 0; }' +
'.category ul { list-style: none; }' +
'.category li { font-size: 13px; padding: 6px 0; border-bottom: 0.5px solid #f2f2f2; }' +
'.category a { color: #1a1a1a; text-decoration: none; }' +
'.category a:hover { color: #4a9edd; }' +
'.brand { color: #999; font-weight: 400; }' +
'.footer-bar { max-width: 900px; margin: 0 auto; padding: 24px; display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: space-between; border-top: 0.5px solid #e5e5e5; font-size: 11px; color: #999; }' +
'.footer-bar a { color: #999; }' +
'</style>' +
'</head><body>' +
'<nav class="nav">' +
  '<a class="nav-logo" href="index.html">GUN<span>FORMA</span></a>' +
  '<div class="nav-links">' +
    '<a class="nav-link" href="index.html">Home</a>' +
    '<a class="nav-link" href="gunforma-builds.html">Builds</a>' +
    '<a class="nav-link active" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
    '<a class="nav-link" href="gunforma-armory.html">Armory</a>' +
  '</div>' +
  '<div class="nav-right">' +
    '<a class="nav-btn" href="gunforma-signin.html" id="nav-signin">Sign in</a>' +
    '<a class="nav-btn cta" href="gunforma-post-build-v6.html">+ Post your build</a>' +
  '</div>' +
'</nav>' +
'<div class="page">' +
  '<div class="intro">' +
    '<div class="eyebrow">Full Catalog Index</div>' +
    '<h1>Every P365 Part on Gunforma</h1>' +
    '<div class="sub">' + totalCount + ' parts across ' + categoryEntries.length +
      ' categories. Want to filter by fit, price, or brand instead? Use the ' +
      '<a href="gunforma-parts-catalog.html">interactive Parts Catalog</a>.</div>' +
  '</div>' +
  '<div class="jump-nav">' + jumpNavHtml + '</div>' +
  sectionsHtml +
'</div>' +
'<div class="footer-bar">' +
  '<span>&copy; 2026 Gunforma &middot; All rights reserved</span>' +
  '<span><a href="gunforma-legal.html#legal">Legal</a> &middot; <a href="gunforma-legal.html#affiliate">Affiliate disclosure</a> &middot; <a href="gunforma-legal.html#contact">Contact</a></span>' +
'</div>' +
'</body></html>';
}

export default async () => {
  let products;
  try {
    products = await fetchAllProducts();
  } catch (err) {
    console.error('[parts-index] product list fetch failed', err);
    return new Response('Temporarily unavailable — try again shortly.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const html = renderPage(Array.isArray(products) ? products : []);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
    },
  });
};
