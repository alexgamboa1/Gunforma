#!/usr/bin/env node
// refresh-affiliate-prices.mjs — v5: nightly Awin multi-merchant price sync
// -----------------------------------------------------------------------------
// Pulls Awin's COMBINED product datafeed (all joined merchants in one file),
// routes each row to the right partner by merchant_id, matches feed rows to our
// affiliate_links table using a six-tier match strategy (strict first, fuzzy
// last, everything auditable), and updates street_price, in_stock,
// last_checked, plus four op_* audit columns.
//
// v6 changes (identifier safety):
//   • The sync may FILL an op_* identifier that is null. It must NEVER
//     overwrite one that is already set. A stored identifier is what pins a
//     link to one product; replacing it on "drift" silently re-points the link,
//     and T1/T2 then re-confirm the wrong product on every later run.
//   • Contradictions go to a review list (logged, and appended to
//     public.sync_drift_review) instead of being written.
//   • Several feed rows resolving to the same link is a CONFLICT: that link is
//     skipped rather than letting the last row in the file win.
//   • A contradicted identifier also blocks the price/stock write for that
//     link, because the match itself is in doubt.
//
// v5 changes (multi-merchant):
//   • Feed rows are routed by merchant_id -> partners.awin_merchant_id.
//     There is no hardcoded partner and no hardcoded host.
//   • Each partner has its own URL host and its own match-rate floor
//     (see PARTNER_CONFIG).
//   • A partner failing its floor is SKIPPED, not fatal — the other partners
//     still write. The run then exits non-zero so Actions shows red.
//
// Scope by design:
//   • Only touches affiliate_links rows whose partner has an awin_merchant_id.
//   • Seven columns written on match: street_price, in_stock, last_checked,
//     op_mpn, op_gtin, op_merchant_product_id, op_last_matched_by.
//   • affiliate_url, product_variants.sku, product_variants.upc, msrp:
//     NEVER WRITTEN. Not now, not ever.
//   • Unmatched rows: left as-is, logged.
//   • Failed fetch/parse: exit before any DB write.
//
// Every write to affiliate_links fires the price_history trigger, so a run
// that touches N rows appends up to N history rows. Bulk edits show up as
// spikes in that table — see CLAUDE.md.
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
//   AWIN_FEED_URL_V2           the combined Create-a-Feed URL (contains the API key)
//   SUPABASE_SERVICE_ROLE_KEY  bypasses RLS; kept in GitHub Actions secrets
//   SUPABASE_URL               optional, defaults to the Gunforma project
//   DRY_RUN                    'true' → parse and log but do not write
//   MATCH_RATE_FLOOR           optional; overrides EVERY partner's floor. Escape
//                              hatch for one-off reruns — normally unset, so the
//                              per-partner floors in PARTNER_CONFIG apply.
//   DEBUG_SAMPLES              optional, default 0; dump N raw feed rows
// -----------------------------------------------------------------------------

import { createGunzip } from 'node:zlib';
import { Readable }     from 'node:stream';
import { parse }        from 'csv-parse';
import { fileURLToPath } from 'node:url';
import { resolve }       from 'node:path';

const AWIN_FEED_URL    = process.env.AWIN_FEED_URL_V2 || '';
const SUPABASE_URL     = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DRY_RUN          = process.env.DRY_RUN === 'true';
const FLOOR_OVERRIDE   = process.env.MATCH_RATE_FLOOR ? Number(process.env.MATCH_RATE_FLOOR) : null;
const DEBUG_SAMPLES    = Number(process.env.DEBUG_SAMPLES || 0);
const CONCURRENCY      = 10;
const FETCH_TIMEOUT_MS = 120_000;

