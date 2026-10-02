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
  GUN_HUBS, GUN_META, GUIDE_FAMILIES, HUB_INDEX_PATH,
  hubPath, isLiveGunHub, guidePagesForGun, guidePath,
} from './_guide-meta.mjs';
import { navHtml, footerHtml, navScript, chromeCss, layoutCss, headTags, esc } from './_page-chrome.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';
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

async function pgGet(path) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
  });
  if (!res.ok) throw new Error('PostgREST ' + res.status + ' for ' + path);
  return res.json();
}

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
    '<a href="' + SITE + HUB_INDEX_PATH + '">See the P365 models we cover &rarr;</a></div></body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

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

// ── the model hub ─────────────────────────────────────────────────────────
function renderHub({ hub, gun, cuts, vocab, guides }) {
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
  ];

  return '<!DOCTYPE html><html lang="en"><head>' +
    headTags({ title, description, canonical, jsonLd, ogType: 'website',
               ogImage: SITE + '/og-default.png' }) +
    '<style>' + chromeCss() + layoutCss() + hubCss() + '</style>' +
    '</head><body>' +
    navHtml() +
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

      '<h2>Browse parts</h2>' +
      '<div class="links">' +
        '<a href="/parts">Parts by category &rarr;</a>' +
        '<a href="/gunforma-builds.html">Real builds &rarr;</a>' +
        '<a href="' + esc(HUB_INDEX_PATH) + '">Other P365 models &rarr;</a>' +
      '</div>' +
      '<div class="author"><span>Last reviewed ' + esc(hub.updated) + '</span></div>' +
    '</div>' +
    footerHtml() +
    navScript() +
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
    navHtml() +
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
    navScript() +
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
    '.author { margin-top: 26px; padding-top: 14px; border-top: 0.5px solid #e5e5e5; font-size: 12px; color: #888; }'
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
    return unavailable();
  }

  const guides = guidePagesForGun(route.gun);
  const html = renderHub({ hub, gun, cuts: cutsRes.cuts, vocab: cutsRes.vocab, guides });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
      // Observability, same as guide-page's x-guide-* headers.
      'x-gun-hub': route.gun,
      'x-gun-hub-guides': String(guides.length),
      'x-gun-hub-cuts': String(cutsRes.cuts.length),
    },
  });
};
