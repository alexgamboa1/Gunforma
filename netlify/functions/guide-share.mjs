// guide-share — /gg/<slug>-<uuid>, every Gun Guide's own shareable page.
// ─────────────────────────────────────────────────────────────────────────
// Before this a guide lived only inside gunforma-gun-guides.html, drawn in
// the browser: nothing a crawler could read, nothing a reader could link
// to. This renders the guide in served HTML — H1, theme or builder, model,
// every part with its photo and a link to its /parts/ page, the live total,
// buy rows through /go/, JSON-LD, apex canonical — the page a share card
// and a search result land on.
//
// THE PATTERN IS build-og.mjs's, with the chrome of gun-hub.mjs:
//   - the uuid at the END of the path is what resolves, the slug is
//     decoration (_guide-url.mjs, the server half of js/guide-url.js — the
//     same pair as _build-url.mjs ↔ js/build-url.js, held together by
//     scripts/guide-url.test.mjs);
//   - every read goes through _pg.mjs: a page is not-found (404) ONLY when
//     PostgREST positively returned zero rows from both tables, and any
//     failure to read is 503 + Retry-After (CLAUDE.md, "Not found means
//     PostgREST said zero rows");
//   - the page is a whole document (there is no static page to inject into,
//     unlike /b/), so the nav, footer and CSS come from _page-chrome.mjs,
//     Guides active.
//
// TWO TABLES, ONE UUID SPACE. A published Gunforma guide (guides) is read
// first; zero rows there, and the id is tried as a community guide
// (gun_guides). Both filters are repeated here though RLS already applies
// them to the anon key — is_published = true, is_removed = false — for the
// reason build-og.mjs repeats status=eq.approved: if a policy is ever
// loosened, the leak does not start here. A Gunforma DRAFT is never served.
//
// INDEXING. A published Gunforma guide is indexable and in the sitemap
// (sitemap.mjs, /sitemap-guides.xml). A community guide is SERVED — its
// link works and its share card renders — but carries noindex and is not
// submitted, until titles can be reported (claude/loadouts-spec.md §7.5:
// moderation is a report button plus admin takedown; the report button does
// not exist yet, so a community title is not something we put in front of
// Google).
//
// THE SHARE CARD is built from the data — the guide's title, its most
// notable parts (headlineParts(), shared with build-og.mjs), the part count
// and today's total — and og:image is the guide's collage,
// /gg-og/<uuid>-<hash>.png (guide-og.mjs; the hash is of what the image
// draws, _guide-og.mjs), declared 1200x630 image/png. When the collage
// cannot be named the page declares og-default.png, the same size and type.
//
// PRICES follow the house rules through the shared modules, never a copy:
// _listing-rules.mjs for stale and sort, _maker-link.mjs for the unpaid
// button and the disclosure, _build-cards.mjs's priceTotal() for "Total at
// today's prices" (the same number a build's page and the open guide on
// Gun Guides show). Each part's buy row is for its SAVED option, falling
// back to the product's listings the way the browser does
// (js/affiliate.js getFor()) — and a maker-only part whose saved option is
// gone reads "Check price", never a sibling option's MSRP. A discontinued
// part keeps its mark and its /parts/ link and is never sold.
//
// Observable from outside: x-guide-share (curated | community),
// x-guide-share-index (index | noindex), -parts, -buy and -priced.
import { gunGuideUrl, gunGuideIdFromPath } from './_guide-url.mjs';
import { isStalePrice, compareListingRows, displayPartnerName } from './_listing-rules.mjs';
import { makerLink, buyDisclosure, MAKER_REL } from './_maker-link.mjs';
import { displayProductName } from './_display-name.mjs';
import { CATEGORY_META } from './_category-meta.mjs';
import { swatchFor } from './_variant-swatch.mjs';
import { variantLabel } from './_variant-label.mjs';
import { priceTotal, priceTotalText, headlineParts, clampLine } from './_build-cards.mjs';
import { navHtml, footerHtml, navScript, chromeCss, layoutCss, headTags, esc } from './_page-chrome.mjs';
import { ANALYTICS_SNIPPET } from './_analytics.mjs';
import { CDN_CACHE_BUILD, CDN_CACHE_NO_STORE } from './_cache.mjs';
import { pgRows, unavailable } from './_pg.mjs';
import { CURATED_SELECT, COMMUNITY_SELECT, VARIANT_SELECT, fetchGuide, fetchVariants, guideParts,
         groupByProduct, partPicture } from './_guide-data.mjs';