// ─── per-partner configuration ──────────────────────────────────────────────
// Keyed by partners.awin_merchant_id. A merchant in the feed with no entry here
// is ignored; a partner in the DB with no entry here is skipped with a warning.
//
// `floor` is a CIRCUIT BREAKER, not a coverage target. It exists to catch a
// sudden collapse — a broken feed, a changed column layout, a merchant pulling
// their catalogue — where writing would corrupt good data with nulls or stale
// prices. It is deliberately set well BELOW the observed match rate so that
// normal coverage drift never trips it. Raising a floor to chase better
// coverage is the wrong tool: fix the matching instead.
//
// Measured on 2026-09-22 against the combined feed (492,753 rows), under the
// v6 identifier policy, which withholds links whose identifiers are
// contradicted or contested:
//   46059 OpticsPlanet  404/468 = 86.3%  → floor 0.75
//   90861 Olight         14/25  = 56.0%  → floor 0.40
//
// OpticsPlanet's floor was 0.85 when the measured rate was 91.6%. v6 withholds
// ~25 more links (24 candidate conflicts + 1 drift), which drops the rate to
// 86.3% — 1.3 points of headroom, against a constant whose whole purpose is to
// sit well clear of normal variation. One more colliding MPN would have
// skipped the entire partner and stopped 400+ legitimate price updates. 0.75
// restores a real margin without weakening the breaker: a genuine feed
// collapse lands far below it.
//
// Olight's rate is low because its feed rows carry no mpn at all (0/218) and
// only 216 usable GTINs; its floor sits beneath the measured rate for the same
// circuit-breaker reason, not as an endorsement of 56%.
const PARTNER_CONFIG = {
  '46059': { host: 'opticsplanet.com', floor: 0.75 },
  '90861': { host: 'olight.com',       floor: 0.40 },
};

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

// GTIN: take the FIRST whitespace-separated token, then strip non-digits and
// leading zeros.
//
// The whitespace split is not cosmetic. Olight's feed ships GTINs like
// "6978095650162 78" — a valid EAN-13 followed by a space and trailing digits.
// Stripping non-digits across the whole string concatenates them into a
// 15-digit value that is not a GTIN and matches nothing, which silently cost us
// every Olight T2 match. 215 of Olight's 216 populated GTINs have this shape;
// zero of OpticsPlanet's 439,973 do, so this is a no-op for OpticsPlanet.
//
// "00612789319039"    → "612789319039"   (leading zeros stripped, 12-digit UPC)
// "6978095650162 78"  → "6978095650162"  (first token only)
export function gtinNorm(val) {
  if (val == null) return null;
  const first = String(val).trim().split(/\s+/)[0];
  const digits = first.replace(/[^0-9]/g, '').replace(/^0+/, '');
  return digits || null;
}

// ─── URL canonicalization ───────────────────────────────────────────────────
// `allowedHost` is the partner's own host (PARTNER_CONFIG[mid].host). A URL on
// any other host returns null — the caller treats that as "not this partner's
// row". Previously this was a single module-level OP_HOST constant, which made
// every olight.com URL canonicalize to null.
function canonicalizeUrl(raw, allowedHost) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (allowedHost && !host.endsWith(allowedHost)) return null;
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

