// affiliate.js — shared affiliate loader + renderers for every page that
// shows product buy links. Extracted from gunforma-build-detail.html so
// gunforma-parts-catalog.html, gunforma-armory.html, and future surfaces
// don't diverge.
//
// The DB shape: product_variants → affiliate_links → partners. builds
// store product_id only (not variant_id), so all buyable listings across
// all variants are surfaced; the shopper picks. Each row's URL is the
// affiliate_url when present, else the raw url. rel="noopener sponsored
// nofollow" + target="_blank" on every partner button.
//
// TWO KINDS OF ROW. A variant with a partner listing is a PARTNER row
// (/go/<link id>, sponsored). A variant with none is a MAKER row when the
// product has a usable products.url: a button to that url through
// /go/part/<product id>, rel="noopener nofollow" (nobody pays for it), with
// the label — "Buy from <maker>" or "Buy at <host>" — decided by
// js/maker-link.js. Partner rows always sort first. A product with neither
// has no entry, as before, and the catalog panel shows renderEmpty().
//
// API (namespaced on window.affiliate):
//   loadFor(sb, productIds)      → Promise; populates the internal cache
//   get(productId)               → the aggregate object or null
//   renderHero(productId)        → compact one-row HTML (price + partner
//                                  + stock + Buy button); '' if no PARTNER
//                                  listing — grid cards never carry a maker
//                                  button
//   renderBlock(productId)       → full block: hero row + expandable
//                                  variants list + disclosure line; '' if
//                                  no data
//   renderEmpty(reason)          → muted "No retailer listings" markup
//   AFFILIATE_BY_PRODUCT_ID      → the raw cache, exposed for pages that
//                                  want to do bespoke rendering
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  var AFFILIATE_BY_PRODUCT_ID = {};

  // VARIANT_AXES, extractVariantAxes, computeActiveAxes and
  // formatVariantLabel used to live here. The label now comes from
  // js/variant-label.js — the same file netlify/functions/_variant-label.mjs
  // mirrors, with scripts/variant-label.test.mjs failing the deploy if the
  // two disagree. This file's copy was one of three, and they had drifted:
  // `finish` was a label axis on the server-rendered product page and not
  // here, so True Precision P365-FUSE read "Black / DLC" at
  // /parts/slides/true-precision-p365-fuse and "Black" twice — $375.25 and
  // $318.99 — in this renderer.
  //
  // Read window.variantLabel AT CALL TIME, never captured into a var here.
  // js/variant-label.js is a separate <script> and this IIFE body runs at
  // load; a captured reference would be whatever existed then.

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

  // Last resort, so a tie resolves the same way on every request and every
  // page: partner name, then URL. Both are stable per listing.
  function tieBreak(a, b) {
    var ap = a.partnerName || '', bp = b.partnerName || '';
    if (ap !== bp) return ap < bp ? -1 : 1;
    var au = a.url || '', bu = b.url || '';
    return au === bu ? 0 : (au < bu ? -1 : 1);
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

    // products.url, is_discontinued and the maker's website feed the maker
    // row; msrp is the only number a maker row has to show. The
    // manufacturers embed names its FK for the same reason the products one
    // does — see CLAUDE.md, PGRST201.
    var res = await sb.from('product_variants')
      .select('id, product_id, variant_label, reticle, reticle_color, color, finish, optic_cut, bundle, clamp, ' +
              'manual_safety_variant, is_default, primary_image_url, msrp, ' +
              'products!product_variants_product_id_fkey(category, url, is_discontinued, ' +
                'manufacturers!products_brand_id_fkey(name, website_url)), ' +
              'affiliate_links(id, url, affiliate_url, street_price, in_stock, ' +
              'last_checked, op_last_matched_by, partners(name))')
      // Retired rows never reach a buy surface. Top-level filter drops a
      // retired variant; the embed filter drops a retired listing while
      // keeping its (live) variant.
      .is('retired_at', null)
      .is('affiliate_links.retired_at', null)
      .in('product_id', ids);
    if (res.error) { console.error('[affiliate] load failed', res.error); return; }

    // Group into (variant, link) rows per product. A variant with no links
    // becomes a maker row when the product has a usable url; a variant with
    // neither is dropped, as every variant without links used to be.
    var byProduct = {};
    (res.data || []).forEach(function (v) {
      var links = v.affiliate_links || [];
      var p = v.products || {};
      // Read at call time: js/maker-link.js is a separate <script>.
      var maker = p.is_discontinued ? null
        : global.makerLink(p.url, p.manufacturers ? p.manufacturers.name : null,
                                  p.manufacturers ? p.manufacturers.website_url : null);
      if (!links.length && !maker) return;
      if (!byProduct[v.product_id]) byProduct[v.product_id] = { partner: [], maker: [] };
      // The label function takes the variant row itself — {variant_label,
      // color, finish} — so the row travels instead of a derived axes bag.
      var variant = { variant_label: v.variant_label, color: v.color, finish: v.finish };
      var msrp = v.msrp != null ? Number(v.msrp) : null;
      if (!links.length) {
        byProduct[v.product_id].maker.push({
          variantId:   v.id,
          variant:     variant,
          category:    p.category || null,
          isDefault:   !!v.is_default,
          url:         null,            // never a retailer url — see goUrl
          linkId:      null,
          goUrl:       '/go/part/' + v.product_id,
          price:       null,
          stale:       true,
          in_stock:    null,
          partnerName: null,
          maker:       maker,           // { host, ownStore, label }
          msrp:        msrp,
        });
        return;
      }
      links.forEach(function (l) {
        byProduct[v.product_id].partner.push({
          variantId:   v.id,
          variant:     variant,
          category:    p.category || null,
          isDefault:   !!v.is_default,
          // The retailer destination, kept for reference; the BUTTON uses goUrl.
          url:         l.affiliate_url || l.url,
          linkId:      l.id,
          goUrl:       '/go/' + l.id,
          price:       l.street_price != null ? Number(l.street_price) : null,
          stale:       isStalePrice(l),
          in_stock:    l.in_stock,
          partnerName: displayPartnerName(l.partners ? l.partners.name : null),
          maker:       null,
          msrp:        msrp,
        });
      });
    });

    Object.keys(byProduct).forEach(function (productId) {
      var partner = byProduct[productId].partner;
      var makers  = byProduct[productId].maker;
      // No active-axis pass: a label is a property of the variant alone now,
      // so it no longer changes when a sibling variant is added or retired.
      partner.forEach(function (l) { l.variantLabel = global.variantLabel(l.variant); });
      makers.forEach(function (l) { l.variantLabel = global.variantLabel(l.variant); });
      // Fresh price first, then in-stock, then cheapest, then a DETERMINISTIC
      // tiebreak. PostgREST returns embedded rows in arbitrary order, so
      // without that last key two equally-priced listings swap hero between
      // requests — is_primary used to hide this for 25 products.
      partner.sort(function (a, b) {
        // Fresh-and-priced first, so listings[0] IS the listing whose price
        // gets displayed.
        var af = (!a.stale && a.price != null), bf = (!b.stale && b.price != null);
        if (af !== bf) return af ? -1 : 1;
        if ((a.in_stock === true) !== (b.in_stock === true)) return a.in_stock ? -1 : 1;
        var ap = sortPrice(a), bp = sortPrice(b);
        if (ap != null && bp != null && ap !== bp) return ap - bp;
        return tieBreak(a, b);
      });
      // Maker rows AFTER every partner row, by label — sorted apart rather
      // than through the comparator above, whose tiebreak would put an
      // unnamed maker row ahead of a stale partner listing.
      makers.sort(function (a, b) {
        return a.variantLabel < b.variantLabel ? -1 : a.variantLabel > b.variantLabel ? 1 : 0;
      });
      var listings = partner.concat(makers);
      // Stale prices are excluded from the range too — "From $X" must not be
      // anchored on a number no feed has confirmed. Maker rows carry no price.
      var priced = listings.filter(function (l) { return l.price != null && !l.stale; });
      var inStockPriced = priced.filter(function (l) { return l.in_stock === true; });
      var priceSet = (inStockPriced.length ? inStockPriced : priced).map(function (l) { return l.price; });
      AFFILIATE_BY_PRODUCT_ID[productId] = {
        hero: listings[0],
        listings: listings,
        partnerCount: partner.length,
        makerCount: makers.length,
        minPrice: priceSet.length ? Math.min.apply(null, priceSet) : null,
        maxPrice: priceSet.length ? Math.max.apply(null, priceSet) : null,
        anyInStock: listings.some(function (l) { return l.in_stock === true; }),
        variantsWithListings: new Set(partner.map(function (l) { return l.variantId; })).size,
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
    } else if (hero.maker && hero.msrp != null) {
      // A maker hero has no street price. MSRP is the only number there is
      // and it is still true — labelled, as product-page.mjs labels it.
      priceHtml = '<span class="part-affiliate-price">MSRP $' + hero.msrp.toFixed(2) + '</span>';
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
    return '<div class="part-affiliate">' +
        '<div class="part-affiliate-info">' + infoHtml + '</div>' +
        buyButtonHtml(hero, 'part-affiliate-btn', true) +
      '</div>';
  }

  // The one place a buy anchor is emitted. A partner row is sponsored and
  // goes through /go/<link>; a maker row is NOT sponsored and goes through
  // /go/part/<product>. `full` chooses "Buy at OpticsPlanet" over the short
  // "OpticsPlanet" used in the options list; a maker label is always full.
  function buyButtonHtml(row, cls, full) {
    var label;
    if (row.maker) {
      label = esc(row.maker.label) + ' ↗';
      return '<a class="' + cls + '" href="' + esc(row.goUrl) + '" target="_blank" rel="' + global.MAKER_REL + '">' + label + '</a>';
    }
    label = row.partnerName
      ? (full ? 'Buy at ' : '') + esc(row.partnerName) + ' ↗'
      : (full ? 'View listing ↗' : 'View ↗');
    return '<a class="' + cls + '" href="' + esc(row.goUrl) + '" target="_blank" rel="noopener sponsored nofollow">' + label + '</a>';
  }

  function renderHero(productId) {
    var aff = get(productId);
    // Grid cards carry a partner hero or nothing: a maker-only product
    // renders no card button, by design — the panel is where that lives.
    if (!aff || !aff.hero || !aff.partnerCount) return '';
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
    // Says what is true of the buttons in this block: partner-only,
    // maker-only, or both. Never absent here — a block exists only when
    // there is at least one button.
    var disclosureText = global.buyDisclosure(aff.partnerCount > 0, aff.makerCount > 0);
    var disclosure = disclosureText
      ? '<div class="part-affiliate-disclosure">' + esc(disclosureText) + '</div>'
      : '';
    if (!multi) return main + disclosure;
    var optionsLabel = 'See all ' + aff.listings.length + ' options';
    var headerRow =
      '<div class="part-affiliate-variant-header">' +
        '<div class="part-affiliate-variant-header-label">Option</div>' +
        '<div class="part-affiliate-variant-header-note">Prices and availability may vary based on promotions and in-stock items.</div>' +
      '</div>';
    var variantRows = aff.listings.map(function (l) {
      var lPrice = (l.price != null && !l.stale) ? '$' + l.price.toFixed(2)
        : (l.maker && l.msrp != null) ? 'MSRP $' + l.msrp.toFixed(2)
        : 'Check price';
      var lStock = l.in_stock === true
        ? '<span class="part-affiliate-stock in">In stock</span>'
        : l.in_stock === false
          ? '<span class="part-affiliate-stock out">Out of stock</span>'
          : '';
      var lPartner = l.partnerName ? 'at <strong>' + esc(l.partnerName) + '</strong>' : '';
      return '<div class="part-affiliate-variant-row">' +
          '<div class="part-affiliate-variant-info">' +
            '<span class="part-affiliate-variant-label">' + esc(l.variantLabel) + '</span>' +
            '<span class="part-affiliate-variant-sub">' + lPrice + ' ' + lPartner + ' ' + lStock + '</span>' +
          '</div>' +
          buyButtonHtml(l, 'part-affiliate-variant-btn', false) +
        '</div>';
    }).join('');
    return main +
      '<details class="part-affiliate-options">' +
        '<summary class="part-affiliate-options-summary">' + optionsLabel + '</summary>' +
        '<div class="part-affiliate-variant-list">' + headerRow + variantRows + '</div>' +
      '</details>' +
      disclosure;
  }

  // Only reached for a product with no partner listing AND no usable
  // products.url (one live part today). Everything else has a button now.
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
