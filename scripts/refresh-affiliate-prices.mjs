#!/usr/bin/env node
// refresh-affiliate-prices.mjs — nightly Awin/OpticsPlanet price sync
// -----------------------------------------------------------------------------
// Pulls OpticsPlanet's Awin product datafeed, matches feed rows to our
// affiliate_links table by product URL (with SKU disambiguation for the
// handful of URLs that map to more than one variant), and updates
// street_price, in_stock and last_checked.
//
// Scope by design:
//   • Only touches affiliate_links rows where partner = "OpticsPlanet (Awin)".
//     Amazon, Olight, manual OpticsPlanet, and "Partner One" rows are
//     invisible to this job by construction — no partner_id filter bug can
//     accidentally widen its reach.
//   • Only three columns are ever written: street_price, in_stock,
//     last_checked. affiliate_url is NOT touched (it carries our own
//     placement-specific clickref tracking that the feed's aw_deep_link
//     would overwrite).
//   • Never blanks a row. If a match isn't found this run, existing values
//     are left as-is and the row's ID goes into an unmatched log.
//   • A failed fetch or parse exits before any DB write; a low match rate
//     also aborts before writing (MATCH_RATE_FLOOR, default 70%).
//
// Env (all required unless noted):
//   AWIN_FEED_URL              the Create-a-Feed URL (contains the API key)
//   SUPABASE_SERVICE_ROLE_KEY  bypasses RLS; kept in GitHub Actions secrets,
//                              never exposed to any site-runtime function
//   SUPABASE_URL               optional, defaults to the Gunforma project
//   DRY_RUN                    'true' → parse and log but do not write
//   MATCH_RATE_FLOOR           optional, default 0.70; abort below this
//
// Runs from GitHub Actions (see .github/workflows/refresh-affiliate-prices.yml)
// or locally with the same env vars set.
// -----------------------------------------------------------------------------

import { createGunzip } from 'node:zlib';
import { Readable }     from 'node:stream';
import { parse }        from 'csv-parse';

const AWIN_FEED_URL    = process.env.AWIN_FEED_URL || '';
const SUPABASE_URL     = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DRY_RUN          = process.env.DRY_RUN === 'true';
const MATCH_RATE_FLOOR = Number(process.env.MATCH_RATE_FLOOR || 0.70);
const DEBUG_SAMPLES    = Number(process.env.DEBUG_SAMPLES || 0);
const PARTNER_NAME     = 'OpticsPlanet (Awin)';
const OP_HOST          = 'opticsplanet.com';
const CONCURRENCY      = 10;
const FETCH_TIMEOUT_MS = 60_000;

// ─── logging ────────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
function c(color, s) {
  if (!isTTY) return s;
  const codes = { grey: 90, red: 31, green: 32, yellow: 33, cyan: 36, bold: 1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
function log(msg)  { console.log(msg); }
function warn(msg) { console.log(c('yellow', 'warn:  ') + msg); }
function fail(msg) { console.error(c('red', 'error: ') + msg); process.exit(1); }

// ─── preflight ──────────────────────────────────────────────────────────────
if (!AWIN_FEED_URL) fail('AWIN_FEED_URL not set');
if (!SERVICE_KEY)   fail('SUPABASE_SERVICE_ROLE_KEY not set');
if (DRY_RUN) log(c('cyan', '── DRY RUN — no database writes ──'));

// ─── URL canonicalization ───────────────────────────────────────────────────
// OpticsPlanet URLs sometimes carry _iv_* selector params that identify a
// specific color/finish (e.g. _iv_code=2VP-PSL-GGP7PS-GGP-365-BLK-1). Those
// ARE meaningful — a URL with different _iv_* params is a different variant.
// Session/tracking noise (utm_*, cid, aff_*, etc.) is NOT. Keep pathname +
// any _iv_* params; drop the rest. Lowercased host, no trailing slash.
function canonicalizeUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith(OP_HOST)) return null;
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (k.startsWith('_iv_')) kept.append(k, v);
  }
  const sortedKeys = [...new Set([...kept.keys()])].sort();
  const out = new URLSearchParams();
  for (const k of sortedKeys) {
    for (const v of kept.getAll(k)) out.append(k, v);
  }
  const path = u.pathname.replace(/\/+$/, '');
  const qs   = out.toString();
  return `${host}${path}${qs ? '?' + qs : ''}`;
}

