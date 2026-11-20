// field-note — server-renders /field-notes/:slug, a Field Notes article,
// from a Markdown file inside the site's real chrome, with two live-data
// blocks no static gun blog can have: the price of a part today, and
// whether it fits a given pistol, both read from the catalog on every
// request.
// -----------------------------------------------------------------------------
// Modelled on guide-page.mjs and gun-hub.mjs, and holding to the same
// rules: dependency-free PostgREST fetch through _pg.mjs (a failed read is
// 503 with Retry-After, never a 404), apex canonical, the shared nav from
// _page-chrome.mjs (so this is NOT a seventeenth nav copy), the analytics
// tag closing the document, durable edge caching on a 200 and no-store on
// anything else.
//
// WHAT IS LIVE AND WHAT IS EDITORIAL
// The prose is the file: field-notes/<slug>.md, reviewed by a human, with
// its title, description and author in the front matter. The numbers are
// not: a `::price` directive renders the current hero listing of each
// named part under the stale-price and sort rules every other page uses
// (_listing-rules.mjs), and a `::fit` directive renders a fit verdict
// walked from the fitment tables — the optic's footprint against the
// gun's cuts by SKU, or the maker's own magazine claim — so an article
// cannot say a price or a fit the catalog does not. The build guard
// (scripts/check-field-notes.mjs) refuses a typed dollar figure in prose.
//
// A SLUG RENDERS ONLY IF DECLARED in _field-notes-meta.mjs; a file alone
// is not a page. An undeclared slug, a path that is not a slug, and a
// `.md` asked for by name all 404 before any read — which is what lets the
// /field-notes/* rewrite be forced (netlify.toml) without serving the raw
// Markdown. A DRAFT is served only off the apex: on gunforma.com it is a
// 404, on a deploy preview it is the page, with noindex and no caching.
//
// The file is read from disk, bundled with the function by included_files
// in netlify.toml the way build-og.mjs carries gunforma-build-detail.html.
// A declared article whose file is not in the bundle is a packaging
// defect, answered 502 (no-store, no Retry-After) rather than 404: the
// page exists, this deploy just cannot find it.

import { readFile } from 'node:fs/promises';
import { FIELD_NOTES_INDEX_PATH, fieldNote, fieldNotePath, fieldNoteFile, relatedNotes, gunsForFieldNote } from './_field-notes-meta.mjs';
import { parseFrontMatter, renderMarkdown, inline, textOf } from './_markdown.mjs';
import { navHtml, footerHtml, navScript, chromeCss, layoutCss, headTags, esc } from './_page-chrome.mjs';
import { isStalePrice, compareListingRows, displayPartnerName } from './_listing-rules.mjs';
import { makerLink, buyDisclosure, MAKER_REL } from './_maker-link.mjs';
import { displayProductName } from './_display-name.mjs';
import { CATEGORY_META } from './_category-meta.mjs';
import { GUN_META, APPLIES_TO_LABEL, HUB_MAGAZINE_COPY, guidePath, isLiveGuidePage, hubPath, isLiveGunHub } from './_guide-meta.mjs';
import { ANALYTICS_SNIPPET } from './_analytics.mjs';
import { pgRows as pgGet, unavailable } from './_pg.mjs';
import { CDN_CACHE_PAGE, CDN_CACHE_NO_STORE } from './_cache.mjs';
import { GUIDE_SPECS, PRODUCT_COLS, colMeta, withGoParams, AFFILIATE_DISCLOSURE_HTML, BUILD_ROLE_META, METHOD_LINE_HTML } from './_guide-blocks.mjs';
import { swatchFor } from './_variant-swatch.mjs';

const SITE = 'https://gunforma.com';
const APEX_HOST = 'gunforma.com';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ── routing ──────────────────────────────────────────────────────────────
// A function receives the ORIGINAL request URL (CLAUDE.md, "Netlify
// redirects"), so the pathname is the reader's own. The ?splat= form is
// what netlify dev substitutes and is read second.
function extractSlug(req) {
  const url = new URL(req.url);
  const splat = url.searchParams.get('splat');
  const path = splat != null && splat !== '' ? '/field-notes/' + splat.replace(/^\/+/, '') : url.pathname;
  const m = path.match(/^\/field-notes\/([^/]+)\/?$/);
  if (!m) return null;
  let slug;
  try { slug = decodeURIComponent(m[1]); } catch { return null; }
  return SLUG_RE.test(slug) ? slug : null;
}

function isApex(req) {
  return new URL(req.url).hostname === APEX_HOST;
}

// Same candidates idea as build-og.mjs's loadPage(): the bundle's working
// directory, then relative to this module. Null when none reads.
async function loadSource(slug) {
  const rel = fieldNoteFile(slug);
  const candidates = [rel, './' + rel, new URL('../../' + rel, import.meta.url)];
  for (const c of candidates) {
    try { return await readFile(c, 'utf8'); } catch { /* next */ }
  }
  return null;
}

// ── responses that are not the page ──────────────────────────────────────
function notFound(detail) {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Page not found — Gunforma</title>' +
    '<meta name="robots" content="noindex"/>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
    'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
    '</head><body><div><div style="font-size:20px;font-weight:700">Page not found</div>' +
    '<div class="s">' + esc(detail || 'No field note at this address.') + '</div>' +
    '<a href="' + SITE + FIELD_NOTES_INDEX_PATH + '">All Field Notes &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60',
                              'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE, 'x-field-note': 'none' } },
  );
}

function notBundled(slug) {
  console.error('[field-note] ' + fieldNoteFile(slug) + ' not bundled — check included_files in netlify.toml');
  return new Response('Temporarily unavailable — try again shortly.\n', {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
               'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE, 'x-field-note': slug, 'x-field-note-source': 'missing' },
  });
}

// ── products: the price block, and the part half of a fit block ──────────
async function fetchProducts(slugs) {
  if (!slugs.length) return [];
  // products → product_variants is the two-FK pair: the embed MUST name
  // the FK (CLAUDE.md, PGRST201). affiliate_links and partners have one
  // FK each, so bare is right for them.
  const cols =
    'id,slug,name,category,url,is_discontinued,restricted_states,material,weight_oz,' +
    'manufacturers!products_brand_id_fkey(name,website_url),' +
    'product_variants!product_variants_product_id_fkey(id,msrp,is_default,primary_image_url,color,finish_family,manual_safety_variant,' +
      'affiliate_links(id,url,affiliate_url,street_price,in_stock,last_checked,op_last_matched_by,partners(name)))';
  const rows = await pgGet('products?slug=in.(' + slugs.map(encodeURIComponent).join(',') + ')' +
    '&select=' + encodeURIComponent(cols) +
    // Embed filters: a retired variant drops out, a retired listing drops
    // out of its live variant. The product itself always survives.
    '&product_variants.retired_at=is.null' +
    '&product_variants.affiliate_links.retired_at=is.null');
  return rows.filter((p) => p && p.slug).map(shapeProduct);
}

function shapeProduct(p) {
  const variants = p.product_variants || [];
  const listings = [];
  for (const v of variants) {
    for (const l of (v.affiliate_links || [])) {
      listings.push({
        price: l.street_price != null ? Number(l.street_price) : null,
        stale: isStalePrice(l),
        url: l.affiliate_url || l.url,
        goUrl: '/go/' + l.id,
        in_stock: l.in_stock,
        partnerName: displayPartnerName(l.partners ? l.partners.name : null),
      });
    }
  }
  listings.sort(compareListingRows);
  const dv = variants.find((v) => v.is_default) || variants[0];
  const photoV = variants.find((v) => v.is_default && v.primary_image_url) || variants.find((v) => v.primary_image_url);
  const meta = CATEGORY_META[p.category];
  const brand = p.manufacturers ? p.manufacturers.name : null;
  // Distinct live variant colours, in the order the variants arrived; a
  // ::colors table re-orders them by colors.sort_order. Blank is not a
  // colour.
  const variantColors = [...new Set(variants.map((v) => (v.color || '').trim()).filter(Boolean))];
  return {
    id: p.id, slug: p.slug, name: p.name, category: p.category, brand,
    variantColors,
    cerakote: variants.some((v) => v.finish_family === 'Cerakote'),
    manualSafety: variants.some((v) => v.manual_safety_variant === true),
    // What the page prints (_display-name.mjs): the brand is part of the
    // name, so no row carries a separate brand line under it.
    displayName: displayProductName({ brand, name: p.name }),
    href: meta ? '/parts/' + meta[0] + '/' + p.slug : '/parts',
    discontinued: p.is_discontinued === true,
    restricted: Array.isArray(p.restricted_states) ? p.restricted_states.map(String).filter(Boolean) : [],
    photo: photoV ? photoV.primary_image_url : null,
    hero: listings[0] || null,
    listings,
    msrp: dv && dv.msrp != null ? Number(dv.msrp) : null,
    material: p.material || null,
    weight_oz: p.weight_oz != null ? Number(p.weight_oz) : null,
    maker: makerLink(p.url, brand, p.manufacturers ? p.manufacturers.website_url : null),
  };
}

const hasPartnerLink = (o) => !!(o.hero && o.hero.url);
const hasMakerLink   = (o) => !hasPartnerLink(o) && !!o.maker;

// The product page's rule, unchanged: a fresh partner price, else "Check
// price" when a listing exists but is stale, else MSRP when there is no
// listing at all. Never typed, always from the row.
function priceText(o) {
  if (o.discontinued) return 'Discontinued';
  if (o.hero && o.hero.price != null && !o.hero.stale) return '$' + o.hero.price.toFixed(2);
  if (o.hero) return 'Check price';
  return o.msrp != null ? 'MSRP $' + o.msrp.toFixed(2) : 'Check price';
}

// Every buy link out of a field note carries the /go/ section params —
// s=<article slug>, loc=<block kind> — so link_clicks can say which page
// and which block sent the click (_guide-blocks.mjs). `labelOverride` is
// the picks/rank rule: with no fresh price the button says "See current
// price" instead of a number, and never MSRP.
function buyHtml(o, ctx, loc, labelOverride) {
  if (o.discontinued) return '';
  if (hasPartnerLink(o)) {
    const label = labelOverride || (o.hero.partnerName ? 'Buy at ' + esc(o.hero.partnerName) : 'View listing');
    return '<a class="buy-btn" href="' + esc(withGoParams(o.hero.goUrl, ctx.slug, loc)) + '" target="_blank" rel="noopener sponsored nofollow">' + label + ' ↗</a>';
  }
  if (hasMakerLink(o)) {
    return '<a class="buy-btn" href="' + esc(withGoParams('/go/part/' + o.id, ctx.slug, loc)) + '" target="_blank" rel="' + MAKER_REL + '">' + (labelOverride || esc(o.maker.label)) + ' ↗</a>';
  }
  return '<span class="buy-btn disabled">No listing yet</span>';
}

