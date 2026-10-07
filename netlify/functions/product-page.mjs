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
// The variant label is NOT computed here any more. It comes from
// _variant-label.mjs, imported below. Its browser mirror is js/variant-label.js
// and scripts/variant-label.test.mjs fails the deploy if the two disagree.
// This file used to carry its own near-copy of js/affiliate.js's axis logic,
// justified as "a small subset" — and it drifted: `finish` was an axis here
// and in neither of the other two copies, so True Precision P365-FUSE read
// "Black / DLC" on this page and "Black" twice, $56 apart, in the catalog buy
// row and on every build page. Importing costs nothing (the module is pure,
// dependency-free ESM) and removes the only way those can disagree.

// category -> [URL segment, display label]. Shared with parts-index.mjs via
// _category-meta.mjs rather than hand-copied — see that file's header for
// why this pair of functions doesn't need the browser-vs-ESM duplication
// that js/category-map.js still requires.
import { CATEGORY_META } from './_category-meta.mjs';
import { variantLabel } from './_variant-label.mjs';
// Stale-price rule and listing sort. These moved to _listing-rules.mjs when
// guide-page.mjs arrived needing the same rules — two server renderers, one
// copy, same reasoning as _variant-label.mjs. The browser copies
// (js/affiliate.js, gunforma-build-detail.html) remain hand-synced; see
// CLAUDE.md "Duplicated logic to keep in sync".
import { isStalePrice, compareListingRows, displayPartnerName } from './_listing-rules.mjs';
// A variant with no partner listing links to the part's own products.url
// through /go/part/<id>. The label ("Buy from <maker>" vs "Buy at <host>")
// and the disclosure wording are decided in _maker-link.mjs, mirrored by
// js/maker-link.js and parity-tested on every deploy.
import { makerLink, buyDisclosure, MAKER_REL } from './_maker-link.mjs';
// For the "Used in these builds" row: /b/ links are built with the shared
// builder, never by hand — see CLAUDE.md, "A build's URL is built in two
// places, on purpose".
import { buildPath } from './_build-url.mjs';
import { ANALYTICS_SNIPPET } from './_analytics.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const SITE = 'https://gunforma.com';
const PHOTO_BASE = SB_URL + '/storage/v1/object/public/build-photos/';

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
    ['housing_classes(display_name,grip_length,magazine_families(display_name,capacity_note))', 'Housing Class',
      (v) => (v && v.display_name) || null],
    ['housing_classes(display_name,grip_length,magazine_families(display_name,capacity_note))', 'Magazines',
      (v) => (v && v.magazine_families)
        ? v.magazine_families.display_name + (v.magazine_families.capacity_note ? ' — ' + v.magazine_families.capacity_note : '')
        : null],
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
  recoil_spring: ['recoil_spring_specs', [
    ['slide_length_in', 'Slide Length', (v) => v + '"'],
    ['spring_weight', 'Spring Weight'],
    ['captured', 'Captured', YESNO],
    ['spring_type', 'Spring Type'],
    ['guide_rod_material', 'Guide Rod Material'],
  ]],
  sight: ['sight_specs', [
    ['sight_position', 'Front, Rear or Set', (v) => ({ front: 'Front', rear: 'Rear', set: 'Set (front and rear)' }[v] || v)],
    ['height', 'Height', (v) => ({ standard: 'Standard', suppressor: 'Suppressor / co-witness' }[v] || v)],
    ['sight_type', 'Type', (v) => ({ night: 'Night (tritium)', fiber: 'Fiber optic', 'night-fiber': 'Night + fiber', plain: 'Plain' }[v] || v)],
    ['dovetail', 'Dovetail / Slide Cut'],
    ['rear_notch', 'Rear Notch'],
  ]],
};
// slide_plate and other have no spec table (CATEGORIES_WITHOUT_SPEC_SHEET in
// _category-meta.mjs); check-categories.mjs asserts every other category is here.

