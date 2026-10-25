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
import { FIELD_NOTES_INDEX_PATH, fieldNote, fieldNotePath, fieldNoteFile } from './_field-notes-meta.mjs';
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
import { GUIDE_SPECS, PRODUCT_COLS, colMeta, withGoParams, AFFILIATE_DISCLOSURE_HTML } from './_guide-blocks.mjs';

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
    'product_variants!product_variants_product_id_fkey(id,msrp,is_default,primary_image_url,' +
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
  return {
    id: p.id, slug: p.slug, name: p.name, category: p.category, brand,
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
  const byTable = new Map();   // table -> { cols: [..], ids: Set }
  const want = (category, o) => {
    const cat = GUIDE_SPECS[category];
    if (!cat || !o) return;
    let t = byTable.get(cat.table);
    if (!t) byTable.set(cat.table, (t = { cols: Object.keys(cat.cols), ids: new Set() }));
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
      '<div class="pick-main"><a class="pick-name" href="#' + esc(rankAnchor(p.slug)) + '">' + esc(o.displayName) + '</a>' +
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
  const extras = (o.listings || []).slice(1, 4).map((l) =>
    '<a class="rank-alt" href="' + esc(withGoParams(l.goUrl, ctx.slug, 'rank')) + '" target="_blank" rel="noopener sponsored nofollow">See price at ' + esc(l.partnerName || 'retailer') + '</a>').join('');
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
  return open +
    '<div class="rank-head"><span class="rank-no">' + b.rank + '</span>' +
      '<span class="rank-best">' + esc(b.best) + '</span></div>' +
    '<div class="rank-body">' +
      (o.photo ? '<img class="rank-photo" src="' + esc(o.photo) + '" alt="' + esc(o.displayName) + '" loading="lazy" width="120" height="120"/>' : '') +
      '<div class="rank-main">' +
        '<a class="rank-name" href="' + esc(o.href) + '">' + esc(o.displayName) + '</a>' +
        '<div class="rank-buy">' + price + buyHtml(o, ctx, 'rank', fresh ? null : 'See current price') + chip + '</div>' +
        (extras ? '<div class="rank-alts">' + extras + '</div>' : '') +
        (specList ? '<div class="rank-specs">' + specList + '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="rank-pcs">' + list(b.pros, 'Pros') + list(b.cons, 'Cons') + '</div>' +
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

// ── all the blocks of one article, resolved ──────────────────────────────
async function resolveBlocks(blocks, articleSlug) {
  const productSlugs = new Set();
  const gunSlugs = new Set();
  for (const b of blocks) {
    if (b.kind === 'price') b.slugs.forEach((s) => productSlugs.add(s));
    if (b.kind === 'fit') { productSlugs.add(b.slug); gunSlugs.add(b.gun); }
    if (b.kind === 'picks') b.picks.forEach((p) => productSlugs.add(p.slug));
    if (b.kind === 'rank') productSlugs.add(b.slug);
    if (b.kind === 'compare') b.slugs.forEach((s) => productSlugs.add(s));
  }
  const products = new Map((await fetchProducts([...productSlugs])).map((p) => [p.slug, p]));
  const guns = new Map((await fetchGuns([...gunSlugs])).map((g) => [g.slug, g]));
  const caches = { optic: new Map(), cuts: new Map() };
  const ctx = {
    slug: articleSlug,
    specs: await fetchSpecRows(blocks, products),
    buildCounts: blocks.some((b) => b.kind === 'rank') ? await fetchBuildCounts() : new Map(),
  };
  const rendered = [];
  const faqQas = [];
  let fitsOk = 0, fitsAsked = 0;
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
    else rendered.push('');
  }
  const kindCount = (k) => blocks.filter((b) => b.kind === k).length;
  return {
    rendered,
    productsAsked: productSlugs.size, productsFound: products.size,
    fitsAsked, fitsOk,
    priceBlocks: kindCount('price'),
    fitBlocks: fitsAsked,
    picksBlocks: kindCount('picks'),
    rankBlocks: kindCount('rank'),
    compareBlocks: kindCount('compare'),
    faqBlocks: kindCount('faq'),
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
  return items ? '<div class="changelog"><div class="section-title">Latest updates</div><ul>' + items + '</ul></div>' : '';
}

function renderPage({ article, meta, bodyHtml, data }) {
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

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: title, description,
      author: author ? { '@type': 'Person', name: author } : { '@type': 'Organization', name: 'Gunforma' },
      publisher: { '@type': 'Organization', name: 'Gunforma', logo: { '@type': 'ImageObject', url: SITE + '/assets/gunforma-logo.png' } },
      datePublished: article.published, dateModified: article.updated || article.published,
      mainEntityOfPage: canonical, image: ogImage,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Gunforma', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Field Notes', item: SITE + FIELD_NOTES_INDEX_PATH },
        { '@type': 'ListItem', position: 3, name: title, item: canonical },
      ],
    },
  ];
  // The ::faq blocks' questions, as FAQPage inside the page's one
  // structured-data script — an array of top-level entities is valid
  // JSON-LD, the same shape the Article and BreadcrumbList already share.
  if (data.faqQas.length) {
    jsonLd.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: data.faqQas.map((qa) => ({
        '@type': 'Question', name: qa.q,
        acceptedAnswer: { '@type': 'Answer', text: qa.a },
      })),
    });
  }

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
'.rank-body { display: flex; gap: 14px; align-items: flex-start; }' +
'.rank-photo { width: 120px; height: 120px; object-fit: contain; border-radius: 8px; border: 0.5px solid #ececec; background: #fff; flex: none; }' +
'@media (max-width: 480px) { .rank-photo { width: 84px; height: 84px; } }' +
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
'.fn-faq details { border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; margin: 8px 0; padding: 0 14px; }' +
'.fn-faq summary { font-size: 14px; font-weight: 700; padding: 10px 0; cursor: pointer; }' +
'.fn-faq details p { margin: 0 0 12px; }' +
'.changelog ul { margin: 0 0 12px 22px; } .changelog li { font-size: 13px; }' +
'.author { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 12.5px; color: #666; border-top: 0.5px solid #e5e5e5; margin-top: 30px; padding-top: 14px; }' +
'.related a { display: inline-block; margin-right: 14px; font-size: 13px; color: #4a9edd; text-decoration: none; }' +
'.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 26px 0 10px; }' +
'</style>' +
'</head><body>' +
  navHtml({}) +