// ─── Supabase PostgREST helpers ─────────────────────────────────────────────
async function pgGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) fail(`GET ${pathAndQuery} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function pgPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: {
      apikey:          SERVICE_KEY,
      Authorization:   `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) fail(`PATCH ${pathAndQuery} → ${res.status}: ${await res.text()}`);
}

// ─── load existing OpticsPlanet rows ────────────────────────────────────────
async function loadExistingRows() {
  const partners = await pgGet(
    `partners?name=eq.${encodeURIComponent(PARTNER_NAME)}&select=id`
  );
  if (!partners.length) fail(`partner "${PARTNER_NAME}" not found`);
  const partnerId = partners[0].id;
  const rows = await pgGet(
    `affiliate_links?partner_id=eq.${partnerId}` +
    `&select=id,url,street_price,in_stock,product_variants(sku,upc)`
  );
  const byUrl = new Map();      // canonical URL → [rows]
  const bySku = new Map();      // normalized SKU → row (fallback lookup)
  const byUpc = new Map();      // normalized UPC → row (fallback lookup)
  for (const r of rows) {
    const canon = canonicalizeUrl(r.url);
    if (!canon) continue;
    if (!byUrl.has(canon)) byUrl.set(canon, []);
    byUrl.get(canon).push(r);
    const sku = normalizeSku(r.product_variants?.sku);
    if (sku) bySku.set(sku, r);
    const upc = normalizeSku(r.product_variants?.upc);
    if (upc) byUpc.set(upc, r);
    // Some sku values are actually UPCs (like "791617481527") — index
    // those under byUpc too so a feed EAN/UPC hits them.
    if (sku && /^\d{12,14}$/.test(sku)) byUpc.set(sku, r);
  }
  return { rows, byUrl, bySku, byUpc };
}