// Strip _iv_* params from a canonical URL to get the base product page URL.
// Feed URLs never carry _iv_* params; 310 of our 466 DB URLs do.
// This creates a candidate group just like shared URLs, so the same
// disambiguation tiers (T3-T6) apply.
function baseUrlOf(canonicalUrl) {
  const qIdx = canonicalUrl.indexOf('?');
  return qIdx === -1 ? canonicalUrl : canonicalUrl.slice(0, qIdx);
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

// ─── load partners that are wired to an Awin merchant ───────────────────────
async function loadPartners() {
  const partners = await pgGet(
    'partners?awin_merchant_id=not.is.null&select=id,name,awin_merchant_id'
  );
  if (!partners.length) fail('no partners have an awin_merchant_id set');
  return partners;
}

// ─── load one partner's existing rows + build its match indexes ─────────────
async function loadExistingRows(partner, host) {
  const rows = await pgGet(
    `affiliate_links?partner_id=eq.${partner.id}&limit=5000` +
    `&select=id,url,street_price,in_stock,op_mpn,op_gtin,op_merchant_product_id,op_last_matched_by,product_variants(sku,upc)`
  );

  // Index 1: canonical URL (with _iv_* params) → [rows]
  const byUrl = new Map();
  // Index 1b: base URL (no _iv_* params) → [rows]
  // Feed URLs never carry _iv_* params. Many of our DB URLs do. This index
  // groups those DB rows by their base product page so the same
  // disambiguation tiers (T3–T6) work on them.
  const byBaseUrl = new Map();
  // Index 2: strict-normalized SKU → row
  const bySku = new Map();
  // Index 3: GTIN-normalized UPC → row
  const byUpc = new Map();
  // Index 4: strict-normalized stored op_mpn → row (for T1)
  const byOpMpn = new Map();
  // Index 5: GTIN-normalized stored op_gtin → row (for T2)
  const byOpGtin = new Map();
  // Index 6: link id → row, so proposal resolution can read the stored
  // identifiers back without a second fetch.
  const byId = new Map(rows.map(r => [r.id, r]));

  for (const r of rows) {
    const canon = canonicalizeUrl(r.url, host);
    if (!canon) continue;
    r._canon = canon;  // stash for later diagnostics

    if (!byUrl.has(canon)) byUrl.set(canon, []);
    byUrl.get(canon).push(r);

    const base = baseUrlOf(canon);
    if (!byBaseUrl.has(base)) byBaseUrl.set(base, []);
    byBaseUrl.get(base).push(r);

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

  return { rows, byId, byUrl, byBaseUrl, bySku, byUpc, byOpMpn, byOpGtin };
}

// ─── fetch + stream-parse feed ──────────────────────────────────────────────
// Yields EVERY row with its merchant_id. Routing and host filtering are the
// caller's job — this used to drop any row whose link did not contain
// opticsplanet.com, which silently discarded every other merchant's catalogue.
async function* streamFeedRows() {
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
        'merchant_id', 'merchant_name',
        'merchant_deep_link', 'aw_deep_link',
        'merchant_product_id', 'aw_product_id',
        'mpn', 'model_number', 'ean', 'upc', 'product_GTIN',
        'product_name', 'brand_name', 'colour',
        'search_price', 'display_price', 'store_price', 'rrp_price',
        'in_stock', 'stock_quantity', 'stock_status',
      ];
      for (const k of keys) {
        if (row[k] != null && row[k] !== '') console.log(`  ${k}: ${row[k]}`);
      }
      dumped++;
    }
    yield row;
  }
}

// ─── match one feed row into one partner's state ────────────────────────────
// Identical tier logic to v4; the only change is that everything it touches
// comes from `st` (the partner's own indexes and host) instead of module state.
function processFeedRow(st, row, today) {
  const canonicalDest = canonicalizeUrl(
    row.merchant_deep_link || row.deep_link ||
    row.aw_product_link    || row.aw_deep_link,
    st.host
  );
  if (!canonicalDest) return;

  const price   = parsePrice(row);
  const inStock = parseStock(row);
  if (price == null && inStock == null) return;

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
  if (!target && feedMpnStrict && st.byOpMpn.has(feedMpnStrict)) {
    target = st.byOpMpn.get(feedMpnStrict);
    tier = 'stored_op_mpn';
  }
  // ── T2: stored op_gtin (exact re-match from prior run) ─────────────
  if (!target && feedGtinNorm && st.byOpGtin.has(feedGtinNorm)) {
    target = st.byOpGtin.get(feedGtinNorm);
    tier = 'stored_op_gtin';
  }

  // Candidates: try exact canonical URL first, then base URL (without
  // _iv_* params) as fallback. The feed never carries _iv_* params, so
  // many of our DB rows can only match via the base-URL candidate group.
  const candidates = !target
    ? (st.byUrl.get(canonicalDest) || st.byBaseUrl.get(baseUrlOf(canonicalDest)) || null)
    : null;

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
      st.fuzzyReviewList.push({
        linkId: hit.id,
        ourSku: hit.product_variants?.sku || '—',
        theirMpn: rawMpn || '—',
        url: canonicalDest,
      });
    }
  }
  // ── No URL match at all — try strict ID-only as last resort ────────
  if (!target) {
    if      (feedMpnStrict && st.bySku.has(feedMpnStrict))  { target = st.bySku.get(feedMpnStrict); tier = 'strict_id_only'; }
    else if (feedGtinNorm  && st.byUpc.has(feedGtinNorm))   { target = st.byUpc.get(feedGtinNorm);  tier = 'strict_id_only'; }
    else if (feedMidStrict && st.bySku.has(feedMidStrict))  { target = st.bySku.get(feedMidStrict); tier = 'strict_id_only'; }
  }

  if (!target) {
    if (candidates && candidates.length > 1) {
      st.unresolvedAmbiguous.push({
        url: canonicalDest,
        feedMpn: rawMpn, feedGtin: rawGtin, feedMid: rawMid,
        candidateIds: candidates.map(x => x.id),
      });
    } else if (st.unmatchedFeedUrls.length < 25) {
      st.unmatchedFeedUrls.push({ url: canonicalDest, mpn: rawMpn, gtin: rawGtin, mid: rawMid });
    }
    return;
  }

  // ── Record a PROPOSAL, do not build the patch yet ──────────────────
  // The patch cannot be decided from one feed row in isolation: several feed
  // rows can resolve to the same link, and the old code let the last one win
  // silently (tier counts summed to 468 against 429 matched — 39 collisions).
  // Proposals are collected here and resolved once per link below.
  if (!st.proposals.has(target.id)) st.proposals.set(target.id, []);
  st.proposals.get(target.id).push({
    tier, price, inStock,
    rawMpn, rawGtin, rawMid,
    feedName: (row.product_name || '').slice(0, 120),
    url: canonicalDest,
  });
}