import { shareImageFor, guideTitle, guideModel, OG_DEFAULT_URL, OG_DEFAULT_W, OG_DEFAULT_H } from './_guide-og.mjs';

const SITE = 'https://gunforma.com';
const GALLERY = '/gunforma-gun-guides.html';
// A reader's saved build is an Armory build, not a Gun Guide (Alex,
// 2026-11-02): Gun Guides lists Gunforma's own guides only, so an Armory
// build's crumb leads back to the Armory, where it was made.
const ARMORY = '/gunforma-armory.html';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The selects and reads are shared with guide-og.mjs (_guide-data.mjs);
// re-exported so the named-embed test reads them where it always has.
export { CURATED_SELECT, COMMUNITY_SELECT, VARIANT_SELECT };

// ── routing ──────────────────────────────────────────────────────────────
// A function receives the ORIGINAL request URL (CLAUDE.md, "Netlify
// redirects"), so the pathname is the source; ?id= is what `netlify dev`
// substitutes and is read only as a fallback. The WHOLE path is validated:
// /gg/<one segment> or nothing.
function extractId(req) {
  const url = new URL(req.url);
  let path = url.pathname;
  if (!/^\/gg\//.test(path)) {
    const splat = url.searchParams.get('id');
    if (splat === null) return null;
    path = '/gg/' + splat.replace(/^\/+/, '');
  }
  if (!/^\/gg\/[^/]+\/?$/.test(path)) return null;
  return gunGuideIdFromPath(decodeURIComponent(path));
}

// /l/<share_id> — the Armory build share link (PR 3 of the 2026-11-10
// design). The slug alphabet is armory_share_id()'s: lowercase base 36.
function extractShareId(req) {
  const url = new URL(req.url);
  let path = url.pathname;
  if (!/^\/l\//.test(path)) {
    const splat = url.searchParams.get('share');
    if (splat === null) return null;
    path = '/l/' + splat.replace(/^\/+/, '');
  }
  const m = /^\/l\/([a-z0-9]{6,12})\/?$/.exec(path);
  return m ? m[1] : null;
}

function notFound() {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Guide not found — Gunforma</title>' +
    '<meta name="robots" content="noindex"/>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
    'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
    '</head><body><div><div style="font-size:20px;font-weight:700">Guide not found</div>' +
    '<div class="s">This Gun Guide isn’t published, or it was taken down.</div>' +
    '<a href="' + SITE + GALLERY + '">Browse Gun Guides &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60',
                              'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE } },
  );
}

// ── reads ────────────────────────────────────────────────────────────────
// fetchGuide() and fetchVariants() (_guide-data.mjs) throw UpstreamError on
// a failure to read (the handler answers 503); an empty array is the one
// real "not here".

// The /l/ page's row: COMMUNITY_SELECT plus the share columns. This select
// exists only behind extractShareId(), so before *_armory_share_links.sql
// is applied no /l/ link exists to ask for it; a request anyway reads as a
// failure to read (503), never a 404.
const SHARE_SELECT = COMMUNITY_SELECT + ',share_id,based_on_id';
async function fetchByShareId(shareId) {
  const rows = await pgRows('gun_guides?share_id=eq.' + encodeURIComponent(shareId) +
    '&is_removed=eq.false&select=' + encodeURIComponent(SHARE_SELECT) + '&limit=1');
  return rows.length ? rows[0] : null;
}

// A community /gg/ hit's new address. Tolerant on purpose: before the
// migration the column is not there, and the answer is "no redirect — serve
// the page as before", never a 503 over a page that can render.
async function shareIdFor(id) {
  try {
    const rows = await pgRows('gun_guides?id=eq.' + id + '&select=share_id&limit=1');
    return rows.length && rows[0].share_id ? rows[0].share_id : null;
  } catch (e) {
    return null;
  }
}

