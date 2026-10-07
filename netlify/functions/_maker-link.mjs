// _maker-link — the rules for a buy link that pays nothing: how it is
// labelled, and what the disclosure beside it says. SERVER copy.
// ─────────────────────────────────────────────────────────────────────────
// A part with no partner listing used to be a dead end — "No listing yet"
// under a line saying we may earn a commission. It now links to the part's
// own `products.url` through /go/part/<id>, so the click is counted and a
// reader has somewhere to go. Counted clicks to a maker are what we take to
// that maker when we ask for a partnership, so a dead end earned nothing
// twice over.
//
// js/maker-link.js is the browser mirror, loaded as a plain <script> global
// by the pages that render buy rows in the browser. The two are duplicated
// for the same reason as _listing-rules.mjs ↔ js/affiliate.js — no module
// loader on the pages — and scripts/maker-link.test.mjs runs both over the
// same inputs and fails the deploy if they disagree. Keep them identical.
//
// WHY THE LABEL IS NOT "Buy from <maker>" UNCONDITIONALLY. products.url is
// usually the maker's own page, but not always: three Olight lights point at
// illumn.com, two Grayguns modules at sigsauer.com, the RAMM trigger at
// thetriggerguyusa.com. Telling a reader they are buying from the maker and
// landing them on a reseller is a small lie, and the one that costs trust.
// So the label is decided from the URL's host against the maker's saved
// website, and falls back to naming the host.

// A bare host: lowercase, no `www.`. Null when the URL does not parse.
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// Only http(s) ever becomes a button — anything else in products.url is a
// data error, not a destination. The /go/part/ edge function applies the
// same test before redirecting, so a label and its link cannot disagree.
export function isHttpUrl(url) {
  try {
    const p = new URL(String(url)).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

// makerLink(url, makerName, makerWebsite) → { host, ownStore, label } | null
//
//   ownStore  the url's host is the maker's website host, or a subdomain of
//             it (shop.springerprecision.com is springerprecision.com).
//             `www.` is ignored on both sides. False when the maker has no
//             website saved — we cannot claim a match we did not check.
//   label     "Buy from <maker>" when ownStore, else "Buy at <host>".
//             No arrow: renderers append ↗ themselves, as they already do
//             for partner buttons.
//
// Null when the url is empty or not http(s) — the caller keeps its non-link
// state, as before this existed.
export function makerLink(url, makerName, makerWebsite) {
  if (!isHttpUrl(url)) return null;
  const host = hostOf(url);
  if (!host) return null;
  const site = hostOf(makerWebsite);
  const name = makerName ? String(makerName).trim() : '';
  const ownStore = !!site && !!name && (host === site || host.endsWith('.' + site));
  return {
    host,
    ownStore,
    label: ownStore ? 'Buy from ' + name : 'Buy at ' + host,
  };
}

// The disclosure line under a buy area, decided by what the area contains.
// Null when there is nothing to disclose — a buy area with no links at all
// gets no line, because a disclosure about links that are not there is noise
// at best and a claim at worst.
export const DISCLOSURE_PARTNER = 'Gunforma may earn a commission on purchases made through these links.';
export const DISCLOSURE_MAKER   = "These links go straight to the seller's own store. Gunforma earns nothing on them.";
export const DISCLOSURE_MIXED   = "Gunforma may earn a commission on retailer links. Links to a maker's own store earn us nothing.";

export function buyDisclosure(hasPartner, hasMaker) {
  if (hasPartner && hasMaker) return DISCLOSURE_MIXED;
  if (hasPartner) return DISCLOSURE_PARTNER;
  if (hasMaker) return DISCLOSURE_MAKER;
  return null;
}

// rel for a maker link. Not sponsored: nobody pays for it. nofollow because
// it is still an outbound buy link through a redirect, and the partner
// buttons' rel is left exactly as it was.
export const MAKER_REL = 'noopener nofollow';
