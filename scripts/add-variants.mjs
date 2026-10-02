#!/usr/bin/env node
// add-variants.mjs — load product variants from a CSV through create_variant().
//
// WHY THIS EXISTS
// create_variant() shipped in migration 003 and nothing ever called it. Every
// real load went around it: rows into the variant_insert_import staging table,
// then hand-written INSERT…SELECT to fan them out across product_variants,
// variant_images and affiliate_links. That is four writes to remember, plus the
// slug format, the one-default-per-product rule, the position=1 image rule and
// the partner lookup — which is exactly the "adding a colour variant is
// complicated" problem 003 was written to end. The validation existed; the
// path around it was shorter, so the path around it is what got used.
//
// This is the short path. One CSV row in, one create_variant() call out, with
// the database enforcing the colour vocabulary, the slug, the default flag and
// the image/affiliate wiring. Migration 004 widened create_variant()'s guard so
// the service_role key can call it at all; before that it was admin-session
// only, which is the mechanical reason the staging detour existed.
//
// USAGE
//   node scripts/add-variants.mjs variants.csv            # dry run, default
//   node scripts/add-variants.mjs variants.csv --commit   # actually write
//
//   SUPABASE_SERVICE_ROLE_KEY=…  required
//   SUPABASE_URL=…               optional, defaults to the Gunforma project
//
// DRY RUN IS THE DEFAULT, on purpose. A bad bulk load is tedious to unpick:
// there is no transaction across rows here, so a half-applied run leaves real
// variants behind. The dry run validates every row against the live database
// — product slug exists, colour is in the vocabulary, partner resolves — and
// refuses to commit anything if any row fails. Fix the CSV, re-run.
//
// CSV COLUMNS
//   required : product_slug, color
//   optional : finish, sku, upc, msrp, image_url, variant_label, optic_cut,
//              handedness, notes, make_default,
//              partner_slug, url, affiliate_url, street_price, in_stock
//   `url` and `partner_slug` must be given together (create_variant enforces
//   this too) — an affiliate link with no partner earns nothing and a partner
//   with no URL is not a link.
//
// Unknown columns are an ERROR, not a warning. A typo'd header ("colour",
// "image") would otherwise silently drop that column from every row and the
// run would look clean.

import { readFileSync } from 'node:fs';
import { parse }        from 'csv-parse/sync';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const REQUIRED = ['product_slug', 'color'];
const OPTIONAL = [
  'finish', 'sku', 'upc', 'msrp', 'image_url', 'variant_label', 'optic_cut',
  'handedness', 'notes', 'make_default',
  'partner_slug', 'url', 'affiliate_url', 'street_price', 'in_stock',
];
const KNOWN = new Set([...REQUIRED, ...OPTIONAL]);

function fail(msg) { console.error(`error: ${msg}`); process.exit(1); }

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const str   = (v) => (blank(v) ? null : String(v).trim());

// Cell-level problems are COLLECTED, not thrown. Exiting on the first bad
// cell meant a CSV with five faults took five runs to clean up, and it hid
// the database-level checks further down entirely — which defeats the point
// of validating the whole file before writing any of it. Everything lands in
// one list and gets reported together.
const problems = [];
function num(v, row, col) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  if (!Number.isFinite(n)) { problems.push(`row ${row}: ${col} "${v}" is not a number`); return null; }
  return n;
}
function bool(v, row, col) {
  if (blank(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s))  return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  problems.push(`row ${row}: ${col} "${v}" is not true/false`);
  return null;
}

// Network errors are reported, not thrown: an unhandled fetch rejection dumps
// a v8 stack trace, which tells whoever is loading a CSV nothing useful. The
// common causes are a host with no egress to supabase.co and a wrong
// SUPABASE_URL, so say that.
async function httpOrFail(url, init, what) {
  try {
    return await fetch(url, init);
  } catch (e) {
    fail(`${what}: cannot reach ${SUPABASE_URL} (${e?.cause?.code || e?.message || e}).\n` +
         `       Check network egress to that host and SUPABASE_URL.`);
  }
}