function missingLine(what, slug) {
  return '<p class="fn-missing">' + esc(what) + ' <code>' + esc(slug) + '</code> is not in the catalog.</p>';
}

const isFresh = (o) => !!(o.hero && o.hero.price != null && !o.hero.stale);

function priceBlockHtml(block, products, ctx) {
  const found = block.slugs.map((s) => products.get(s)).filter(Boolean);
  const missing = block.slugs.filter((s) => !products.has(s));
  const rows = found.map((o) =>
    '<tr>' +
      '<td><div class="t-part">' +
        (o.photo ? '<img class="t-photo" src="' + esc(o.photo) + '" alt="' + esc(o.displayName) + '" loading="lazy" width="44" height="44"/>' : '') +
        '<div><a href="' + esc(o.href) + '">' + esc(o.displayName) + '</a>' +
        (o.restricted.length ? '<span class="t-restricted">' + esc(HUB_MAGAZINE_COPY.restricted) + ' ' + esc(o.restricted.join(', ')) + '</span>' : '') +
        '</div></div></td>' +
      '<td class="t-price">' + esc(priceText(o)) + '</td>' +
      '<td>' + buyHtml(o, ctx, 'price') + '</td>' +
    '</tr>').join('');
  const second = buyDisclosure(found.some(hasPartnerLink), found.some(hasMakerLink));
  return '<div class="fn-block fn-price">' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>Part</th><th>Price today</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="disclosure">' + esc(HUB_MAGAZINE_COPY.prices) + (second ? ' ' + esc(second) : '') + '</div>' : '') +
    missing.map((s) => missingLine('Part', s)).join('') +
  '</div>';
}

// ── the guide blocks: picks, rank, compare, faq ──────────────────────────
// The evidence rules, same as the prose: a price renders only through live
// listings (never typed, never MSRP in a picks row or rank card), a spec
// cell renders the column or "—" (never a guess), and "Used in N builds"
// is a count of approved builds whose parts_snapshot references the
// product — N = 0 renders nothing, never "0 builds". A slug that is not in
// the catalog renders a visible missing line; the build guard and
// check-routes are what keep that from shipping.

// One read per spec table a rank or compare block on this page needs, with
// every column _guide-blocks.mjs declares for the category — the column
// sets live there, never per article.
async function fetchSpecRows(blocks, products) {
  const byTable = new Map();   // table -> { cols: [..select fragments..], ids: Set }
  const want = (category, o) => {
    const cat = GUIDE_SPECS[category];
    if (!cat || !o) return;
    let t = byTable.get(cat.table);
    // A column is its name, unless it declares its own select fragment (a
    // lookup such as optic footprint) — aliased to the key, so the row
    // reads the same either way.
    if (!t) byTable.set(cat.table, (t = { cols: Object.entries(cat.cols).map(([k, m]) => m.select || k), ids: new Set() }));
    t.ids.add(o.id);
  };
  for (const b of blocks) {
    if (b.kind === 'rank') { const o = products.get(b.slug); if (o) want(o.category, o); }
    if (b.kind === 'compare') for (const s of b.slugs) want(b.category, products.get(s));
  }
  const specs = new Map();
  for (const [table, t] of byTable) {
    const rows = await pgGet(table + '?product_id=in.(' + [...t.ids].map(encodeURIComponent).join(',') + ')' +
      '&select=' + encodeURIComponent(['product_id', ...t.cols].join(',')));
    for (const r of rows) if (r && r.product_id) specs.set(r.product_id, r);
  }
  return specs;
}

// Approved builds per product, for "Used in N Gunforma builds". Same
// fetch-and-filter shape as product-page.mjs's fetchBuildsUsing(): approved
// builds fit in one page today, so one read for the whole article beats a
// cs.[] contains-query per rank card — revisit if they outgrow the limit.
async function fetchBuildCounts() {
  const rows = await pgGet('builds?status=eq.approved&select=parts_snapshot&limit=100');
  const counts = new Map();
  for (const b of rows) {
    const seen = new Set();
    for (const p of (Array.isArray(b.parts_snapshot) ? b.parts_snapshot : [])) {
      if (p && p.refId && !seen.has(p.refId)) { seen.add(p.refId); counts.set(p.refId, (counts.get(p.refId) || 0) + 1); }
    }
  }
  return counts;
}

// A spec value for one product and one declared column — product-level
// (products.material, products.weight_oz) or from the category's spec row.
// Null means "not stated", which renders as "—" in a compare cell and as
// nothing in a rank card's list.
function specValue(category, col, o, specRow) {
  const m = colMeta(category, col);
  if (!m) return { label: null, value: null };
  const raw = PRODUCT_COLS[col] ? o[col] : (specRow ? specRow[col] : null);
  if (raw == null || raw === '') return { label: m.label, value: null };
  const v = m.fmt ? m.fmt(raw) : raw;
  return { label: m.label, value: v == null || v === '' ? null : String(v) };
}

const rankAnchor = (slug) => 'rank-' + slug;
// The page's shared chrome carries <base href="/"/>, so a bare "#fragment"
// href resolves against the BASE — the homepage — not this page. Caught on
// deploy preview 204 by clicking one: every same-page anchor link must be
// page-absolute.
const rankHref = (ctx, slug) => fieldNotePath(ctx.slug) + '#' + rankAnchor(slug);

// ::picks — the numbered top-picks box. Each row jumps to its ::rank card's
// anchor on the same page; the price is the hero listing's fresh price or
// nothing (the button then reads "See current price").
function picksBlockHtml(block, products, ctx) {
  const rows = block.picks.map((p) => {
    const o = products.get(p.slug);
    if (!o) return '<li class="pick">' + missingLine('Part', p.slug) + '</li>';
    const price = isFresh(o)
      ? '<span class="pick-price">$' + o.hero.price.toFixed(2) + (o.hero.partnerName ? ' at ' + esc(o.hero.partnerName) : '') + '</span>'
      : '';
    return '<li class="pick">' +
      '<div class="pick-main"><a class="pick-name" href="' + esc(rankHref(ctx, p.slug)) + '">' + esc(o.displayName) + '</a>' +
      '<span class="pick-best">' + esc(p.label) + '</span></div>' +
      '<div class="pick-buy">' + price + buyHtml(o, ctx, 'picks', isFresh(o) ? null : 'See current price') + '</div>' +
    '</li>';
  }).join('');
  return '<div class="fn-block fn-picks"><div class="fn-picks-head">Top picks</div><ol class="picks-list">' + rows + '</ol></div>';
}

