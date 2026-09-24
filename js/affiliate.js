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
    { key: 'reticle',               label: 'Reticle'       },
    { key: 'reticle_color',         label: 'Reticle Color' },
    { key: 'color',                 label: 'Color'         },
    { key: 'optic_cut',             label: 'Optic Cut'     },
    { key: 'bundle',                label: 'Bundle'        },
    { key: 'clamp',                 label: 'Clamp'         },
    { key: 'manual_safety_variant', label: 'Manual Safety' },
  ];

  function extractVariantAxes(v) {
    return {
      reticle:               v.reticle || null,
      reticle_color:         v.reticle_color || null,
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
  // An axis shows only when listings disagree on it — except reticle on
  // optics, which is key purchase info even when every variant shares it.
  function computeActiveAxes(listings) {
    var isOptic = listings.some(function (l) { return l.category === 'optic'; });
    return VARIANT_AXES.filter(function (axis) {
      var seen = new Set();
      listings.forEach(function (l) { seen.add(l.axes[axis.key]); });
      if (axis.key === 'reticle' && isOptic &&
          listings.some(function (l) { return l.axes.reticle; })) return true;
      return seen.size > 1;
    });
  }
  // variant_label is a hand-set override (e.g. "2 MOA Red Dot") for variants
  // that differ on things the axis columns don't capture. Axis logic is the
  // fallback; "Standard" is the last resort.
  function formatVariantLabel(axes, activeAxes, customLabel) {
    if (typeof customLabel === 'string' && customLabel.trim()) return customLabel.trim();
    if (!activeAxes.length) return 'Standard';
    return activeAxes.map(function (a) {
      var val = axes[a.key];
      return val != null && val !== '' ? val : '—';
    }).join(' / ');
  }
  // DB stores retailer + network like "OpticsPlanet (Awin)"; shoppers only
  // need the retailer, so strip anything trailing in parens.
  // A price we can stand behind is one a FEED verified within the window.
  // op_last_matched_by null means no feed ever matched this link, so its
  // street_price was hand-entered — a hand-typed last_checked must not pass as
  // verification, which is why both columns are checked and not just the date.
  //
  // Duplicated in gunforma-build-detail.html and
  // netlify/functions/product-page.mjs — the same three-way rule, same window.
  // Change one, change all three or the same listing reads differently
  // depending on which page you are on.
  var STALE_AFTER_DAYS = 7;
  function isStalePrice(l) {
    if (!l || !l.last_checked || !l.op_last_matched_by) return true;
    // last_checked is a DATE ('YYYY-MM-DD'); read it as UTC midnight so the
    // comparison doesn't shift by a day for viewers west of UTC.
    var checked = Date.parse(l.last_checked + 'T00:00:00Z');
    if (isNaN(checked)) return true;
    // Whole DAYS, not elapsed milliseconds: last_checked is a date, so
    // "checked 7 days ago" must read the same at 09:00 and at 23:00. This is
    // the same boundary as the SQL rule, last_checked < current_date - 7.
    var now = new Date();
    var todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return checked < todayUTC - STALE_AFTER_DAYS * 86400000;
  }

  // Price to rank by. A stale price sorts as unknown rather than as its
  // number: otherwise a stale low price still wins the hero row, displacing a
  // fresh listing, and merely renders as "Check price" once it has won.
  function sortPrice(l) { return l.stale ? null : l.price; }

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
      .select('id, product_id, variant_label, reticle, reticle_color, color, finish, optic_cut, bundle, clamp, ' +
              'manual_safety_variant, is_default, primary_image_url, ' +
              'products!product_variants_product_id_fkey(category), ' +
              'affiliate_links(url, affiliate_url, street_price, in_stock, is_primary, ' +
              'last_checked, op_last_matched_by, partners(name))')
      // Retired rows never reach a buy surface. Top-level filter drops a
      // retired variant; the embed filter drops a retired listing while
      // keeping its (live) variant.
      .is('retired_at', null)
      .is('affiliate_links.retired_at', null)
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
          customLabel: v.variant_label,
          category:    v.products ? v.products.category : null,
          isDefault:   !!v.is_default,
          url:         l.affiliate_url || l.url,
          price:       l.street_price != null ? Number(l.street_price) : null,
          stale:       isStalePrice(l),
          in_stock:    l.in_stock,
          is_primary:  !!l.is_primary,
          partnerName: displayPartnerName(l.partners ? l.partners.name : null),
        });
      });
    });

    Object.keys(byProduct).forEach(function (productId) {
      var listings = byProduct[productId];
      var activeAxes = computeActiveAxes(listings);
      listings.forEach(function (l) { l.variantLabel = formatVariantLabel(l.axes, activeAxes, l.customLabel); });
      // Fresh price first, then in-stock, then cheapest; is_primary only breaks ties.
      listings.sort(function (a, b) {
        // Fresh-and-priced first, so listings[0] IS the listing whose price gets
        // displayed. is_primary drops to a tiebreak: it used to lead, which is
        // how a product could show one listing's price and send the click to
        // another (27 of 160 products did).
        var af = (!a.stale && a.price != null), bf = (!b.stale && b.price != null);
        if (af !== bf) return af ? -1 : 1;
        if ((a.in_stock === true) !== (b.in_stock === true)) return a.in_stock ? -1 : 1;
        var ap = sortPrice(a), bp = sortPrice(b);
        if (ap != null && bp != null && ap !== bp) return ap - bp;
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return 0;
      });
      // Stale prices are excluded from the range too — "From $X" must not be
      // anchored on a number no feed has confirmed.
      var priced = listings.filter(function (l) { return l.price != null && !l.stale; });
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
    } else if (hero.price != null && !hero.stale) {
      priceHtml = '<span class="part-affiliate-price">$' + hero.price.toFixed(2) + '</span>';
    } else {
      // Unknown or unverified — the buy link still works, we just won't state
      // a number we can't stand behind.
      priceHtml = '<span class="part-affiliate-price">Check price</span>';
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
      var lPrice = (l.price != null && !l.stale) ? '$' + l.price.toFixed(2) : 'Check price';
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
