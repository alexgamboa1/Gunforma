// product-page — server-renders /parts/:category/:slug so crawlers (and
// anyone whose JS hasn't run yet) see real product content instead of the
// "Loading parts…" shell gunforma-parts-catalog.html shows before Supabase
// resolves client-side.
// -----------------------------------------------------------------------------
// Unlike profile-og, this does not inject meta into an existing client page —
// there's no per-product HTML file to inject into, and the catalog page's
// shell is built for browsing 231 products at once, not for being one
// product's canonical document. This renders a small, self-contained page:
// real body content in the initial response, not just <head> meta.
//
// Same conventions as profile-og.mjs on purpose (dependency-free PostgREST
// fetch with the public anon key, path-then-header slug extraction, genuine
// 404 for a bad slug so soft-404s don't get indexed) — that function is this
// repo's one working server-render precedent, so this one follows its shape
// rather than inventing a second pattern.
//
// The variant-label logic below duplicates a small slice of js/affiliate.js's
// VARIANT_AXES on purpose rather than importing it: affiliate.js is browser
// JS (DOM-free itself, but shipped and tested as a <script> global, not a
// module) and its label logic is explicitly settled/do-not-refactor per the
// project docs. This is a separate, server-side computation of the same
// affiliate_links + product_variants rows, so a future edit to affiliate.js's
// axis list won't need to touch this file, but also won't automatically be
// picked up here — worth a comment update on both sides if that list changes.
// -----------------------------------------------------------------------------

