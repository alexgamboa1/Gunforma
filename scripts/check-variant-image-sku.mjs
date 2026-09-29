#!/usr/bin/env node
// check-variant-image-sku — a variant's photo must not be a photo of a
// different colour.
//
// HOW THIS WAS FINDABLE, AND WHY IT SHOULD STAY FINDABLE
// The catalog's image filenames carry the variant SKU:
//
//   ...True-Precision-Sig-P365XL-Non-Threaded-Barrel-Gold-TP-P365XLB-XG__88285.jpg
//
// So a variant whose image URL contains a SIBLING variant's SKU, and not its
// own, is provably showing the wrong colour. Seven default variants were in
// that state on 2026-09-29 — Black/DLC barrels illustrated with the gold one,
// a Black slide plate illustrated with the purple one — and it had been live
// for as long as the rows existed.
//
// Nothing could have caught it before this: it renders perfectly, the URL is
// valid, the image loads, and it is the right product. Only the colour is
// wrong, and only the filename says so.
//
// It mattered more once builds started storing which variant they used:
// gunforma-build-detail.html denormalises the variant's image into
// parts_snapshot, so a wrong photo stops being a fixable catalog row and
// becomes a permanent part of someone's build.
//
// THE RULE
//   flag when   the URL contains another live variant's SKU (same product)
//   and         the URL does NOT contain this variant's own SKU
//
// Both halves are needed. Requiring only the first flags every variant of a
// product whose SKUs share a prefix; requiring only the second flags every
// image that simply is not named after its SKU, which is most of them and
// tells us nothing.
//
// WHY THIS IS NOT A BUILD CHECK
// It reads live data, so it is time-dependent rather than tree-dependent —
// exactly the property that keeps scripts/check-price-freshness.mjs out of the
// build. A deploy that changed nothing could fail it, and a CSV import that
// broke it would pass every deploy until someone imported again. Refusing an
// unrelated deploy because a catalog row is wrong is the wrong lever. It runs
// from .github/workflows/check-variant-images.yml on a schedule instead, and
// is listed under NOT_BUILD_CHECKS with this reason.
//
//   node scripts/check-variant-image-sku.mjs
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

async function pg(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!res.ok) { console.error(`GET ${path} → ${res.status}: ${await res.text()}`); process.exit(2); }
  return res.json();
}

// products embeds from product_variants only with the FK NAMED — products
// references product_variants back via lowest_price_variant_id, so a bare
// embed is ambiguous in both directions and PostgREST rejects the whole query
// with PGRST201. See CLAUDE.md.
const rows = await pg(
  'product_variants?select=id,product_id,sku,color,finish,is_default,primary_image_url,' +
  'products!product_variants_product_id_fkey(name,manufacturers(name))' +
  '&retired_at=is.null&limit=5000',
);

const byProduct = new Map();
for (const v of rows) {
  if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
  byProduct.get(v.product_id).push(v);
}

const hasSku = (v) => typeof v.sku === 'string' && v.sku.trim().length >= 4;
const findings = [];

for (const siblings of byProduct.values()) {
  for (const v of siblings) {
    if (!v.primary_image_url || !hasSku(v)) continue;
    const url = v.primary_image_url;
    if (url.includes(v.sku.trim())) continue;               // named after itself: fine
    for (const s of siblings) {
      if (s.id === v.id || !hasSku(s)) continue;
      if (!url.includes(s.sku.trim())) continue;
      findings.push({
        brand: (v.products?.manufacturers?.name) || '?',
        product: v.products?.name || '?',
        shows: `${v.color || '—'} / ${v.finish || '—'}`,
        isDefault: v.is_default,
        ownSku: v.sku.trim(),
        photoSku: s.sku.trim(),
        photoIs: `${s.color || '—'} / ${s.finish || '—'}`,
        variantId: v.id,
      });
      break;   // one finding per variant is enough to act on
    }
  }
}

const checked = rows.filter((v) => v.primary_image_url && hasSku(v)).length;
console.log(`checked ${checked} live variants that have both an image and a SKU\n`);

for (const f of findings) {
  console.log(`FAIL  ${f.brand} — ${f.product}`);
  console.log(`        variant "${f.shows}"${f.isDefault ? '  [DEFAULT]' : ''}  sku ${f.ownSku}`);
  console.log(`        photo is sku ${f.photoSku} = "${f.photoIs}"`);
  console.log(`        variant_id ${f.variantId}`);
}

if (!findings.length) {
  console.log('ok: no variant is illustrated with a sibling variant\'s photo');
  process.exit(0);
}
const defaults = findings.filter((f) => f.isDefault).length;
console.log(`\n${findings.length} variant(s) show the wrong colour's photo` +
            (defaults ? ` — ${defaults} of them are DEFAULT variants, which is what new builds record` : ''));
console.log('Fix by nulling primary_image_url: the nightly sync refills it per-colour from the feed');
console.log('where the link carries a stored identifier. A swatch is a correct answer; a wrong photo is not.');
process.exit(1);
