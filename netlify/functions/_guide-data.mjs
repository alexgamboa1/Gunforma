// _guide-data — what a Gun Guide is made of, read once for its two renderers.
// ─────────────────────────────────────────────────────────────────────────
// guide-share.mjs (the /gg/ page) and guide-og.mjs (its share image) draw
// the same guide, and the image's URL carries a hash of what it draws — so
// the two must read the same rows the same way, or the page names an image
// the image function then calls stale. The selects, the reads and the
// which-photo rule live here once.
import { pgRows } from './_pg.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every embed names its FK (CLAUDE.md, PGRST201). gun_guides carries TWO
// foreign keys to guns — gun_id alone and the composite (gun_id,
// platform_id) — so a bare guns(...) off it is ambiguous and fails the
// whole read. guides has one (the composite); named anyway.
export const CURATED_SELECT = [
  'id', 'title', 'category', 'description', 'platform_id', 'gun_id', 'parts_snapshot', 'created_at',
  'guide_themes!guides_category_fkey(label)',
  'guns!guides_gun_platform_fkey(name,slug)',
  'platforms!guides_platform_id_fkey(name)',
].join(',');
export const COMMUNITY_SELECT = [
  'id', 'user_id', 'title', 'platform_id', 'gun_id', 'parts_snapshot', 'created_at', 'updated_at',
  'guns!gun_guides_gun_id_fkey(name,slug)',
  'platforms!gun_guides_platform_id_fkey(name)',
].join(',');
// One read for every catalog part: photos, the saved option's listings, the
// maker fallback and priceTotal()'s inputs (a superset of
// PRICE_TOTAL_SELECT). product_variants → products is the two-FK pair: named.
export const VARIANT_SELECT = [
  'id', 'product_id', 'is_default', 'msrp', 'color', 'finish', 'variant_label', 'primary_image_url',
  'products!product_variants_product_id_fkey(slug,category,url,is_discontinued,' +
    'manufacturers!products_brand_id_fkey(name,website_url))',
  'affiliate_links(id,url,affiliate_url,street_price,in_stock,last_checked,op_last_matched_by,partners(name))',
].join(',');

// Each throws UpstreamError on a failure to read; an empty array is the one
// real "not here". A published Gunforma guide first, then a community guide.
// Both filters are repeated though RLS applies them to the anon key, for the
// reason build-og.mjs repeats status=eq.approved: if a policy is ever
// loosened, the leak does not start here. A Gunforma DRAFT is never served.
export async function fetchGuide(id) {
  const curated = await pgRows('guides?id=eq.' + id + '&is_published=eq.true' +
    '&select=' + encodeURIComponent(CURATED_SELECT) + '&limit=1');
  if (curated.length) return { kind: 'curated', row: curated[0] };
  const community = await pgRows('gun_guides?id=eq.' + id + '&is_removed=eq.false' +
    '&select=' + encodeURIComponent(COMMUNITY_SELECT) + '&limit=1');
  if (community.length) return { kind: 'community', row: community[0] };
  return null;
}

export const guideParts = (row) => (Array.isArray(row && row.parts_snapshot) ? row.parts_snapshot : []).filter(Boolean);

export async function fetchVariants(parts) {
  const ids = [...new Set(parts.map((p) => p && p.refId).filter((r) => typeof r === 'string' && UUID_RE.test(r)))];
  if (!ids.length) return [];
  return pgRows('product_variants?select=' + encodeURIComponent(VARIANT_SELECT) +
    '&retired_at=is.null&affiliate_links.retired_at=is.null&product_id=in.(' + ids.join(',') + ')');
}

// product_id → { product, variants }.
export function groupByProduct(variants) {
  const byProduct = new Map();
  for (const v of variants || []) {
    if (!v || !v.product_id) continue;
    const e = byProduct.get(v.product_id) || { product: v.products || null, variants: [] };
    if (!e.product && v.products) e.product = v.products;
    e.variants.push(v);
    byProduct.set(v.product_id, e);
  }
  return byProduct;
}

// What a part looks like: the SAVED option's photo; a curated guide (no
// saved option) shows the default's. Never another option's photo as a
// stand-in (claude/loadouts-spec.md §9) — a saved option with no photo gets
// its own colour's swatch. A saved option that is no longer live falls back
// to the photo the snapshot itself carried, which the page shows as an
// <img> but the share image does NOT fetch: that URL was written by
// whoever saved the guide, and the image function fetches server-side
// (`fromSnapshot` tells the two apart).
export function partPicture(p, entry) {
  const variants = entry ? entry.variants : [];
  const saved = p.variantId ? variants.find((v) => v.id === p.variantId) : null;
  const dv = variants.find((v) => v.is_default) || variants[0] || null;
  const shown = p.variantId ? saved : dv;
  if (shown) return { photo: shown.primary_image_url || null, color: shown.color || null, fromSnapshot: false, saved };
  const snap = p.variantId ? p.imageUrl || null : null;
  return { photo: snap, color: p.variantColor || null, fromSnapshot: !!snap, saved };
}