// category -> [URL segment, display label]. Shared with parts-index.mjs via
// _category-meta.mjs rather than hand-copied — see that file's header for
// why this pair of functions doesn't need the browser-vs-ESM duplication
// that js/category-map.js still requires.
import { CATEGORY_META } from './_category-meta.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE = 'https://gunforma.com';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// category -> [spec table, [ [column, label, formatter?], ... ] ]
// Columns/tables taken from the live schema (see `products`' FK list) — not
// guessed. slide_plate has no dedicated spec table in the schema, so it gets
// no extra spec rows beyond the common product fields.
const YESNO = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);
const SPEC_TABLES = {
  barrel: ['barrel_specs', [
    ['barrel_length_in', 'Barrel Length', (v) => v + '"'],
    ['caliber', 'Caliber'],
    ['barrel_type', 'Type'],
    ['thread_pitch', 'Thread Pitch'],
    ['port_style', 'Port Style'],
    ['is_lci', 'Loaded Chamber Indicator', YESNO],
  ]],
  slide: ['slide_specs', [
    ['slide_length_in', 'Slide Length', (v) => v + '"'],
    ['barrel_length_in', 'Barrel Length', (v) => v + '"'],
    ['comes_with_sights', 'Comes With Sights', YESNO],
    ['barrel_included', 'Barrel Included', YESNO],
    ['window_cuts', 'Window Cuts', YESNO],
    ['internally_ported', 'Internally Ported', YESNO],
    ['port_style', 'Port Style'],
    ['integrated_comp', 'Integrated Compensator', YESNO],
    ['threaded_barrel_ok', 'Fits Threaded Barrel', YESNO],
    ['required_spring_weight', 'Required Spring Weight'],
  ]],
  frame: ['frame_specs', [
    ['housing_class', 'Housing Class'],
    ['frame_material', 'Material'],
    ['has_rail', 'Accessory Rail', YESNO],
    ['grip_rail_type', 'Rail Type'],
    ['has_beaver_tail', 'Beavertail', YESNO],
    ['undercut_trigger_guard', 'Undercut Trigger Guard', YESNO],
    ['palm_swell', 'Palm Swell', YESNO],
    ['magwell_type', 'Magwell Type'],
    ['grip_texture', 'Grip Texture'],
    ['finger_grooves', 'Finger Grooves', YESNO],
    ['thumb_rest', 'Thumb Rest', YESNO],
  ]],
  trigger: ['trigger_specs', [
    ['profile', 'Profile'],
    ['pull_weight_text', 'Pull Weight'],
    ['pull_weight_lb', 'Pull Weight (lb)'],
    ['adjustable', 'Adjustable', YESNO],
    ['adjustment_type', 'Adjustment Type'],
    ['safety_type', 'Safety Type'],
    ['drop_in', 'Drop-In', YESNO],
  ]],
  compensator: ['compensator_specs', [
    ['caliber', 'Caliber'],
    ['mounting_type', 'Mounting Type'],
    ['requires_threaded_barrel', 'Requires Threaded Barrel', YESNO],
    ['thread_pitch', 'Thread Pitch'],
    ['comes_with_barrel', 'Comes With Barrel', YESNO],
    ['included_barrel', 'Included Barrel'],
    ['port_design', 'Port Design'],
    ['muzzle_flip_reduction', 'Muzzle Flip Reduction'],
    ['length_in', 'Length', (v) => v + '"'],
  ]],
  light: ['light_specs', [
    ['series', 'Series'],
    ['mount_system', 'Mount System'],
    ['lumens_max', 'Max Lumens'],
    ['candela_max', 'Max Candela'],
    ['beam_type', 'Beam Type'],
    ['has_laser', 'Laser', YESNO],
    ['laser_color', 'Laser Color'],
    ['rechargeable', 'Rechargeable', YESNO],
    ['ipx_rating', 'IPX Rating'],
    ['has_strobe', 'Strobe', YESNO],
    ['has_infrared', 'Infrared', YESNO],
    ['battery_type', 'Battery Type'],
  ]],
  optic: ['optic_specs', [
    ['optic_type', 'Optic Type'],
    ['mount_height', 'Mount Height'],
    ['reticle', 'Reticle'],
    ['dot_size_moa', 'Dot Size', (v) => v + ' MOA'],
    ['magnification', 'Magnification'],
    ['window_size', 'Window Size'],
    ['emitter', 'Emitter'],
    ['enclosed_emitter', 'Enclosed Emitter', YESNO],
    ['battery_type', 'Battery Type'],
    ['battery_life', 'Battery Life'],
    ['solar_power', 'Solar Power', YESNO],
    ['housing_material', 'Housing Material'],
  ]],
  mag_release: ['mag_release_specs', [
    ['caliber', 'Caliber'],
    ['style', 'Style'],
    ['texture', 'Texture'],
    ['material', 'Material'],
    ['length_added_in', 'Length Added', (v) => v + '"'],
  ]],
  magwell: ['magwell_specs', [
    ['attachment_method', 'Attachment Method'],
    ['is_combo', 'Combo (Magwell + Basepad)', YESNO],
    ['includes_hardware', 'Includes Hardware', YESNO],
  ]],
  basepad: ['basepad_specs', [
    ['basepad_type', 'Basepad Type'],
    ['fits_mag_type', 'Fits Magazine Type'],
    ['capacity_change', 'Capacity Change', (v) => (v > 0 ? '+' + v : String(v))],
  ]],
  slide_release: ['slide_release_specs', [
    ['texture', 'Texture'],
    ['uses_oem_spring', 'Uses OEM Spring', YESNO],
  ]],
  safety_selector: ['safety_selector_specs', [
    ['is_ambidextrous', 'Ambidextrous', YESNO],
    ['includes_detent_spring', 'Includes Detent Spring', YESNO],
    ['kit_contents', 'Kit Contents'],
  ]],
  takedown_lever: ['takedown_lever_specs', [
    ['takedown_type', 'Type'],
    ['has_thumb_rest', 'Thumb Rest', YESNO],
    ['optic_compatibility_notes', 'Optic Compatibility'],
  ]],
};

