// js/build-total.js — what a build costs, in the browser.
// -----------------------------------------------------------------------------
// The browser copy of priceTotal() / priceTotalText() in
// netlify/functions/_build-cards.mjs — the same split, for the same reason,
// as js/build-url.js ↔ _build-url.mjs: the pages load plain <script>
// globals and the functions are ESM. scripts/build-total.test.mjs runs both
// copies over the same rows on every deploy and fails if they differ.
//
// THE RULE (CLAUDE.md, "Prices we can stand behind"): one price per catalog
// part — the cheapest FRESH partner price, in stock first, when the part has
// live listings; its default variant's MSRP when it has none; nothing when
// its only listings are stale, and nothing for a typed part. The total is a
// floor when some part priced to nothing, and the text says so with a "+".
//
// Before this file the homepage and gallery cards summed MSRPs while the
// build page's kicker used the rule above, and the same build read "~$1176"
// on its card and "$1,017" on its page. One function, one number.
//
//   window.buildPriceTotal(parts, rows)  → { total, count, of }
//   window.priceTotalText(priced)        → "$1,017" | "$1,017+" | null
//
// `rows` are product_variants rows with their live affiliate_links — the
// select is PRICE_TOTAL_SELECT, spelled on the page that queries it.
(function (global) {
  // The stale rule, as js/affiliate.js and gunforma-build-detail.html hold
  // it (CLAUDE.md, "Duplicated logic to keep in sync"): no feed match ever,
  // or no check, or a check older than 7 whole UTC days.
  var STALE_AFTER_DAYS = 7;
  function isStalePrice(l) {
    if (!l || !l.last_checked || !l.op_last_matched_by) return true;
    var checked = Date.parse(l.last_checked + 'T00:00:00Z');
    if (isNaN(checked)) return true;
    var now = new Date();
    var todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return checked < todayUTC - STALE_AFTER_DAYS * 86400000;
  }

  function buildPriceTotal(parts, rows) {
    var list = Array.isArray(parts) ? parts : [];
    var of = list.length;
    var byProduct = {};
    (Array.isArray(rows) ? rows : []).forEach(function (v) {
      if (!v || typeof v.product_id !== 'string') return;
      var acc = byProduct[v.product_id] || (byProduct[v.product_id] = { listings: [], msrp: null, hasDefault: false });
      (Array.isArray(v.affiliate_links) ? v.affiliate_links : []).forEach(function (l) {
        if (l) acc.listings.push({ price: l.street_price != null ? Number(l.street_price) : null, stale: isStalePrice(l), in_stock: l.in_stock });
      });
      if (v.msrp != null && (v.is_default || !acc.hasDefault)) {
        if (v.is_default) acc.hasDefault = true;
        if (v.is_default || acc.msrp == null) acc.msrp = Number(v.msrp);
      }
    });
    function priceFor(acc) {
      if (!acc) return null;
      if (acc.listings.length) {
        var fresh = acc.listings.filter(function (l) { return l.price != null && !l.stale && isFinite(l.price); });
        var inStock = fresh.filter(function (l) { return l.in_stock === true; });
        var use = inStock.length ? inStock : fresh;
        return use.length ? Math.min.apply(null, use.map(function (l) { return l.price; })) : null;
      }
      return acc.msrp != null && isFinite(acc.msrp) ? acc.msrp : null;
    }
    var total = 0, count = 0;
    list.forEach(function (p) {
      var price = p && typeof p.refId === 'string' ? priceFor(byProduct[p.refId]) : null;
      if (price == null) return;
      total += price;
      count++;
    });
    return { total: count ? total : null, count: count, of: of };
  }

  function priceTotalText(priced) {
    if (!priced || !priced.count || !(priced.total > 0)) return null;
    return '$' + Math.round(priced.total).toLocaleString('en-US') + (priced.count < priced.of ? '+' : '');
  }

  global.buildPriceTotal = buildPriceTotal;
  global.priceTotalText = priceTotalText;
})(window);