// "Based on @user's build" — credit, not a fact about this page, so any
// failure (or a taken-down source) is a page without the line.
async function fetchBasedOn(basedOnId) {
  if (!basedOnId) return null;
  try {
    const rows = await pgRows('gun_guides?id=eq.' + basedOnId + '&is_removed=eq.false' +
      '&select=' + encodeURIComponent('share_id,user_id,title') + '&limit=1');
    if (!rows.length) return null;
    const username = await fetchUsername(rows[0].user_id);
    return {
      href: '/l/' + rows[0].share_id,
      text: username ? '@' + username + '’s build' : 'a shared build',
    };
  } catch (e) {
    return null;
  }
}

// The builder's username. Not a fact about whether the guide exists, so a
// failed read is a page without a byline, never a 503.
async function fetchUsername(userId) {
  if (!userId || !UUID_RE.test(userId)) return null;
  try {
    const rows = await pgRows('profiles?id=eq.' + userId + '&select=username&limit=1');
    return rows.length && rows[0].username ? rows[0].username : null;
  } catch (e) {
    console.error('[guide-share] username read failed', e);
    return null;
  }
}

// ── one product's buy rows ───────────────────────────────────────────────
// Every live variant of the product as a PARTNER row per listing, or as a
// MAKER row when it has none and the product has a usable url — the shape
// js/affiliate.js builds in the browser, ordered by the shared comparator.
function productRows(variants, product) {
  const maker = product.is_discontinued ? null
    : makerLink(product.url, product.manufacturers ? product.manufacturers.name : null,
                product.manufacturers ? product.manufacturers.website_url : null);
  const partner = [], makers = [];
  for (const v of variants) {
    const links = Array.isArray(v.affiliate_links) ? v.affiliate_links : [];
    const msrp = v.msrp != null ? Number(v.msrp) : null;
    if (!links.length) {
      if (maker) makers.push({ variantId: v.id, maker, msrp, goUrl: '/go/part/' + v.product_id });
      continue;
    }
    for (const l of links) {
      partner.push({
        variantId: v.id, maker: null, msrp,
        url: l.affiliate_url || l.url,
        goUrl: '/go/' + l.id,
        price: l.street_price != null ? Number(l.street_price) : null,
        stale: isStalePrice(l),
        in_stock: l.in_stock,
        partnerName: displayPartnerName(l.partners ? l.partners.name : null),
      });
    }
  }
  partner.sort(compareListingRows);
  return { partner, makers };
}

// The SAVED option's own rows when it has any, else the product's — and
// whether the fallback happened (a saved option that is gone).
function scopedRows(all, variantId) {
  if (variantId) {
    const partner = all.partner.filter((r) => r.variantId === variantId);
    const makers = all.makers.filter((r) => r.variantId === variantId);
    if (partner.length || makers.length) return { partner, makers, savedGone: false };
    return { partner: all.partner, makers: all.makers, savedGone: true };
  }
  return { partner: all.partner, makers: all.makers, savedGone: false };
}

const money = (n) => '$' + Number(n).toFixed(2);

// { priceText, partnerLabel, href, rel, label, kind } or null for no row.
function buyFor(scoped, variantId) {
  if (scoped.partner.length) {
    const hero = scoped.partner[0];   // fresh-and-priced first: the number shown IS this row's
    return {
      kind: 'partner',
      priceText: hero.price != null && !hero.stale ? money(hero.price) : 'Check price',
      partnerName: hero.partnerName,
      inStock: hero.in_stock,
      href: hero.goUrl,
      rel: 'noopener sponsored nofollow',
      label: hero.partnerName ? 'Buy at ' + hero.partnerName : 'View listing',
    };
  }
  if (scoped.makers.length) {
    const row = scoped.makers[0];
    let priceText;
    if (scoped.savedGone) priceText = 'Check price';           // never a sibling's MSRP
    else if (variantId) priceText = row.msrp != null ? 'MSRP ' + money(row.msrp) : 'Check price';
    else {
      const prices = scoped.makers.map((r) => r.msrp).filter((n) => n != null);
      const low = prices.length ? Math.min(...prices) : null;
      const same = prices.length === scoped.makers.length && prices.every((n) => n === low);
      priceText = low == null ? 'Check price' : (same ? 'MSRP ' : 'MSRP from ') + money(low);
    }
    return { kind: 'maker', priceText, partnerName: null, inStock: null,
             href: row.goUrl, rel: MAKER_REL, label: row.maker.label };
  }
  return null;
}

