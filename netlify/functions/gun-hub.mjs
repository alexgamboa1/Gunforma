// gun-hub — /p365/<gun-slug>, and /p365/ as the index of declared hubs.
// ─────────────────────────────────────────────────────────────────────────
// Page type #4: the page a fit guide links UP to. One pistol model, its own
// facts from `guns`, its optic-cut decoder from gun_optic_cuts, and a link
// to every declared fit page for it.
//
// Why this exists at all: the nine /fit/ pages shipped in #104 and #119 were
// ORPHANED — a grep of every .html, .js and .mjs for "/fit/" found hits only
// in the four files that produce the pages themselves. The sitemap was the
// only discovery path, which means the cluster had no internal link equity
// and no route a reader could follow. A hub is the fix on the up side;
// product-page.mjs and the catalog link down.
//
// Registry, not reflection: a hub exists only for a gun in GUN_HUBS, and
// GUN_HUBS must match the gun set in GUIDE_PAGES exactly — a hub with no fit
// pages lists nothing, and a fit page with no hub is still orphaned on the
// up side. scripts/check-guide-content.mjs asserts both directions.
//
// /p365/ (no slug) is the index. It exists so a browser-side page can link
// into this cluster with ONE static href that is always valid — which is how
// gunforma-parts-catalog.html links in without a client-side mirror of the
// registry. _guide-meta.mjs's "do not create a browser mirror" note still
// holds, and this is what keeps it true.
import {
  GUN_HUBS, GUN_META, GUIDE_FAMILIES, HUB_INDEX_PATH, HUB_MAGAZINE_COPY,
  hubPath, isLiveGunHub, guidePagesForGun, guidePath,
} from './_guide-meta.mjs';
// The magazine rows' buy buttons: the same hero-listing rules and the same
// unpaid "Buy from <maker>" fallback the fit guides and product pages use,
// so one listing reads the same on every page (CLAUDE.md, "Duplicated
// logic to keep in sync").
import { isStalePrice, compareListingRows, displayPartnerName } from './_listing-rules.mjs';
import { makerLink, buyDisclosure, MAKER_REL } from './_maker-link.mjs';
import { CATEGORY_META } from './_category-meta.mjs';
import { navHtml, footerHtml, navScript, chromeCss, layoutCss, headTags, esc } from './_page-chrome.mjs';
// The Cloudflare Web Analytics tag, at the end of every document this
// function emits — the same rule as every other HTML-emitting function, and the one this
// file shipped without: hub pages exist to draw traffic, and were invisible
// to the thing that counts it. scripts/check-analytics-snippet.mjs discovers
// HTML-emitting functions and refuses the build without this import.
import { ANALYTICS_SNIPPET } from './_analytics.mjs';
import { pgRows as pgGet, unavailable as upstreamUnavailable } from './_pg.mjs';

const SITE = 'https://gunforma.com';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Same decoder wording as guide-page.mjs — the hub shows the same table, so
// a reader who lands here first is not learning a second vocabulary.
const APPLIES_TO_LABEL = {
  'default':                'Standard SKUs',
  'all-current-skus':       'All current SKUs',
  'sku-sl-rxsl':            'SKUs ending in -SL or -RXSL',
  'sku-rs':                 'SKUs ending in -RS',
  'legacy-non-optic-ready': 'Older non-optic-ready SKUs',
};

// pgGet is _pg.mjs's pgRows: one retry, a per-attempt timeout, and a body
// that is guaranteed to be the array PostgREST returns — so `rows.length`
// below is a fact about the table, never about the connection. On any
// failure it throws, and the handler answers unavailable(): 503 with
// Retry-After, never a 404. See _pg.mjs.

// /p365/<gun> or /p365/. Validates the WHOLE path, same reasoning as
// guide-page.mjs: /p365/anything/else must 404 rather than answer 200 under
// a URL we did not mean to serve.
function extractRoute(req) {
  const url = new URL(req.url);
  const splat = url.searchParams.get('splat');
  const path = splat !== null ? '/p365/' + splat.replace(/^\/+/, '') : url.pathname;
  if (/^\/p365\/?$/.test(path)) return { index: true };
  const m = path.match(/^\/p365\/([^/]+)\/?$/);
  if (!m) return null;
  const gun = decodeURIComponent(m[1]);
  if (!SLUG_RE.test(gun)) return null;
  return { index: false, gun };
}

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
    '<div class="s">' + esc(detail || 'No model page at this address.') + '</div>' +
    '<a href="' + SITE + HUB_INDEX_PATH + '">See the P365 models we cover &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