// ─── resolve proposals into patches ─────────────────────────────────────────
// THE RULE: the sync may FILL an op_* identifier that is null. It must NEVER
// overwrite one that is already set. A stored identifier is what ties a link to
// a specific product; overwriting it on "drift" silently re-points the link at
// a different product, and the next run then re-confirms the wrong mapping via
// T1/T2 forever. That is how link 269535fb came to sit on the green Osight SE
// variant while carrying the red product's MPN, price and URL.
//
// Anything that contradicts a stored identifier is a review item, not a write.
function resolveProposals(st, today) {
  for (const [linkId, proposals] of st.proposals) {
    const target = st.byId.get(linkId);
    if (!target) continue;

    // ── Conflict: two feed rows disagree about what this link is ──────
    const fingerprint = p =>
      `${strictNorm(p.rawMpn) || ''}|${gtinNorm(p.rawGtin) || ''}|${strictNorm(p.rawMid) || ''}`;
    const distinct = [...new Set(proposals.map(fingerprint))];
    if (distinct.length > 1) {
      st.conflicts.push({
        linkId, url: target.url,
        candidates: proposals.map(p => ({
          mpn: p.rawMpn, gtin: p.rawGtin, mid: p.rawMid, price: p.price, name: p.feedName,
        })),
      });
      continue;   // skipped, not written
    }

    const p = proposals[0];

    // ── Identifier policy: fill nulls, never overwrite ────────────────
    const patch = { last_checked: today };
    let blocked = null;

    const consider = (field, stored, incoming, norm) => {
      if (blocked) return;
      if (incoming == null || incoming === '') return;        // nothing offered
      if (stored == null || stored === '') {                  // FILL
        patch[field] = incoming;
        return;
      }
      if (norm(stored) === norm(incoming)) return;            // already agrees
      blocked = { field, stored, incoming };                  // CONTRADICTS
    };
    consider('op_mpn',                 target.op_mpn,                 p.rawMpn,  strictNorm);
    consider('op_gtin',                target.op_gtin,                p.rawGtin, gtinNorm);
    consider('op_merchant_product_id', target.op_merchant_product_id, p.rawMid,  strictNorm);

    if (blocked) {
      // A contradicted identifier means the match itself is suspect, so the
      // price and stock are not trustworthy either. Nothing is written.
      st.driftReview.push({
        linkId, url: target.url, tier: p.tier,
        field: blocked.field, stored: blocked.stored, incoming: blocked.incoming,
        feedName: p.feedName, feedPrice: p.price,
      });
      continue;   // skipped, not written
    }

    // ── Safe to write: price, stock, last_checked, and any FILLED ids ──
    if (p.price   != null && Number(target.street_price) !== p.price) patch.street_price = p.price;
    if (p.inStock != null && target.in_stock !== p.inStock)           patch.in_stock     = p.inStock;
    patch.op_last_matched_by = p.tier;

    st.tierCounts[p.tier] = (st.tierCounts[p.tier] || 0) + 1;
    st.filled += ['op_mpn', 'op_gtin', 'op_merchant_product_id'].filter(f => f in patch).length;
    st.updates.set(linkId, patch);
  }
}