// Small subset of js/affiliate.js's VARIANT_AXES — see file header.
const VARIANT_AXES = [
  { key: 'reticle',               label: 'Reticle'       },
  { key: 'reticle_color',         label: 'Reticle Color' },
  { key: 'color',                 label: 'Color'         },
  { key: 'finish',                label: 'Finish'        },
  { key: 'optic_cut',             label: 'Optic Cut'     },
  { key: 'bundle',                label: 'Bundle'        },
  { key: 'clamp_style',           label: 'Clamp'         },
  { key: 'manual_safety_variant', label: 'Manual Safety' },
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function extractAxes(v) {
  return {
    reticle: v.reticle || null,
    reticle_color: v.reticle_color || null,
    color: v.color || null,
    finish: v.finish || null,
    optic_cut: v.optic_cut || null,
    bundle: v.bundle || null,
    clamp_style: v.clamp_style || null,
    manual_safety_variant: v.manual_safety_variant === true ? 'Yes'
                          : v.manual_safety_variant === false ? 'No' : null,
  };
}

function computeActiveAxes(variants, isOptic) {
  return VARIANT_AXES.filter((axis) => {
    const seen = new Set(variants.map((v) => v.axes[axis.key]));
    if (axis.key === 'reticle' && isOptic && variants.some((v) => v.axes.reticle)) return true;
    return seen.size > 1;
  });
}

function variantLabel(v, activeAxes) {
  if (typeof v.variant_label === 'string' && v.variant_label.trim()) return v.variant_label.trim();
  if (!activeAxes.length) return 'Standard';
  return activeAxes.map((a) => v.axes[a.key] || '—').join(' / ');
}

function displayPartnerName(name) {
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

// Reads slug the same defensive way profile-og reads username: query param
// first (works under netlify dev), then the rewritten pathname, then
// x-nf-original-path (what production actually carries — see profile-og's
// comment on why a single mechanism isn't trustworthy).
function extractSlug(req) {
  const url = new URL(req.url);
  const fromSplat = url.searchParams.get('splat');
  if (fromSplat) return fromSplat.split('/').filter(Boolean).pop();

  const fromPath = url.pathname.match(/^\/parts\/[^/]+\/([^/]+)\/?$/);
  if (fromPath) return decodeURIComponent(fromPath[1]);

  const original = req.headers.get('x-nf-original-path') || '';
  const fromHeader = original.match(/^\/parts\/[^/]+\/([^/?#]+)/);
  if (fromHeader) return decodeURIComponent(fromHeader[1]);

  return '';
}

function notFound(slug) {
  const s = esc(slug || '');
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Part not found — Gunforma</title>' +
    '<meta name="robots" content="noindex"/>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
    'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
    '</head><body><div><div style="font-size:20px;font-weight:700">Part not found</div>' +
    '<div class="s">' + (s ? 'No listing at &ldquo;' + s + '&rdquo;.' : 'That part link is not valid.') + '</div>' +
    '<a href="' + SITE + '/gunforma-parts-catalog.html">Browse the catalog &rarr;</a></div></body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

async function fetchProduct(slug) {
  const cols = [
    'id', 'slug', 'name', 'category', 'description', 'best_for', 'pros', 'cons',
    'material', 'weight_oz', 'installation_difficulty', 'fitment_confidence',
    'build_warning', 'fitment_notes', 'lowest_price',
    'manufacturers!products_brand_id_fkey(name,slug,website_url)',
    // Must name the FK: products has two relationships to product_variants
    // (product_variants.product_id -> products.id, and
    // products.lowest_price_variant_id -> product_variants.id), so a bare
    // product_variants(...) embed is ambiguous and PostgREST rejects the whole
    // query with PGRST201.
    'product_variants!product_variants_product_id_fkey(id,slug,sku,upc,msrp,is_default,primary_image_url,color,finish,' +
      'optic_cut,bundle,clamp_style,manual_safety_variant,reticle,reticle_color,variant_label,' +
      'variant_images(url,position,alt_text),' +
      'affiliate_links(url,affiliate_url,street_price,in_stock,is_primary,partners(name)))',
  ].join(',');
  const rows = await pgGet('products?slug=eq.' + encodeURIComponent(slug) + '&select=' + encodeURIComponent(cols) + '&limit=1');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchSpecs(category, productId) {
  const table = SPEC_TABLES[category];
  if (!table) return null;
  const [tableName, fields] = table;
  const cols = fields.map((f) => f[0]).join(',');
  const rows = await pgGet(tableName + '?product_id=eq.' + productId + '&select=' + encodeURIComponent(cols) + '&limit=1');
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return [];
  return fields
    .map(([col, label, fmt]) => {
      const raw = row[col];
      if (raw === null || raw === undefined || raw === '') return null;
      const val = fmt ? fmt(raw) : String(raw);
      return val === null ? null : { label, value: val };
    })
    .filter(Boolean);
}

function renderPage({ product, specs, categorySegment, categoryLabel }) {
  const brand = product.manufacturers || {};
  const variants = product.product_variants || [];
  const isOptic = product.category === 'optic';

  // Flatten to (variant, link) rows, same shape/ordering rule as affiliate.js.
  const rows = [];
  variants.forEach((v) => {
    const links = v.affiliate_links || [];
    const axes = extractAxes(v);
    if (!links.length) {
      rows.push({ v, axes, price: null, url: null, in_stock: null, partnerName: null, is_primary: false });
      return;
    }
    links.forEach((l) => {
      rows.push({
        v, axes,
        price: l.street_price != null ? Number(l.street_price) : null,
        url: l.affiliate_url || l.url,
        in_stock: l.in_stock,
        is_primary: !!l.is_primary,
        partnerName: displayPartnerName(l.partners ? l.partners.name : null),
      });
    });
  });
  // Active axes are computed over the flattened (variant, link) rows, same as
  // affiliate.js does over its "listings" — not over raw variants, since a
  // variant with no listings shouldn't count toward what differs.
  const activeAxes = computeActiveAxes(rows, isOptic);
  rows.forEach((r) => { r.label = variantLabel({ axes: r.axes, variant_label: r.v.variant_label }, activeAxes); });
  rows.sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    if ((a.in_stock === true) !== (b.in_stock === true)) return a.in_stock ? -1 : 1;
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });

  const pricedInStock = rows.filter((r) => r.price != null && r.in_stock === true);
  const priced = rows.filter((r) => r.price != null);
  const priceSet = (pricedInStock.length ? pricedInStock : priced).map((r) => r.price);
  const minPrice = priceSet.length ? Math.min(...priceSet) : null;
  const maxPrice = priceSet.length ? Math.max(...priceSet) : null;
  const anyInStock = rows.some((r) => r.in_stock === true);

  const heroImage = (() => {
    const withImg = variants.find((v) => v.primary_image_url) ||
      variants.find((v) => (v.variant_images || []).length);
    if (!withImg) return null;
    if (withImg.primary_image_url) return withImg.primary_image_url;
    const imgs = (withImg.variant_images || []).slice().sort((a, b) => a.position - b.position);
    return imgs.length ? imgs[0].url : null;
  })();

  const title = product.name + (brand.name ? ' by ' + brand.name : '') + ' | Gunforma';
  const priceText = minPrice != null
    ? (maxPrice != null && maxPrice !== minPrice ? '$' + minPrice.toFixed(2) + '–$' + maxPrice.toFixed(2) : '$' + minPrice.toFixed(2))
    : null;
  const descBase = product.description
    ? product.description.replace(/\s+/g, ' ').trim().slice(0, 220)
    : (categoryLabel + ' for the Sig Sauer P365' + (brand.name ? ' from ' + brand.name : '') + '.');
  const metaDescription = descBase + (priceText ? ' Priced ' + priceText + '.' : '');
  const canonical = SITE + '/parts/' + categorySegment + '/' + product.slug;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.name,
    description: product.description || metaDescription,
    sku: (variants.find((v) => v.is_default) || variants[0] || {}).sku || undefined,
    brand: brand.name ? { '@type': 'Brand', name: brand.name } : undefined,
    image: heroImage || undefined,
    category: categoryLabel,
    offers: rows.filter((r) => r.price != null && r.url).map((r) => ({
      '@type': 'Offer',
      price: r.price.toFixed(2),
      priceCurrency: 'USD',
      // Omit availability entirely when stock is unknown. schema.org reads an
      // absent property as "not stated", which is the truth. The previous
      // fallback emitted InStoreOnly, which positively asserts the item can
      // only be bought in a physical shop — false for an affiliate link, and
      // exactly the kind of wrong structured data that surfaces in rich
      // results. No link has a null in_stock today, so this has never fired;
      // it is about to, once Olight's unverified stock flags are cleared.
      ...(r.in_stock === true
            ? { availability: 'https://schema.org/InStock' }
            : r.in_stock === false
              ? { availability: 'https://schema.org/OutOfStock' }
              : {}),
      url: r.url,
      itemCondition: 'https://schema.org/NewCondition',
    })),
  };

  const specRowsHtml = (specs || [])
    .map((s) => '<div class="spec-row"><span class="spec-label">' + esc(s.label) + '</span><span class="spec-value">' + esc(s.value) + '</span></div>')
    .join('');

  const commonSpecs = [
    product.material ? { label: 'Material', value: product.material } : null,
    product.weight_oz ? { label: 'Weight', value: product.weight_oz + ' oz' } : null,
    product.installation_difficulty ? { label: 'Install Difficulty', value: product.installation_difficulty } : null,
    product.fitment_confidence ? { label: 'Fitment', value: product.fitment_confidence } : null,
  ].filter(Boolean)
    .map((s) => '<div class="spec-row"><span class="spec-label">' + esc(s.label) + '</span><span class="spec-value">' + esc(s.value) + '</span></div>')
    .join('');

  const variantRowsHtml = rows.map((r) => {
    const price = r.price != null ? '$' + r.price.toFixed(2) : (r.v.msrp ? 'MSRP $' + Number(r.v.msrp).toFixed(2) : 'See price');
    const stock = r.in_stock === true ? '<span class="stock in">In stock</span>'
      : r.in_stock === false ? '<span class="stock out">Out of stock</span>' : '';
    const partner = r.partnerName ? ' at <strong>' + esc(r.partnerName) + '</strong>' : '';
    const btn = r.url
      ? '<a class="buy-btn" href="' + esc(r.url) + '" target="_blank" rel="noopener sponsored nofollow">' +
          (r.partnerName ? 'Buy at ' + esc(r.partnerName) + ' ↗' : 'View listing ↗') + '</a>'
      : '<span class="buy-btn disabled">No listing yet</span>';
    return '<div class="variant-row">' +
        '<div class="variant-info"><span class="variant-label">' + esc(r.label) + '</span>' +
        '<span class="variant-sub">' + price + partner + ' ' + stock + '</span></div>' +
        btn +
      '</div>';
  }).join('') || '<div class="variant-row"><div class="variant-info"><span class="variant-sub">No retailer listings available yet.</span></div></div>';

  const bestForHtml = (product.best_for || []).length
    ? '<div class="chips">' + product.best_for.map((b) => '<span class="chip">' + esc(String(b).replace(/-/g, ' ')) + '</span>').join('') + '</div>'
    : '';

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
'<link rel="canonical" href="' + esc(canonical) + '" />' +
'<meta name="description" content="' + esc(metaDescription) + '"/>' +
'<meta property="og:type" content="product"/>' +
'<meta property="og:title" content="' + esc(title) + '"/>' +
'<meta property="og:description" content="' + esc(metaDescription) + '"/>' +
'<meta property="og:image" content="' + esc(heroImage || SITE + '/og-default.png') + '"/>' +
'<meta property="og:url" content="' + esc(canonical) + '"/>' +
'<meta name="twitter:card" content="summary_large_image"/>' +
'<meta name="twitter:title" content="' + esc(title) + '"/>' +
'<meta name="twitter:description" content="' + esc(metaDescription) + '"/>' +
'<meta name="twitter:image" content="' + esc(heroImage || SITE + '/og-default.png') + '"/>' +
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
'.breadcrumb { max-width: 900px; margin: 18px auto 0; padding: 0 24px; font-size: 12px; color: #888; }' +
'.breadcrumb a { color: #888; text-decoration: none; } .breadcrumb a:hover { color: #1a1a1a; }' +
'.page { max-width: 900px; margin: 0 auto; padding: 14px 24px 64px; display: grid; grid-template-columns: 280px 1fr; gap: 32px; }' +
'@media (max-width: 640px) { .page { grid-template-columns: 1fr; } }' +
'.hero-img { width: 100%; border-radius: 8px; border: 0.5px solid #e5e5e5; background: #fff; object-fit: contain; aspect-ratio: 1; }' +
'.hero-placeholder { width: 100%; aspect-ratio: 1; border-radius: 8px; border: 0.5px dashed #d9d6cc; background: #fff; display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 12px; }' +
'.eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #4a9edd; font-weight: 700; margin-bottom: 6px; }' +
'h1 { font-size: 26px; line-height: 1.25; margin-bottom: 6px; }' +
'.brand-line { font-size: 13px; color: #888; margin-bottom: 14px; }' +
'.brand-line a { color: #888; }' +
'.price-line { font-size: 20px; font-weight: 700; margin-bottom: 16px; }' +
'.desc { font-size: 14px; line-height: 1.6; color: #333; margin-bottom: 18px; }' +
'.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }' +
'.chip { font-size: 11px; text-transform: capitalize; background: #eef2f6; color: #345; padding: 4px 10px; border-radius: 20px; }' +
'.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 22px 0 10px; }' +
'.spec-row { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 0; border-bottom: 0.5px solid #ececec; }' +
'.spec-label { color: #777; } .spec-value { font-weight: 600; }' +
'.variant-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 0.5px solid #e5e5e5; border-radius: 6px; background: #fff; margin-bottom: 8px; }' +
'.variant-info { display: flex; flex-direction: column; gap: 3px; }' +
'.variant-label { font-size: 13px; font-weight: 700; }' +
'.variant-sub { font-size: 12px; color: #666; }' +
'.stock.in { color: #1e7d32; margin-left: 6px; } .stock.out { color: #b23; margin-left: 6px; }' +
'.buy-btn { font-size: 12px; font-weight: 700; color: #fff; background: #4a9edd; padding: 8px 14px; border-radius: 6px; text-decoration: none; white-space: nowrap; }' +
'.buy-btn.disabled { background: #ddd; color: #888; }' +
'.disclosure { font-size: 11px; color: #999; margin-top: 10px; font-style: italic; }' +
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
'<div class="breadcrumb">' +
  '<a href="gunforma-parts-catalog.html">Parts Catalog</a> / ' +
  '<a href="gunforma-parts-catalog.html?category=' + encodeURIComponent(product.category) + '">' + esc(categoryLabel) + '</a> / ' +
  esc(product.name) +
'</div>' +
'<div class="page">' +
  '<div>' + (heroImage
    ? '<img class="hero-img" src="' + esc(heroImage) + '" alt="' + esc(product.name) + '" loading="eager" />'
    : '<div class="hero-placeholder">No photo yet</div>') + '</div>' +
  '<div>' +
    '<div class="eyebrow">' + esc(categoryLabel) + ' &middot; Sig Sauer P365</div>' +
    '<h1>' + esc(product.name) + '</h1>' +
    (brand.name ? '<div class="brand-line">by ' + (brand.website_url ? '<a href="' + esc(brand.website_url) + '" target="_blank" rel="noopener">' + esc(brand.name) + '</a>' : esc(brand.name)) + '</div>' : '') +
    (priceText ? '<div class="price-line">' + esc(priceText) + '</div>' : '') +
    (product.description ? '<div class="desc">' + esc(product.description) + '</div>' : '') +
    bestForHtml +
    (product.fitment_notes ? '<div class="desc"><strong>Fitment notes:</strong> ' + esc(product.fitment_notes) + '</div>' : '') +
    (product.build_warning ? '<div class="desc" style="color:#b23"><strong>Heads up:</strong> ' + esc(product.build_warning) + '</div>' : '') +
    '<div class="section-title">Specs</div>' +
    commonSpecs + specRowsHtml +
    '<div class="section-title">Buy</div>' +
    variantRowsHtml +
    '<div class="disclosure">Gunforma may earn a commission on purchases made through these links.</div>' +
  '</div>' +
'</div>' +
'<div class="footer-bar">' +
  '<span>&copy; 2026 Gunforma &middot; All rights reserved</span>' +
  '<span><a href="gunforma-legal.html#legal">Legal</a> &middot; <a href="gunforma-legal.html#affiliate">Affiliate disclosure</a> &middot; <a href="gunforma-legal.html#contact">Contact</a></span>' +
'</div>' +
'</body></html>';
}

export default async (req) => {
  const slug = extractSlug(req);
  if (!slug || !SLUG_RE.test(slug)) return notFound(slug);

  let product;
  try {
    product = await fetchProduct(slug);
  } catch (err) {
    console.error('[product-page] product lookup failed', err);
    return new Response('Temporarily unavailable — try again shortly.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (!product) return notFound(slug);

  const meta = CATEGORY_META[product.category] || [product.category, product.category];
  const [categorySegment, categoryLabel] = meta;

  let specs = [];
  try {
    specs = await fetchSpecs(product.category, product.id) || [];
  } catch (err) {
    console.error('[product-page] spec lookup failed for ' + product.category, err);
    // Non-fatal — page still renders with common specs only.
  }

  const html = renderPage({ product, specs, categorySegment, categoryLabel });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
    },
  });
};