// A declared hub whose gun has no cut data: a data regression, not a
// transient — 502 and no Retry-After, unlike upstreamUnavailable().
function unavailable() {
  return new Response('Temporarily unavailable — try again shortly.', {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function fetchGun(slug) {
  const rows = await pgGet('guns?slug=eq.' + encodeURIComponent(slug) +
    '&select=' + encodeURIComponent(
      'id,slug,name,housing_class,slide_length_in,barrel_length_in,integrated_comp,oem_capacity') +
    '&limit=1');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchCuts(gunId) {
  const cuts = await pgGet('gun_optic_cuts?gun_id=eq.' + gunId +
    '&select=' + encodeURIComponent('optic_cut,applies_to,confidence,notes') +
    '&order=applies_to.asc');
  if (!cuts.length) return { cuts: [], vocab: {} };
  const names = [...new Set(cuts.map((c) => c.optic_cut))];
  const vocabRows = await pgGet('optic_cuts?optic_cut=in.(' + names.map(encodeURIComponent).join(',') +
    ')&select=' + encodeURIComponent('optic_cut,display_name,mounting'));
  return { cuts, vocab: Object.fromEntries(vocabRows.map((v) => [v.optic_cut, v])) };
}

const IN = (v) => (v == null ? null : String(v) + '"');

// ── magazines that fit this model ─────────────────────────────────────────
// One row per magazine_housing_fit row for the gun's housing class — the
// maker's own claim, structured (supabase/migrations/20261014202159_magazine_housing_fit.sql).
// A combination the maker never mentioned has no row and renders nothing;
// a model with no rows at all renders no section. Read in a query of its
// own and tolerated when it fails: the hub is the hub with or without this
// section, and for the minutes between this deploy and the migration being
// applied the table does not exist and PostgREST answers 404 here.
//
// Embeds: magazine_housing_fit has one FK to products, magazine_specs has
// one, manufacturers has one from products — bare is fine for those (the
// FK is still named where it is cheap to). products → product_variants is
// the two-FK pair and MUST name the FK: CLAUDE.md, PGRST201.
async function fetchMagazineFit(housingClass) {
  if (!housingClass) return [];
  const cols =
    'fit,note,source,' +
    'products!magazine_housing_fit_magazine_product_id_fkey(id,slug,name,url,is_discontinued,restricted_states,' +
      'manufacturers!products_brand_id_fkey(name,website_url),' +
      'magazine_specs(capacity,mag_style),' +
      'product_variants!product_variants_product_id_fkey(id,msrp,is_default,' +
        'affiliate_links(id,url,affiliate_url,street_price,in_stock,last_checked,op_last_matched_by,partners(name))))';
  const rows = await pgGet('magazine_housing_fit?housing_class=eq.' + encodeURIComponent(housingClass) +
    '&select=' + encodeURIComponent(cols) +
    '&products.product_variants.retired_at=is.null' +
    '&products.product_variants.affiliate_links.retired_at=is.null');
  const mags = [];
  for (const r of rows) {
    const p = r.products;
    if (!p || !p.slug || p.is_discontinued) continue;
    // magazine_specs is one-to-one on the product's id, so PostgREST hands
    // it back as an object; tolerate an array in case that ever changes.
    const spec = Array.isArray(p.magazine_specs) ? (p.magazine_specs[0] || {}) : (p.magazine_specs || {});
    const listings = [];
    for (const v of (p.product_variants || [])) {
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
    const dv = (p.product_variants || []).find((v) => v.is_default) || (p.product_variants || [])[0];
    mags.push({
      fit: r.fit, note: r.note || '', source: r.source,
      productId: p.id, slug: p.slug, name: p.name,
      href: '/parts/' + CATEGORY_META.magazine[0] + '/' + p.slug,
      capacity: spec.capacity != null ? Number(spec.capacity) : null,
      style: spec.mag_style || null,
      restricted: Array.isArray(p.restricted_states) ? p.restricted_states.map(String).filter(Boolean) : [],
      hero: listings[0] || null,
      msrp: dv && dv.msrp != null ? Number(dv.msrp) : null,
      maker: makerLink(p.url, p.manufacturers ? p.manufacturers.name : null,
                       p.manufacturers ? p.manufacturers.website_url : null),
    });
  }
  // Capacity ascending, then name — the brief's order, and the one a reader
  // scanning "what fits" expects. The "doesn't fit" line keeps the same order.
  mags.sort((a, b) => ((a.capacity ?? 999) - (b.capacity ?? 999)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return mags;
}

const fitsIt = (m) => m.fit !== 'not_compatible';
const hasPartnerLink = (m) => !!(m.hero && m.hero.url);
const hasMakerLink   = (m) => !hasPartnerLink(m) && !!m.maker;

// Price text follows the product page's rule: a fresh partner price, else
// "Check price" when a listing exists but is stale, else MSRP when there is
// no listing at all. Never typed, always from the row.
function magPriceText(m) {
  if (m.hero && m.hero.price != null && !m.hero.stale) return '$' + m.hero.price.toFixed(2);
  if (m.hero) return 'Check price';
  return m.msrp != null ? 'MSRP $' + m.msrp.toFixed(2) : '';
}

function magBuyHtml(m) {
  if (hasPartnerLink(m)) {
    const label = m.hero.partnerName ? 'Buy at ' + esc(m.hero.partnerName) : 'View listing';
    return '<a class="buy-btn" href="' + esc(m.hero.goUrl) + '" target="_blank" rel="noopener sponsored nofollow">' + label + ' ↗</a>';
  }
  if (hasMakerLink(m)) {
    return '<a class="buy-btn" href="/go/part/' + esc(m.productId) + '" target="_blank" rel="' + MAKER_REL + '">' + esc(m.maker.label) + ' ↗</a>';
  }
  return '';
}

function magazineSectionHtml(name, mags) {
  const fits = mags.filter(fitsIt);
  if (!fits.length) return '';
  const C = HUB_MAGAZINE_COPY;
  const rows = fits.map((m) =>
    '<div class="mag-row">' +
      '<div class="mag-main">' +
        '<a class="mag-name" href="' + esc(m.href) + '">' + esc(m.name) + '</a>' +
        '<div class="mag-meta">' +
          (m.capacity != null ? '<span><span class="mag-k">' + esc(C.capacity) + '</span> ' + esc(String(m.capacity)) + ' rounds</span>' : '') +
          (m.style ? '<span><span class="mag-k">' + esc(C.style) + '</span> ' + esc(m.style) + '</span>' : '') +
        '</div>' +
        '<div class="mag-verdict"><strong>' + esc(C.verdict[m.fit] || m.fit) + '</strong>' +
          (m.note ? ' — ' + esc(m.note) : '') + '</div>' +
        (m.restricted.length
          ? '<div class="mag-restricted">' + esc(C.restricted) + ' ' + esc(m.restricted.join(', ')) + '</div>'
          : '') +
      '</div>' +
      '<div class="mag-buy">' +
        (magPriceText(m) ? '<span class="mag-price">' + esc(magPriceText(m)) + '</span>' : '') +
        magBuyHtml(m) +
      '</div>' +
    '</div>').join('');
  const noFit = mags.filter((m) => !fitsIt(m));
  const noFitHtml = noFit.length
    ? '<p class="mag-nofit"><strong>' + esc(C.noFit.replace('{model}', name)) + '</strong> ' +
      noFit.map((m) => '<a href="' + esc(m.href) + '">' + esc(m.name) + '</a>').join(', ') + '</p>'
    : '';
  const second = buyDisclosure(fits.some(hasPartnerLink), fits.some(hasMakerLink));
  return '<h2 id="magazines">' + esc(C.heading.replace('{model}', name)) + '</h2>' +
    '<p class="desc">' + esc(C.intro) + '</p>' +
    '<div class="mag-list">' + rows + '</div>' +
    noFitHtml +
    '<p class="mag-disclosure">' + esc(C.prices) + (second ? ' ' + esc(second) : '') + '</p>';
}


// ── the model hub ─────────────────────────────────────────────────────────
function renderHub({ hub, gun, cuts, vocab, guides, mags }) {
  mags = mags || [];
  const fittingMags = mags.filter(fitsIt);
  const name = gun.name;
  const canonical = SITE + hubPath(gun.slug);
  const title = 'Sig ' + name + ': Specs, Optic Cut and Red Dot Fit (2026)';
  const description =
    'Sig Sauer ' + name + ' at a glance: slide and barrel length, capacity, ' +
    'which optic cut each SKU carries, and every red dot verified to fit it.';

  const cutNames = [...new Set(cuts.filter((c) => c.optic_cut !== 'none')
    .map((c) => (vocab[c.optic_cut] || {}).display_name || c.optic_cut))];

  const specRows = [
    ['Model', name],
    ['Slide length', IN(gun.slide_length_in)],
    ['Barrel length', IN(gun.barrel_length_in)],
    ['Integrated compensator', gun.integrated_comp === true ? 'Yes' : gun.integrated_comp === false ? 'No' : null],
    ['Factory capacity', gun.oem_capacity],
    ['Grip module family', gun.housing_class],
    ['Optic cut', cutNames.join(' / ') || null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '')
   .map(([k, v]) => '<div class="spec-row"><span class="spec-label">' + esc(k) + '</span>' +
     '<span class="spec-value">' + esc(v) + '</span></div>').join('');

  const decoderRows = cuts.map((c) => {
    const v = vocab[c.optic_cut] || {};
    const label = c.optic_cut === 'none' ? 'No optic cut' : (v.display_name || c.optic_cut);
    return '<div class="spec-row"><span class="spec-label">' +
      esc(APPLIES_TO_LABEL[c.applies_to] || c.applies_to) + '</span><span class="spec-value">' +
      esc(label) + (c.confidence === 'likely' ? ' <em class="likely">(likely)</em>' : '') +
      '</span></div>';
  }).join('');

  // Every DECLARED fit page for this model. Derived from the registry, so a
  // page that is not live cannot be linked here.
  const guideCards = guides.map((g) => {
    const fam = GUIDE_FAMILIES[g.family] || { label: g.family };
    return '<a class="guide-card" href="' + esc(guidePath(g.family, g.gun)) + '">' +
      '<span class="gc-kicker">Fit guide</span>' +
      '<span class="gc-title">' + esc(fam.label) + ' that fit the ' + esc(name) + '</span>' +
      '<span class="gc-go">Verified list, live prices &rarr;</span></a>';
  }).join('');

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: title, description, url: canonical,
      dateModified: hub.updated,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Gunforma', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'P365 models', item: SITE + HUB_INDEX_PATH },
        { '@type': 'ListItem', position: 3, name: 'Sig ' + name, item: canonical },
      ],
    },
    ...(guides.length ? [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Fit guides for the Sig ' + name,
      itemListElement: guides.map((g, i) => ({
        '@type': 'ListItem', position: i + 1,
        name: (GUIDE_FAMILIES[g.family] || {}).label + ' that fit the ' + name,
        item: SITE + guidePath(g.family, g.gun),
      })),
    }] : []),
    // Same shape as the fit-guide list above: an ItemList of the magazines
    // the maker says fit, each pointing at its product page.
    ...(fittingMags.length ? [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: HUB_MAGAZINE_COPY.heading.replace('{model}', 'Sig ' + name),
      itemListElement: fittingMags.map((m, i) => ({
        '@type': 'ListItem', position: i + 1,
        name: m.name,
        item: SITE + m.href,
      })),
    }] : []),
  ];

  return '<!DOCTYPE html><html lang="en"><head>' +
    headTags({ title, description, canonical, jsonLd, ogType: 'website',
               ogImage: SITE + '/og-default.png' }) +
    '<style>' + chromeCss() + layoutCss() + hubCss() + '</style>' +
    '</head><body>' +
    navHtml({ active: 'p365' }) +
    '<div class="breadcrumb"><a href="/">Home</a> / <a href="' + esc(HUB_INDEX_PATH) + '">P365 models</a> / ' + esc(name) + '</div>' +
    '<div class="page">' +
      '<div class="eyebrow">Sig Sauer &middot; P365 family</div>' +
      '<h1>Sig Sauer ' + esc(name) + '</h1>' +
      '<p class="desc">' + esc(hub.summary) + '</p>' +

      '<h2>Specifications</h2>' +
      '<div class="spec-box">' + specRows + '</div>' +

      '<h2>Which optic cut does it have?</h2>' +
      '<p class="desc">The cut is set per SKU, not per model, so the suffix on the ' +
        'box matters. This is read from the same fitment data the guides below use.</p>' +
      '<div class="spec-box">' + decoderRows + '</div>' +

      (guides.length
        ? '<h2>Fit guides</h2>' +
          '<p class="desc">Every optic in these lists is verified against this model&rsquo;s ' +
            'factory cut, with prices checked against retailer feeds.</p>' +
          '<div class="guide-grid">' + guideCards + '</div>'
        : '') +

      // Below the fit guides, above the links out: the magazine question,
      // answered only from maker-stated rows. Empty when the model has none.
      magazineSectionHtml(name, mags) +

      '<h2>Browse parts</h2>' +
      '<div class="links">' +
        '<a href="/parts">Parts by category &rarr;</a>' +
        '<a href="/gunforma-builds.html">Real builds &rarr;</a>' +
        '<a href="' + esc(HUB_INDEX_PATH) + '">Other P365 models &rarr;</a>' +
      '</div>' +
      '<div class="author"><span>Last reviewed ' + esc(hub.updated) + '</span></div>' +
    '</div>' +
    footerHtml() +
    navScript() + ANALYTICS_SNIPPET +
    '</body></html>';
}

// ── the index ─────────────────────────────────────────────────────────────
function renderIndex({ hubs }) {
  const canonical = SITE + HUB_INDEX_PATH;
  const title = 'Sig P365 Models: Specs, Optic Cuts and Red Dot Fit (2026)';
  const description =
    'Every Sig P365 model we cover: slide and barrel length, capacity, which ' +
    'optic cut each one carries, and the verified red dot fit list for each.';

  const cards = hubs.map((h) => '<a class="guide-card" href="' + esc(hubPath(h.gun)) + '">' +
    '<span class="gc-kicker">Model</span>' +
    '<span class="gc-title">Sig ' + esc(GUN_META[h.gun] || h.gun) + '</span>' +
    '<span class="gc-go">Specs, cut and fit &rarr;</span></a>').join('');

  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: title, description, url: canonical },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Gunforma', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'P365 models', item: canonical },
      ] },
    { '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: hubs.map((h, i) => ({
        '@type': 'ListItem', position: i + 1,
        name: 'Sig ' + (GUN_META[h.gun] || h.gun),
        item: SITE + hubPath(h.gun),
      })) },
  ];

  return '<!DOCTYPE html><html lang="en"><head>' +
    headTags({ title, description, canonical, jsonLd, ogType: 'website',
               ogImage: SITE + '/og-default.png' }) +
    '<style>' + chromeCss() + layoutCss() + hubCss() + '</style>' +
    '</head><body>' +
    navHtml({ active: 'p365' }) +
    '<div class="breadcrumb"><a href="/">Home</a> / P365 models</div>' +
    '<div class="page">' +
      '<div class="eyebrow">Sig Sauer &middot; P365 family</div>' +
      '<h1>Sig P365 models</h1>' +
      '<p class="desc">The P365 line does not share one optic cut. Which pocket ' +
        'your slide carries depends on the model and often on the SKU suffix, so ' +
        'each model has its own page with its specs, its cut decoder and its ' +
        'verified fit list.</p>' +
      '<div class="guide-grid">' + cards + '</div>' +
      '<h2>Browse parts</h2>' +
      '<div class="links">' +
        '<a href="/parts">Parts by category &rarr;</a>' +
        '<a href="/gunforma-builds.html">Real builds &rarr;</a>' +
      '</div>' +
    '</div>' +
    footerHtml() +
    navScript() + ANALYTICS_SNIPPET +
    '</body></html>';
}