// ─── per-partner report ─────────────────────────────────────────────────────
function reportPartner(st) {
  const matched      = st.updates.size;
  const priceChanged = [...st.updates.values()].filter(p => 'street_price' in p).length;
  const stockChanged = [...st.updates.values()].filter(p => 'in_stock'     in p).length;
  const matchRate    = st.rows.length ? matched / st.rows.length : 0;
  const unmatched    = st.rows.filter(r => !st.updates.has(r.id));

  log(c('bold', `\n── ${st.partner.name}  (merchant ${st.partner.awin_merchant_id}, host ${st.host}) ──`));
  log(`  feed rows for this merchant:  ${st.feedRowsSeen}`);
  log(`  existing rows in DB:          ${st.rows.length}`);
  log(`  matched:                      ${matched}   (${(matchRate * 100).toFixed(1)}%)`);
  log(`  price changed:                ${priceChanged}`);
  log(`  stock flag changed:           ${stockChanged}`);
  log(`  ambiguous unresolved:         ${st.unresolvedAmbiguous.length}`);
  log(`  unmatched:                    ${unmatched.length}`);
  log(`  identifiers filled (were null): ${st.filled}`);
  log(`  drift review (not written):   ${st.driftReview.length}`);
  log(`  conflicts (not written):      ${st.conflicts.length}`);

  // Belt and braces: prove no patch overwrites a non-null stored identifier.
  // If this ever trips, the policy has been broken by a later edit.
  let overwrites = 0;
  for (const [linkId, patch] of st.updates) {
    const row = st.byId.get(linkId);
    for (const f of ['op_mpn', 'op_gtin', 'op_merchant_product_id']) {
      if (f in patch && row && row[f] != null && row[f] !== '') overwrites++;
    }
  }
  log(`  identifier overwrites:        ${overwrites}` + (overwrites ? c('red', '  <-- MUST BE ZERO') : ''));
  st.overwrites = overwrites;

  log('  match confidence breakdown:');
  const tiersSeen = Object.entries(st.tierCounts).filter(([, n]) => n > 0);
  if (!tiersSeen.length) log(c('grey', '    (none)'));
  for (const [tier, n] of tiersSeen) log(`    ${tier.padEnd(28)} ${n}`);

  if (st.fuzzyReviewList.length) {
    log(c('yellow', `\n  Fuzzy matches for review (${st.fuzzyReviewList.length}):`));
    for (const f of st.fuzzyReviewList) {
      log(c('yellow', `    Link ${f.linkId.slice(0, 8)}…`));
      log(c('yellow', `      our sku:   ${f.ourSku}`));
      log(c('yellow', `      their mpn: ${f.theirMpn}`));
      log(c('yellow', `      URL:       ${f.url}`));
    }
  }

  if (st.driftReview.length) {
    log(c('yellow', `\n  Drift review — stored identifier contradicted, NOT written (${st.driftReview.length}):`));
    for (const d of st.driftReview.slice(0, 20)) {
      log(c('yellow', `    Link ${d.linkId.slice(0, 8)}…  ${d.field}: stored "${d.stored}" vs feed "${d.incoming}"  [${d.tier}]`));
      log(c('grey',   `      feed: ${d.feedName}`));
    }
    if (st.driftReview.length > 20) log(c('grey', `      …and ${st.driftReview.length - 20} more`));
  }

  if (st.conflicts.length) {
    log(c('red', `\n  Conflicts — several feed rows claim the same link, NOT written (${st.conflicts.length}):`));
    for (const cf of st.conflicts.slice(0, 10)) {
      log(c('red', `    Link ${cf.linkId.slice(0, 8)}…  ${cf.candidates.length} candidates`));
      for (const cand of cf.candidates) {
        log(c('grey', `      mpn=${cand.mpn || '—'} gtin=${cand.gtin || '—'} $${cand.price ?? '—'}  ${cand.name}`));
      }
    }
  }

  if (st.unresolvedAmbiguous.length) {
    log(c('grey', '\n  Ambiguous (first 10):'));
    for (const a of st.unresolvedAmbiguous.slice(0, 10)) {
      log(c('grey',
        `    ${a.url}  (mpn: ${a.feedMpn || '—'}, gtin: ${a.feedGtin || '—'}, mid: ${a.feedMid || '—'})`
      ));
    }
  }

  // URL-shape diagnostic when match rate is imperfect
  if (matchRate < 0.90 && unmatched.length) {
    log(c('grey', '\n  URL-shape diagnostic:'));
    log(c('grey', '    unmatched DB URLs (first 10):'));
    for (const r of unmatched.slice(0, 10)) {
      log(c('grey', `      ${r._canon || r.url}  (sku: ${r.product_variants?.sku || '—'})`));
    }
    if (st.unmatchedFeedUrls.length) {
      log(c('grey', '    unmatched feed URLs (first 10):'));
      for (const f of st.unmatchedFeedUrls.slice(0, 10)) {
        log(c('grey', `      ${f.url}  (mpn: ${f.mpn || '—'}, gtin: ${f.gtin || '—'})`));
      }
    }
  }

  return { matched, matchRate };
}