// ── the page ─────────────────────────────────────────────────────────────
function partHref(p, product) {
  const cat = (product && product.category) || p.category;
  const slug = (product && product.slug) || p.slug;
  const meta = CATEGORY_META[cat];
  return meta && slug ? '/parts/' + meta[0] + '/' + slug : null;
}

function partView(p, byProduct) {
  const entry = p && p.refId ? byProduct.get(p.refId) : null;
  const product = entry ? entry.product : null;
  const refId = p && p.refId ? String(p.refId) : null;
  const variants = entry ? entry.variants : [];
  // The saved option's photo, else its swatch — never another option's
  // (partPicture(), shared with the share image).
  const { photo, color, saved } = partPicture(p, entry);
  const optionLabel = saved ? variantLabel(saved) : (p.variantLabel || '');
  const discontinued = !!(product && product.is_discontinued);
  let buy = null;
  if (product && !discontinued) {
    buy = buyFor(scopedRows(productRows(variants, product), p.variantId || null), p.variantId || null);
  }
  const catKey = (product && product.category) || p.category;
  return {
    name: displayProductName({ brand: p.brand || '', name: p.name || '' }),
    catLabel: CATEGORY_META[catKey] ? CATEGORY_META[catKey][2] : '',
    href: partHref(p, product),
    photo, color, brand: p.brand || '',
    optionLabel, discontinued, buy, refId,
  };
}

function partRowHtml(v) {
  const media = v.photo
    ? '<img src="' + esc(v.photo) + '" alt="' + esc(v.name) + '" loading="lazy" width="96" height="72"/>'
    : '<span class="pr-swatch" role="img" aria-label="' + esc(v.name) + '" style="' + swatchFor(v.color, v.brand).css + '"></span>';
  const nameHtml = v.href ? '<a href="' + esc(v.href) + '">' + esc(v.name) + '</a>' : esc(v.name);
  let buyHtml = '';
  if (v.buy) {
    buyHtml = '<div class="pr-buy">' +
      '<span class="pr-price">' + esc(v.buy.priceText) + '</span>' +
      (v.buy.partnerName ? '<span class="pr-at">at <strong>' + esc(v.buy.partnerName) + '</strong></span>' : '') +
      (v.buy.inStock === true ? '<span class="pr-stock">In stock</span>' : '') +
      '<a class="buy-btn" href="' + esc(v.buy.href) + '" target="_blank" rel="' + v.buy.rel + '">' + esc(v.buy.label) + ' ↗</a>' +
    '</div>';
  }
  return '<div class="pr"' + (v.refId ? ' data-ref="' + esc(v.refId) + '"' : '') + '>' +
    '<div class="pr-media">' + media + '</div>' +
    '<div class="pr-main">' +
      (v.catLabel ? '<div class="pr-cat">' + esc(v.catLabel) + '</div>' : '') +
      '<div class="pr-name">' + nameHtml +
        (v.optionLabel ? ' <span class="pr-opt">· ' + esc(v.optionLabel) + '</span>' : '') +
        (v.discontinued ? ' <span class="pr-disc">Discontinued</span>' : '') + '</div>' +
      // The share page's fit tag lands here, drawn in the browser by
      // js/armory-share.js through the shared fit module. Empty for
      // everything else — crawlers never see a verdict the server did not
      // compute.
      '<span class="pr-fit" data-fit></span>' +
      buyHtml +
    '</div>' +
  '</div>';
}

// "Title: Holosun 507K X2, Grey Ghost Precision V3 Slide | Gunforma" —
// the parts added while they fit, most searched-for first.
const TITLE_PARTS_BUDGET = 60;
function pageTitle(title, parts) {
  const out = [];
  let used = 0;
  for (const p of parts) {
    const cost = p.length + (out.length ? 2 : 0);
    if (out.length && used + cost > TITLE_PARTS_BUDGET) break;
    out.push(p);
    used += cost;
  }
  return clampLine(title, 70) + (out.length ? ': ' + out.join(', ') : '') + ' | Gunforma';
}