async function pgGet(pathAndQuery) {
  const res = await httpOrFail(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }, `GET ${pathAndQuery}`);
  if (!res.ok) fail(`GET ${pathAndQuery} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function callCreateVariant(args) {
  const res = await httpOrFail(`${SUPABASE_URL}/rest/v1/rpc/create_variant`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  }, 'create_variant');
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text };
  return { ok: true, id: JSON.parse(text) };
}

// ─── main ───────────────────────────────────────────────────────────────────
const file   = process.argv[2];
const commit = process.argv.includes('--commit');
if (!file) fail('usage: node scripts/add-variants.mjs <file.csv> [--commit]');
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY not set');

const rows = parse(readFileSync(file, 'utf8'), {
  columns: true, skip_empty_lines: true, trim: true, bom: true,
});
if (!rows.length) fail(`${file} has no data rows`);

// Header check before touching the network.
const headers = Object.keys(rows[0]);
const unknown = headers.filter((h) => !KNOWN.has(h));
if (unknown.length) {
  fail(`unknown column(s): ${unknown.join(', ')}\n` +
       `       known: ${[...KNOWN].join(', ')}`);
}
const missing = REQUIRED.filter((c) => !headers.includes(c));
if (missing.length) fail(`missing required column(s): ${missing.join(', ')}`);

// Build the call payloads, failing loudly on malformed cells.
const calls = rows.map((r, i) => {
  const n = i + 2; // 1-based, +1 for the header line
  if (blank(r.product_slug)) problems.push(`row ${n}: product_slug is empty`);
  if (blank(r.color))        problems.push(`row ${n}: color is empty`);
  return {
    _row: n,
    p_product_slug:  str(r.product_slug),
    p_color:         str(r.color),
    p_finish:        str(r.finish),
    p_sku:           str(r.sku),
    p_upc:           str(r.upc),
    p_msrp:          num(r.msrp, n, 'msrp'),
    p_image_url:     str(r.image_url),
    p_partner_slug:  str(r.partner_slug),
    p_url:           str(r.url),
    p_affiliate_url: str(r.affiliate_url),
    p_street_price:  num(r.street_price, n, 'street_price'),
    p_in_stock:      bool(r.in_stock, n, 'in_stock'),
    p_variant_label: str(r.variant_label),
    p_optic_cut:     str(r.optic_cut),
    p_handedness:    str(r.handedness),
    p_notes:         str(r.notes),
    p_make_default:  bool(r.make_default, n, 'make_default'),
  };
});

// ─── validate every row against the live database before writing anything ───
const slugs  = [...new Set(calls.map((c) => c.p_product_slug))];
const colors = [...new Set(calls.map((c) => c.p_color))];

// Fetch the whole vocabulary rather than filtering by an in.(…) list.
// These are small (a few hundred products, ~60 colours, a handful of
// partners) and one unfiltered GET each is cheaper than the alternative is
// risky: building `slug=in.("a","b")` means hand-quoting values into a URL,
// and a single slug containing a comma, parenthesis or quote would silently
// change which rows come back — producing a FALSE "no product with slug"
// rejection, or worse, a false pass. Comparing against the full set has no
// such failure mode.
const [knownProducts, knownColors, knownPartners] = await Promise.all([
  pgGet('products?select=slug&limit=10000'),
  pgGet('colors?select=color&limit=10000'),
  pgGet('partners?select=slug&limit=10000'),
]);
const haveProduct = new Set(knownProducts.map((p) => p.slug));
const haveColor   = new Set(knownColors.map((c) => c.color));
const havePartner = new Set(knownPartners.map((p) => p.slug));

for (const c of calls) {
  if (c.p_product_slug === null || c.p_color === null) continue; // already reported
  if (!haveProduct.has(c.p_product_slug)) problems.push(`row ${c._row}: no product with slug "${c.p_product_slug}"`);
  if (!haveColor.has(c.p_color))          problems.push(`row ${c._row}: colour "${c.p_color}" is not in public.colors — add it there first, with a color_family`);
  if (!!c.p_url !== !!c.p_partner_slug)   problems.push(`row ${c._row}: url and partner_slug must be given together`);
  if (c.p_partner_slug && !havePartner.has(c.p_partner_slug)) problems.push(`row ${c._row}: no partner with slug "${c.p_partner_slug}"`);
}

console.log(`${file}: ${calls.length} row(s), ${slugs.length} product(s), ${colors.length} colour(s)`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s) — nothing was written:\n`);
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('all rows validate against the live database.');

if (!commit) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
  calls.slice(0, 5).forEach((c) => console.log(
    `  would add: ${c.p_product_slug} / ${c.p_color}${c.p_finish ? ' · ' + c.p_finish : ''}` +
    `${c.p_msrp != null ? '  $' + c.p_msrp : ''}`));
  if (calls.length > 5) console.log(`  … and ${calls.length - 5} more`);
  process.exit(0);
}

// ─── commit, one row at a time so a failure names its row ───────────────────
let added = 0;
const failures = [];
for (const c of calls) {
  const { _row, ...args } = c;
  const r = await callCreateVariant(args);
  if (r.ok) { added++; }
  else      { failures.push(`row ${_row} (${args.p_product_slug} / ${args.p_color}): ${r.error}`); }
}

console.log(`\nadded ${added} of ${calls.length} variant(s)`);
if (failures.length) {
  console.error(`\n${failures.length} row(s) failed:`);
  failures.forEach((f) => console.error('  ' + f));
  console.error(`\n${added} row(s) WERE written. The loop does not stop at a failure and`);
  console.error('there is no cross-row transaction, so the successes are spread through');
  console.error('the file, not confined to the rows above the first error. Re-run with');
  console.error('ONLY the failed rows above, or you will create duplicates.');
  process.exit(1);
}
