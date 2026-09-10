// affiliate.js — shared affiliate loader + renderers for every page that
// shows product buy links. Extracted from gunforma-build-detail.html so
// gunforma-parts-catalog.html, gunforma-armory.html, and future surfaces
// don't diverge.
//
// The DB shape: product_variants → affiliate_links → partners. builds
// store product_id only (not variant_id), so all buyable listings across
// all variants are surfaced; the shopper picks. Each row's URL is the
// affiliate_url when present, else the raw url. rel="noopener sponsored
// nofollow" + target="_blank" everywhere.
//
// API (namespaced on window.affiliate):
//   loadFor(sb, productIds)      → Promise; populates the internal cache
//   get(productId)               → the aggregate object or null
//   renderHero(productId)        → compact one-row HTML (price + partner
//                                  + stock + Buy button); '' if no data
//   renderBlock(productId)       → full block: hero row + expandable
//                                  variants list + disclosure line; '' if
//                                  no data
//   renderEmpty(reason)          → muted "No retailer listings" markup
//   AFFILIATE_BY_PRODUCT_ID      → the raw cache, exposed for pages that
//                                  want to do bespoke rendering
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  var AFFILIATE_BY_PRODUCT_ID = {};

  var VARIANT_AXES = [
    { key: 'color',                 label: 'Color'         },
    { key: 'finish',                label: 'Finish'        },
    { key: 'optic_cut',             label: 'Optic Cut'     },
    { key: 'bundle',                label: 'Bundle'        },
    { key: 'clamp',                 label: 'Clamp'         },
    { key: 'manual_safety_variant', label: 'Manual Safety' },
  ];

  function extractVariantAxes(v) {
    return {
      color:                 v.color || null,
      finish:                v.finish || null,
      optic_cut:             v.optic_cut || null,
      bundle:                v.bundle || null,
      clamp:                 v.clamp || null,
      manual_safety_variant: v.manual_safety_variant === true ? 'Yes'
                           : v.manual_safety_variant === false ? 'No'
                           : null,
    };
  }
  function computeActiveAxes(listings) {
    return VARIANT_AXES.filter(function (axis) {
      var seen = new Set();
      listings.forEach(function (l) { seen.add(l.axes[axis.key]); });
      return seen.size > 1;
    });
  }
  function formatVariantLabel(axes, activeAxes) {
    if (!activeAxes.length) return 'Standard';
    return activeAxes.map(function (a) {
      var val = axes[a.key];
      return val != null && val !== '' ? val : '—';
    }).join(' / ');
  }
  // DB stores retailer + network like "OpticsPlanet (Awin)"; shoppers only
  // need the retailer, so strip anything trailing in parens.
  function displayPartnerName(name) {
    if (!name) return name;
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function loadFor(sb, productIds) {
    if (!Array.isArray(productIds) || !productIds.length) return;
    // De-dup + filter falsy — callers may hand us raw parts_snapshot arrays.
    var seen = {}, ids = [];
    productIds.forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; ids.push(id); } });
    if (!ids.length) return;

    var res = await sb.from('product_variants')
      .select('id, product_id, color, finish, optic_cut, bundle, clamp, ' +
              'manual_safety_variant, is_default, primary_image_url, ' +
              'affiliate_links(url, affiliate_url, street_price, in_stock, is_primary, partners(name))')
      .in('product_id', ids);
    if (res.error) { console.error('[affiliate] load failed', res.error); return; }

    // Group into (variant, link) rows per product; drop variants with no links.
    var byProduct = {};
    (res.data || []).forEach(function (v) {
      var links = v.affiliate_links || [];
      if (!links.length) return;
      if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
      var axes = extractVariantAxes(v);
      links.forEach(function (l) {
        byProduct[v.product_id].push({
          variantId:   v.id,
          axes:        axes,
          isDefault:   !!v.is_default,
          url:         l.affiliate_url || l.url,
          price:       l.street_price != null ? Number(l.street_price) : null,
          in_stock:    l.in_stock,
          is_primary:  !!l.is_primary,
          partnerName: displayPartnerName(l.partners ? l.partners.name : null),
        });
      });
    });

    Object.keys(byProduct).forEach(function (productId) {
      var listings = byProduct[productId];
      var activeAxes = computeActiveAxes(listings);
      listings.forEach(function (l) { l.variantLabel = formatVariantLabel(l.axes, activeAxes); });
      // Primary listings first, then in-stock, then price ascending (nulls last).
      listings.sort(function (a, b) {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        if ((a.in_stock === true) !== (b.in_stock === true)) return a.in_stock ? -1 : 1;
        if (a.price == null && b.price == null) return 0;
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      });
      var priced = listings.filter(function (l) { return l.price != null; });
      var inStockPriced = priced.filter(function (l) { return l.in_stock === true; });
      var priceSet = (inStockPriced.length ? inStockPriced : priced).map(function (l) { return l.price; });
      AFFILIATE_BY_PRODUCT_ID[productId] = {
        hero: listings[0],
        listings: listings,
        activeAxes: activeAxes,
        minPrice: priceSet.length ? Math.min.apply(null, priceSet) : null,
        maxPrice: priceSet.length ? Math.max.apply(null, priceSet) : null,
        anyInStock: listings.some(function (l) { return l.in_stock === true; }),
        variantsWithListings: new Set(listings.map(function (l) { return l.variantId; })).size,
      };
    });
  }

  function get(productId) { return AFFILIATE_BY_PRODUCT_ID[productId] || null; }

  // Shared hero-row markup used by both renderHero and renderBlock. Uses
  // the .part-affiliate* classes that build-detail already ships — pages
  // adopting this module inherit build-detail's visual treatment.
  //
  // opts.compact (renderHero on grid cards): drops the "at Partner" text
  // and the in-stock badge, since the partner name is already in the CTA
  // label and stock lives in the detail view. Keeps price + Buy button.
  function heroRowHtml(aff, opts) {
    opts = opts || {};
    var hero = aff.hero;
    var multi = aff.listings.length > 1;
    var priceHtml;
    if (aff.minPrice != null && multi && aff.maxPrice !== aff.minPrice) {
      priceHtml = '<span class="part-affiliate-price">From $' + aff.minPrice.toFixed(2) + '</span>' +
                  '<span class="part-affiliate-range">up to $' + aff.maxPrice.toFixed(2) + '</span>';
    } else if (aff.minPrice != null) {
      priceHtml = '<span class="part-affiliate-price">$' + aff.minPrice.toFixed(2) + '</span>';
    } else if (hero.price != null) {
      priceHtml = '<span class="part-affiliate-price">$' + hero.price.toFixed(2) + '</span>';
    } else {
      priceHtml = '<span class="part-affiliate-price">See price</span>';
    }
    var infoHtml;
    if (opts.compact) {
      infoHtml = priceHtml;
    } else {
      var stockHtml = aff.anyInStock
        ? '<span class="part-affiliate-stock in">In stock</span>'
        : (aff.listings.every(function (l) { return l.in_stock === false; })
            ? '<span class="part-affiliate-stock out">Out of stock</span>'
            : '');
      var partnerHtml = hero.partnerName
        ? '<span class="part-affiliate-partner">at <strong>' + esc(hero.partnerName) + '</strong>' + stockHtml + '</span>'
        : (stockHtml ? '<span class="part-affiliate-partner">' + stockHtml + '</span>' : '');
      infoHtml = priceHtml + partnerHtml;
    }
    var btnLabel = hero.partnerName ? 'Buy at ' + esc(hero.partnerName) + ' ↗' : 'View listing ↗';
    return '<div class="part-affiliate">' +
        '<div class="part-affiliate-info">' + infoHtml + '</div>' +
        '<a class="part-affiliate-btn" href="' + esc(hero.url) + '" target="_blank" rel="noopener sponsored nofollow">' + btnLabel + '</a>' +
      '</div>';
  }

  function renderHero(productId) {
    var aff = get(productId);
    if (!aff || !aff.hero) return '';
    // Inline styles so the hint renders consistently on every consuming
    // page without requiring each host to define a shared class.
    var hint = '<div class="part-affiliate-hint" style="font-size:10px;color:#a8a5a0;padding:6px 4px 0;text-align:center;font-style:italic;">Click for more details</div>';
    return heroRowHtml(aff, { compact: true }) + hint;
  }

  function renderBlock(productId) {
    var aff = get(productId);
    if (!aff || !aff.hero) return '';
    var main = heroRowHtml(aff);
    var multi = aff.listings.length > 1;
    var disclosure = '<div class="part-affiliate-disclosure">Gunforma may earn a commission on purchases made through these links.</div>';
    if (!multi) return main + disclosure;
    var optionsLabel = 'See all ' + aff.listings.length + ' options';
    var headerRow =
      '<div class="part-affiliate-variant-header">' +
        (aff.activeAxes.length
          ? '<div class="part-affiliate-variant-header-label">' + esc(aff.activeAxes.map(function (a) { return a.label; }).join(' / ')) + '</div>'
          : '') +
        '<div class="part-affiliate-variant-header-note">Prices and availability may vary based on promotions and in-stock items.</div>' +
      '</div>';
    var variantRows = aff.listings.map(function (l) {
      var lPrice = l.price != null ? '$' + l.price.toFixed(2) : 'See price';
      var lStock = l.in_stock === true
        ? '<span class="part-affiliate-stock in">In stock</span>'
        : l.in_stock === false
          ? '<span class="part-affiliate-stock out">Out of stock</span>'
          : '';
      var lPartner = l.partnerName ? 'at <strong>' + esc(l.partnerName) + '</strong>' : '';
      var lBtn = l.partnerName ? esc(l.partnerName) + ' ↗' : 'View ↗';
      return '<div class="part-affiliate-variant-row">' +
          '<div class="part-affiliate-variant-info">' +
            '<span class="part-affiliate-variant-label">' + esc(l.variantLabel) + '</span>' +
            '<span class="part-affiliate-variant-sub">' + lPrice + ' ' + lPartner + ' ' + lStock + '</span>' +
          '</div>' +
          '<a class="part-affiliate-variant-btn" href="' + esc(l.url) + '" target="_blank" rel="noopener sponsored nofollow">' + lBtn + '</a>' +
        '</div>';
    }).join('');
    return main +
      '<details class="part-affiliate-options">' +
        '<summary class="part-affiliate-options-summary">' + optionsLabel + '</summary>' +
        '<div class="part-affiliate-variant-list">' + headerRow + variantRows + '</div>' +
      '</details>' +
      disclosure;
  }

  function renderEmpty() {
    return '<div class="part-affiliate part-affiliate-empty" style="color:#888;font-style:italic;font-size:12px;">No retailer listings available yet.</div>';
  }

  global.affiliate = {
    loadFor: loadFor,
    get: get,
    renderHero: renderHero,
    renderBlock: renderBlock,
    renderEmpty: renderEmpty,
    AFFILIATE_BY_PRODUCT_ID: AFFILIATE_BY_PRODUCT_ID,
  };
})(window);