// "Sig P365 Concealed Carry: Aimpoint ACRO P-2, Grey Ghost Precision
// GGP365 V1… — 4 parts, $1,285 today." The count and today's total are the
// point of the card, so they are never the thing cut: the parts give way
// first, and the closing sentence is added only when it fits WHOLE — a
// sentence clipped mid-phrase reads worse than none.
const META_DESCRIPTION_MAX = 160;
function pageDescription({ title, kind, model, username, parts, count, totalText }) {
  const tail = ' — ' + count + (count === 1 ? ' part' : ' parts') + (totalText ? ', ' + totalText + ' today' : '') + '.';
  const head = clampLine(title, 70);
  let shown = parts.slice(0, 2);
  const leadFor = (list) => {
    if (!list.length) return head;
    const more = count > list.length && !/…$/.test(list[list.length - 1]);
    return head + ': ' + list.join(', ') + (more ? '…' : '');
  };
  while (shown.length && (leadFor(shown) + tail).length > META_DESCRIPTION_MAX) shown = shown.slice(0, -1);
  const core = leadFor(shown) + tail;
  const who = kind === 'curated'
    ? ' A Gunforma guide for the ' + model + ', every part fit-checked.'
    : ' A ' + model + ' build' + (username ? ' by ' + username : '') + ', spec’d in the Gunforma Armory.';
  return (core + who).length <= META_DESCRIPTION_MAX ? core + who : clampLine(core, META_DESCRIPTION_MAX);
}

// `image` is the share image the handler resolved (shareImageFor()); without
// one the page declares og-default.png at its real size.
// `share` ({ shareId, basedOn }) marks the /l/<share_id> rendering of an
// Armory build: its own URL, the based-on credit, the share actions and
// the client modules that make it the owner's share view. Null is the
// /gg/ page exactly as before.
export function renderGuide({ kind, row, variants, username, image, share }) {
  const id = String(row.id).toLowerCase();
  const title = guideTitle(row);
  const canonical = share ? SITE + '/l/' + share.shareId : gunGuideUrl(id, title);
  const model = guideModel(row);
  const theme = kind === 'curated' && row.guide_themes ? row.guide_themes.label : null;
  const parts = guideParts(row);
  const og = image || { url: OG_DEFAULT_URL, w: OG_DEFAULT_W, h: OG_DEFAULT_H, type: 'image/png',
                        alt: (kind === 'curated' ? 'Gun Guide: ' : 'Armory build: ') + title, collage: false };

  const byProduct = groupByProduct(variants);
  const views = parts.map((p) => partView(p, byProduct));
  const totalText = priceTotalText(priceTotal(parts, variants));
  const hasPartner = views.some((v) => v.buy && v.buy.kind === 'partner');
  const hasMaker = views.some((v) => v.buy && v.buy.kind === 'maker');
  const disclosure = buyDisclosure(hasPartner, hasMaker);

  const headline = headlineParts({ parts_snapshot: parts }, 3, 38);
  const docTitle = pageTitle(title, headline);
  const description = pageDescription({ title, kind, model, username, parts: headline, count: parts.length, totalText });
  const indexable = kind === 'curated';
  const crumb = kind === 'curated' ? { name: 'Gun Guides', path: GALLERY } : { name: 'Armory', path: ARMORY };

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: title, description, url: canonical,
      numberOfItems: views.length,
      itemListElement: views.map((v, i) => ({
        '@type': 'ListItem', position: i + 1, name: v.name,
        ...(v.href ? { url: SITE + v.href } : {}),
      })),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Gunforma', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: crumb.name, item: SITE + crumb.path },
        { '@type': 'ListItem', position: 3, name: title, item: canonical },
      ],
    },
  ];

  const eyebrow = kind === 'curated'
    ? 'Gunforma guide' + (theme ? ' &middot; ' + esc(theme) : '')
    : 'Armory build' + (username ? ' by @' + esc(username) : '');

  const html = '<!DOCTYPE html><html lang="en"><head>' +
    headTags({ title: docTitle, description, canonical, jsonLd, ogType: 'article',
               ogImage: og.url, ogImageMeta: og }) +
    // An Armory build is served, never submitted (loadouts-spec §7.5).
    (indexable ? '' : '<meta name="robots" content="noindex"/>') +
    '<style>' + chromeCss() + layoutCss() + guideCss() + '</style>' +
    '</head><body>' +
    navHtml({ active: 'guides' }) +
    '<div class="breadcrumb"><a href="/">Home</a> / <a href="' + crumb.path + '">' + crumb.name + '</a> / ' + esc(title) + '</div>' +
    '<div class="page">' +
      '<div class="eyebrow">' + eyebrow + '</div>' +
      '<h1>' + esc(title) + '</h1>' +
      '<div class="model">' + esc(model) + ' &middot; ' + parts.length + (parts.length === 1 ? ' part' : ' parts') + '</div>' +
      (share && share.basedOn
        ? '<div class="based-on">Based on <a href="' + esc(share.basedOn.href) + '">' + esc(share.basedOn.text) + '</a></div>'
        : '') +
      (kind === 'curated' && row.description ? '<p class="desc">' + esc(row.description) + '</p>' : '') +
      // The anonymous-save banner and the claim/export panel are the
      // OWNER's: js/armory-share.js shows them only in the browser that
      // holds this build's edit token, or to its signed-in owner. Served
      // empty, one cacheable page for everyone.
      (share ? '<div id="ash-banner" hidden></div><div id="ash-fit" role="status"></div>' : '') +
      '<div class="parts">' + views.map(partRowHtml).join('') + '</div>' +
      (totalText ? '<div class="total">Total at today’s prices: <strong>' + esc(totalText) + '</strong></div>' : '') +
      (disclosure ? '<p class="disclosure">' + esc(disclosure) + '</p>' : '') +
      '<div class="actions">' +
        (share
          ? '<button type="button" class="act" id="ash-copy" data-url="' + esc(canonical) + '">Copy link</button>' +
            '<a class="act primary" id="ash-edit" href="/gunforma-armory.html?from=' + esc(id) + '">Edit build &rarr;</a>' +
            '<button type="button" class="act" id="ash-reddit">Copy for Reddit</button>'
          : '<a class="act primary" href="/gunforma-armory.html?from=' + esc(id) + '">Customize this build in the Armory &rarr;</a>' +
            '<a class="act" href="' + GALLERY + '">More Gun Guides &rarr;</a>') +
      '</div>' +
      (share ? '<div id="ash-export" hidden></div>' : '') +
    '</div>' +
    footerHtml() +
    navScript() +
    (share
      ? '<script src="/js/category-map.js"></script>' +
        '<script src="/js/display-name.js"></script>' +
        '<script src="/js/variant-label.js"></script>' +
        '<script src="/js/maker-link.js"></script>' +
        '<script src="/js/option-price.js"></script>' +
        '<script src="/js/affiliate.js"></script>' +
        '<script src="/js/build-total.js"></script>' +
        '<script src="/js/slide-fit.js"></script>' +
        '<script src="/js/armory-fit.js"></script>' +
        '<script src="/js/armory-share.js"></script>'
      : '') +
    ANALYTICS_SNIPPET +
    '</body></html>';

  return {
    html, indexable,
    buyCount: views.filter((v) => v.buy).length,
    totalText,
    collage: !!og.collage,
  };
}