// ─── persist the review list ────────────────────────────────────────────────
// Best-effort: the table is created by supabase/sync_drift_review.sql. If it is
// not there yet the run must still succeed — the log already carries the same
// information, and a missing review table is not a reason to skip price updates.
async function writeDriftReview(st, runAt) {
  const rows = [
    ...st.driftReview.map(d => ({
      run_at: runAt, partner_id: st.partner.id, link_id: d.linkId, kind: 'identifier_drift',
      field: d.field, stored_value: d.stored, feed_value: d.incoming,
      feed_product_name: d.feedName, matched_by: d.tier, link_url: d.url,
    })),
    ...st.conflicts.map(cf => ({
      run_at: runAt, partner_id: st.partner.id, link_id: cf.linkId, kind: 'candidate_conflict',
      field: null, stored_value: null,
      feed_value: cf.candidates.map(x => x.mpn || x.gtin || x.mid).join(' | '),
      feed_product_name: cf.candidates.map(x => x.name).join(' | ').slice(0, 500),
      matched_by: null, link_url: cf.url,
    })),
  ];
  if (!rows.length) return 0;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sync_drift_review`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    warn(`could not write sync_drift_review (${res.status}) — see the log above instead`);
    return 0;
  }
  return rows.length;
}

// ─── write one partner's updates ────────────────────────────────────────────
async function writePartner(st) {
  const entries = [...st.updates.entries()];
  log(c('bold', `\nWriting ${entries.length} row updates for ${st.partner.name} (concurrency ${CONCURRENCY})…`));
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
  return written;
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();

  // ── preflight ──
  if (!AWIN_FEED_URL) fail('AWIN_FEED_URL_V2 not set');
  if (!SERVICE_KEY)   fail('SUPABASE_SERVICE_ROLE_KEY not set');
  if (DRY_RUN) log(c('cyan', '── DRY RUN — no database writes ──'));
  if (FLOOR_OVERRIDE != null) {
    warn(`MATCH_RATE_FLOOR=${FLOOR_OVERRIDE} overrides every per-partner floor`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // ── load partners and their rows ──
  log(c('bold', '\nLoading Awin partners from Supabase…'));
  const partners = await loadPartners();
  const states = new Map();

  for (const p of partners) {
    const mid = String(p.awin_merchant_id).trim();
    const cfg = PARTNER_CONFIG[mid];
    if (!cfg) {
      warn(`partner "${p.name}" has awin_merchant_id ${mid} but no PARTNER_CONFIG entry — skipping`);
      continue;
    }
    const ix = await loadExistingRows(p, cfg.host);
    const shared = [...ix.byUrl.entries()].filter(([, list]) => list.length > 1);
    const storedOp = ix.rows.filter(r => r.op_mpn || r.op_gtin).length;

    log(`  ${p.name}  (merchant ${mid}, host ${cfg.host}, floor ${(cfg.floor * 100).toFixed(0)}%)`);
    log(`    rows:                       ${ix.rows.length}`);
    log(`    distinct canonical URLs:    ${ix.byUrl.size}`);
    log(`    with SKU:                   ${ix.bySku.size}`);
    log(`    with UPC (or numeric SKU):  ${ix.byUpc.size}`);
    log(`    with stored op_mpn/op_gtin: ${storedOp}  (T1/T2 exact re-match)`);
    log(`    shared URLs (>1 row):       ${shared.length}   (rows: ${shared.reduce((n, [, l]) => n + l.length, 0)})`);

    states.set(mid, {
      partner: p, host: cfg.host, floor: cfg.floor, ...ix,
      proposals: new Map(),          // link id → [proposal] (resolved after the feed pass)
      updates: new Map(),
      tierCounts: {},
      unresolvedAmbiguous: [], unmatchedFeedUrls: [],
      fuzzyReviewList: [],
      driftReview: [],               // stored identifier contradicted → not written
      conflicts: [],                 // two feed rows disagree about this link → not written
      filled: 0,                     // identifiers written into a previously-null column
      feedRowsSeen: 0,
    });
  }

  if (!states.size) fail('no configured partners to process');

  // ── stream the combined feed once, routing by merchant_id ──
  log(c('bold', '\nFetching + parsing combined Awin feed…'));
  let totalRows = 0;
  const unknownMerchants = new Map();

  for await (const row of streamFeedRows()) {
    totalRows++;
    const mid = String(row.merchant_id ?? '').trim();
    const st = states.get(mid);
    if (!st) {
      if (mid) unknownMerchants.set(mid, (unknownMerchants.get(mid) || 0) + 1);
      continue;
    }
    st.feedRowsSeen++;
    processFeedRow(st, row, today);
  }

  log(`  total feed rows: ${totalRows}`);

  // Resolve each link's proposals into at most one patch.
  for (const st of states.values()) resolveProposals(st, today);
  if (unknownMerchants.size) {
    const list = [...unknownMerchants.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([m, n]) => `${m} (${n})`).join(', ');
    log(c('grey', `  ignored merchants not in PARTNER_CONFIG: ${list}`));
  }

  // ── per-partner report + floor check ──
  log(c('bold', '\nSummary'));
  const willWrite = [];
  const skipped   = [];

  for (const st of states.values()) {
    const { matched, matchRate } = reportPartner(st);
    const floor = FLOOR_OVERRIDE != null ? FLOOR_OVERRIDE : st.floor;

    if (matchRate < floor) {
      // Skip THIS partner only. Other partners are independent and still write:
      // a 26-link Olight problem must not block 466 OpticsPlanet updates.
      log(c('red', `\n  !! ${st.partner.name}: match rate ${(matchRate * 100).toFixed(1)}% is below its floor ` +
                   `${(floor * 100).toFixed(0)}%.`));
      log(c('red',   `  !! SKIPPING this partner — no writes for ${st.partner.name}. Its ${st.rows.length} rows keep`));
      log(c('red',   `  !! their existing prices. Investigate the feed shape for merchant ` +
                   `${st.partner.awin_merchant_id} before the next run.`));
      skipped.push(st);
      continue;
    }
    if (matched) willWrite.push(st);
  }

  // ── write ──
  if (DRY_RUN) {
    log(c('cyan', '\n[dry-run] no writes performed'));
    log(`  would write: ${willWrite.map(s => `${s.partner.name} ${s.updates.size}`).join(', ') || 'nothing'}`);
    log(`  duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } else {
    let written = 0;
    for (const st of willWrite) written += await writePartner(st);
    let reviewed = 0;
    const runAt = new Date().toISOString();
    for (const st of states.values()) reviewed += await writeDriftReview(st, runAt);
    if (reviewed) log(c('grey', `  ${reviewed} row(s) recorded in sync_drift_review`));
    log(c('green', `\n✓ updated ${written} rows in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`));
  }

  // The identifier policy is not advisory. If any patch would overwrite a
  // non-null stored identifier, something has regressed — fail loudly.
  const totalOverwrites = [...states.values()].reduce((n, st) => n + (st.overwrites || 0), 0);
  if (totalOverwrites) {
    console.error(c('red',
      `\nerror: ${totalOverwrites} patch(es) would overwrite a stored op_* identifier. ` +
      'The sync may fill a null identifier but must never replace one.'));
    process.exit(1);
  }

  // ── exit status ──
  // Skipped partners are a real failure even though the run did useful work:
  // exit non-zero so the Actions run goes red and somebody looks at it.
  if (skipped.length) {
    console.error(c('red',
      `\nerror: ${skipped.length} partner(s) skipped below their match-rate floor: ` +
      skipped.map(s => s.partner.name).join(', ')
    ));
    process.exit(1);
  }
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

// Run only when invoked directly, so the unit test can import the real
// normalizers from this file rather than keeping a second copy in sync.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch(e => fail(`unhandled: ${e.stack || e.message}`));
}