'<div class="breadcrumb"><a href="/">Home</a> / <a href="' + FIELD_NOTES_INDEX_PATH + '">Field Notes</a> / ' + esc(title) + '</div>' +
'<div class="page article">' +
  (article.draft ? '<div class="draft-strip"><strong>Draft.</strong> Served on previews only; this address is a 404 on gunforma.com.</div>' : '') +
  '<div class="eyebrow">Field Notes &middot; ' + esc(typeLabel) + (meta.category ? ' &middot; ' + esc(meta.category) : '') + '</div>' +
  '<h1>' + inline(title) + '</h1>' +
  '<div class="byline">' + (author ? 'By <strong>' + esc(author) + '</strong> &middot; ' : '') + esc(fmtDate(article.published)) +
    (article.updated ? ' &middot; Last reviewed ' + esc(fmtMonth(article.updated)) : '') + '</div>' +
  (data.hasAffiliate ? AFFILIATE_DISCLOSURE_HTML : '') +
  html +
  changelogHtml(article.changelog) +
  '<div class="related"><div class="section-title">Related</div>' +
    '<a href="' + FIELD_NOTES_INDEX_PATH + '">All Field Notes &rarr;</a>' +
    '<a href="/p365/">What fits your P365 &rarr;</a>' +
    '<a href="/parts">Parts by category &rarr;</a>' +
    '<a href="/gunforma-builds.html">Real builds &rarr;</a>' +
  '</div>' +
  (author
    ? '<div class="author"><strong>' + esc(author) + '</strong>' +
      (meta.author_credential ? '<span>' + esc(meta.author_credential) + '</span>' : '') +
      '<span>Last reviewed ' + esc(fmtMonth(article.updated || article.published)) + '</span></div>'
    : '') +
'</div>' +
  footerHtml() +
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
  const { html: bodyHtml, blocks } = renderMarkdown(body);

  let data;
  try {
    data = await resolveBlocks(blocks, slug);
  } catch (err) {
    console.error('[field-note] lookup failed', err);
    return unavailable();   // 503 + Retry-After, never a 404 — see _pg.mjs
  }

  const page = renderPage({ article, meta, bodyHtml, data });
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
        ' compare=' + data.compareBlocks + ' faq=' + data.faqBlocks,
      'x-field-note-products': data.productsFound + '/' + data.productsAsked,
      'x-field-note-fits': data.fitsOk + '/' + data.fitsAsked,
    },
  });
};
