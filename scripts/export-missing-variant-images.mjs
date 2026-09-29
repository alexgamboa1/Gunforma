#!/usr/bin/env node
// export-missing-variant-images — the variants with no photo, as a CSV to
// work through by hand.
//
// 244 of 649 live variants have no primary_image_url. The nightly sync now
// fills one from the feed's merchant_image_url wherever a link carries a
// stored identifier that resolves — measured at 148 of them, unambiguously by
// merchant_product_id. This exports whatever is STILL null, which is the set
// no feed can answer for:
//
//   • variants with no affiliate link at all        (no feed row to match)
//   • variants whose link has no stored identifier  (nothing to match ON)
//   • variants whose feed row carries no image
//
// Run it AFTER a real sync, not before, or it exports rows the sync was about
// to handle. The `feed_may_fill` column says which side of that a row is on,
// so an early run is still readable rather than quietly wrong.
//
// `feed_may_fill` is a HEURISTIC and reads slightly optimistic. It knows only
// whether a link carries a stored identifier; it cannot see two things the
// sync does:
//   • whether the matched feed row actually has an image
//   • whether the link is WITHHELD for a candidate conflict or identifier
//     drift, in which case the sync deposits no image either — a contested
//     match must not deposit a photo any more than it deposits a price
// Measured 2026-09-29: this script said 149 fillable, the sync said 147. One
// had no feed image, one was withheld (Tyrant CNC Takedown Lever, a recurring
// same-MPN conflict). Trust the sync's own count over this column.
//
// Until an image exists the picker and the build row show a colour swatch
// with the label — never the default variant's photo standing in for the
// chosen colour. A Black barrel's photo above the words "Gold / TiN" is a
// worse answer than no photo, because it looks like an answer.
//
//   node scripts/export-missing-variant-images.mjs
//
// Anon key: products, variants and affiliate_links are public reads. No
// secret, so anyone can regenerate it.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { variantLabel } from '../netlify/functions/_variant-label.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'scripts/out/variants-missing-images.csv');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

async function pg(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!res.ok) { console.error(`GET ${path} → ${res.status}: ${await res.text()}`); process.exit(1); }
  return res.json();
}

// products embeds cleanly from product_variants ONLY with the FK named —
// products.lowest_price_variant_id points back here, so a bare embed is
// ambiguous in BOTH directions and PostgREST rejects the whole query with
// PGRST201. See CLAUDE.md. affiliate_links has a single FK to
// product_variants, so ITS embed is bare on purpose — do not "fix" it.
const rows = await pg(
  'product_variants?select=id,color,finish,variant_label,is_default,sku,upc,' +
  'products!product_variants_product_id_fkey(name,category,slug,manufacturers(name)),' +
  'affiliate_links(url,affiliate_url,op_mpn,op_merchant_product_id,retired_at)' +
  '&retired_at=is.null&primary_image_url=is.null&limit=5000',
);

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

let noLink = 0, noIdentifier = 0, mayFill = 0;
const out = rows.map((v) => {
  const live = (v.affiliate_links || []).filter((l) => l.retired_at == null);
  const withId = live.find((l) => l.op_merchant_product_id || l.op_mpn);
  const link = withId || live[0] || null;

  if (!live.length) noLink++;
  else if (!withId) noIdentifier++;
  else mayFill++;

  const p = v.products || {};
  return {
    product: p.name || '',
    brand: (p.manufacturers && p.manufacturers.name) || '',
    category: p.category || '',
    variant_label: variantLabel(v),
    is_default: v.is_default ? 'yes' : '',
    mpn: (link && link.op_mpn) || v.sku || '',
    merchant_product_id: (link && link.op_merchant_product_id) || '',
    affiliate_url: link ? (link.affiliate_url || link.url) : '',
    feed_may_fill: withId ? 'likely — unless withheld or the feed row has no image' : (live.length ? 'no — link has no stored identifier' : 'no — no live link'),
    variant_id: v.id,
    product_page: p.slug ? `https://gunforma.com/parts/${p.category || ''}/${p.slug}` : '',
  };
});

out.sort((a, b) => (a.brand + a.product + a.variant_label).localeCompare(b.brand + b.product + b.variant_label));

const cols = Object.keys(out[0] || { product: '' });
const csv = [cols.join(','), ...out.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, csv, 'utf8');

console.log(`${out.length} live variant(s) with no primary_image_url`);
console.log(`  ${mayFill} have a link with a stored identifier — the sync should fill MOST of these`);
console.log(`     (the sync's own dry-run count is authoritative; it also excludes withheld links)`);
console.log(`  ${noIdentifier} have a live link but no stored identifier`);
console.log(`  ${noLink} have no live link at all`);
console.log(`\n  -> ${noIdentifier + noLink} need a human either way`);
console.log(`written: ${OUT}`);
