// maker-link — the rules for a buy link that pays nothing: how it is
// labelled, and what the disclosure beside it says. BROWSER copy.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_maker-link.mjs is the server copy, and its header holds
// the reasoning. The two are duplicated because these pages load plain
// <script> globals with no module loader — the same split as
// js/build-url.js ↔ _build-url.mjs. scripts/maker-link.test.mjs runs both
// over the same inputs and fails the deploy if they differ, so change them
// together.
//
// Globals: window.makerLink, window.buyDisclosure, window.MAKER_REL.
(function (global) {
  function hostOf(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '') || null;
    } catch (e) {
      return null;
    }
  }

  function isHttpUrl(url) {
    try {
      var p = new URL(String(url)).protocol;
      return p === 'http:' || p === 'https:';
    } catch (e) {
      return false;
    }
  }

  // makerLink(url, makerName, makerWebsite) → { host, ownStore, label } | null
  // ownStore: the url's host is the maker's website host or a subdomain of
  // it, `www.` ignored; false when no website is saved. label has no arrow —
  // renderers append ↗ themselves.
  global.makerLink = function (url, makerName, makerWebsite) {
    if (!isHttpUrl(url)) return null;
    var host = hostOf(url);
    if (!host) return null;
    var site = hostOf(makerWebsite);
    var name = makerName ? String(makerName).trim() : '';
    var ownStore = !!site && !!name && (host === site || host.slice(-(site.length + 1)) === '.' + site);
    return {
      host: host,
      ownStore: ownStore,
      label: ownStore ? 'Buy from ' + name : 'Buy at ' + host,
    };
  };

  var DISCLOSURE_PARTNER = 'Gunforma may earn a commission on purchases made through these links.';
  var DISCLOSURE_MAKER   = "These links go straight to the seller's own store. Gunforma earns nothing on them.";
  var DISCLOSURE_MIXED   = "Gunforma may earn a commission on retailer links. Links to a maker's own store earn us nothing.";

  // Null when there is nothing to disclose.
  global.buyDisclosure = function (hasPartner, hasMaker) {
    if (hasPartner && hasMaker) return DISCLOSURE_MIXED;
    if (hasPartner) return DISCLOSURE_PARTNER;
    if (hasMaker) return DISCLOSURE_MAKER;
    return null;
  };

  global.MAKER_REL = 'noopener nofollow';
})(window);
