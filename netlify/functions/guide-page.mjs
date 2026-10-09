// guide-page — server-renders /fit/p365/:family/:gun — the question-answering
// fit pages ("what red dots fit a P365 XL?"), built live from the fitment
// tables so a crawler (or an AI assistant) sees a real answer with real
// prices in the initial response.
// -----------------------------------------------------------------------------
// Same conventions as product-page.mjs, this repo's server-render precedent:
// dependency-free PostgREST fetch with the public anon key, hard 404 for
// anything unresolvable, apex canonical, observability headers.
//
// WHAT IS LIVE AND WHAT IS EDITORIAL
// Products, footprints, prices, fit verdicts, counts: queried at request
// time from gun_optic_cuts → optic_cut_footprints → optic_specs, so the
// page cannot disagree with the catalog. Title, intro prose, FAQ, picks:
// _guide-content.mjs, reviewed by a human, no prices or counts allowed in
// it (scripts/check-guide-content.mjs enforces that at build time).
//
// A (family, gun) pair renders ONLY if declared in _guide-meta.mjs's
// GUIDE_PAGES *and* carrying content in _guide-content.mjs — an undeclared
// pair is a hard 404, not a thin auto-generated page. Adding a page is a
// deliberate act: registry row + content block, one commit.
//
// NAV: this is the FIFTEENTH copy of the site nav (CLAUDE.md said fourteen;
// this function makes three of them Netlify functions). A nav change now
// means changing fifteen files — update CLAUDE.md's count when sweeping.

import { GUIDE_FAMILIES, GUIDE_PAGES, guidePath, isLiveGuidePage, hubPath, isLiveGunHub } from './_guide-meta.mjs';
import { GUIDE_CONTENT } from './_guide-content.mjs';
import { navHtml, footerHtml, navScript, chromeCss, layoutCss, headTags, esc } from './_page-chrome.mjs';
import { isStalePrice, compareListingRows, displayPartnerName } from './_listing-rules.mjs';
// An optic with no partner listing links to its own products.url through
// /go/part/<id>; label and disclosure rules live in _maker-link.mjs.
import { makerLink, buyDisclosure, MAKER_REL } from './_maker-link.mjs';
import { buildPath } from './_build-url.mjs';
import { ANALYTICS_SNIPPET } from './_analytics.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';
const SITE = 'https://gunforma.com';
const PHOTO_BASE = SB_URL + '/storage/v1/object/public/build-photos/';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Human wording for gun_optic_cuts.applies_to — the SKU decoder.
const APPLIES_TO_LABEL = {
  'default':                'Standard SKUs',
  'all-current-skus':       'All current SKUs',
  'sku-sl-rxsl':            'SKUs ending in -SL or -RXSL',
  'sku-rs':                 'SKUs ending in -RS',
  'legacy-non-optic-ready': 'Older non-optic-ready SKUs',
};

// esc, the nav, the footer and the chrome CSS come from _page-chrome.mjs.

async function pgGet(path) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
  });
  if (!res.ok) throw new Error('PostgREST ' + res.status + ' for ' + path);
  return res.json();
}

