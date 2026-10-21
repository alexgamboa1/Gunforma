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
    'id,slug,name,category,url,is_discontinued,restricted_states,' +
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
    msrp: dv && dv.msrp != null ? Number(dv.msrp) : null,
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

function buyHtml(o) {
  if (o.discontinued) return '';
  if (hasPartnerLink(o)) {
    const label = o.hero.partnerName ? 'Buy at ' + esc(o.hero.partnerName) : 'View listing';
    return '<a class="buy-btn" href="' + esc(o.hero.goUrl) + '" target="_blank" rel="noopener sponsored nofollow">' + label + ' ↗</a>';
  }
  if (hasMakerLink(o)) {
    return '<a class="buy-btn" href="/go/part/' + esc(o.id) + '" target="_blank" rel="' + MAKER_REL + '">' + esc(o.maker.label) + ' ↗</a>';
  }
  return '<span class="buy-btn disabled">No listing yet</span>';
}

function missingLine(what, slug) {
  return '<p class="fn-missing">' + esc(what) + ' <code>' + esc(slug) + '</code> is not in the catalog.</p>';
}

function priceBlockHtml(block, products) {
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
      '<td>' + buyHtml(o) + '</td>' +
    '</tr>').join('');
  const second = buyDisclosure(found.some(hasPartnerLink), found.some(hasMakerLink));
  return '<div class="fn-block fn-price">' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>Part</th><th>Price today</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="disclosure">' + esc(HUB_MAGAZINE_COPY.prices) + (second ? ' ' + esc(second) : '') + '</div>' : '') +
    missing.map((s) => missingLine('Part', s)).join('') +
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
  // magazine: the maker's own claim for this housing class, or none. Read
  // from the page-wide prefetch (prefetchMagazines), never per block.
  const claim = gun.housing_class ? (caches.magFit.get(product.id + '|' + gun.housing_class) || null) : null;
  const cap = caches.magCapacity.get(product.id);
  const fits = claim ? claim.fit !== 'not_compatible' : null;
  return {
    block, product, gun, ok: true, claim,
    capacity: cap != null ? Number(cap) : null,
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

// Magazine blocks are read TWICE per page, not twice per block: one
// magazine_housing_fit read for every (magazine, housing class) pair the
// page asks about and one magazine_specs read for every magazine. The
// first article (p365-magazine-fit, 2026-10-21) carries 48 magazine blocks
// — every catalog magazine against every factory grip module — and the
// per-block shape cost 98 sequential reads and 8.5 s to render, against a
// 10 s function budget. Measured locally against production PostgREST;
// field-notes.test.mjs pins the read count so it cannot creep back.
async function prefetchMagazines(blocks, products, guns, caches) {
  const mag = blocks.filter((b) => b.kind === 'fit' && b.part === 'magazine');
  const ids = [...new Set(mag.map((b) => products.get(b.slug)).filter(Boolean).map((p) => p.id))];
  const classes = [...new Set(mag.map((b) => guns.get(b.gun)).filter(Boolean).map((g) => g.housing_class).filter(Boolean))];
  if (!ids.length) return;
  const list = (xs) => xs.map(encodeURIComponent).join(',');
  if (classes.length) {
    const rows = await pgGet('magazine_housing_fit?magazine_product_id=in.(' + list(ids) + ')' +
      '&housing_class=in.(' + list(classes) + ')&select=' + encodeURIComponent('magazine_product_id,housing_class,fit,note'));
    for (const r of rows) caches.magFit.set(r.magazine_product_id + '|' + r.housing_class, { fit: r.fit, note: r.note });
  }
  const specs = await pgGet('magazine_specs?product_id=in.(' + list(ids) + ')&select=' + encodeURIComponent('product_id,capacity'));
  for (const s of specs) if (s.capacity != null) caches.magCapacity.set(s.product_id, s.capacity);
}

// ── all the blocks of one article, resolved ──────────────────────────────
async function resolveBlocks(blocks) {
  const productSlugs = new Set();
  const gunSlugs = new Set();
  for (const b of blocks) {
    if (b.kind === 'price') b.slugs.forEach((s) => productSlugs.add(s));
    if (b.kind === 'fit') { productSlugs.add(b.slug); gunSlugs.add(b.gun); }
  }
  const products = new Map((await fetchProducts([...productSlugs])).map((p) => [p.slug, p]));
  const guns = new Map((await fetchGuns([...gunSlugs])).map((g) => [g.slug, g]));
  const caches = { optic: new Map(), cuts: new Map(), magFit: new Map(), magCapacity: new Map() };
  await prefetchMagazines(blocks, products, guns, caches);
  const rendered = [];
  let fitsOk = 0, fitsAsked = 0;
  for (const b of blocks) {
    if (b.kind === 'price') rendered.push(priceBlockHtml(b, products));
    else if (b.kind === 'fit') {
      fitsAsked++;
      const f = await resolveFit(b, products, guns, caches);
      if (f.ok) fitsOk++;
      rendered.push(fitBlockHtml(f));
    } else rendered.push('');
  }
  return {
    rendered,
    productsAsked: productSlugs.size, productsFound: products.size,
    fitsAsked, fitsOk,
    priceBlocks: blocks.filter((b) => b.kind === 'price').length,
    fitBlocks: fitsAsked,
  };
}

// ── the page ─────────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function renderPage({ article, meta, bodyHtml, data }) {
  const slug = article.slug;
  const canonical = SITE + fieldNotePath(slug);
  const title = meta.title || slug;
  const description = meta.description || textOf(bodyHtml).slice(0, 155);
  const author = meta.author || 'Gunforma';
  const cover = meta.cover ? (/^https?:\/\//i.test(meta.cover) ? meta.cover : SITE + (meta.cover.startsWith('/') ? '' : '/') + meta.cover) : null;
  const ogImage = cover || SITE + '/og-default.png';
  const typeLabel = meta.type === 'review' ? 'Review' : meta.type === 'comparison' ? 'Comparison' : 'Guide';

  // Each placeholder becomes its resolved block, in order.
  const html = bodyHtml.replace(/<!--fn-block-(\d+)-->/g, (_, n) => data.rendered[Number(n)] || '');

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: title, description,
      author: { '@type': 'Person', name: author },
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
  '<div class="byline">By <strong>' + esc(author) + '</strong> &middot; ' + esc(fmtDate(article.published)) +
    (article.updated && article.updated !== article.published ? ' &middot; Updated ' + esc(fmtDate(article.updated)) : '') + '</div>' +
  html +
  '<div class="related"><div class="section-title">Related</div>' +
    '<a href="' + FIELD_NOTES_INDEX_PATH + '">All Field Notes &rarr;</a>' +
    '<a href="/p365/">What fits your P365 &rarr;</a>' +
    '<a href="/parts">Parts by category &rarr;</a>' +
    '<a href="/gunforma-builds.html">Real builds &rarr;</a>' +
  '</div>' +
  '<div class="author"><strong>' + esc(author) + '</strong>' +
    (meta.author_credential ? '<span>' + esc(meta.author_credential) + '</span>' : '') +
    '<span>Last reviewed ' + esc(article.updated || article.published) + '</span></div>' +
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
    data = await resolveBlocks(blocks);
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
      'x-field-note-blocks': 'price=' + data.priceBlocks + ' fit=' + data.fitBlocks,
      'x-field-note-products': data.productsFound + '/' + data.productsAsked,
      'x-field-note-fits': data.fitsOk + '/' + data.fitsAsked,
    },
  });
};