// ::rank — the ranked product card ::picks jumps to.
function rankBlockHtml(b, products, ctx) {
  const o = products.get(b.slug);
  const open = '<div class="fn-block fn-rank" id="' + esc(rankAnchor(b.slug)) + '">';
  if (!o) return open + missingLine('Part', b.slug) + '</div>';
  const fresh = isFresh(o);
  const price = fresh
    ? '<span class="rank-price">$' + o.hero.price.toFixed(2) + '</span>' +
      (o.hero.partnerName ? '<span class="rank-partner">at ' + esc(o.hero.partnerName) + '</span>' : '')
    : '';
  const chip = b.code ? '<span class="coupon-chip">Code ' + esc(b.code) + ' at checkout</span>' : '';
  // The extra listings never repeat a retailer: the hero's retailer counts
  // as taken (its button is already on the card — "Buy at X" over "See
  // price at X" reads as link padding), and one link per remaining
  // retailer, up to 3. A single-listing product renders no extras row.
  const taken = new Set(o.hero ? [o.hero.partnerName || ''] : []);
  const extras = [];
  for (const l of (o.listings || []).slice(1)) {
    if (extras.length === 3) break;
    const name = l.partnerName || '';
    if (taken.has(name)) continue;
    taken.add(name);
    extras.push('<a class="rank-alt" href="' + esc(withGoParams(l.goUrl, ctx.slug, 'rank')) + '" target="_blank" rel="noopener sponsored nofollow">See price at ' + esc(l.partnerName || 'retailer') + '</a>');
  }
  const cat = GUIDE_SPECS[o.category];
  const specRow = ctx.specs.get(o.id);
  const specList = (cat ? cat.rank : []).map((col) => {
    const { label, value } = specValue(o.category, col, o, specRow);
    return value == null ? '' : '<div class="rank-spec"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }).join('');
  const list = (items, head) => (items.length
    ? '<div class="rank-pc"><div class="rank-pc-head">' + head + '</div><ul>' + items.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>'
    : '');
  const n = ctx.buildCounts.get(o.id) || 0;
  // The changes/same card (Field Notes v2): `~` lines are what the part
  // changes from the factory part, `=` lines what stays the same, with the
  // optional baseline product named under the headings. `+`/`-` pros and
  // cons still render for the old fixtures.
  const baseline = b.baseline ? ctx.products.get(b.baseline) : null;
  const baselineLine = b.baseline
    ? (baseline
        ? '<div class="rank-baseline">Compared with <a href="' + esc(baseline.href) + '">' + esc(baseline.displayName) + '</a></div>'
        : missingLine('Baseline part', b.baseline))
    : '';
  // Colours and the manual-safety option, from the live variant rows —
  // never typed. No colours renders no row.
  const colors = orderColors(o.variantColors, ctx.colorsOrder);
  const colorsRow = colors.length
    ? '<div class="rank-colors">' + colors.map((c) => swatchChipHtml(c, o.brand)).join(' ') + '</div>'
    : '';
  const safetyRow = o.manualSafety ? '<div class="rank-safety">Manual-safety option available</div>' : '';
  return open +
    '<div class="rank-head"><span class="rank-no">' + b.rank + '</span>' +
      '<span class="rank-best">' + esc(b.best) + '</span></div>' +
    '<div class="rank-body">' +
      (o.photo ? '<div class="rank-photo-frame"><img class="rank-photo" src="' + esc(o.photo) + '" alt="' + esc(o.displayName) + '" loading="lazy"/></div>' : '') +
      '<div class="rank-main">' +
        '<a class="rank-name" href="' + esc(o.href) + '">' + esc(o.displayName) + '</a>' +
        '<div class="rank-buy">' + price + buyHtml(o, ctx, 'rank', fresh ? null : 'See current price') + chip + '</div>' +
        (extras.length ? '<div class="rank-alts">' + extras.join('') + '</div>' : '') +
        (specList ? '<div class="rank-specs">' + specList + '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="rank-pcs">' +
      list(b.changes, 'What it changes from the factory part') + list(b.same, 'What stays the same') +
      list(b.pros, 'Pros') + list(b.cons, 'Cons') +
    '</div>' +
    baselineLine +
    colorsRow + safetyRow +
    (n >= 1 ? '<a class="rank-builds" href="' + esc(o.href) + '">Used in ' + n + ' Gunforma build' + (n === 1 ? '' : 's') + ' &rarr;</a>' : '') +
  '</div>';
}

// ::compare — one row per product, one column per declared spec, a final
// live-price column. "—" is a null cell or a price we cannot stand behind.
function compareBlockHtml(b, products, ctx) {
  const cols = b.cols.map((c) => ({ col: c, meta: colMeta(b.category, c) })).filter((x) => x.meta);
  const missing = b.slugs.filter((s) => !products.has(s));
  let dash = false;
  const rows = b.slugs.map((s) => {
    const o = products.get(s);
    if (!o) return '';
    const specRow = ctx.specs.get(o.id);
    const cells = cols.map(({ col }) => {
      const { value } = specValue(b.category, col, o, specRow);
      if (value == null) dash = true;
      return '<td>' + (value == null ? '&mdash;' : esc(value)) + '</td>';
    }).join('');
    let priceCell;
    if (isFresh(o)) {
      priceCell = '<td class="t-price"><a href="' + esc(withGoParams(o.hero.goUrl, ctx.slug, 'compare')) + '" target="_blank" rel="noopener sponsored nofollow">$' + o.hero.price.toFixed(2) + '</a></td>';
    } else { dash = true; priceCell = '<td class="t-price">&mdash;</td>'; }
    return '<tr><td><a href="' + esc(o.href) + '">' + esc(o.displayName) + '</a></td>' + cells + priceCell + '</tr>';
  }).join('');
  return '<div class="fn-block fn-compare">' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>Part</th>' +
      cols.map(({ meta }) => '<th>' + esc(meta.label) + '</th>').join('') +
      '<th>Price today</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (dash ? '<div class="disclosure">&mdash; = no live retailer price, or not stated by the maker.</div>' : '') : '') +
    missing.map((s) => missingLine('Part', s)).join('') +
  '</div>';
}

// ::faq — details/summary pairs, no JS. The FAQPage JSON-LD is emitted by
// renderPage into the page's one structured-data script.
function faqBlockHtml(b) {
  return '<div class="fn-block fn-faq">' + b.qas.map((qa) =>
    '<details><summary>' + esc(qa.q) + '</summary><p>' + esc(qa.a) + '</p></details>').join('') + '</div>';
}

// ── the v2 blocks: unlocks, colors, build ────────────────────────────────
// Everything here is counted or judged from the fit views and the variant
// rows at request time — never typed. A zero-row line is omitted (never
// "0 …"), except where the zero is itself the answer (the magwell gap).

// A colour as a named chip: the one swatch rule (_variant-swatch.mjs ↔
// js/variant-swatch.js) plus the name. The colors table carries no hex, so
// an unknown name draws swatchFor()'s neutral chip beside its name — the
// "neutral dot + name" shape, from the shared rule rather than a new one.
function swatchChipHtml(color, brand) {
  const s = swatchFor(color, brand);
  return '<span class="fn-swatch"><i class="fn-swatch-dot" style="' + esc(s.css) + '"></i>' + esc(color) + '</span>';
}

// colors.sort_order, read once per page that needs it (a ::colors table, or
// a ::rank card's swatch row). A colour the table does not know sorts last,
// by name — never dropped.
async function fetchColorsOrder() {
  const rows = await pgGet('colors?select=' + encodeURIComponent('color,sort_order'));
  return new Map(rows.filter((r) => r && r.color).map((r) => [String(r.color).toLowerCase(), r.sort_order != null ? Number(r.sort_order) : null]));
}

function orderColors(colors, colorsOrder) {
  const key = (c) => {
    const o = colorsOrder ? colorsOrder.get(c.toLowerCase()) : null;
    return o != null ? o : Infinity;
  };
  return colors.slice().sort((a, b) => (key(a) - key(b)) || (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
}

// The ids in a fit-view count that are listed parts: approved and not
// discontinued, the same bar every buying list on the site holds
// (CLAUDE.md, "Listed parts are approved and not discontinued"). A count
// that included unlisted parts would promise more than the linked page
// shows.
async function fetchLiveIds(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return new Set();
  const rows = await pgGet('products?id=in.(' + list.map(encodeURIComponent).join(',') + ')' +
    '&select=' + encodeURIComponent('id,is_approved,is_discontinued'));
  return new Set(rows.filter((p) => p && p.is_approved === true && p.is_discontinued !== true).map((p) => p.id));
}

// ::unlocks — what this part opens up, counted from the fit views.
async function resolveUnlocks(block, products) {
  const o = products.get(block.slug) || null;
  if (!o) return { block, o: null };
  const u = { block, o };
  if (block.part === 'frame') {
    const lightRows = await pgGet('v_frame_light_fit?frame_product_id=eq.' + encodeURIComponent(o.id) +
      '&select=' + encodeURIComponent('light_product_id,confidence,fitment_type'));
    const slideRows = await pgGet('v_slide_frame_fit?frame_product_id=eq.' + encodeURIComponent(o.id) +
      '&fits=is.true&select=' + encodeURIComponent('slide_product_id'));
    const specRows = await pgGet('frame_specs?product_id=eq.' + encodeURIComponent(o.id) +
      '&select=' + encodeURIComponent('housing_class,magwell_type,housing_classes(magazine_family,magazine_families(display_name))') + '&limit=1');
    const spec = specRows[0] || null;
    const magRows = spec && spec.housing_class
      ? await pgGet('magazine_housing_fit?housing_class=eq.' + encodeURIComponent(spec.housing_class) +
          '&fit=neq.not_compatible&select=' + encodeURIComponent('magazine_product_id'))
      : [];
    const magwellRows = await pgGet('magwell_frame_requirements?frame_product_id=eq.' + encodeURIComponent(o.id) +
      '&select=' + encodeURIComponent('magwell_product_id'));
    const live = await fetchLiveIds([
      ...lightRows.map((r) => r.light_product_id),
      ...slideRows.map((r) => r.slide_product_id),
      ...magRows.map((r) => r.magazine_product_id),
    ]);
    // One light per product: verified wins over likely, and a light with no
    // direct row needs the maker's key or adapter.
    const lights = new Map();
    for (const r of lightRows) {
      if (!live.has(r.light_product_id)) continue;
      const cur = lights.get(r.light_product_id) || { verified: false, direct: false };
      if (r.confidence === 'verified') cur.verified = true;
      if (r.fitment_type === 'direct') cur.direct = true;
      lights.set(r.light_product_id, cur);
    }
    u.lights = {
      total: lights.size,
      verified: [...lights.values()].filter((l) => l.verified).length,
      likely: [...lights.values()].filter((l) => !l.verified).length,
      adapter: [...lights.values()].filter((l) => !l.direct).length,
    };
    u.slides = new Set(slideRows.map((r) => r.slide_product_id).filter((id) => live.has(id))).size;
    const fam = spec && spec.housing_classes ? spec.housing_classes : null;
    u.magazineFamily = fam && fam.magazine_families ? fam.magazine_families.display_name : (fam ? fam.magazine_family : null);
    u.magazines = new Set(magRows.map((r) => r.magazine_product_id).filter((id) => live.has(id))).size;
    u.magwells = new Set(magwellRows.map((r) => r.magwell_product_id)).size;
    u.magwellType = spec ? spec.magwell_type : null;
    u.colors = o.variantColors.length;
  } else {
    const opticRows = await pgGet('v_optic_slide_variant_fit?slide_product_id=eq.' + encodeURIComponent(o.id) +
      '&select=' + encodeURIComponent('optic_product_id,uses_optic_adapter'));
    const barrelRows = await pgGet('v_barrel_slide_fit?slide_product_id=eq.' + encodeURIComponent(o.id) +
      '&fit_status=eq.fits&select=' + encodeURIComponent('barrel_product_id'));
    const frameRows = await pgGet('v_slide_frame_fit?slide_product_id=eq.' + encodeURIComponent(o.id) +
      '&fits=is.true&select=' + encodeURIComponent('frame_product_id'));
    const specRows = await pgGet('slide_specs?product_id=eq.' + encodeURIComponent(o.id) +
      '&select=' + encodeURIComponent('part_classes(display_name)') + '&limit=1');
    const live = await fetchLiveIds([
      ...opticRows.map((r) => r.optic_product_id),
      ...barrelRows.map((r) => r.barrel_product_id),
      ...frameRows.map((r) => r.frame_product_id),
    ]);
    const optics = new Map();
    for (const r of opticRows) {
      if (!live.has(r.optic_product_id)) continue;
      const cur = optics.get(r.optic_product_id) || { direct: false };
      if (r.uses_optic_adapter !== true) cur.direct = true;
      optics.set(r.optic_product_id, cur);
    }
    u.optics = {
      total: optics.size,
      direct: [...optics.values()].filter((x) => x.direct).length,
      plate: [...optics.values()].filter((x) => !x.direct).length,
    };
    u.barrels = new Set(barrelRows.map((r) => r.barrel_product_id).filter((id) => live.has(id))).size;
    u.frames = new Set(frameRows.map((r) => r.frame_product_id).filter((id) => live.has(id))).size;
    u.springClass = specRows[0] && specRows[0].part_classes ? specRows[0].part_classes.display_name : null;
  }
  return u;
}

function unlocksBlockHtml(u) {
  if (!u.o) return '<div class="fn-block fn-unlocks">' + missingLine('Part', u.block.slug) + '</div>';
  const o = u.o;
  const lines = [];
  const line = (label, text) => lines.push('<li><span class="fn-unlocks-label">' + label + '</span> ' +
    '<a href="' + esc(o.href) + '">' + text + '</a></li>');
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  // "1 slide fits" / "2 slides fit" — a count line reads as a sentence.
  const counted = (n, word, verb) => plural(n, word) + ' ' + verb + (n === 1 ? 's' : '');
  if (u.block.part === 'frame') {
    if (u.lights.total > 0) {
      let t = counted(u.lights.total, 'light', 'fit') + ' — ' + u.lights.verified + ' verified · ' + u.lights.likely + ' likely';
      if (u.lights.adapter > 0) t += ' · ' + u.lights.adapter + ' need' + (u.lights.adapter === 1 ? 's' : '') + ' an adapter or key';
      line('Lights', esc(t));
    }
    if (u.slides > 0) line('Slides', esc(counted(u.slides, 'slide', 'fit')));
    if (u.magazineFamily && u.magazines > 0) {
      line('Magazines', esc(u.magazineFamily + ' — ' + counted(u.magazines, 'magazine', 'fit') + ' at the family level'));
    }
    if (u.magwells > 0) line('Add-on magwells', esc(plural(u.magwells, 'add-on magwell') + ' on record'));
    else if (/^none$/i.test(u.magwellType || '')) {
      // The one zero a reader should see: no integrated magwell AND no
      // add-on magwell on record is a real gap, not an omitted line.
      lines.push('<li><span class="fn-unlocks-label">Add-on magwells</span> No add-on magwell on record for this module</li>');
    }
    if (u.colors > 0) line('Colours', esc(plural(u.colors, 'colour')));
  } else {
    if (u.optics.total > 0) line('Optics', esc(counted(u.optics.total, 'optic', 'mount') + ' — ' + u.optics.direct + ' direct mount · ' + u.optics.plate + ' with a plate'));
    if (u.barrels > 0) line('Barrels', esc(counted(u.barrels, 'barrel', 'fit')));
    if (u.frames > 0) line('Grip modules', esc(counted(u.frames, 'grip module', 'fit')));
    if (u.springClass) lines.push('<li><span class="fn-unlocks-label">Recoil spring</span> ' + esc(u.springClass) + '</li>');
  }
  return '<div class="fn-block fn-unlocks">' +
    '<div class="fn-unlocks-head">What the <a href="' + esc(o.href) + '">' + esc(o.displayName) + '</a> opens up</div>' +
    (lines.length ? '<ul class="fn-unlocks-list">' + lines.join('') + '</ul>' : '') +
    '<div class="disclosure">Counts from the gunforma catalog on ' + esc(fmtDate(new Date().toISOString().slice(0, 10))) + '.</div>' +
  '</div>';
}

// ::colors — the colour table. One row per product, the baseline (factory)
// row first; colour names in colors.sort_order; never typed.
function colorsBlockHtml(block, products, ctx) {
  const order = [block.baseline, ...block.slugs];
  const missing = order.filter((s) => !products.has(s));
  const rows = order.map((s, i) => {
    const o = products.get(s);
    if (!o) return '';
    const colors = orderColors(o.variantColors, ctx.colorsOrder);
    return '<tr><td><a href="' + esc(o.href) + '">' + esc(o.displayName) + '</a>' + (i === 0 ? ' <span class="fn-factory">(factory)</span>' : '') + '</td>' +
      '<td>' + (colors.length ? colors.map((c) => swatchChipHtml(c, o.brand)).join(' ') : '&mdash;') + '</td>' +
      '<td>' + colors.length + '</td>' +
      '<td>' + (o.cerakote ? 'Cerakote' : '&mdash;') + '</td></tr>';
  }).join('');
  return '<div class="fn-block fn-colors">' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>Part</th><th>Colours</th><th>Count</th><th>Finish</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    missing.map((s) => missingLine('Part', s)).join('') +
  '</div>';
}

// ::build — an example configuration, proven against the fit views on
// every request. A pair with a fit source MUST fit; a pair without one
// (trigger × slide) is allowed and says nothing. A build that no longer
// passes renders a visible refusal, never a priced parts list — the data
// changed, and the page must not go on recommending the combination.
async function resolveBuild(block, products) {
  const byRole = {};
  for (const p of block.parts) byRole[p.role] = products.get(p.slug) || null;
  const pairs = [];
  const pair = async (roleA, roleB, label, read) => {
    const a = byRole[roleA], b = byRole[roleB];
    if (!a || !b) return;
    const r = await read(a, b);
    pairs.push({ label, a, b, ok: r.ok, notes: r.notes || [], roleB });
  };
  await pair('slide', 'frame', 'slide × grip module', async (s, f) => {
    const rows = await pgGet('v_slide_frame_fit?slide_product_id=eq.' + encodeURIComponent(s.id) +
      '&frame_product_id=eq.' + encodeURIComponent(f.id) + '&select=' + encodeURIComponent('fits,verdict'));
    return { ok: rows.some((r) => r.fits === true) };
  });
  await pair('optic', 'slide', 'optic × slide', async (o, s) => {
    const rows = await pgGet('v_optic_slide_variant_fit?optic_product_id=eq.' + encodeURIComponent(o.id) +
      '&slide_product_id=eq.' + encodeURIComponent(s.id) + '&select=' + encodeURIComponent('slide_variant_id,uses_optic_adapter'));
    return { ok: rows.length > 0 };
  });
  await pair('light', 'frame', 'light × grip module', async (l, f) => {
    const rows = await pgGet('v_frame_light_fit?light_product_id=eq.' + encodeURIComponent(l.id) +
      '&frame_product_id=eq.' + encodeURIComponent(f.id) + '&select=' + encodeURIComponent('fitment_type,confidence'));
    if (!rows.length) return { ok: false };
    const notes = [];
    // The best way this light mounts: a direct or adapter-included row wins
    // over adapter-separate; the note renders only when none better exists.
    if (rows.every((r) => r.fitment_type === 'adapter-separate')) notes.push('needs a key/adapter, sold separately');
    if (!rows.some((r) => r.confidence === 'verified')) notes.push('fit likely, not verified');
    return { ok: true, notes };
  });
  await pair('barrel', 'slide', 'barrel × slide', async (b, s) => {
    const rows = await pgGet('v_barrel_slide_fit?barrel_product_id=eq.' + encodeURIComponent(b.id) +
      '&slide_product_id=eq.' + encodeURIComponent(s.id) + '&select=' + encodeURIComponent('fit_status'));
    return { ok: rows.some((r) => r.fit_status === 'fits') };
  });
  await pair('comp', 'barrel', 'compensator × barrel', async (c, b) => {
    const rows = await pgGet('v_comp_barrel_fit?comp_product_id=eq.' + encodeURIComponent(c.id) +
      '&barrel_product_id=eq.' + encodeURIComponent(b.id) + '&select=' + encodeURIComponent('fit_status'));
    return { ok: rows.some((r) => r.fit_status === 'fits') };
  });
  await pair('magwell', 'frame', 'magwell × grip module', async (m, f) => {
    const rows = await pgGet('magwell_frame_requirements?magwell_product_id=eq.' + encodeURIComponent(m.id) +
      '&frame_product_id=eq.' + encodeURIComponent(f.id) + '&select=' + encodeURIComponent('source'));
    return { ok: rows.length > 0 };
  });
  return { block, byRole, pairs, failures: pairs.filter((p) => !p.ok) };
}

function buildBlockHtml(b, ctx) {
  const head = '<div class="fn-build-head">' + esc(b.block.name) + '</div>';
  if (b.failures.length) {
    return '<div class="fn-block fn-build fn-build-failed">' + head +
      '<p class="fn-missing">This example build does not pass the catalog’s fit data: ' +
      b.failures.map((f) => esc(f.a.displayName) + ' × ' + esc(f.b.displayName) + ' (' + esc(f.label) + ')').join('; ') +
      '. Not rendered.</p></div>';
  }
  // light × grip module is the only pair that carries notes today
  // (adapter-separate, likely); they render on the light's row.
  const lightNotes = b.pairs.filter((p) => p.label === 'light × grip module').flatMap((p) => p.notes);
  let total = 0, priced = 0, unpriced = 0;
  const rows = b.block.parts.map(({ role, slug }) => {
    const o = b.byRole[role];
    // The role's label is its category's singular name (_category-meta.mjs)
    // — "Grip Module", "Weapon Light" — never a second copy of the names.
    const meta = CATEGORY_META[(BUILD_ROLE_META[role] || {}).category];
    const label = meta ? meta[2] : role;
    if (!o) return '<tr><td>' + esc(label) + '</td><td colspan="2">' + missingLine('Part', slug) + '</td></tr>';
    let priceCell;
    if (isFresh(o)) {
      total += o.hero.price; priced++;
      priceCell = '$' + o.hero.price.toFixed(2) + (o.hero.partnerName ? ' at ' + esc(o.hero.partnerName) : '');
    } else { unpriced++; priceCell = 'Check price'; }
    const notes = role === 'light' ? lightNotes : [];
    return '<tr><td>' + esc(label) + '</td>' +
      '<td><a href="' + esc(o.href) + '">' + esc(o.displayName) + '</a>' +
      (notes.length ? '<span class="fn-build-note">' + notes.map(esc).join(' · ') + '</span>' : '') + '</td>' +
      '<td class="t-price">' + priceCell + '</td></tr>';
  }).join('');
  const totalLine = priced > 0
    ? '<div class="fn-build-total">$' + total.toFixed(2) + ' at today’s prices' +
      (unpriced > 0 ? ' + ' + unpriced + ' part' + (unpriced === 1 ? '' : 's') + ' without a live price' : '') + '</div>'
    : '';
  return '<div class="fn-block fn-build">' + head +
    '<div class="table-wrap"><table><thead><tr><th>Role</th><th>Part</th><th>Price today</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    totalLine +
    '<a class="buy-btn fn-build-start" href="/gunforma-armory.html">Start this build in the Armory</a>' +
  '</div>';
}

// ── guns and the fit chain ───────────────────────────────────────────────
async function fetchGuns(slugs) {
  if (!slugs.length) return [];
  return pgGet('guns?slug=in.(' + slugs.map(encodeURIComponent).join(',') + ')' +
    '&select=' + encodeURIComponent('id,slug,name,housing_class'));
}

// The optic's own footprint, and the footprints it reaches through an
// adapter plate. optic_specs → footprints is the direct-FK-plus-many-to-many
// trap and MUST name the FK; optic_adapter_footprints has one FK to
// footprints, so its bare embed is right (CLAUDE.md, PGRST201).
async function fetchOpticFootprints(productId) {
  const specs = await pgGet('optic_specs?product_id=eq.' + encodeURIComponent(productId) +
    '&select=' + encodeURIComponent('footprint_id,footprints!optic_specs_footprint_id_fkey(slug,common_name)') + '&limit=1');
  const adapters = await pgGet('optic_adapter_footprints?optic_product_id=eq.' + encodeURIComponent(productId) +
    '&select=' + encodeURIComponent('footprint_id,plate_included,footprints(slug,common_name)'));
  return { native: specs[0] || null, adapters };
}

// The gun's cuts by SKU, the cut vocabulary, and which footprints each cut
// mounts — the same three reads guide-page.mjs does, from the gun's side.
async function fetchGunCuts(gunId) {
  const cuts = await pgGet('gun_optic_cuts?gun_id=eq.' + encodeURIComponent(gunId) +
    '&select=' + encodeURIComponent('optic_cut,applies_to,confidence') + '&order=applies_to.asc');
  const names = [...new Set(cuts.map((c) => c.optic_cut))];
  const mountable = names.filter((c) => c !== 'none');
  const vocabRows = names.length
    ? await pgGet('optic_cuts?optic_cut=in.(' + names.map(encodeURIComponent).join(',') + ')' +
        '&select=' + encodeURIComponent('optic_cut,display_name'))
    : [];
  const maps = mountable.length
    ? await pgGet('optic_cut_footprints?optic_cut=in.(' + mountable.map(encodeURIComponent).join(',') + ')' +
        '&select=' + encodeURIComponent('optic_cut,fit,footprint_id'))
    : [];
  return { cuts, vocab: Object.fromEntries(vocabRows.map((v) => [v.optic_cut, v])), maps };
}

const fpName = (fp) => (fp && (fp.common_name || fp.slug)) || '';

// One verdict per cut row (one per SKU group). The order of the checks is
// the strength of the claim: a direct mount of the optic's own footprint,
// then a mount of that footprint through a plate the cut takes, then a
// footprint the optic reaches with an adapter plate of its own.
function opticVerdicts(optic, gunCuts) {
  return gunCuts.cuts.map((c) => {
    const v = gunCuts.vocab[c.optic_cut] || {};
    const cutLabel = c.optic_cut === 'none' ? 'No optic cut' : (v.display_name || c.optic_cut);
    const maps = gunCuts.maps.filter((m) => m.optic_cut === c.optic_cut);
    const native = optic.native ? optic.native.footprint_id : null;
    let verdict, text;
    if (c.optic_cut === 'none') {
      verdict = 'none'; text = 'No optic cut on these SKUs';
    } else if (native && maps.some((m) => m.footprint_id === native && m.fit === 'direct')) {
      verdict = 'yes'; text = 'Direct fit';
    } else if (native && maps.some((m) => m.footprint_id === native && m.fit === 'via-plate')) {
      verdict = 'plate'; text = 'Fits with a plate';
    } else {
      const ad = optic.adapters.find((a) => maps.some((m) => m.footprint_id === a.footprint_id && m.fit === 'direct'));
      if (ad) { verdict = 'plate'; text = ad.plate_included ? 'Fits with the included adapter plate (' + fpName(ad.footprints) + ')' : 'Fits with an adapter plate (' + fpName(ad.footprints) + ')'; }
      else { verdict = 'no'; text = 'Doesn’t fit'; }
    }
    return { applies: APPLIES_TO_LABEL[c.applies_to] || c.applies_to, cutLabel, likely: c.confidence === 'likely', verdict, text };
  });
}

function overall(rows) {
  const fits = rows.filter((r) => r.verdict === 'yes' || r.verdict === 'plate');
  if (!rows.length) return { cls: 'unknown', text: 'No cut data for this model' };
  if (fits.length === rows.length) return { cls: 'yes', text: fits.every((r) => r.verdict === 'yes') ? 'Yes, direct fit' : 'Yes, with a plate' };
  if (!fits.length) return { cls: 'no', text: 'No' };
  return { cls: 'depends', text: 'Depends on the SKU' };
}

async function resolveFit(block, products, guns, caches) {
  const product = products.get(block.slug) || null;
  const gun = guns.get(block.gun) || null;
  if (!product || !gun) return { block, product, gun, ok: false };
  if (block.part === 'optic') {
    if (!caches.optic.has(product.id)) caches.optic.set(product.id, await fetchOpticFootprints(product.id));
    if (!caches.cuts.has(gun.id)) caches.cuts.set(gun.id, await fetchGunCuts(gun.id));
    const optic = caches.optic.get(product.id);
    const rows = opticVerdicts(optic, caches.cuts.get(gun.id));
    return { block, product, gun, ok: true, footprint: fpName(optic.native && optic.native.footprints), rows, overall: overall(rows) };
  }
  // magazine: the maker's own claim for this housing class, or none.
  const rows = gun.housing_class
    ? await pgGet('magazine_housing_fit?housing_class=eq.' + encodeURIComponent(gun.housing_class) +
        '&magazine_product_id=eq.' + encodeURIComponent(product.id) + '&select=' + encodeURIComponent('fit,note') + '&limit=1')
    : [];
  const specs = await pgGet('magazine_specs?product_id=eq.' + encodeURIComponent(product.id) + '&select=capacity&limit=1');
  const claim = rows[0] || null;
  const fits = claim ? claim.fit !== 'not_compatible' : null;
  return {
    block, product, gun, ok: true, claim,
    capacity: specs[0] && specs[0].capacity != null ? Number(specs[0].capacity) : null,
    overall: claim ? { cls: fits ? 'yes' : 'no', text: HUB_MAGAZINE_COPY.verdict[claim.fit] || claim.fit }
                   : { cls: 'unknown', text: 'The maker makes no claim for this combination' },
  };
}

function fitBlockHtml(f) {
  if (!f.product) return '<div class="fn-block fn-fit">' + missingLine('Part', f.block.slug) + '</div>';
  if (!f.gun)     return '<div class="fn-block fn-fit">' + missingLine('Pistol', f.block.gun) + '</div>';
  const gunName = f.gun.name || GUN_META[f.gun.slug] || f.gun.slug;
  const head =
    '<div class="fn-fit-q">Does the <a href="' + esc(f.product.href) + '">' + esc(f.product.displayName) + '</a> fit the Sig Sauer ' + esc(gunName) + '?</div>' +
    '<div class="fn-verdict ' + esc(f.overall.cls) + '">' + esc(f.overall.text) + '</div>';
  let body;
  if (f.block.part === 'optic') {
    body =
      (f.footprint ? '<div class="fn-fit-sub">Optic footprint: <strong>' + esc(f.footprint) + '</strong></div>' : '<div class="fn-fit-sub">This optic has no footprint recorded.</div>') +
      (f.rows.length ? '<div class="table-wrap"><table><thead><tr><th>SKUs</th><th>Factory cut</th><th>Verdict</th></tr></thead><tbody>' +
        f.rows.map((r) => '<tr><td>' + esc(r.applies) + '</td><td>' + esc(r.cutLabel) + (r.likely ? ' <em class="likely">(likely)</em>' : '') + '</td>' +
          '<td class="v-' + esc(r.verdict) + '">' + esc(r.text) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      (f.rows.some((r) => r.likely) ? '<p class="fn-note">A cut marked <em>likely</em> is one where Sig’s own published specs are inconsistent for those SKUs — verify on your slide before buying.</p>' : '');
  } else {
    body =
      '<div class="fn-fit-sub">' +
        (f.capacity != null ? esc(HUB_MAGAZINE_COPY.capacity) + ': <strong>' + esc(String(f.capacity)) + ' rounds</strong>' : '') +
        (f.claim && f.claim.note ? (f.capacity != null ? ' · ' : '') + esc(f.claim.note) : '') +
      '</div>' +
      (f.product.restricted.length ? '<p class="fn-note">' + esc(HUB_MAGAZINE_COPY.restricted) + ' ' + esc(f.product.restricted.join(', ')) + '</p>' : '');
  }
  const links = [];
  if (f.block.part === 'optic' && isLiveGuidePage('red-dots', f.gun.slug))
    links.push('<a href="' + esc(guidePath('red-dots', f.gun.slug)) + '">Every red dot that fits the ' + esc(gunName) + ' &rarr;</a>');
  if (isLiveGunHub(f.gun.slug))
    links.push('<a href="' + esc(hubPath(f.gun.slug)) + '">Everything for the Sig Sauer ' + esc(gunName) + ' &rarr;</a>');
  return '<div class="fn-block fn-fit">' + head + body + (links.length ? '<div class="fn-fit-links">' + links.join('') + '</div>' : '') + '</div>';
}

// ── ranked groups, for the ItemList schema ───────────────────────────────
// A ::rank card whose rank is 1 starts a new group when the current one
// already has cards — "rank restarts at 1" is the author's way of saying
// "a second list". Each group is named by the H2 its first card sits under
// (else the article title) and lists its cards in rank order. A card whose
// product did not resolve has no /parts/ page to point at and is left out
// of the schema (the page shows its visible missing line; the build guard
// is what keeps one from shipping).
export function rankGroups(blocks, blockSections, products) {
  const groups = [];
  blocks.forEach((b, k) => {
    if (b.kind !== 'rank') return;
    const cur = groups[groups.length - 1];
    if (!cur || (b.rank === 1 && cur.cards.length)) groups.push({ section: blockSections[k] || null, cards: [] });
    groups[groups.length - 1].cards.push(b);
  });
  return groups.map((g) => ({
    section: g.section,
    cards: g.cards.length,
    items: g.cards.slice().sort((x, y) => x.rank - y.rank)
      .map((b) => ({ rank: b.rank, o: products.get(b.slug) || null }))
      .filter((it) => it.o && it.o.href !== '/parts'),
  }));
}

// ── related field notes: the four (at most) the registry ranks first ─────
// Title and description come from each related article's own front matter,
// read from the bundle the way the article itself is. A file that does not
// read is skipped — the related footer is navigation, not the page, and a
// packaging gap there must not take the article down (check-field-notes
// is what holds every declared file present).
async function loadRelated(slug) {
  const out = [];
  for (const a of relatedNotes(slug)) {
    const src = await loadSource(a.slug);
    if (src == null) continue;
    const { meta } = parseFrontMatter(src);
    if (!meta.title) continue;
    out.push({ slug: a.slug, href: fieldNotePath(a.slug), title: meta.title, description: meta.description || '' });
  }
  return out;
}

// ── all the blocks of one article, resolved ──────────────────────────────
async function resolveBlocks(blocks, articleSlug, blockSections = []) {
  const productSlugs = new Set();
  const gunSlugs = new Set();
  for (const b of blocks) {
    if (b.kind === 'price') b.slugs.forEach((s) => productSlugs.add(s));
    if (b.kind === 'fit') { productSlugs.add(b.slug); gunSlugs.add(b.gun); }
    if (b.kind === 'picks') b.picks.forEach((p) => productSlugs.add(p.slug));
    if (b.kind === 'rank') { productSlugs.add(b.slug); if (b.baseline) productSlugs.add(b.baseline); }
    if (b.kind === 'compare') b.slugs.forEach((s) => productSlugs.add(s));
    if (b.kind === 'unlocks') productSlugs.add(b.slug);
    if (b.kind === 'colors') { productSlugs.add(b.baseline); b.slugs.forEach((s) => productSlugs.add(s)); }
    if (b.kind === 'build') b.parts.forEach((p) => productSlugs.add(p.slug));
  }
  const products = new Map((await fetchProducts([...productSlugs])).map((p) => [p.slug, p]));
  const guns = new Map((await fetchGuns([...gunSlugs])).map((g) => [g.slug, g]));
  const caches = { optic: new Map(), cuts: new Map() };
  const ctx = {
    slug: articleSlug,
    products,
    specs: await fetchSpecRows(blocks, products),
    buildCounts: blocks.some((b) => b.kind === 'rank') ? await fetchBuildCounts() : new Map(),
    // colors.sort_order, for a ::colors table and a ::rank card's swatch
    // row. Only read when a block needs it.
    colorsOrder: blocks.some((b) => b.kind === 'colors' || b.kind === 'rank') ? await fetchColorsOrder() : null,
  };
  const rendered = [];
  const faqQas = [];
  let fitsOk = 0, fitsAsked = 0, buildPairs = 0, buildPairsOk = 0;
  for (const b of blocks) {
    if (b.kind === 'price') rendered.push(priceBlockHtml(b, products, ctx));
    else if (b.kind === 'fit') {
      fitsAsked++;
      const f = await resolveFit(b, products, guns, caches);
      if (f.ok) fitsOk++;
      rendered.push(fitBlockHtml(f));
    }
    else if (b.kind === 'picks') rendered.push(picksBlockHtml(b, products, ctx));
    else if (b.kind === 'rank') rendered.push(rankBlockHtml(b, products, ctx));
    else if (b.kind === 'compare') rendered.push(compareBlockHtml(b, products, ctx));
    else if (b.kind === 'faq') { faqQas.push(...b.qas); rendered.push(faqBlockHtml(b)); }
    else if (b.kind === 'unlocks') rendered.push(unlocksBlockHtml(await resolveUnlocks(b, products)));
    else if (b.kind === 'colors') rendered.push(colorsBlockHtml(b, products, ctx));
    else if (b.kind === 'build') {
      const r = await resolveBuild(b, products);
      buildPairs += r.pairs.length;
      buildPairsOk += r.pairs.length - r.failures.length;
      rendered.push(buildBlockHtml(r, ctx));
    }
    else rendered.push('');
  }
  const kindCount = (k) => blocks.filter((b) => b.kind === k).length;
  return {
    rendered,
    rankGroups: rankGroups(blocks, blockSections, products),
    productsAsked: productSlugs.size, productsFound: products.size,
    fitsAsked, fitsOk,
    buildPairs, buildPairsOk,
    priceBlocks: kindCount('price'),
    fitBlocks: fitsAsked,
    picksBlocks: kindCount('picks'),
    rankBlocks: kindCount('rank'),
    compareBlocks: kindCount('compare'),
    faqBlocks: kindCount('faq'),
    unlocksBlocks: kindCount('unlocks'),
    colorsBlocks: kindCount('colors'),
    buildBlocks: kindCount('build'),
    faqQas,
    // The automatic affiliate disclosure near the top: any block whose buy
    // buttons can earn a commission puts it on the page.
    hasAffiliate: blocks.some((b) => b.kind === 'price' || b.kind === 'picks' || b.kind === 'rank'),
  };
}

// ── the page ─────────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// "Last reviewed October 2026" — the registry's `updated` date, which is
// already what drives dateModified and the sitemap lastmod. One date, three
// readers, no second copy.
function fmtMonth(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
}

// The registry's changelog — "YYYY-MM-DD: what changed" strings — rendered
// newest first. The guard holds every entry to that shape, so an entry that
// does not match renders as nothing rather than half a sentence.
function changelogHtml(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  const items = entries.slice().sort((a, b) => (String(a) < String(b) ? 1 : -1)).map((e) => {
    const m = String(e).match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
    return m ? '<li><strong>' + esc(fmtDate(m[1])) + '</strong> &mdash; ' + esc(m[2]) + '</li>' : '';
  }).join('');
  return items ? '<div class="changelog fn-toc-target" id="latest-updates"><div class="section-title">Latest updates</div><ul>' + items + '</ul></div>' : '';
}

// ── the table of contents ────────────────────────────────────────────────
// One entry per H2, in document order, by the id the Markdown renderer
// already gave it; H3s are never listed. "Latest updates" and "Related
// field notes" — the renderer's own sections — close the list when the
// page has them. Fewer than TOC_MIN_H2 H2s means no table of contents at
// all, and no two-column layout: a short note is better read straight.
export const TOC_MIN_H2 = 3;

// The visible label: the heading's {toc="…"} short label, else its text,
// as plain text — inline Markdown rendered and its tags dropped, because a
// heading's link or code span inside a TOC link would nest an <a> in an
// <a>. inline() has already escaped it, so it is inserted as is.
const tocLabelHtml = (s) => inline(s).replace(/<[^>]*>/g, '');

export function tocEntries(headings, { hasChangelog, hasRelated }) {
  const h2 = headings.filter((h) => h.level === 2);
  if (h2.length < TOC_MIN_H2) return [];
  return [
    ...h2.map((h) => ({ id: h.id, labelHtml: tocLabelHtml(h.toc || h.text) })),
    ...(hasChangelog ? [{ id: 'latest-updates', labelHtml: 'Latest updates' }] : []),
    ...(hasRelated ? [{ id: 'related-field-notes', labelHtml: 'Related field notes' }] : []),
  ];
}

// Hrefs are page-absolute, never a bare "#id": the chrome's <base href="/"/>
// resolves a bare fragment against the homepage (found on deploy preview
// 204, the ::picks jump links). Same path as the page, so it is still an
// in-page jump with JS off.
function tocListHtml(entries, slug) {
  return '<ol class="fn-toc-list">' + entries.map((e) =>
    '<li><a href="' + esc(fieldNotePath(slug) + '#' + e.id) + '">' + e.labelHtml + '</a></li>').join('') + '</ol>';
}

// Two renderings of one list, and exactly one landmark: the ≥1024px rail
// is the <nav aria-label="On this page">; the <1024px copy is a collapsed
// <details> with no landmark role. CSS shows one at a time (display:none
// takes the other out of the accessibility tree too), so a screen reader
// meets one table of contents, never two.
function tocRailHtml(entries, slug) {
  return '<aside class="fn-toc-rail"><nav class="fn-toc" id="on-this-page" aria-label="On this page">' +
    '<div class="fn-toc-head">On this page</div>' + tocListHtml(entries, slug) + '</nav></aside>';
}
function tocMobileHtml(entries, slug) {
  return '<details class="fn-toc-mobile"><summary>Jump to section</summary>' + tocListHtml(entries, slug) + '</details>';
}

// Progressive enhancement only: with JS off the links above already jump.
// An IntersectionObserver (no scroll listener) repaints which link carries
// aria-current="true": the last target whose top has passed the line under
// the sticky nav, or — once the footer is in view — the last target on
// screen, so a short final section can still be current. It animates
// nothing; smooth scrolling is CSS, and only under
// prefers-reduced-motion: no-preference.
const TOC_SCRIPT =
'<script>(function(){' +
  'if(!("IntersectionObserver" in window))return;' +
  'var links=[].slice.call(document.querySelectorAll(".fn-toc-list a"));' +
  'var idOf=function(a){return decodeURIComponent((a.getAttribute("href")||"").split("#")[1]||"");};' +
  'var seen={},heads=[];links.forEach(function(a){var id=idOf(a);if(id&&!seen[id]){seen[id]=1;var el=document.getElementById(id);if(el)heads.push(el);}});' +
  'if(!heads.length)return;' +
  'var foot=document.querySelector(".footer-bar"),footIn=false,cur;' +
  'function paint(entries){' +
    '(entries||[]).forEach(function(e){if(e.target===foot)footIn=e.isIntersecting;});' +
    'var pick=null;for(var i=0;i<heads.length;i++){if(heads[i].getBoundingClientRect().top<=96)pick=heads[i];else break;}' +
    'var last=heads[heads.length-1];if(footIn&&last.getBoundingClientRect().top<window.innerHeight)pick=last;' +
    'var id=pick?pick.id:null;if(id===cur)return;cur=id;' +
    'links.forEach(function(a){if(id&&idOf(a)===id)a.setAttribute("aria-current","true");else a.removeAttribute("aria-current");});' +
  '}' +
  'var io=new IntersectionObserver(paint,{rootMargin:"-96px 0px 0px 0px",threshold:[0,1]});' +
  'heads.forEach(function(h){io.observe(h);});if(foot)io.observe(foot);paint();' +
'})();</script>';

// The page's ONE "Related" section (Alex, 2026-11-20 — never two Related
// headings): "Related field notes", up to four other live articles sharing
// a tag (relatedNotes() in _field-notes-meta.mjs), then a single "Keep
// going" line — the note's model hub, the Armory, the builds, and All Field
// Notes LAST (Alex, 2026-11-20: besides the breadcrumb it is an article's
// only path to the index, and the index is what links every note; "Parts
// by category" stays out). The hub is
// the first gun whose hub links into this note (gunsForFieldNote()), only
// while that hub is live; otherwise the /p365/ index. With no related
// notes there is no heading and no TOC entry: the Keep going line stands
// alone, since a "Related field notes" heading over no notes says nothing.
function keepGoingHtml(slug) {
  const gun = gunsForFieldNote(slug).find((g) => isLiveGunHub(g));
  const hub = gun
    ? '<a href="' + esc(hubPath(gun)) + '">Everything for the Sig Sauer ' + esc(GUN_META[gun] || gun) + ' &rarr;</a>'
    : '<a href="/p365/">What fits your P365 &rarr;</a>';
  return '<div class="fn-keep-going"><span class="fn-keep-going-label">Keep going:</span> ' +
    hub + ' <a href="/gunforma-armory.html">Build yours in the Armory &rarr;</a> <a href="/gunforma-builds.html">Real builds &rarr;</a>' +
    ' <a href="' + FIELD_NOTES_INDEX_PATH + '">All Field Notes &rarr;</a></div>';
}

function relatedSectionHtml(related, slug) {
  if (!related.length) return '<div class="fn-related-notes">' + keepGoingHtml(slug) + '</div>';
  return '<div class="fn-related-notes fn-toc-target" id="related-field-notes"><div class="section-title">Related field notes</div>' +
    '<ul class="fn-related-list">' + related.map((r) =>
      '<li><a href="' + esc(r.href) + '">' + tocLabelHtml(r.title) + '</a>' +
      (r.description ? '<span class="fn-related-desc">' + esc(r.description) + '</span>' : '') + '</li>').join('') +
    '</ul>' + keepGoingHtml(slug) + '</div>';
}

function renderPage({ article, meta, bodyHtml, data, headings = [], related = [] }) {
  const slug = article.slug;
  const canonical = SITE + fieldNotePath(slug);
  const title = meta.title || slug;
  const description = meta.description || textOf(bodyHtml).slice(0, 155);
  // No author means NO byline — never a placeholder name. The JSON-LD then
  // credits the Organization instead of inventing a Person.
  const author = meta.author || null;
  const cover = meta.cover ? (/^https?:\/\//i.test(meta.cover) ? meta.cover : SITE + (meta.cover.startsWith('/') ? '' : '/') + meta.cover) : null;
  const ogImage = cover || SITE + '/og-default.png';
  const typeLabel = meta.type === 'review' ? 'Review' : meta.type === 'comparison' ? 'Comparison' : 'Guide';

  // Each placeholder becomes its resolved block, in order.
  const html = bodyHtml.replace(/<!--fn-block-(\d+)-->/g, (_, n) => data.rendered[Number(n)] || '');

  const changelog = changelogHtml(article.changelog);
  const toc = tocEntries(headings, { hasChangelog: !!changelog, hasRelated: related.length > 0 });
  const reviewed = article.updated || article.published;

  // The page's structured data: ONE @graph, renderer-owned, in the page's
  // one script. Article (a Person when the front matter names an author,
  // else the Organization — never an invented name), the BreadcrumbList,
  // one ItemList per ranked group, and FAQPage when the note has ::faq.
  // Deliberately no Review and no AggregateRating: Gunforma does not
  // range-test parts (the method line says so on the same page), and a
  // review or a star rating would claim it does.
  const graph = [
    {
      '@type': 'Article', '@id': canonical + '#article',
      headline: title, description,
      author: author
        ? { '@type': 'Person', name: author, ...(meta.author_credential ? { description: meta.author_credential } : {}) }
        : { '@type': 'Organization', name: 'Gunforma' },
      publisher: { '@type': 'Organization', name: 'Gunforma', logo: { '@type': 'ImageObject', url: SITE + '/assets/gunforma-logo.png' } },
      datePublished: article.published, dateModified: reviewed,
      mainEntityOfPage: canonical, image: ogImage,
    },
    {
      '@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Field Notes', item: SITE + FIELD_NOTES_INDEX_PATH },
        { '@type': 'ListItem', position: 3, name: title, item: canonical },
      ],
    },
    ...data.rankGroups.filter((g) => g.items.length).map((g) => ({
      '@type': 'ItemList',
      name: g.section || title,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: g.items.length,
      itemListElement: g.items.map((it) => ({
        '@type': 'ListItem', position: it.rank, name: it.o.displayName, url: SITE + it.o.href,
      })),
    })),
  ];
  if (data.faqQas.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: data.faqQas.map((qa) => ({
        '@type': 'Question', name: qa.q,
        acceptedAnswer: { '@type': 'Answer', text: qa.a },
      })),
    });
  }
  const jsonLd = { '@context': 'https://schema.org', '@graph': graph };

  // The byline row, under the H1: author · credential · Last reviewed
  // <Month YYYY>. ONE visible date (Alex, 2026-11-20): the published date
  // lives in the JSON-LD's datePublished and the article:published_time
  // meta, not in the byline. No author means none of the author half —
  // never a placeholder name. The byline is also the page's only author
  // credit: the author box that used to repeat it at the bottom is gone
  // (same ruling).
  const bylineParts = [
    author ? 'By <strong>' + esc(author) + '</strong>' : null,
    author && meta.author_credential ? '<span class="byline-cred">' + esc(meta.author_credential) + '</span>' : null,
    'Last reviewed ' + esc(fmtMonth(reviewed)),
  ].filter(Boolean);

  return '<!DOCTYPE html><html lang="en"><head>' +
  headTags({ title: title + ' | Field Notes | Gunforma', description, canonical, jsonLd, ogImage }) +
  '<meta property="article:published_time" content="' + esc(article.published) + '"/>' +
  '<meta property="article:modified_time" content="' + esc(article.updated || article.published) + '"/>' +
  (article.draft ? '<meta name="robots" content="noindex"/>' : '') +
'<style>' +
  chromeCss() +
  layoutCss() +
'.article h1 { font-size: 28px; line-height: 1.25; margin: 6px 0 12px; letter-spacing: -0.01em; }' +
'.byline { font-size: 12.5px; color: #666; margin-bottom: 22px; }' +
'.byline strong { color: #1a1a1a; }' +
'.draft-strip { background: #fff5e6; border: 0.5px solid #f8d5a0; color: #b45309; font-size: 12px; padding: 8px 12px; border-radius: 6px; margin: 0 0 18px; }' +
'.article h2 { font-size: 20px; margin: 32px 0 10px; }' +
'.article h3 { font-size: 16px; margin: 22px 0 8px; }' +
'.article p, .article li { font-size: 15px; line-height: 1.7; color: #333; }' +
'.article p { margin-bottom: 12px; }' +
'.article ul, .article ol { margin: 0 0 12px 22px; } .article li { margin-bottom: 4px; } .article li ul, .article li ol { margin-bottom: 0; }' +
'.article blockquote { border-left: 3px solid #4a9edd; background: #f2f6f9; padding: 10px 16px; margin: 14px 0; border-radius: 0 6px 6px 0; }' +
'.article blockquote p:last-child { margin-bottom: 0; }' +
'.article code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; background: #f0ede7; padding: 1px 5px; border-radius: 4px; }' +
'.article pre { background: #0e0f11; color: #e8e6e1; padding: 14px 16px; border-radius: 8px; overflow-x: auto; margin: 14px 0; font-size: 13px; line-height: 1.5; }' +
'.article pre code { background: none; color: inherit; padding: 0; }' +
'.article figure { margin: 18px 0; } .article figure img { max-width: 100%; height: auto; border-radius: 8px; border: 0.5px solid #e5e5e5; background: #fff; display: block; }' +
'.article figcaption { font-size: 12px; color: #777; margin-top: 6px; }' +
'.article p img { max-width: 100%; height: auto; vertical-align: middle; }' +
'.article hr { border: 0; border-top: 0.5px solid #e5e5e5; margin: 26px 0; }' +
'.article a { color: #1d6fb8; }' +
'.table-wrap { overflow-x: auto; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; margin: 12px 0; }' +
'table { border-collapse: collapse; width: 100%; font-size: 13.5px; }' +
'th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #667; padding: 10px 12px; border-bottom: 1px solid #e5e5e5; background: #fbfbfa; }' +
'td { padding: 10px 12px; border-bottom: 0.5px solid #efefec; vertical-align: middle; }' +
'tr:last-child td { border-bottom: 0; }' +
'.fn-block { margin: 18px 0 22px; }' +
'.fn-block td a { color: #1a1a1a; font-weight: 600; text-decoration: none; } .fn-block td a:hover { color: #4a9edd; }' +
'.t-part { display: flex; align-items: center; gap: 10px; }' +
'.t-photo { width: 44px; height: 44px; object-fit: contain; border-radius: 6px; border: 0.5px solid #ececec; background: #fff; flex: none; }' +
'.t-restricted { display: block; font-size: 11px; color: #b03a2e; font-weight: 400; }' +
'.t-price { font-weight: 700; white-space: nowrap; }' +
'.buy-btn { font-size: 12px; font-weight: 700; color: #fff; background: #4a9edd; padding: 7px 12px; border-radius: 6px; text-decoration: none; white-space: nowrap; }' +
'.buy-btn.disabled { background: #ddd; color: #888; }' +
'.disclosure { font-size: 11px; color: #999; margin-top: 8px; font-style: italic; }' +
'.fn-fit { border: 0.5px solid #dfe5ea; background: #f2f6f9; border-radius: 8px; padding: 14px 18px; }' +
'.fn-fit-q { font-size: 15px; font-weight: 700; color: #1a1a1a; } .fn-fit-q a { color: #1a1a1a; text-decoration: none; } .fn-fit-q a:hover { color: #4a9edd; }' +
'.fn-verdict { display: inline-block; margin: 8px 0 6px; font-size: 13px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }' +
'.fn-verdict.yes { background: #e3f3e8; color: #1d6b43; } .fn-verdict.no { background: #fdecea; color: #b42318; }' +
'.fn-verdict.depends { background: #fff5e6; color: #b45309; } .fn-verdict.unknown { background: #eee; color: #666; }' +
'.fn-fit-sub { font-size: 13px; color: #445; margin-bottom: 6px; }' +
'.fn-fit .table-wrap { background: #fff; } .fn-fit table { min-width: 0; }' +
'td.v-yes, td.v-plate { color: #1d6b43; font-weight: 600; } td.v-no { color: #b42318; font-weight: 600; } td.v-none { color: #777; }' +
'.likely { color: #7a6a2f; font-style: normal; font-size: 11px; }' +
'.fn-note { font-size: 12.5px; color: #555; margin: 8px 0 0; }' +
'.fn-fit-links a { display: inline-block; margin: 8px 14px 0 0; font-size: 13px; color: #1d6fb8; text-decoration: none; }' +
'.fn-missing { font-size: 13px; color: #b03a2e; }' +
'.fn-affiliate-note { font-size: 12px; color: #888; font-style: italic; margin: -10px 0 18px; } .fn-affiliate-note a { color: #1d6fb8; }' +
'.fn-picks { border: 0.5px solid #dfe5ea; background: #f8fafb; border-radius: 10px; padding: 12px 14px; }' +
'.fn-picks-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin-bottom: 6px; }' +
'.picks-list { margin: 0 0 0 22px; } .picks-list .pick { margin: 8px 0; }' +
'.pick-main { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }' +
'.pick-name { font-weight: 700; color: #1a1a1a; text-decoration: none; } .pick-name:hover { color: #4a9edd; }' +
'.pick-best { font-size: 11px; font-weight: 700; color: #1d6b43; background: #e3f3e8; padding: 2px 8px; border-radius: 12px; white-space: nowrap; }' +
'.pick-buy { display: flex; gap: 10px; align-items: center; margin-top: 4px; flex-wrap: wrap; }' +
'.pick-price { font-size: 13px; font-weight: 700; }' +
'.fn-rank { border: 0.5px solid #e5e5e5; background: #fff; border-radius: 10px; padding: 14px 16px; scroll-margin-top: 70px; }' +
'.rank-head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }' +
'.rank-no { width: 26px; height: 26px; border-radius: 50%; background: #0e0f11; color: #f2efe8; font-size: 13px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; flex: none; }' +
'.rank-best { font-size: 11px; font-weight: 700; color: #1d6b43; background: #e3f3e8; padding: 3px 10px; border-radius: 12px; }' +
// The showcase frame (Alex, 2026-10-26): ONE frame shape on every card —
// 4:3, capped at 280px tall, the image centered and contained, never
// cropped, never stretched, and never upscaled past its source pixels
// (max-width/max-height with auto sizing, not width/height). White behind
// it so a white-background product JPEG reads seamless and a transparent
// PNG stays clean. A card with no photo renders no frame at all (the test
// pins that), exactly as the 120px thumbnail this replaces did.
'.rank-body { display: flex; flex-direction: column; gap: 12px; }' +
'.rank-photo-frame { width: 100%; aspect-ratio: 4 / 3; max-height: 280px; display: flex; align-items: center; justify-content: center; background: #fff; border: 0.5px solid #ececec; border-radius: 8px; overflow: hidden; }' +
'.rank-photo { max-width: 94%; max-height: 94%; width: auto; height: auto; object-fit: contain; }' +
'.rank-main { min-width: 0; flex: 1; }' +
'.rank-name { font-size: 16px; font-weight: 700; color: #1a1a1a; text-decoration: none; display: inline-block; margin-bottom: 6px; } .rank-name:hover { color: #4a9edd; }' +
'.rank-buy { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }' +
'.rank-price { font-size: 16px; font-weight: 800; } .rank-partner { font-size: 12px; color: #667; }' +
'.coupon-chip { font-size: 11px; font-weight: 700; color: #7a4d09; background: #fff5e6; border: 0.5px solid #f8d5a0; padding: 3px 8px; border-radius: 12px; white-space: nowrap; }' +
'.rank-alts { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }' +
'.rank-alt { font-size: 12px; color: #1d6fb8; text-decoration: none; }' +
'.rank-specs { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px 14px; margin-top: 8px; }' +
'.rank-spec { font-size: 12px; color: #667; display: flex; flex-direction: column; } .rank-spec strong { color: #1a1a1a; font-size: 12.5px; }' +
'.rank-pcs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }' +
'@media (max-width: 480px) { .rank-pcs { grid-template-columns: 1fr; } }' +
'.rank-pc-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin-bottom: 4px; }' +
'.rank-pc ul { margin: 0 0 0 18px; } .rank-pc li { font-size: 13px; line-height: 1.55; margin-bottom: 3px; }' +
'.rank-builds { display: inline-block; margin-top: 10px; font-size: 13px; color: #1d6fb8; text-decoration: none; }' +
'.fn-compare table { min-width: 480px; }' +
'.fn-method { font-size: 12.5px; color: #555; border-left: 3px solid #d9d6cc; background: #fafaf8; padding: 8px 12px; border-radius: 0 6px 6px 0; margin: 0 0 14px; } .fn-method a { color: #1d6fb8; text-decoration: none; }' +
'.fn-unlocks { border: 0.5px solid #dfe5ea; background: #f8fafb; border-radius: 10px; padding: 12px 14px; }' +
'.fn-unlocks-head { font-size: 14px; font-weight: 700; margin-bottom: 6px; } .fn-unlocks-head a { color: #1a1a1a; text-decoration: none; } .fn-unlocks-head a:hover { color: #4a9edd; }' +
'.fn-unlocks-list { margin: 0 0 8px 20px; } .fn-unlocks-list li { font-size: 13.5px; line-height: 1.7; } .fn-unlocks-list a { color: #1d6fb8; text-decoration: none; }' +
'.fn-unlocks-label { font-weight: 700; color: #1a1a1a; }' +
'.fn-swatch { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #333; border: 0.5px solid #e5e5e5; border-radius: 12px; padding: 2px 8px 2px 4px; background: #fff; white-space: nowrap; margin: 2px 0; }' +
'.fn-swatch-dot { width: 13px; height: 13px; border-radius: 50%; display: inline-block; border: 0.5px solid rgba(0,0,0,0.12); }' +
'.fn-factory { font-size: 11px; color: #667; font-weight: 400; }' +
'.rank-baseline { font-size: 12.5px; color: #555; margin-top: 8px; } .rank-baseline a { color: #1d6fb8; text-decoration: none; }' +
'.rank-colors { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }' +
'.rank-safety { font-size: 12.5px; color: #1d6b43; font-weight: 600; margin-top: 6px; }' +
'.fn-build { border: 0.5px solid #dfe5ea; background: #f8fafb; border-radius: 10px; padding: 12px 14px; }' +
'.fn-build-head { font-size: 14px; font-weight: 700; margin-bottom: 6px; }' +
'.fn-build .table-wrap { background: #fff; }' +
'.fn-build-note { display: block; font-size: 11.5px; color: #7a6a2f; font-weight: 400; }' +
'.fn-build-total { font-size: 14px; font-weight: 700; margin: 8px 0; }' +
'.fn-build-start { display: inline-block; margin-top: 2px; }' +
'.fn-faq details { border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; margin: 8px 0; padding: 0 14px; }' +
'.fn-faq summary { font-size: 14px; font-weight: 700; padding: 10px 0; cursor: pointer; }' +
'.fn-faq details p { margin: 0 0 12px; }' +
'.changelog ul { margin: 0 0 12px 22px; } .changelog li { font-size: 13px; }' +
'.fn-keep-going { font-size: 13px; color: #555; margin: 14px 0 0; padding-top: 12px; border-top: 0.5px solid #e5e5e5; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; }' +
'.fn-keep-going-label { font-weight: 700; color: #1a1a1a; }' +
'.fn-keep-going a { color: #1d6fb8; text-decoration: none; } .fn-keep-going a:hover { text-decoration: underline; }' +
'.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 26px 0 10px; }' +
// ── the table of contents and the two-column layout ──
// <1024px: one column, the collapsed <details> under the method line, no
// sticky bar. ≥1024px: the rail (220px) beside the article column, whose
// width (812px) is exactly the old single column's content width — the
// line length does not change. The rail sticks under the 52px nav.
'.fn-toc-rail { display: none; }' +
'.fn-toc-mobile { margin: 0 0 16px; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; padding: 0 14px; }' +
'.fn-toc-mobile summary { font-size: 13px; font-weight: 700; padding: 10px 0; cursor: pointer; }' +
'.article .fn-toc-list { margin: 0 0 10px 20px; } .fn-toc-list li { font-size: 13.5px; line-height: 1.5; margin: 6px 0; }' +
'.fn-toc-list a { color: #1d6fb8; text-decoration: none; } .fn-toc-list a:hover { text-decoration: underline; }' +
'.fn-toc-list a[aria-current="true"] { color: #1a1a1a; font-weight: 700; }' +
'.fn-toc-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin-bottom: 8px; }' +
'@media (min-width: 1024px) {' +
'  .page.fn-has-toc { max-width: 1120px; }' +
'  .fn-has-toc .fn-grid { display: grid; grid-template-columns: 220px minmax(0, 812px); column-gap: 40px; }' +
'  .fn-toc-rail { display: block; }' +
'  .fn-toc-rail .fn-toc { position: sticky; top: 72px; max-height: calc(100vh - 92px); overflow-y: auto; padding-top: 16px; }' +
'  .fn-toc-rail .fn-toc-list { list-style: none; margin: 0; border-left: 2px solid #e5e5e5; }' +
'  .fn-toc-rail .fn-toc-list li { margin: 0; font-size: 13px; }' +
'  .fn-toc-rail .fn-toc-list a { display: block; padding: 5px 0 5px 12px; margin-left: -2px; border-left: 2px solid transparent; color: #555; }' +
'  .fn-toc-rail .fn-toc-list a[aria-current="true"] { border-left-color: #4a9edd; color: #1a1a1a; }' +
'  .fn-toc-mobile { display: none; }' +
'  .fn-toc-on .breadcrumb { max-width: 1120px; padding-left: 284px; }' +
'}' +
// A jumped-to heading lands below the sticky 52px nav, not under it.
'.article h2, .fn-toc-target { scroll-margin-top: 72px; }' +
'@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }' +
'.byline-cred { color: #555; }' +
'.article .fn-related-list { list-style: none; margin: 0; } .fn-related-list li { margin: 0 0 12px; }' +
'.fn-related-list a { font-size: 14px; font-weight: 700; color: #1a1a1a; text-decoration: none; } .fn-related-list a:hover { color: #4a9edd; }' +
'.fn-related-desc { display: block; font-size: 13px; color: #666; line-height: 1.5; margin-top: 2px; }' +
'</style>' +
'</head><body' + (toc.length ? ' class="fn-toc-on"' : '') + '>' +
  navHtml({}) +
'<div class="breadcrumb"><a href="/">Home</a> / <a href="' + FIELD_NOTES_INDEX_PATH + '">Field Notes</a> / ' + esc(title) + '</div>' +
'<div class="page article' + (toc.length ? ' fn-has-toc' : '') + '"><div class="fn-grid">' +
  (toc.length ? tocRailHtml(toc, slug) : '') +
  '<div class="fn-main">' +
  (article.draft ? '<div class="draft-strip"><strong>Draft.</strong> Served on previews only; this address is a 404 on gunforma.com.</div>' : '') +
  '<div class="eyebrow">Field Notes &middot; ' + esc(typeLabel) + (meta.category ? ' &middot; ' + esc(meta.category) : '') + '</div>' +
  '<h1>' + inline(title) + '</h1>' +
  '<div class="byline">' + bylineParts.join(' &middot; ') + '</div>' +
  // The method line, on every field note, directly under the byline and
  // above the disclosure — one implementation (_guide-blocks.mjs), never
  // per-article text.
  METHOD_LINE_HTML +
  (toc.length ? tocMobileHtml(toc, slug) : '') +
  (data.hasAffiliate ? AFFILIATE_DISCLOSURE_HTML : '') +
  html +
  changelog +
  relatedSectionHtml(related, slug) +
  '</div>' +   // .fn-main
'</div></div>' +   // .fn-grid, .page
  footerHtml() +
  (toc.length ? TOC_SCRIPT : '') +
  navScript() + ANALYTICS_SNIPPET + '</body></html>';
}

export default async (req) => {
  const slug = extractSlug(req);
  if (!slug) return notFound();
  const article = fieldNote(slug);
  // Undeclared, or a draft asked for on the apex: not a page here. Both
  // are decided before any read, so neither can be a 503.
  if (!article || (article.draft && isApex(req))) return notFound('No field note at this address.');

  const src = await loadSource(slug);
  if (src == null) return notBundled(slug);
  const { meta, body } = parseFrontMatter(src);
  const { html: bodyHtml, blocks, headings, blockSections } = renderMarkdown(body);

  let data;
  try {
    data = await resolveBlocks(blocks, slug, blockSections);
  } catch (err) {
    console.error('[field-note] lookup failed', err);
    return unavailable();   // 503 + Retry-After, never a 404 — see _pg.mjs
  }
  const related = await loadRelated(slug);

  const page = renderPage({ article, meta, bodyHtml, data, headings, related });
  return new Response(page, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': article.draft ? 'no-store' : 'public, max-age=300, s-maxage=1800',
      'Netlify-CDN-Cache-Control': article.draft ? CDN_CACHE_NO_STORE : CDN_CACHE_PAGE,
      // Observability, the house habit: the page's inputs readable from
      // outside, so check-routes.mjs prints facts rather than guesses.
      'x-field-note': slug,
      'x-field-note-draft': article.draft ? '1' : '0',
      'x-field-note-source': 'file',
      'x-field-note-blocks': 'price=' + data.priceBlocks + ' fit=' + data.fitBlocks +
        ' picks=' + data.picksBlocks + ' rank=' + data.rankBlocks +
        ' compare=' + data.compareBlocks + ' faq=' + data.faqBlocks +
        ' unlocks=' + data.unlocksBlocks + ' colors=' + data.colorsBlocks +
        ' build=' + data.buildBlocks,
      'x-field-note-products': data.productsFound + '/' + data.productsAsked,
      // The page furniture, countable from outside: TOC entries (0 = no
      // table of contents), ItemList groups:items, related notes linked.
      'x-field-note-toc': String(tocEntries(headings, { hasChangelog: !!changelogHtml(article.changelog), hasRelated: related.length > 0 }).length),
      'x-field-note-itemlists': data.rankGroups.filter((g) => g.items.length).length + ':' +
        data.rankGroups.reduce((n, g) => n + g.items.length, 0),
      'x-field-note-related': String(related.length),
      'x-field-note-fits': data.fitsOk + '/' + data.fitsAsked,
      // Pairs a ::build block checked against the fit views, ok/asked — a
      // shortfall means a build block rendered its refusal, which
      // check-routes can read off the wire.
      ...(data.buildBlocks ? { 'x-field-note-build': data.buildPairsOk + '/' + data.buildPairs } : {}),
    },
  });
};
