#!/usr/bin/env node
// refresh-affiliate-prices.mjs — v4: nightly Awin/OpticsPlanet price sync
// -----------------------------------------------------------------------------
// Pulls OpticsPlanet's Awin product datafeed, matches feed rows to our
// affiliate_links table using a six-tier match strategy (strict first, fuzzy
// last, everything auditable), and updates street_price, in_stock,
// last_checked, plus four new op_* audit columns.
//
// Scope by design:
//   • Only touches affiliate_links rows where partner = "OpticsPlanet (Awin)".
//   • Seven columns written on match: street_price, in_stock, last_checked,
//     op_mpn, op_gtin, op_merchant_product_id, op_last_matched_by.
//   • affiliate_url, product_variants.sku, product_variants.upc, msrp:
//     NEVER WRITTEN. Not now, not ever.
//   • Unmatched rows: left as-is, logged.
//   • Failed fetch/parse or low match rate: exit before any DB write.
//
// Match tiers (tried in order, first hit wins):
//   T1  stored_op_mpn   — previously matched; op_mpn matches feed mpn exactly
//   T2  stored_op_gtin  — previously matched; op_gtin matches feed gtin exactly
//   T3  url+mpn         — canonical URL match + strict mpn match (lowercase+trim)
//   T4  url+gtin        — canonical URL match + strict gtin match (leading-zero-stripped)
//   T5  url_only        — canonical URL match, exactly one candidate, no ID confirmation
//   T6  fuzzy_mpn       — canonical URL match + alphanumeric-only SKU comparison
//                         (TD-P365SC-Gold vs tdp365scgold). FLAGGED for review.
//
// Rows that match only via T6 are written but marked op_last_matched_by =
// 'fuzzy_mpn_needs_review' and printed in a review block. The operator can
// eyeball them and, if any are wrong, add exclusion rules before re-running
// with DRY_RUN=false.
//
// Env (all required unless noted):
//   AWIN_FEED_URL              the Create-a-Feed URL (contains the API key)
//   SUPABASE_SERVICE_ROLE_KEY  bypasses RLS; kept in GitHub Actions secrets
//   SUPABASE_URL               optional, defaults to the Gunforma project
//   DRY_RUN                    'true' → parse and log but do not write
//   MATCH_RATE_FLOOR           optional, default 0.70; abort below this
//   DEBUG_SAMPLES              optional, default 0; dump N raw feed rows
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

// ─── normalizers ────────────────────────────────────────────────────────────
// TWO normalizers, not one. They serve different comparison families.

// Strict: lowercase + trim only. Used for T1-T5 exact comparisons.
function strictNorm(val) {
  return val == null ? null : String(val).trim().toLowerCase() || null;
}

// Fuzzy: strip ALL non-alphanumeric. "TD-P365SC-Gold" → "tdp365scgold".
// Used ONLY for T6 (flagged for review). Never for silent matching.
function fuzzyNorm(val) {
  return val == null ? null : String(val).toLowerCase().replace(/[^a-z0-9]/g, '') || null;
}

// GTIN: strip non-digits then strip leading zeros.
// "00612789319039" → "612789319039" to match our DB's 12-digit UPCs.
function gtinNorm(val) {
  if (val == null) return null;
  const digits = String(val).replace(/[^0-9]/g, '').replace(/^0+/, '');
  return digits || null;
}

