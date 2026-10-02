// _listing-rules — the server-side buy-row rules: what counts as a stale
// price, and how listings sort. One copy for every server renderer.
// ─────────────────────────────────────────────────────────────────────────
// Extracted from product-page.mjs the day guide-page.mjs was written,
// because the alternative was a FOURTH copy of these rules. CLAUDE.md's
// "Duplicated logic to keep in sync" section documents the three that must
// stay hand-synced (js/affiliate.js and gunforma-build-detail.html are
// browser-side, across a bundler boundary that doesn't exist between
// Netlify functions) — but product-page.mjs and guide-page.mjs are both
// plain ESM functions, so between THEM the honest number of copies is one.
// Same reasoning as _category-meta.mjs and _variant-label.mjs.
//
// The rules themselves are CLAUDE.md doctrine ("Prices we can stand
// behind", "Listing order") and are duplicated by hand in the two browser
// copies. Change them here, change them there — scripts/listing-rules.test.mjs
// pins this module's behaviour to the documented rules so a drive-by edit
// here fails the deploy instead of quietly disagreeing with the catalog.

// A price we can stand behind is one a FEED verified within the window.
// op_last_matched_by null means no feed ever matched this link, so its
// street_price was hand-entered — a hand-typed last_checked must not pass as
// verification, which is why both columns are checked and not just the date.
export const STALE_AFTER_DAYS = 7;

export function isStalePrice(l) {
  if (!l || !l.last_checked || !l.op_last_matched_by) return true;
  // last_checked is a DATE ('YYYY-MM-DD'); read as UTC midnight.
  const checked = Date.parse(l.last_checked + 'T00:00:00Z');
  if (Number.isNaN(checked)) return true;
  // Whole DAYS, not elapsed milliseconds — same boundary as the SQL rule,
  // last_checked < current_date - 7.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return checked < todayUTC - STALE_AFTER_DAYS * 86400000;
}

// Last resort, so a tie resolves the same way on every request and every page:
// partner name, then URL. PostgREST returns embedded rows in arbitrary order.
export function tieBreak(a, b) {
  const ap = a.partnerName || '', bp = b.partnerName || '';
  if (ap !== bp) return ap < bp ? -1 : 1;
  const au = a.url || '', bu = b.url || '';
  return au === bu ? 0 : (au < bu ? -1 : 1);
}

// A stale price sorts as unknown rather than as its number — otherwise a stale
// low price still leads the buy rows and only then renders as "Check price".
export function sortPrice(r) { return r.stale ? null : r.price; }

// The full ordering from CLAUDE.md ("Listing order"): fresh-and-priced →
// in stock → price ascending → partner name → URL. The first key is what
// keeps the hero row honest: rows[0] is the listing whose price is shown,
// so the number shown and the button's destination are the same row.
export function compareListingRows(a, b) {
  const af = (!a.stale && a.price != null), bf = (!b.stale && b.price != null);
  if (af !== bf) return af ? -1 : 1;
  if ((a.in_stock === true) !== (b.in_stock === true)) return a.in_stock ? -1 : 1;
  const ap = sortPrice(a), bp = sortPrice(b);
  if (ap != null && bp != null && ap !== bp) return ap - bp;
  return tieBreak(a, b);
}

export function displayPartnerName(name) {
  if (!name) return name;
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}