function hubCss() {
  return (
    '.desc { font-size: 14px; line-height: 1.6; color: #333; margin: 10px 0; }' +
    'h1 { font-size: 27px; line-height: 1.25; margin-bottom: 12px; }' +
    'h2 { font-size: 19px; margin: 30px 0 10px; }' +
    '.spec-box { border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; overflow: hidden; margin: 12px 0; }' +
    '.spec-row { display: flex; justify-content: space-between; gap: 16px; padding: 11px 16px; font-size: 13.5px; border-bottom: 0.5px solid #f0f0f0; }' +
    '.spec-row:last-child { border-bottom: 0; }' +
    '.spec-label { color: #777; }' +
    '.spec-value { color: #1a1a1a; font-weight: 600; text-align: right; }' +
    '.likely { font-style: normal; font-size: 11px; color: #b06a00; font-weight: 600; }' +
    '.guide-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; margin: 12px 0; }' +
    '.guide-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; text-decoration: none; }' +
    '.guide-card:hover { border-color: #4a9edd; }' +
    '.gc-kicker { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #4a9edd; font-weight: 700; }' +
    '.gc-title { font-size: 14.5px; font-weight: 700; color: #1a1a1a; line-height: 1.35; }' +
    '.gc-go { font-size: 12px; color: #4a9edd; }' +
    '.links { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 12px 0; }' +
    '.links a { font-size: 13px; color: #4a9edd; text-decoration: none; }' +
    '.author { margin-top: 26px; padding-top: 14px; border-top: 0.5px solid #e5e5e5; font-size: 12px; color: #888; }' +
    // Magazine rows: one card per magazine, two columns on a desktop, one
    // column on a phone (no fixed widths anywhere, so nothing can overflow
    // the 16px gutter at 390px).
    '.mag-list { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }' +
    '.mag-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 10px 16px; padding: 12px 16px; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; }' +
    '.mag-main { flex: 1 1 260px; min-width: 0; }' +
    '.mag-name { font-size: 14.5px; font-weight: 700; color: #1a1a1a; text-decoration: none; line-height: 1.35; overflow-wrap: anywhere; }' +
    '.mag-name:hover { color: #4a9edd; }' +
    '.mag-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: #333; margin-top: 4px; }' +
    '.mag-k { color: #777; }' +
    '.mag-verdict { font-size: 13px; line-height: 1.5; color: #1a1a1a; margin-top: 6px; }' +
    '.mag-verdict strong { color: #1f6f3f; }' +
    '.mag-restricted { font-size: 12.5px; font-weight: 600; line-height: 1.45; color: #8a3b12; background: #fff4ec; border: 0.5px solid #f0c9ad; border-radius: 6px; padding: 7px 10px; margin-top: 8px; }' +
    '.mag-buy { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: 0 0 auto; }' +
    '.mag-price { font-size: 13.5px; font-weight: 700; color: #1a1a1a; }' +
    '.buy-btn { display: inline-block; padding: 8px 14px; border-radius: 7px; background: #1a1a1a; color: #fff; font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap; }' +
    '.buy-btn:hover { background: #4a9edd; }' +
    '.mag-nofit { font-size: 13px; line-height: 1.6; color: #333; margin: 10px 0; }' +
    '.mag-nofit strong { color: #8a3b12; }' +
    '.mag-nofit a { color: #4a9edd; text-decoration: none; }' +
    '.mag-disclosure { font-size: 11.5px; color: #888; margin: 8px 0 0; line-height: 1.5; }' +
    '@media (max-width: 480px) { .mag-row { flex-direction: column; } .mag-buy { align-items: flex-start; flex-direction: row; align-items: center; gap: 12px; } }'
  );
}