function guideCss() {
  return (
    'h1 { font-size: 27px; line-height: 1.25; margin-bottom: 6px; }' +
    '.model { font-size: 13px; color: #666; margin-bottom: 8px; }' +
    '.desc { font-size: 14px; line-height: 1.6; color: #333; margin: 10px 0; }' +
    '.parts { display: flex; flex-direction: column; gap: 10px; margin: 18px 0; }' +
    '.pr { display: flex; gap: 14px; align-items: flex-start; padding: 12px; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; }' +
    '.pr-media { flex: 0 0 96px; aspect-ratio: 4/3; background: #f4f3ee; border-radius: 5px; overflow: hidden; }' +
    '.pr-media img { width: 100%; height: 100%; object-fit: cover; display: block; }' +
    '.pr-swatch { display: block; width: 100%; height: 100%; }' +
    '.pr-main { flex: 1; min-width: 0; }' +
    '.pr-cat { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #999; font-weight: 700; }' +
    '.pr-name { font-size: 14.5px; font-weight: 700; color: #1a1a1a; line-height: 1.35; margin-top: 2px; overflow-wrap: anywhere; }' +
    '.pr-name a { color: inherit; text-decoration: none; }' +
    '.pr-name a:hover { color: #4a9edd; text-decoration: underline; }' +
    '.pr-opt { font-size: 12px; color: #888; font-weight: 500; }' +
    '.pr-disc { display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a3b12; background: #fff4ec; border: 0.5px solid #f0c9ad; border-radius: 3px; padding: 1px 6px; vertical-align: 1px; }' +
    '.pr-buy { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 8px; }' +
    '.pr-price { font-size: 14px; font-weight: 700; color: #1a1a1a; }' +
    '.pr-at { font-size: 12px; color: #888; }' +
    '.pr-at strong { color: #444; }' +
    '.pr-stock { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; padding: 2px 7px; border-radius: 20px; color: #2f7a3d; background: #eaf5ec; border: 0.5px solid #b7dcbe; }' +
    '.buy-btn { margin-left: auto; display: inline-block; padding: 7px 12px; border-radius: 6px; background: #1a1a1a; color: #fff; font-size: 12.5px; font-weight: 600; text-decoration: none; white-space: nowrap; }' +
    '.buy-btn:hover { background: #4a9edd; }' +
    '.total { font-size: 14px; color: #444; padding-top: 12px; border-top: 0.5px solid #e5e5e5; }' +
    '.total strong { font-size: 16px; color: #1a1a1a; }' +
    '.disclosure { font-size: 11.5px; color: #888; margin: 8px 0 0; line-height: 1.5; }' +
    '.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 0; }' +
    '.act { display: inline-block; padding: 9px 14px; border-radius: 6px; border: 0.5px solid #d5d3ca; color: #1a1a1a; font-size: 13px; font-weight: 600; text-decoration: none; }' +
    '.act.primary { background: #2a7bbd; border-color: #2a7bbd; color: #fff; }' +
    '.act[hidden] { display: none; }' +
    '.based-on { font-size: 12px; color: #888; margin: -2px 0 8px; }' +
    '.based-on a { color: #2a7bbd; text-decoration: none; font-weight: 700; }' +
    '.pr-fit:empty { display: none; }' +
    '.pr-fit { display: block; margin-top: 6px; }' +
    '.fit-tag { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }' +
    '.fit-tag.green { background: #e7f6ee; color: #1e7a4d; border: 0.5px solid #9edbbb; }' +
    '.fit-tag.neutral { background: #f0f1f3; color: #555; border: 0.5px solid #d9dbdf; }' +
    '.fit-tag.amber { background: #fdf3e2; color: #8a6d3b; border: 0.5px solid #f3d9a8; }' +
    '.fit-tag.red { background: #fdeae4; color: #b24a2a; border: 0.5px solid #f3bfae; }' +
    '.fit-tag.muted { background: #f4f3ee; color: #999; border: 0.5px solid #e5e2d8; }' +
    '.fit-reason { font-size: 11.5px; color: #8a6d3b; margin-left: 6px; }' +
    '#ash-fit .bar { display: flex; gap: 10px; align-items: flex-start; border-radius: 6px; padding: 10px 14px; font-size: 12.5px; border: 0.5px solid; margin: 0 0 14px; line-height: 1.5; }' +
    '#ash-fit .bar.ok { background: #e7f6ee; border-color: #9edbbb; }' +
    '#ash-fit .bar.warn { background: #fdf3e2; border-color: #f3d9a8; }' +
    '#ash-fit .bar.bad { background: #fdeae4; border-color: #f3bfae; }' +
    '#ash-fit ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }' +
    '#ash-banner .banner { background: #eaf4fc; border: 0.5px solid #a7cdec; border-radius: 6px; padding: 10px 14px; font-size: 12.5px; margin: 0 0 14px; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }' +
    '#ash-banner .banner.saved { background: #e7f6ee; border-color: #9edbbb; }' +
    '#ash-banner button { font-family: inherit; font-size: 12px; font-weight: 700; color: #fff; background: #4a9edd; border: 0.5px solid #4a9edd; border-radius: 4px; padding: 8px 14px; cursor: pointer; white-space: nowrap; }' +
    '#ash-export .panel { border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; padding: 14px; margin-top: 16px; }' +
    '#ash-export h3 { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #888; margin: 0 0 10px; }' +
    '#ash-export label { display: block; font-size: 11.5px; color: #888; margin: 8px 0 4px; }' +
    '#ash-export select, #ash-export textarea { width: 100%; font-family: inherit; font-size: 12.5px; border: 0.5px solid #d5d3ca; border-radius: 4px; padding: 8px; background: #fff; color: #1a1a1a; }' +
    '#ash-export textarea { font-family: ui-monospace, Menlo, monospace; font-size: 11px; line-height: 1.5; resize: vertical; }' +
    '#ash-export .seg { display: flex; border: 0.5px solid #d5d3ca; border-radius: 4px; overflow: hidden; margin: 8px 0; }' +
    '#ash-export .seg button { flex: 1; border: 0; background: #fff; padding: 7px; font-size: 12px; font-weight: 700; color: #888; cursor: pointer; font-family: inherit; }' +
    '#ash-export .seg button[aria-selected="true"] { background: #1a1a1a; color: #fff; }' +
    '#ash-export .copy { margin-top: 8px; width: 100%; font-family: inherit; font-size: 12.5px; font-weight: 700; color: #fff; background: #4a9edd; border: 0.5px solid #4a9edd; border-radius: 4px; padding: 9px; cursor: pointer; }'
  );
}