// ─── fetch + stream-parse feed ──────────────────────────────────────────────
async function* streamOpticsPlanetRows() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(AWIN_FEED_URL, { signal: controller.signal });
  } catch (e) {
    fail(`fetch failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok)   fail(`feed responded ${res.status}`);
  if (!res.body) fail('feed body was empty');

  // Awin's Create-a-Feed serves .csv.gz as the file (gzip in the payload,
  // not as Content-Encoding), so fetch will NOT auto-decompress. If you
  // regenerated the feed URL without gzip, this pipeline will fail loudly.
  const nodeBody = Readable.fromWeb(res.body);
  const gunzip   = createGunzip();
  const parser   = parse({
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  nodeBody.on('error', e => parser.destroy(e));
  gunzip  .on('error', e => parser.destroy(e));
  nodeBody.pipe(gunzip).pipe(parser);

  let dumped = 0;
  for await (const row of parser) {
    if (dumped < DEBUG_SAMPLES) {
      console.log(c('cyan', `\n[debug feed row ${dumped + 1}/${DEBUG_SAMPLES}]`));
      // Dump only the fields useful for match-strategy debugging, in a
      // stable order. Full rows are hundreds of columns and mostly noise.
      const keys = [
        'merchant_deep_link', 'deep_link', 'aw_deep_link',
        'merchant_product_id', 'aw_product_id', 'product_id',
        'mpn', 'model_number', 'ean', 'upc', 'product_GTIN',
        'product_name', 'brand_name',
        'search_price', 'display_price', 'store_price', 'price', 'rrp_price',
        'in_stock', 'stock_quantity', 'stock_status', 'availability',
      ];
      for (const k of keys) {
        if (row[k] != null && row[k] !== '') console.log(`  ${k}: ${row[k]}`);
      }
      dumped++;
    }
    const link = row.merchant_deep_link || row.deep_link ||
                 row.aw_deep_link       || row.aw_product_link;
    if (!link || !link.toLowerCase().includes(OP_HOST)) continue;
    yield row;
  }
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();

  log(c('bold', '\nLoading existing OpticsPlanet rows from Supabase…'));
  const { rows, byUrl, bySku, byUpc } = await loadExistingRows();
  const shared = [...byUrl.entries()].filter(([, list]) => list.length > 1);
  log(`  rows:                    ${rows.length}`);
  log(`  distinct canonical URLs: ${byUrl.size}`);
  log(`  with SKU:                ${bySku.size}`);
  log(`  with UPC (or numeric SKU): ${byUpc.size}`);
  log(`  shared URLs (>1 row):    ${shared.length}   (rows: ${shared.reduce((n, [, l]) => n + l.length, 0)})`);

  log(c('bold', '\nFetching + parsing Awin feed…'));
  let feedRowsSeen = 0;
  const updates = new Map();          // link.id → patch
  const unresolvedAmbiguous = [];     // { url, feedSku, candidateIds[] }
  const today = new Date().toISOString().slice(0, 10);

  for await (const row of streamOpticsPlanetRows()) {
    feedRowsSeen++;
    const canonicalDest = canonicalizeUrl(
      row.merchant_deep_link || row.deep_link ||
      row.aw_product_link    || row.aw_deep_link
    );
    if (!canonicalDest) continue;

    const price   = parsePrice(row);
    const inStock = parseStock(row);
    if (price == null && inStock == null) continue;

    // Pull all the identifiers the feed might use for matching against our
    // sku/upc columns. Priority reflects what actually matches in practice:
    //   mpn / model_number → manufacturer part number, matches DB sku
    //   ean / upc / product_GTIN → GTIN-family, matches DB upc (and DB sku
    //     when the sku column happens to hold a UPC — 81 of ours do)
    //   merchant_product_id → OpticsPlanet's internal ID, rarely matches
    //     anything of ours (kept as last resort)
    const feedMpn = normalizeSku(row.mpn || row.model_number);
    const feedGtin = normalizeSku(row.ean || row.upc || row.product_GTIN);
    const feedMerchantId = normalizeSku(row.merchant_product_id || row.product_id);

    let target = null;
    const candidates = byUrl.get(canonicalDest);
    if (candidates && candidates.length === 1) {
      target = candidates[0];
    } else if (candidates && candidates.length > 1) {
      // Disambiguate on any identifier we have, in preference order.
      for (const [feedId, ourAccessor] of [
        [feedMpn,        r => normalizeSku(r.product_variants?.sku)],
        [feedGtin,       r => normalizeSku(r.product_variants?.upc)],
        [feedGtin,       r => normalizeSku(r.product_variants?.sku)],
        [feedMerchantId, r => normalizeSku(r.product_variants?.sku)],
      ]) {
        if (!feedId) continue;
        const hit = candidates.find(r => ourAccessor(r) === feedId);
        if (hit) { target = hit; break; }
      }
      if (!target) {
        unresolvedAmbiguous.push({
          url: canonicalDest,
          feedMpn, feedGtin, feedMerchantId,
          candidateIds: candidates.map(x => x.id),
        });
        continue;
      }
    } else {
      // No URL match. Try identifier-only match, in preference order. Only
      // accept when the ID is unique on our side (bySku/byUpc dedupe already).
      if      (feedMpn        && bySku.has(feedMpn))        target = bySku.get(feedMpn);
      else if (feedGtin       && byUpc.has(feedGtin))       target = byUpc.get(feedGtin);
      else if (feedGtin       && bySku.has(feedGtin))       target = bySku.get(feedGtin);
      else if (feedMerchantId && bySku.has(feedMerchantId)) target = bySku.get(feedMerchantId);
      else continue;
    }

    // Only queue changes if something actually differs.
    const patch = { last_checked: today };
    if (price   != null && Number(target.street_price) !== price) patch.street_price = price;
    if (inStock != null && target.in_stock !== inStock)           patch.in_stock     = inStock;
    updates.set(target.id, patch);
  }

  const matched      = updates.size;
  const priceChanged = [...updates.values()].filter(p => 'street_price' in p).length;
  const stockChanged = [...updates.values()].filter(p => 'in_stock'     in p).length;
  const matchRate    = rows.length ? matched / rows.length : 0;
  const unmatched    = rows.filter(r => !updates.has(r.id));

  log(c('bold', '\nSummary'));
  log(`  feed rows (opticsplanet.com): ${feedRowsSeen}`);
  log(`  existing rows in DB:          ${rows.length}`);
  log(`  matched:                      ${matched}   (${(matchRate * 100).toFixed(1)}%)`);
  log(`  price changed:                ${priceChanged}`);
  log(`  stock flag changed:           ${stockChanged}`);
  log(`  ambiguous unresolved:         ${unresolvedAmbiguous.length}`);
  log(`  unmatched:                    ${unmatched.length}`);
  if (unmatched.length && unmatched.length <= 30) {
    log(c('grey', '    unmatched IDs: ' + unmatched.map(r => r.id).join(', ')));
  }
  if (unresolvedAmbiguous.length) {
    log(c('grey', '    ambiguous (first 10):'));
    for (const a of unresolvedAmbiguous.slice(0, 10)) {
      log(c('grey',
        `      ${a.url}  (mpn: ${a.feedMpn || '—'}, gtin: ${a.feedGtin || '—'}, ` +
        `mid: ${a.feedMerchantId || '—'})`
      ));
    }
  }

  if (matchRate < MATCH_RATE_FLOOR) {
    fail(
      `match rate ${(matchRate * 100).toFixed(1)}% is below floor ` +
      `${(MATCH_RATE_FLOOR * 100).toFixed(0)}%. Refusing to write. ` +
      'Investigate feed shape before rerunning.'
    );
  }

  if (DRY_RUN) {
    log(c('cyan', '\n[dry-run] no writes performed'));
    log(`  duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  log(c('bold', `\nWriting ${matched} row updates (concurrency ${CONCURRENCY})…`));
  const entries = [...updates.entries()];
  let written = 0;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const chunk = entries.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(([id, patch]) =>
      pgPatch(`affiliate_links?id=eq.${id}`, patch)
    ));
    written += chunk.length;
    if (written % 100 === 0 || written === entries.length) {
      log(c('grey', `  ${written}/${entries.length}`));
    }
  }

  log(c('green', `\n✓ updated ${written} rows in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`));
}

// ─── parsing helpers ────────────────────────────────────────────────────────
function parsePrice(row) {
  // Awin exposes several price columns depending on vertical/feed generation.
  // Take the first present, in preference order.
  const raw = row.search_price ?? row.display_price ?? row.store_price ??
              row.price         ?? row.base_price;
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function parseStock(row) {
  const s = String(row.in_stock ?? row.availability ?? row.stock_status ?? '').toLowerCase().trim();
  if (!s) {
    const q = row.stock_quantity;
    if (q == null || q === '') return null;
    const n = Number(q);
    return Number.isFinite(n) ? n > 0 : null;
  }
  if (['1', 'true', 'yes', 'in stock', 'in_stock', 'available'].includes(s))            return true;
  if (['0', 'false', 'no', 'out of stock', 'out_of_stock', 'unavailable', 'sold out'].includes(s)) return false;
  return null;
}
function normalizeSku(sku) {
  return sku == null ? null : String(sku).trim().toLowerCase() || null;
}

main().catch(e => fail(`unhandled: ${e.stack || e.message}`));