export default async (req) => {
  const route = extractRoute(req);
  if (!route) return notFound();

  if (route.index) {
    return new Response(renderIndex({ hubs: GUN_HUBS }), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=1800',
        'x-gun-hub': 'index',
        'x-gun-hub-count': String(GUN_HUBS.length),
      },
    });
  }

  const hub = GUN_HUBS.find((h) => h.gun === route.gun);
  if (!hub || !isLiveGunHub(route.gun)) return notFound('No model page at this address yet.');

  let gun, cutsRes;
  try {
    gun = await fetchGun(route.gun);
    // Zero rows from PostgREST — a real not-found. A failed read never gets
    // here: fetchGun throws and the catch below answers 503.
    if (!gun) return notFound('Unknown pistol model.');
    cutsRes = await fetchCuts(gun.id);
    if (!cutsRes.cuts.length) {
      // Same rule as guide-page.mjs: a declared page whose gun has no cut
      // data is a data regression, not a thin page to ship.
      console.error('[gun-hub] no gun_optic_cuts rows for ' + route.gun);
      return unavailable();
    }
  } catch (err) {
    console.error('[gun-hub] lookup failed', err);
    return upstreamUnavailable();   // 503 + Retry-After, never a 404 — see _pg.mjs
  }

  const guides = guidePagesForGun(route.gun);

  let mags = [];
  try {
    mags = await fetchMagazineFit(gun.housing_class);
  } catch (err) {
    // Non-fatal: the hub is the hub without this section, and until the
    // magazine_housing_fit migration is applied the table does not exist.
    console.error('[gun-hub] magazine-fit lookup failed', err);
  }

  const html = renderHub({ hub, gun, cuts: cutsRes.cuts, vocab: cutsRes.vocab, guides, mags });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
      // Observability, same as guide-page's x-guide-* headers.
      'x-gun-hub': route.gun,
      'x-gun-hub-guides': String(guides.length),
      'x-gun-hub-cuts': String(cutsRes.cuts.length),
      // Magazine rows served: fitting / not-compatible. check-routes.mjs
      // asserts the section against this so an empty section cannot pass
      // as "nothing to show".
      'x-gun-hub-mags': String(mags.filter(fitsIt).length) + '/' + String(mags.length - mags.filter(fitsIt).length),
    },
  });
};