function pageHeaders(out, extra) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    // The build directive — an hour, no stale-while-revalidate — so an
    // unpublished or taken-down guide leaves every reader within the hour,
    // the same promise a corrected build makes (_cache.mjs).
    'Netlify-CDN-Cache-Control': CDN_CACHE_BUILD,
    'x-guide-share-index': out.indexable ? 'index' : 'noindex',
    'x-guide-share-buy': String(out.buyCount),
    'x-guide-share-priced': out.totalText || 'none',
    'x-guide-share-image': out.collage ? 'collage' : 'default',
    ...(out.indexable ? {} : { 'X-Robots-Tag': 'noindex' }),
    ...extra,
  };
}

export default async (req) => {
  // /l/<share_id> — an Armory build's share link. noindex, never in the
  // sitemap; zero rows (unknown slug, or taken down) is the 404.
  const shareId = extractShareId(req);
  if (shareId) {
    let row, variants;
    try {
      row = await fetchByShareId(shareId);
      if (!row) return notFound();
      variants = await fetchVariants(guideParts(row));
    } catch (err) {
      console.error('[guide-share] /l/ lookup failed', err);
      return unavailable();   // 503 + Retry-After, never a 404 — see _pg.mjs
    }
    const username = await fetchUsername(row.user_id);
    const basedOn = await fetchBasedOn(row.based_on_id);
    const image = await shareImageFor({ kind: 'community', row }, variants);
    const out = renderGuide({ kind: 'community', row, variants, username, image,
                              share: { shareId, basedOn } });
    return new Response(out.html, {
      status: 200,
      headers: pageHeaders(out, {
        'x-guide-share': 'community',
        'x-armory-share': 'build',
        'x-guide-share-parts': String(guideParts(row).length),
      }),
    });
  }

  const id = extractId(req);
  if (!id) return notFound();   // nothing in the path that could be a guide: no read

  let found, variants;
  try {
    found = await fetchGuide(id);
    // Zero rows from BOTH tables — the one real not-found. A failed read
    // never gets here: pgRows throws and the catch answers 503.
    if (!found) return notFound();
    variants = await fetchVariants(guideParts(found.row));
  } catch (err) {
    console.error('[guide-share] lookup failed', err);
    return unavailable();   // 503 + Retry-After, never a 404 — see _pg.mjs
  }

  // An Armory build's /gg/ link moves home: 301 to /l/<share_id> the
  // moment the column exists, so nothing shared before the migration
  // breaks and nothing keeps two live addresses after it. Gunforma guides
  // keep their /gg/ pages untouched.
  if (found.kind === 'community') {
    const share = await shareIdFor(id);
    if (share) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: SITE + '/l/' + share,
          'Netlify-CDN-Cache-Control': CDN_CACHE_BUILD,
          'x-guide-share': 'community-moved',
        },
      });
    }
  }

  const username = found.kind === 'community' ? await fetchUsername(found.row.user_id) : null;
  const image = await shareImageFor(found, variants);   // never throws: og-default.png on any failure

  const out = renderGuide({ kind: found.kind, row: found.row, variants, username, image });
  return new Response(out.html, {
    status: 200,
    headers: pageHeaders(out, {
      'x-guide-share': found.kind,
      'x-guide-share-parts': String(guideParts(found.row).length),
    }),
  });
};