// /fit/p365/<family>/<gun> — validate the WHOLE path, unlike product-page's
// last-segment extraction: /fit/anything/red-dots/p365-xl must 404, not
// answer 200 under a wrong URL.
function extractRoute(req) {
  const url = new URL(req.url);
  const splat = url.searchParams.get('splat');
  const path = splat ? '/fit/' + splat.replace(/^\/+/, '') : url.pathname;
  const m = path.match(/^\/fit\/p365\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  const family = decodeURIComponent(m[1]);
  const gun = decodeURIComponent(m[2]);
  if (!SLUG_RE.test(family) || !SLUG_RE.test(gun)) return null;
  return { family, gun };
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
    '<div class="s">' + esc(detail || 'No fit guide at this address.') + '</div>' +
    '<a href="' + SITE + '/parts">Browse parts by category &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

async function fetchGun(gunSlug) {
  const rows = await pgGet('guns?slug=eq.' + encodeURIComponent(gunSlug) +
    '&select=' + encodeURIComponent('id,slug,name,housing_class,slide_length_in,barrel_length_in,integrated_comp,oem_capacity') + '&limit=1');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchCuts(gunId) {
  const cuts = await pgGet('gun_optic_cuts?gun_id=eq.' + gunId +
    '&select=' + encodeURIComponent('optic_cut,applies_to,confidence,source_url,notes') +
    '&order=applies_to.asc');
  if (!cuts.length) return { cuts: [], vocab: {} };
  const names = [...new Set(cuts.map((c) => c.optic_cut))];
  const vocabRows = await pgGet('optic_cuts?optic_cut=in.(' + names.map(encodeURIComponent).join(',') + ')' +
    '&select=' + encodeURIComponent('optic_cut,display_name,mounting,notes'));
  const vocab = Object.fromEntries(vocabRows.map((v) => [v.optic_cut, v]));
  return { cuts, vocab };
}

async function fetchFitOptics(cutNames) {
  const mountable = cutNames.filter((c) => c !== 'none');
  if (!mountable.length) return { footprints: [], optics: [] };
  const maps = await pgGet('optic_cut_footprints?optic_cut=in.(' + mountable.map(encodeURIComponent).join(',') + ')' +
    '&select=' + encodeURIComponent('optic_cut,fit,footprint_id,footprints(slug,common_name)'));
  const byFootprint = new Map();
  for (const m of maps) {
    const prev = byFootprint.get(m.footprint_id);
    // 'direct' beats 'via-plate' when several cuts reach one footprint.
    if (!prev || (prev.fit !== 'direct' && m.fit === 'direct')) byFootprint.set(m.footprint_id, m);
  }
  const fpIds = [...byFootprint.keys()];
  if (!fpIds.length) return { footprints: [], optics: [] };

  // optic_specs carries TWO FKs to products (optic_specs_product_id_fkey and
  // a legacy optic_specs_product_fkey on the same column), so the products
  // embed MUST name the FK or the whole query dies with PGRST201 — see
  // CLAUDE.md. Same rule again one level down for product_variants — and for
  // footprints, where the ambiguity is subtler: optic_specs reaches
  // footprints BOTH by its direct FK and many-to-many through
  // optic_adapter_footprints, so the bare embed is a PGRST300/201 the
  // moment optic_adapter_footprints exists. Found on the wire, not in
  // review — check-embeds.sh does not cover this pair.
  const cols =
    'footprint_id,optic_type,reticle,dot_size_moa,window_size,battery_life,enclosed_emitter,shake_awake,solar_power,' +
    'footprints!optic_specs_footprint_id_fkey(slug,common_name),' +
    'products!optic_specs_product_id_fkey(id,slug,name,url,fitment_confidence,is_discontinued,' +
      'manufacturers!products_brand_id_fkey(name,website_url),' +
      'product_variants!product_variants_product_id_fkey(id,msrp,is_default,primary_image_url,' +
        'affiliate_links(id,url,affiliate_url,street_price,in_stock,last_checked,op_last_matched_by,partners(name))))';
  const retiredFilters =
    '&products.product_variants.retired_at=is.null' +
    '&products.product_variants.affiliate_links.retired_at=is.null';
  const rows = await pgGet('optic_specs?footprint_id=in.(' + fpIds.join(',') + ')' +
    '&select=' + encodeURIComponent(cols) + retiredFilters);

  const optics = [];
  for (const r of rows) {
    const p = r.products;
    if (!p || !p.slug || p.is_discontinued) continue;
    const mapping = byFootprint.get(r.footprint_id);
    // Flatten every live listing, choose the hero with the shared rules —
    // the price shown and the button's destination stay the same row.
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
    const hero = listings[0] || null;
    const msrp = (() => {
      const dv = (p.product_variants || []).find((v) => v.is_default) || (p.product_variants || [])[0];
      return dv && dv.msrp != null ? Number(dv.msrp) : null;
    })();
    // The default variant's photo, or any variant's — every optic in the
    // catalog has one today, but a product without one renders text-only
    // rather than a broken image.
    const photo = (() => {
      const dv = (p.product_variants || []).find((v) => v.is_default && v.primary_image_url) ||
                 (p.product_variants || []).find((v) => v.primary_image_url);
      return dv ? dv.primary_image_url : null;
    })();
    optics.push({
      photo,
      spec: r,
      slug: p.slug,
      name: p.name,
      brand: p.manufacturers ? p.manufacturers.name : null,
      fitmentConfidence: p.fitment_confidence,
      footprintName: (r.footprints && r.footprints.common_name) || (r.footprints && r.footprints.slug) || '',
      mountFit: mapping ? mapping.fit : null,
      hero, msrp,
      productId: p.id,
      // The unpaid fallback for the buy cell. Null when products.url is
      // empty or not http(s), and the cell stays "No listing yet".
      maker: makerLink(p.url, p.manufacturers ? p.manufacturers.name : null,
                       p.manufacturers ? p.manufacturers.website_url : null),
    });
  }
  // Fresh-priced first (ascending), then the rest alphabetically — a reader
  // scanning for "cheapest that fits" gets the true answer at the top.
  optics.sort((a, b) => {
    const af = a.hero && !a.hero.stale && a.hero.price != null;
    const bf = b.hero && !b.hero.stale && b.hero.price != null;
    if (af !== bf) return af ? -1 : 1;
    if (af && bf && a.hero.price !== b.hero.price) return a.hero.price - b.hero.price;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return { footprints: fpIds, optics };
}

// Approved builds whose parts_snapshot names any product on the page.
// 7 approved builds exist today, so fetch-and-filter beats 15 cs.[] ORs;
// revisit if approved builds outgrow one page.
async function fetchBuildsUsing(productIds) {
  const rows = await pgGet('builds?status=eq.approved' +
    '&select=' + encodeURIComponent('id,name,parts_snapshot,profiles!builds_user_id_fkey(username),build_photos(storage_path,is_hero,position)') +
    '&order=updated_at.desc&limit=100');
  const idSet = new Set(productIds);
  const out = [];
  for (const b of rows) {
    const snap = Array.isArray(b.parts_snapshot) ? b.parts_snapshot : [];
    if (!snap.some((part) => part && idSet.has(part.refId))) continue;
    const photos = (b.build_photos || []).slice().sort((x, y) => (y.is_hero === true) - (x.is_hero === true) || (x.position ?? 9) - (y.position ?? 9));
    out.push({
      id: b.id, name: b.name,
      owner: b.profiles ? b.profiles.username : null,
      photo: photos.length && photos[0].storage_path ? PHOTO_BASE + photos[0].storage_path : null,
    });
    if (out.length === 3) break;
  }
  return out;
}

// The reticle column. optic_specs.reticle is prose that can carry a
// multi-reticle truth ("2 MOA Dot & 32 MOA Circle (MRS)") that a single
// dot_size_moa number cannot — the 507K X2 has no single MOA value, and
// rendering one would be wrong, not incomplete. dot_size_moa is only the
// fallback for a row whose reticle text is missing.
function reticleCell(o) {
  if (o.spec.reticle) return esc(o.spec.reticle);
  if (o.spec.dot_size_moa != null) return esc(o.spec.dot_size_moa) + ' MOA';
  return '—';
}

function priceCell(o) {
  if (o.hero && o.hero.price != null && !o.hero.stale) return '$' + o.hero.price.toFixed(2);
  if (o.hero) return 'Check price';
  return o.msrp != null ? 'MSRP $' + o.msrp.toFixed(2) : 'Check price';
}

// A partner listing first (sponsored, /go/<link>); otherwise the optic's own
// store (not sponsored — nobody pays for it — /go/part/<product>); otherwise
// the non-link state, for the rare optic with no url saved.
function hasPartnerLink(o) { return !!(o.hero && o.hero.url); }
function hasMakerLink(o)   { return !hasPartnerLink(o) && !!o.maker; }

function buyCell(o) {
  if (hasPartnerLink(o)) {
    const label = o.hero.partnerName ? 'Buy at ' + esc(o.hero.partnerName) : 'View listing';
    return '<a class="buy-btn" href="' + esc(o.hero.goUrl) + '" target="_blank" rel="noopener sponsored nofollow">' + label + ' ↗</a>';
  }
  if (hasMakerLink(o)) {
    return '<a class="buy-btn" href="/go/part/' + esc(o.productId) + '" target="_blank" rel="' + MAKER_REL + '">' + esc(o.maker.label) + ' ↗</a>';
  }
  return '<span class="buy-btn disabled">No listing yet</span>';
}

// The line under the table. The first sentence is about the prices and
// stays; the second says what is true of the buttons above it — partner,
// maker, both — and is absent when there is no button at all.
function tableDisclosure(optics) {
  const second = buyDisclosure(optics.some(hasPartnerLink), optics.some(hasMakerLink));
  return 'Prices update from retailer feeds; a listing we could not verify in the last 7 days shows &ldquo;Check price&rdquo;.' +
    (second ? ' ' + esc(second) : '');
}

function renderPage({ family, familyMeta, gun, content, cuts, vocab, optics, builds, updated }) {
  const gunName = gun.name;
  const canonical = SITE + guidePath(family, gun.slug);
  const freshPriced = optics.filter((o) => o.hero && o.hero.price != null && !o.hero.stale);
  const enclosed = optics.filter((o) => o.spec.enclosed_emitter === true);
  const cheapest = freshPriced[0] || null;
  const likelyCuts = cuts.filter((c) => c.confidence === 'likely');
  const noneCut = cuts.find((c) => c.optic_cut === 'none');

  // The answer, first sentence, computed so it cannot rot.
  const cutNames = [...new Set(cuts.filter((c) => c.optic_cut !== 'none').map((c) => (vocab[c.optic_cut] || {}).display_name || c.optic_cut))];
  const lead = String(optics.length) + ' red dots in our database fit the Sig Sauer ' + gunName +
    ' directly, on its factory ' + cutNames.join(' / ') + ' optic cut.';

  const takeaways = [
    ...content.staticTakeaways,
    optics.length + ' optics fit the ' + gunName + ' as a direct mount; ' + freshPriced.length +
      ' of them have live, feed-verified prices today.',
    ...(cheapest ? ['The least expensive with a verified price right now is the ' + cheapest.name +
      ' at $' + cheapest.hero.price.toFixed(2) + '.'] : []),
    ...(enclosed.length ? [String(enclosed.length) + ' of the fitting optics are enclosed-emitter designs, including the ' +
      enclosed[0].name + '.'] : []),
  ];

  const tableRows = optics.map((o) => {
    const productHref = '/parts/' + familyMeta.categorySegment + '/' + o.slug;
    return '<tr>' +
      '<td><div class="t-optic">' +
        (o.photo ? '<img class="t-photo" src="' + esc(o.photo) + '" alt="' + esc(o.name) + '" loading="lazy" width="44" height="44"/>' : '') +
        '<div><a href="' + esc(productHref) + '">' + esc(o.name) + '</a>' +
        (o.brand ? '<span class="t-brand">' + esc(o.brand) + '</span>' : '') + '</div></div></td>' +
      '<td>' + esc(o.footprintName) + (o.mountFit === 'direct' ? '' : ' (plate)') + '</td>' +
      '<td>' + reticleCell(o) + '</td>' +
      '<td>' + (o.spec.window_size ? esc(o.spec.window_size) : '—') + '</td>' +
      '<td>' + (o.spec.battery_life ? esc(o.spec.battery_life) : '—') + '</td>' +
      '<td class="t-price">' + priceCell(o) + '</td>' +
      '<td>' + buyCell(o) + '</td>' +
    '</tr>';
  }).join('');

  const decoderRows = cuts.map((c) => {
    const v = vocab[c.optic_cut] || {};
    const cutLabel = c.optic_cut === 'none' ? 'No optic cut' : (v.display_name || c.optic_cut);
    return '<div class="spec-row"><span class="spec-label">' + esc(APPLIES_TO_LABEL[c.applies_to] || c.applies_to) + '</span>' +
      '<span class="spec-value">' + esc(cutLabel) + (c.confidence === 'likely' ? ' <em class="likely">(likely)</em>' : '') + '</span></div>';
  }).join('');

  const picks = content.picks
    .map((pick) => ({ pick, o: optics.find((o) => o.slug === pick.slug) }))
    .filter((x) => x.o);
  const picksHtml = picks.map(({ pick, o }) =>
    '<div class="pick-card">' +
      (o.photo ? '<img class="pick-photo" src="' + esc(o.photo) + '" alt="' + esc(o.name) + '" loading="lazy"/>' : '') +
      '<div class="pick-name"><a href="/parts/' + esc(familyMeta.categorySegment) + '/' + esc(o.slug) + '">' + esc(o.name) + '</a></div>' +
      (o.brand ? '<div class="pick-brand">' + esc(o.brand) + '</div>' : '') +
      '<div class="pick-why">' + esc(pick.why) + '</div>' +
      '<div class="pick-meta">' +
        (o.spec.reticle ? esc(o.spec.reticle) + ' · ' : '') +
        (o.spec.enclosed_emitter ? 'Enclosed emitter · ' : '') +
        '<strong>' + priceCell(o) + '</strong></div>' +
      buyCell(o) +
    '</div>').join('');

  const buildsHtml = builds.length
    ? '<div class="section-title">Used in these builds</div><div class="builds-row">' +
      builds.map((b) =>
        '<a class="build-card" href="' + esc(buildPath(b.id, b.name)) + '">' +
          (b.photo ? '<img src="' + esc(b.photo) + '" alt="' + esc(b.name) + '" loading="lazy"/>' : '') +
          '<span class="build-name">' + esc(b.name) + '</span>' +
          (b.owner ? '<span class="build-owner">by ' + esc(b.owner) + '</span>' : '') +
        '</a>').join('') + '</div>'
    : '';

  const faqHtml = content.faq.map((f) =>
    '<h3>' + esc(f.q) + '</h3><p>' + esc(f.a) + '</p>').join('');

  const likelyNote = likelyCuts.length
    ? '<div class="desc" style="color:#7a6a2f"><strong>Note:</strong> the ' +
      likelyCuts.map((c) => esc(APPLIES_TO_LABEL[c.applies_to] || c.applies_to)).join(', ') +
      ' cut is marked <em>likely</em> — Sig’s own published specs are inconsistent for those SKUs, so verify on your slide before buying a SIG-LOC-only optic.</div>'
    : '';

  const noneNote = noneCut
    ? '<div class="desc"><strong>' + esc(APPLIES_TO_LABEL[noneCut.applies_to] || noneCut.applies_to) + ':</strong> ' +
      'some older ' + esc(gunName) + ' SKUs shipped with no optic cut at all — those need a milled or replacement slide before any of this applies.</div>'
    : '';

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: content.title,
      author: { '@type': 'Person', name: content.author.name },
      datePublished: updated, dateModified: updated,
      mainEntityOfPage: canonical,
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: content.faq.map((f) => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Gunforma', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Parts', item: SITE + '/parts' },
        { '@type': 'ListItem', position: 3, name: familyMeta.label + ' for the ' + gunName, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: optics.map((o, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': 'Product', name: o.name,
          url: SITE + '/parts/' + familyMeta.categorySegment + '/' + o.slug,
          ...(o.photo ? { image: o.photo } : {}),
          ...(o.brand ? { brand: { '@type': 'Brand', name: o.brand } } : {}),
          // Offer only when the price is feed-verified — a stale number
          // asserts something we cannot support (CLAUDE.md, "Prices we can
          // stand behind").
          ...(o.hero && o.hero.price != null && !o.hero.stale ? {
            offers: {
              '@type': 'Offer', price: o.hero.price.toFixed(2), priceCurrency: 'USD',
              url: SITE + '/parts/' + familyMeta.categorySegment + '/' + o.slug,
              ...(o.hero.in_stock === true ? { availability: 'https://schema.org/InStock' }
                : o.hero.in_stock === false ? { availability: 'https://schema.org/OutOfStock' } : {}),
            },
          } : {}),
        },
      })),
    },
  ];

  return '<!DOCTYPE html><html lang="en"><head>' +
  headTags({ title: content.title, description: content.metaDescription,
             canonical, jsonLd, ogImage: SITE + '/og-default.png' }) +
'<style>' +
  chromeCss() +
  layoutCss() +
'h1 { font-size: 27px; line-height: 1.25; margin-bottom: 12px; }' +
'h2 { font-size: 19px; margin: 30px 0 10px; }' +
'h3 { font-size: 15px; margin: 20px 0 6px; }' +
'p { font-size: 14px; line-height: 1.65; color: #333; margin-bottom: 10px; }' +
'.desc { font-size: 14px; line-height: 1.6; color: #333; margin: 10px 0; }' +
'.takeaways { border: 0.5px solid #dfe5ea; background: #f2f6f9; border-radius: 8px; padding: 14px 18px; margin: 16px 0 6px; }' +
'.takeaways .tk-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #345; margin-bottom: 8px; }' +
'.takeaways li { font-size: 13.5px; line-height: 1.55; color: #234; margin: 0 0 6px 18px; }' +
'.table-wrap { overflow-x: auto; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; margin: 12px 0; }' +
'table { border-collapse: collapse; width: 100%; min-width: 720px; font-size: 13px; }' +
'th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #667; padding: 10px 12px; border-bottom: 1px solid #e5e5e5; background: #fbfbfa; }' +
'td { padding: 10px 12px; border-bottom: 0.5px solid #efefec; vertical-align: middle; }' +
'td a { color: #1a1a1a; font-weight: 600; text-decoration: none; } td a:hover { color: #4a9edd; }' +
'.t-brand { display: block; font-size: 11px; color: #888; font-weight: 400; }' +
'.t-optic { display: flex; align-items: center; gap: 10px; }' +
'.t-photo { width: 44px; height: 44px; object-fit: contain; border-radius: 6px; border: 0.5px solid #ececec; background: #fff; flex: none; }' +
'.pick-photo { width: 100%; aspect-ratio: 4/3; object-fit: contain; border-radius: 6px; border: 0.5px solid #ececec; background: #fff; }' +
'.t-price { font-weight: 700; white-space: nowrap; }' +
'.buy-btn { font-size: 12px; font-weight: 700; color: #fff; background: #4a9edd; padding: 7px 12px; border-radius: 6px; text-decoration: none; white-space: nowrap; }' +
'.buy-btn.disabled { background: #ddd; color: #888; }' +
'.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 26px 0 10px; }' +
'.spec-row { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 0; border-bottom: 0.5px solid #ececec; max-width: 560px; }' +
'.spec-label { color: #777; } .spec-value { font-weight: 600; } .likely { color: #7a6a2f; font-style: normal; font-size: 11px; }' +
'.picks { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }' +
'.pick-card { border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; padding: 14px; display: flex; flex-direction: column; gap: 6px; }' +
'.pick-name a { font-size: 14px; font-weight: 700; color: #1a1a1a; text-decoration: none; }' +
'.pick-brand { font-size: 11px; color: #888; }' +
'.pick-why { font-size: 12.5px; line-height: 1.5; color: #444; }' +
'.pick-meta { font-size: 12px; color: #555; margin-top: auto; }' +
'.builds-row { display: flex; gap: 12px; flex-wrap: wrap; }' +
'.build-card { display: flex; flex-direction: column; gap: 4px; width: 180px; text-decoration: none; color: #1a1a1a; }' +
'.build-card img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 6px; border: 0.5px solid #e5e5e5; }' +
'.build-name { font-size: 13px; font-weight: 600; } .build-owner { font-size: 11px; color: #888; }' +
'.author { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; color: #666; border-top: 0.5px solid #e5e5e5; margin-top: 30px; padding-top: 14px; }' +
'.related a { display: inline-block; margin-right: 14px; font-size: 13px; color: #4a9edd; text-decoration: none; }' +
'.disclosure { font-size: 11px; color: #999; margin-top: 10px; font-style: italic; }' +
'</style>' +
'</head><body>' +
  navHtml() +
// The link UP to the gun's hub — the other half of "links in both
// directions". The hub links down to every fit page it declares; without
// this, a reader who lands here from search has no route to the rest of
// the P365 cluster. Only when the hub is declared live, so a fit page can
// never emit a dead /p365/ URL. check-routes.mjs asserts it on the wire.
'<div class="breadcrumb"><a href="/">Home</a> / ' +
  (isLiveGunHub(gun.slug)
    ? '<a href="' + esc(hubPath(gun.slug)) + '">Sig Sauer ' + esc(gunName) + '</a>'
    : '<a href="/parts">Parts</a>') +
  ' / ' + esc(familyMeta.label) + ' for the ' + esc(gunName) + '</div>' +
'<div class="page">' +
  '<div class="eyebrow">Fit guide &middot; Sig Sauer ' + esc(gunName) + '</div>' +
  '<h1>' + esc(familyMeta.label) + ' That Fit the Sig Sauer ' + esc(gunName) + '</h1>' +
  '<p>' + esc(lead) + ' ' + esc(content.introAfter) + '</p>' +
  '<div class="takeaways"><div class="tk-title">Key takeaways</div><ul>' +
    takeaways.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' +
  likelyNote + noneNote +
  '<h2>Every red dot that fits the ' + esc(gunName) + '</h2>' +
  '<div class="table-wrap"><table><thead><tr>' +
    '<th>Optic</th><th>Footprint</th><th>Reticle</th><th>Window</th><th>Battery life</th><th>Price</th><th></th>' +
  '</tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
  '<div class="disclosure">' + tableDisclosure(optics) + '</div>' +
  '<h2>Which optic cut does my ' + esc(gunName) + ' have?</h2>' +
  decoderRows +
  (picks.length ? '<h2>Top picks</h2><div class="picks">' + picksHtml + '</div>' : '') +
  buildsHtml +
  '<h2>Frequently asked</h2>' + faqHtml +
  '<div class="related"><div class="section-title">Related</div>' +
    (isLiveGunHub(gun.slug)
      ? '<a href="' + esc(hubPath(gun.slug)) + '">Everything for the Sig Sauer ' + esc(gunName) + ' &rarr;</a>'
      : '') +
    '<a href="/parts/' + esc(familyMeta.categorySegment) + '">All P365 ' + esc(familyMeta.label.toLowerCase()) + ' &rarr;</a>' +
    '<a href="/parts">Parts by category &rarr;</a>' +
    '<a href="/gunforma-builds.html">Real builds &rarr;</a>' +
  '</div>' +
  '<div class="author"><strong>' + esc(content.author.name) + '</strong>' +
    (content.author.credential ? '<span>' + esc(content.author.credential) + '</span>' : '') +
    '<span>Last reviewed ' + esc(updated) + '</span></div>' +
'</div>' +
  footerHtml() +
// Same dependency-free hamburger as product-page.mjs, same reason: this page
// ships no client JS, so without it the nav is unreachable below 820px.
  // navScript() is that inline toggle, byte for byte, now shared with
  // gun-hub.mjs through _page-chrome.mjs. The analytics tag closes the
  // document, as on every HTML-emitting function.
  navScript() + ANALYTICS_SNIPPET + '</body></html>';
}

export default async (req) => {
  const route = extractRoute(req);
  if (!route) return notFound();
  const { family, gun: gunSlug } = route;

  const familyMeta = GUIDE_FAMILIES[family];
  const content = GUIDE_CONTENT[family] && GUIDE_CONTENT[family][gunSlug];
  if (!familyMeta || !content || !isLiveGuidePage(family, gunSlug)) {
    return notFound('No fit guide at this address yet.');
  }
  const updated = GUIDE_PAGES.find((p) => p.family === family && p.gun === gunSlug).updated;

  let gun, cutsRes, fitRes, builds;
  try {
    gun = await fetchGun(gunSlug);
    if (!gun) return notFound('Unknown pistol model.');
    cutsRes = await fetchCuts(gun.id);
    if (!cutsRes.cuts.length) {
      // A declared page whose gun has no cut data is a data regression, not
      // a thin page to ship — refuse loudly rather than render a guess.
      console.error('[guide-page] no gun_optic_cuts rows for ' + gunSlug);
      return new Response('Temporarily unavailable — try again shortly.', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    fitRes = await fetchFitOptics([...new Set(cutsRes.cuts.map((c) => c.optic_cut))]);
    builds = await fetchBuildsUsing(fitRes.optics.map((o) => o.productId));
  } catch (err) {
    console.error('[guide-page] lookup failed', err);
    return new Response('Temporarily unavailable — try again shortly.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const html = renderPage({
    family, familyMeta, gun, content,
    cuts: cutsRes.cuts, vocab: cutsRes.vocab,
    optics: fitRes.optics, builds, updated,
  });
  const fresh = fitRes.optics.filter((o) => o.hero && o.hero.price != null && !o.hero.stale).length;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
      // Observability, same idea as build-og's x-build-og-* headers: the
      // page's inputs readable from outside, so check-routes prints facts.
      'x-guide-gun': gunSlug,
      'x-guide-optics': String(fitRes.optics.length),
      'x-guide-fresh-priced': String(fresh),
    },
  });
};