// VARIANT_AXES, extractAxes, computeActiveAxes and variantLabel used to
// live here. They are gone: the label comes from _variant-label.mjs and
// no longer depends on what a variant's SIBLINGS look like, so there is
// nothing per-product to compute. esc() moved up, it is still needed.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// isStalePrice, compareListingRows and displayPartnerName come from
// _listing-rules.mjs — see the import at the top and that file's header.

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
    '<a href="' + SITE + '/gunforma-parts-catalog.html">Browse the catalog &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

async function fetchProduct(slug) {
  const cols = [
    'id', 'slug', 'name', 'category', 'description', 'best_for', 'pros', 'cons',
    'material', 'material_family', 'weight_oz', 'installation_difficulty', 'fitment_confidence',
    'build_warning', 'fitment_notes', 'lowest_price', 'url', 'is_discontinued',
    'manufacturers!products_brand_id_fkey(name,slug,website_url)',
    // Must name the FK: products has two relationships to product_variants
    // (product_variants.product_id -> products.id, and
    // products.lowest_price_variant_id -> product_variants.id), so a bare
    // product_variants(...) embed is ambiguous and PostgREST rejects the whole
    // query with PGRST201.
    'product_variants!product_variants_product_id_fkey(id,slug,sku,upc,msrp,is_default,primary_image_url,color,finish,' +
      'optic_cut,bundle,clamp_style,manual_safety_variant,reticle,reticle_color,variant_label,' +
      'variant_images(url,position,alt_text),' +
      'affiliate_links(id,url,affiliate_url,street_price,in_stock,last_checked,op_last_matched_by,partners(name)))',
  ].join(',');
  // Embed filters, one per level: a retired variant drops out of the page, and
  // a retired listing drops out of its (live) variant's buy rows. Both are
  // embed filters, so the product itself always survives — a product whose
  // every listing is retired still renders, just with no buy row.
  const retiredFilters =
    '&product_variants.retired_at=is.null' +
    '&product_variants.affiliate_links.retired_at=is.null';
  const rows = await pgGet('products?slug=eq.' + encodeURIComponent(slug) + '&select=' + encodeURIComponent(cols) + retiredFilters + '&limit=1');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchSpecs(category, productId) {
  // An Other Part's one extra fact is products.part_type. Asked for here,
  // for that category only, never in fetchProduct's select: a column named
  // there that the database does not have yet fails every product page.
  if (category === 'other') {
    const rows = await pgGet('products?id=eq.' + productId + '&select=part_type&limit=1');
    const t = Array.isArray(rows) && rows.length ? rows[0].part_type : null;
    return t ? [{ label: 'Part Type', value: t, partType: t }] : [];
  }
  const table = SPEC_TABLES[category];
  if (!table) return null;
  const [tableName, fields] = table;
  const cols = Array.from(new Set(fields.map((f) => f[0]))).join(',');
  const rows = await pgGet(tableName + '?product_id=eq.' + productId + '&select=' + encodeURIComponent(cols) + '&limit=1');
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return [];
  return fields
    .map(([col, label, fmt]) => {
      const raw = row[col.split('(')[0]];
      if (raw === null || raw === undefined || raw === '') return null;
      const val = fmt ? fmt(raw) : String(raw);
      return val === null ? null : { label, value: val };
    })
    .filter(Boolean);
}

// Approved builds that run this product, newest first, with a hero photo for
// the card. Same fetch-and-filter shape as guide-page.mjs's
// fetchBuildsUsing(): builds fit in one page today (5 approved), so one query
// and a local filter beats a cs.[] contains-query per product — revisit if
// approved builds outgrow the limit.
//
// This section is what makes a product page more than a copy of the
// retailer's listing: Search Console judged 63% of /parts/ to be thin
// duplicates, and real builds using the part are the one thing a retailer
// page cannot have. It also gives every build inbound links from pages
// Google already crawls, instead of the sitemap being a build's only door.
async function fetchBuildsUsing(productId) {
  const rows = await pgGet('builds?status=eq.approved' +
    '&select=' + encodeURIComponent('id,name,parts_snapshot,profiles!builds_user_id_fkey(username),build_photos(storage_path,is_hero,position)') +
    '&order=updated_at.desc&limit=100');
  const out = [];
  for (const b of (Array.isArray(rows) ? rows : [])) {
    const snap = Array.isArray(b.parts_snapshot) ? b.parts_snapshot : [];
    if (!snap.some((p) => p && p.refId === productId)) continue;
    const photos = (b.build_photos || []).slice().sort((x, y) =>
      (y.is_hero === true) - (x.is_hero === true) || (x.position ?? 9) - (y.position ?? 9));
    out.push({
      id: b.id, name: b.name,
      owner: b.profiles ? b.profiles.username : null,
      photo: photos.length && photos[0].storage_path ? PHOTO_BASE + photos[0].storage_path : null,
    });
    if (out.length === 4) break;
  }
  return out;
}

function renderPage({ product, specs, categorySegment, categoryPlural, categorySingular, builds }) {
  const brand = product.manufacturers || {};
  const variants = product.product_variants || [];

  // A variant with no partner listing gets a MAKER row instead of a dead
  // "No listing yet": a button to the part's own products.url through
  // /go/part/<id>, so the click is counted. Null when there is no usable url
  // (one live part today, streamlight-tlr-7-sub) — that row keeps the
  // non-link state. A discontinued part gets none: /go/part/ 404s it.
  const maker = product.is_discontinued ? null
    : makerLink(product.url, brand.name, brand.website_url);

  // Flatten to (variant, link) rows, same shape/ordering rule as affiliate.js.
  // partnerRows and otherRows are kept apart so partner rows ALWAYS sort
  // first: the shared comparator's tiebreak would otherwise put an unnamed
  // maker row ahead of a stale partner listing.
  const partnerRows = [];
  const otherRows = [];
  variants.forEach((v) => {
    const links = v.affiliate_links || [];
    if (!links.length) {
      otherRows.push(maker
        ? { v, price: null, stale: true, url: null, in_stock: null, partnerName: null,
            maker, goUrl: '/go/part/' + product.id }
        : { v, price: null, stale: true, url: null, in_stock: null, partnerName: null });
      return;
    }
    links.forEach((l) => {
      partnerRows.push({
        v,
        price: l.street_price != null ? Number(l.street_price) : null,
        stale: isStalePrice(l),
        url: l.affiliate_url || l.url,
        goUrl: '/go/' + l.id,
        in_stock: l.in_stock,
        partnerName: displayPartnerName(l.partners ? l.partners.name : null),
      });
    });
  });
  // No active-axis pass any more: the label is a property of the variant
  // alone, so it no longer changes when a sibling variant is added or
  // retired. That instability was fine for a comparison table and wrong for
  // a build page, where the same label gets written into parts_snapshot.
  partnerRows.forEach((r) => { r.label = variantLabel(r.v); });
  otherRows.forEach((r) => { r.label = variantLabel(r.v); });
  // Fresh-and-priced first, so the top buy row is the one the headline
  // price quotes; the shared comparator keeps equal listings in a stable
  // order. Full ordering documented in _listing-rules.mjs. The unlisted
  // variants follow, by label — PostgREST returns them in arbitrary order.
  partnerRows.sort(compareListingRows);
  otherRows.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const rows = partnerRows.concat(otherRows);
  const hasPartner = partnerRows.some((r) => r.url);
  const hasMaker = otherRows.some((r) => r.maker);

  // Stale prices are excluded from the range — the headline "$X–$Y" must not
  // be anchored on a number no feed has confirmed.
  const pricedInStock = rows.filter((r) => r.price != null && !r.stale && r.in_stock === true);
  const priced = rows.filter((r) => r.price != null && !r.stale);
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
    : (categorySingular + ' for the Sig Sauer P365' + (brand.name ? ' from ' + brand.name : '') + '.');
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
    category: categorySingular,
    // A stale-priced listing still ships as an Offer — the URL and stock are
    // true — but WITHOUT price/priceCurrency. Same principle as the
    // availability omission below: absent means "not stated", which is honest,
    // where a stale number positively asserts something we can't stand behind.
    //
    // MAKER ROWS ARE NOT OFFERS. A link to the maker's store with a hand-typed
    // MSRP is not a price we can stand behind in rich results, so the
    // structured data is exactly what it was before those rows existed.
    offers: rows.filter((r) => !r.maker && r.url).map((r) => ({
      '@type': 'Offer',
      ...(r.price != null && !r.stale
            ? { price: r.price.toFixed(2), priceCurrency: 'USD' }
            : {}),
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
    (product.material_family || product.material)
      ? { label: 'Material',
          value: product.material_family
            ? product.material_family + (product.material && product.material !== product.material_family ? ' (' + product.material + ')' : '')
            : product.material }
      : null,
    product.weight_oz ? { label: 'Weight', value: product.weight_oz + ' oz' } : null,
    product.installation_difficulty ? { label: 'Install Difficulty', value: product.installation_difficulty } : null,
    product.fitment_confidence ? { label: 'Fitment', value: product.fitment_confidence } : null,
  ].filter(Boolean)
    .map((s) => '<div class="spec-row"><span class="spec-label">' + esc(s.label) + '</span><span class="spec-value">' + esc(s.value) + '</span></div>')
    .join('');

  const variantRowsHtml = rows.map((r) => {
    // Three cases, and the order matters:
    //   fresh price        → the number
    //   stale price        → "Check price". NOT the MSRP fallback: a listing
    //                        we last saw at $233 would otherwise advertise its
    //                        $365 list price, which is a worse lie than saying
    //                        nothing.
    //   no listing at all  → MSRP, which is all we have and is still true.
    const price = r.price != null
      ? (r.stale ? 'Check price' : '$' + r.price.toFixed(2))
      : (r.v.msrp ? 'MSRP $' + Number(r.v.msrp).toFixed(2) : 'Check price');
    const stock = r.in_stock === true ? '<span class="stock in">In stock</span>'
      : r.in_stock === false ? '<span class="stock out">Out of stock</span>' : '';
    const partner = r.partnerName ? ' at <strong>' + esc(r.partnerName) + '</strong>' : '';
    // Three buttons: a partner listing (sponsored, through /go/<link>), the
    // part's own store (NOT sponsored — nobody pays for it — through
    // /go/part/<product>), or no link at all when products.url is empty.
    const btn = r.url
      ? '<a class="buy-btn" href="' + esc(r.goUrl) + '" target="_blank" rel="noopener sponsored nofollow">' +
          (r.partnerName ? 'Buy at ' + esc(r.partnerName) + ' ↗' : 'View listing ↗') + '</a>'
      : r.maker
        ? '<a class="buy-btn" href="' + esc(r.goUrl) + '" target="_blank" rel="' + MAKER_REL + '">' +
            esc(r.maker.label) + ' ↗</a>'
        : '<span class="buy-btn disabled">No listing yet</span>';
    return '<div class="variant-row">' +
        '<div class="variant-info"><span class="variant-label">' + esc(r.label) + '</span>' +
        '<span class="variant-sub">' + price + partner + ' ' + stock + '</span></div>' +
        btn +
      '</div>';
  }).join('') || '<div class="variant-row"><div class="variant-info"><span class="variant-sub">No retailer listings available yet.</span></div></div>';

  const disclosure = buyDisclosure(hasPartner, hasMaker);

  const bestForHtml = (product.best_for || []).length
    ? '<div class="chips">' + product.best_for.map((b) => '<span class="chip">' + esc(String(b).replace(/-/g, ' ')) + '</span>').join('') + '</div>'
    : '';

  // Same card guide-page.mjs draws for its "Used in these builds" row.
  // Nothing renders for a product no approved build runs — an empty heading
  // would be the thin-content problem restated.
  const buildsHtml = (builds && builds.length)
    ? '<div class="section-title">Used in these builds</div>' +
      '<div class="builds-row">' +
        builds.map((b) =>
          '<a class="build-card" href="' + esc(buildPath(b.id, b.name)) + '">' +
            (b.photo ? '<img src="' + esc(b.photo) + '" alt="' + esc(b.name) + '" loading="lazy"/>' : '') +
            '<span class="build-name">' + esc(b.name) + '</span>' +
            (b.owner ? '<span class="build-owner">by ' + esc(b.owner) + '</span>' : '') +
          '</a>').join('') +
      '</div>'
    : '';

  return '<!DOCTYPE html><html lang="en"><head>' +
'<meta charset="UTF-8"/>' +
'<base href="/"/>' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
'<link rel="icon" type="image/png" href="/assets/gunforma-mark.png" />' +
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
'.nav-logo { display: flex; align-items: center; text-decoration: none; }' +
'.nav-logo img { height: 22px; width: auto; display: block; }' +
'.nav-logo img.nav-logo-mark { display: none; }' +
'@media (max-width: 600px) { .nav-logo img.nav-logo-full { display: none; } .nav-logo img.nav-logo-mark { display: block; } }' +
'.nav-links { display: flex; gap: 28px; }' +
'.nav-link { font-size: 12px; color: #ffffff; letter-spacing: 0.06em; text-transform: uppercase; text-decoration: none; }' +
'.nav-link:hover, .nav-link.active { color: #ffffff; }' +
'.nav-link.active { border-bottom: 2px solid #4a9edd; padding-bottom: 2px; }' +
'.nav-right { display: flex; align-items: center; gap: 14px; }' +
'.nav-btn { font-size: 11px; color: #ffffff; border: 0.5px solid #2a2b2e; padding: 5px 12px; border-radius: 4px; cursor: pointer; text-decoration: none; }' +
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
'.builds-row { display: flex; gap: 12px; flex-wrap: wrap; }' +
'.build-card { display: flex; flex-direction: column; gap: 4px; width: 160px; text-decoration: none; color: #1a1a1a; }' +
'.build-card img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 6px; border: 0.5px solid #e5e5e5; }' +
'.build-name { font-size: 13px; font-weight: 600; } .build-owner { font-size: 11px; color: #888; }' +
'.disclosure { font-size: 11px; color: #999; margin-top: 10px; font-style: italic; }' +
'.footer-bar { max-width: 900px; margin: 0 auto; padding: 24px; display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: space-between; border-top: 0.5px solid #e5e5e5; font-size: 11px; color: #999; }' +
'.footer-bar a { color: #999; }' +
'.nav-toggle { display: none; background: none; border: 0; padding: 8px; margin: 0 -8px 0 0; cursor: pointer; }' +
'.nav-toggle span { display: block; width: 20px; height: 2px; background: #e8e6e1; border-radius: 2px; }' +
'.nav-toggle span + span { margin-top: 4px; }' +
'.nav-profile { display: none; align-items: center; justify-content: center; width: 34px; height: 34px; border: 0.5px solid #2a2b2e; border-radius: 50%; color: #ffffff; text-decoration: none; }' +
'.nav-profile svg { width: 19px; height: 19px; }' +
'.nav-menu { display: none; }' +
'@media (max-width: 820px) {' +
'  .nav-links { display: none; }' +
'  .nav-signin-inline { display: none; }' +
'  .nav-profile { display: flex; }' +
'  .nav-toggle { display: block; }' +
'  .nav-menu { position: absolute; top: 52px; left: 0; right: 0; background: #0e0f11; border-bottom: 0.5px solid #2a2b2e; flex-direction: column; padding: 8px 0; z-index: 99; }' +
'  .nav-menu.open { display: flex; }' +
'  .nav-menu a { padding: 13px 28px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #ffffff; text-decoration: none; border-bottom: 0.5px solid #1a1b1e; }' +
'  .nav-menu a.signout { color: #ffffff; }' +
'}' +
'</style>' +
'</head><body>' +
'<nav class="nav">' +
  '<a class="nav-logo" href="index.html"><img class="nav-logo-full" src="assets/gunforma-logo.png" alt="Gunforma"><img class="nav-logo-mark" src="assets/gunforma-mark.png" alt="Gunforma"></a>' +
  '<div class="nav-links">' +
    '<a class="nav-link" href="index.html">Home</a>' +
    '<a class="nav-link" href="gunforma-builds.html">Builds</a>' +
    '<a class="nav-link active" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
  '</div>' +
  '<div class="nav-right">' +
    '<a class="nav-btn nav-signin-inline" href="gunforma-signin.html" id="nav-signin">Sign in</a>' +
    '<a class="nav-btn cta" href="gunforma-post-build.html">+ Post your build</a>' +
    '<a class="nav-profile" href="gunforma-signin.html" aria-label="Account"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke-linecap="round"/></svg></a>' +
    '<button class="nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu"><span></span><span></span><span></span></button>' +
  '</div>' +
'<div class="nav-menu" id="nav-menu">' +
  '<a href="gunforma-builds.html">Builds</a>' +
  '<a href="gunforma-parts-catalog.html">Parts Catalog</a>' +
'</div>' +
'</nav>' +
'<div class="breadcrumb">' +
  '<a href="gunforma-parts-catalog.html">Parts Catalog</a> / ' +
  '<a href="gunforma-parts-catalog.html?category=' + encodeURIComponent(product.category) + '">' + esc(categoryPlural) + '</a> / ' +
  esc(product.name) +
'</div>' +
'<div class="page">' +
  '<div>' + (heroImage
    ? '<img class="hero-img" src="' + esc(heroImage) + '" alt="' + esc(product.name) + '" loading="eager" />'
    : '<div class="hero-placeholder">No photo yet</div>') + '</div>' +
  '<div>' +
    '<div class="eyebrow">' + esc(categorySingular) + ' &middot; Sig Sauer P365</div>' +
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
    // Says what is true of the links above it: partner-only, maker-only,
    // both — or nothing at all when there is no link to disclose.
    (disclosure ? '<div class="disclosure">' + esc(disclosure) + '</div>' : '') +
    buildsHtml +
  '</div>' +
'</div>' +
'<div class="footer-bar">' +
  '<span>&copy; 2026 Gunforma &middot; All rights reserved</span>' +
  '<span><a href="gunforma-legal.html#legal">Legal</a> &middot; <a href="gunforma-legal.html#affiliate">Affiliate disclosure</a> &middot; <a href="gunforma-legal.html#contact">Contact</a></span>' +
'</div>' +
// This page ships no client JS at all -- unlike parts-index.mjs it does not
// load supabase-client.js or nav.js -- so the hamburger needs its own toggle
// or the nav links are simply unreachable below 820px. Kept inline and
// dependency-free, in keeping with the rest of the function.
//
// The account icon here is a plain link to sign-in: with no session script on
// the page there is nothing to make it session-aware, which is the same reason
// the "Sign in" button beside it is already static. Both are consistent with
// each other; parts-index.mjs, which does load nav.js, gets the live version.
'<script>(function(){' +
  'var t=document.querySelector(".nav-toggle"),m=document.querySelector(".nav-menu");' +
  'if(!t||!m)return;' +
  'function c(){m.classList.remove("open");t.setAttribute("aria-expanded","false");}' +
  't.addEventListener("click",function(){' +
    'var o=m.classList.toggle("open");t.setAttribute("aria-expanded",o?"true":"false");' +
  '});' +
  'm.addEventListener("click",function(e){if(e.target.closest("a"))c();});' +
  'window.addEventListener("resize",function(){if(window.innerWidth>820)c();});' +
'})();</script>' +
ANALYTICS_SNIPPET + '</body></html>';
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

  const meta = CATEGORY_META[product.category] || [product.category, product.category, product.category];
  const [categorySegment, categoryPlural] = meta;
  let categorySingular = meta[2];

  let specs = [];
  try {
    specs = await fetchSpecs(product.category, product.id) || [];
  } catch (err) {
    console.error('[product-page] spec lookup failed for ' + product.category, err);
    // Non-fatal — page still renders with common specs only.
  }

  // An Other Part reads as what it is ("Thumb ledge for the Sig Sauer P365"),
  // not "Other Part for …": its part type is the singular name.
  const partType = (specs.find((s) => s.partType) || {}).partType;
  if (partType) categorySingular = partType.charAt(0).toUpperCase() + partType.slice(1);

  let builds = [];
  try {
    builds = await fetchBuildsUsing(product.id);
  } catch (err) {
    // Non-fatal: the product page is the product page with or without the
    // builds row, and a builds hiccup must not take down a buy page.
    console.error('[product-page] builds lookup failed', err);
  }

  const html = renderPage({ product, specs, categorySegment, categoryPlural, categorySingular, builds });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
    },
  });
};