// ─── URL canonicalization ───────────────────────────────────────────────────
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
    `&select=id,url,street_price,in_stock,op_mpn,op_gtin,op_merchant_product_id,op_last_matched_by,product_variants(sku,upc)`
  );

  // Index 1: canonical URL → [rows]
  const byUrl = new Map();
  // Index 2: strict-normalized SKU → row
  const bySku = new Map();
  // Index 3: GTIN-normalized UPC → row
  const byUpc = new Map();
  // Index 4: strict-normalized stored op_mpn → row (for T1)
  const byOpMpn = new Map();
  // Index 5: GTIN-normalized stored op_gtin → row (for T2)
  const byOpGtin = new Map();

  for (const r of rows) {
    const canon = canonicalizeUrl(r.url);
    if (!canon) continue;
    r._canon = canon;  // stash for later diagnostics

    if (!byUrl.has(canon)) byUrl.set(canon, []);
    byUrl.get(canon).push(r);

    const sku = strictNorm(r.product_variants?.sku);
    if (sku) bySku.set(sku, r);

    const upc = gtinNorm(r.product_variants?.upc);
    if (upc) byUpc.set(upc, r);
    // SKU values that are numeric UPCs (e.g. "791617481527") → also index as GTIN
    if (r.product_variants?.sku && /^\d{12,14}$/.test(String(r.product_variants.sku).trim())) {
      const skuGtin = gtinNorm(r.product_variants.sku);
      if (skuGtin) byUpc.set(skuGtin, r);
    }

    // Stored op_* fields from previous successful matches (T1, T2)
    const opMpn = strictNorm(r.op_mpn);
    if (opMpn) byOpMpn.set(opMpn, r);
    const opGtin = gtinNorm(r.op_gtin);
    if (opGtin) byOpGtin.set(opGtin, r);
  }

  return { rows, byUrl, bySku, byUpc, byOpMpn, byOpGtin };
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
      const keys = [
        'merchant_deep_link', 'aw_deep_link',
        'merchant_product_id', 'aw_product_id',
        'mpn', 'model_number', 'ean', 'upc', 'product_GTIN',
        'product_name', 'brand_name',
        'search_price', 'display_price', 'store_price', 'rrp_price',
        'in_stock', 'stock_quantity', 'stock_status',
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
  const { rows, byUrl, bySku, byUpc, byOpMpn, byOpGtin } = await loadExistingRows();
  const shared = [...byUrl.entries()].filter(([, list]) => list.length > 1);
  const storedOp = rows.filter(r => r.op_mpn || r.op_gtin).length;
  log(`  rows:                       ${rows.length}`);
  log(`  distinct canonical URLs:    ${byUrl.size}`);
  log(`  with SKU:                   ${bySku.size}`);
  log(`  with UPC (or numeric SKU):  ${byUpc.size}`);
  log(`  with stored op_mpn/op_gtin: ${storedOp}  (T1/T2 exact re-match)`);
  log(`  shared URLs (>1 row):       ${shared.length}   (rows: ${shared.reduce((n, [, l]) => n + l.length, 0)})`);

  log(c('bold', '\nFetching + parsing Awin feed…'));
  let feedRowsSeen = 0;

  // Per-tier counters
  const tierCounts = {
    stored_op_mpn: 0, stored_op_gtin: 0,
    'url+mpn': 0, 'url+gtin': 0, url_only: 0,
    strict_id_only: 0, fuzzy_mpn_needs_review: 0,
  };
  const updates = new Map();              // link.id → { patch, tier }
  const unresolvedAmbiguous = [];
  const unmatchedFeedUrls   = [];
  const fuzzyReviewList     = [];         // { linkId, ourSku, theirMpn, url }
  const driftWarnings       = [];         // { linkId, field, old, new }
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

    // Raw feed identifiers (preserved as-is for audit columns)
    const rawMpn  = (row.mpn || row.model_number || '').trim() || null;
    const rawGtin = (row.ean || row.upc || row.product_GTIN || '').trim() || null;
    const rawMid  = (row.merchant_product_id || row.product_id || '').trim() || null;

    // Normalized for comparison
    const feedMpnStrict = strictNorm(rawMpn);
    const feedGtinNorm  = gtinNorm(rawGtin);
    const feedMpnFuzzy  = fuzzyNorm(rawMpn);
    const feedMidStrict = strictNorm(rawMid);

    let target = null;
    let tier   = null;

    // ── T1: stored op_mpn (exact re-match from prior run) ──────────────
    if (!target && feedMpnStrict && byOpMpn.has(feedMpnStrict)) {
      target = byOpMpn.get(feedMpnStrict);
      tier = 'stored_op_mpn';
    }
    // ── T2: stored op_gtin (exact re-match from prior run) ─────────────
    if (!target && feedGtinNorm && byOpGtin.has(feedGtinNorm)) {
      target = byOpGtin.get(feedGtinNorm);
      tier = 'stored_op_gtin';
    }

    const candidates = !target ? byUrl.get(canonicalDest) : null;

    // ── T3: URL + strict mpn match ─────────────────────────────────────
    if (!target && candidates && feedMpnStrict) {
      const hit = candidates.find(r =>
        strictNorm(r.product_variants?.sku) === feedMpnStrict
      );
      if (hit) { target = hit; tier = 'url+mpn'; }
    }
    // ── T4: URL + strict gtin match ────────────────────────────────────
    if (!target && candidates && feedGtinNorm) {
      const hit = candidates.find(r =>
        gtinNorm(r.product_variants?.upc) === feedGtinNorm ||
        gtinNorm(r.product_variants?.sku) === feedGtinNorm
      );
      if (hit) { target = hit; tier = 'url+gtin'; }
    }
    // ── T5: URL only (single candidate, no ID confirmation) ────────────
    if (!target && candidates && candidates.length === 1) {
      target = candidates[0];
      tier = 'url_only';
    }
    // ── T6: URL + fuzzy mpn (FLAGGED for review) ───────────────────────
    if (!target && candidates && candidates.length > 1 && feedMpnFuzzy) {
      const hit = candidates.find(r =>
        fuzzyNorm(r.product_variants?.sku) === feedMpnFuzzy
      );
      if (hit) {
        target = hit;
        tier = 'fuzzy_mpn_needs_review';
        fuzzyReviewList.push({
          linkId: hit.id,
          ourSku: hit.product_variants?.sku || '—',
          theirMpn: rawMpn || '—',
          url: canonicalDest,
        });
      }
    }
    // ── No URL match at all — try strict ID-only as last resort ────────
    if (!target) {
      if      (feedMpnStrict && bySku.has(feedMpnStrict))   { target = bySku.get(feedMpnStrict); tier = 'strict_id_only'; }
      else if (feedGtinNorm  && byUpc.has(feedGtinNorm))    { target = byUpc.get(feedGtinNorm);  tier = 'strict_id_only'; }
      else if (feedMidStrict && bySku.has(feedMidStrict))   { target = bySku.get(feedMidStrict); tier = 'strict_id_only'; }
    }

    if (!target) {
      if (candidates && candidates.length > 1) {
        unresolvedAmbiguous.push({
          url: canonicalDest,
          feedMpn: rawMpn, feedGtin: rawGtin, feedMid: rawMid,
          candidateIds: candidates.map(x => x.id),
        });
      } else if (unmatchedFeedUrls.length < 25) {
        unmatchedFeedUrls.push({ url: canonicalDest, mpn: rawMpn, gtin: rawGtin, mid: rawMid });
      }
      continue;
    }

    // ── Build patch ────────────────────────────────────────────────────
    const patch = {
      last_checked: today,
      op_mpn: rawMpn,
      op_gtin: rawGtin,
      op_merchant_product_id: rawMid,
      op_last_matched_by: tier,
    };
    if (price   != null && Number(target.street_price) !== price) patch.street_price = price;
    if (inStock != null && target.in_stock !== inStock)           patch.in_stock     = inStock;

    // ── Drift detection ────────────────────────────────────────────────
    if (target.op_mpn && rawMpn && strictNorm(target.op_mpn) !== strictNorm(rawMpn)) {
      driftWarnings.push({ linkId: target.id, field: 'op_mpn', old: target.op_mpn, new: rawMpn });
    }
    if (target.op_gtin && rawGtin && gtinNorm(target.op_gtin) !== gtinNorm(rawGtin)) {
      driftWarnings.push({ linkId: target.id, field: 'op_gtin', old: target.op_gtin, new: rawGtin });
    }

    tierCounts[tier]++;
    updates.set(target.id, patch);
  }

  // ─── Summary ──────────────────────────────────────────────────────────
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

  log(c('bold', '\nMatch confidence breakdown'));
  for (const [tier, n] of Object.entries(tierCounts)) {
    if (n > 0) log(`  ${tier.padEnd(30)} ${n}`);
  }

  if (fuzzyReviewList.length) {
    log(c('yellow', `\nFuzzy matches for review (${fuzzyReviewList.length}):`));
    for (const f of fuzzyReviewList) {
      log(c('yellow', `  Link ${f.linkId.slice(0, 8)}…`));
      log(c('yellow', `    our sku:   ${f.ourSku}`));
      log(c('yellow', `    their mpn: ${f.theirMpn}`));
      log(c('yellow', `    URL:       ${f.url}`));
    }
  }

  if (driftWarnings.length) {
    log(c('yellow', `\nDrift warnings (${driftWarnings.length}):`));
    for (const d of driftWarnings.slice(0, 20)) {
      log(c('yellow', `  Link ${d.linkId.slice(0, 8)}…  ${d.field}: "${d.old}" → "${d.new}"`));
    }
  }

  if (unresolvedAmbiguous.length) {
    log(c('grey', '\n  Ambiguous (first 10):'));
    for (const a of unresolvedAmbiguous.slice(0, 10)) {
      log(c('grey',
        `    ${a.url}  (mpn: ${a.feedMpn || '—'}, gtin: ${a.feedGtin || '—'}, mid: ${a.feedMid || '—'})`
      ));
    }
  }

  // URL-shape diagnostic when match rate is imperfect
  if (matchRate < 0.90 && unmatched.length && unmatchedFeedUrls.length) {
    log(c('grey', '\n  URL-shape diagnostic:'));
    log(c('grey', '    unmatched DB URLs (first 10):'));
    for (const r of unmatched.slice(0, 10)) {
      log(c('grey', `      ${r._canon || r.url}  (sku: ${r.product_variants?.sku || '—'})`));
    }
    log(c('grey', '    unmatched feed URLs (first 10):'));
    for (const f of unmatchedFeedUrls.slice(0, 10)) {
      log(c('grey', `      ${f.url}  (mpn: ${f.mpn || '—'}, gtin: ${f.gtin || '—'})`));
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

main().catch(e => fail(`unhandled: ${e.stack || e.message}`));
