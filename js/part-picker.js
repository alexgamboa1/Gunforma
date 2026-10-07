// js/part-picker.js — the shared part picker's cards, thumbnails and
// post-add behaviour. Loaded as a plain <script src> global by the two pages
// that let someone assemble a parts list:
//
//   gunforma-post-build.html  — a builder posting their own build
//   gunforma-admin-post.html  — an admin posting on a builder's behalf
//
// It injects its own CSS into <head> on init, so a page adds the script tag,
// calls PartPicker.init(), and keeps no copy of the markup or the rules.
//
// WHY THIS IS A MODULE AND NOT A COPY
//
// This is the fourth thing in the repo that had to be extracted rather than
// copied, and the picker is now the worked example that cost the most. When
// #81 fixed three defects in gunforma-post-build.html, the identical code in
// gunforma-admin-post.html kept every one of them — the picker did not close
// on a pick, product photos were cropped to a 100px letterbox, and the added
// parts were still text chips with no photo to check them against. The two
// copies were byte-identical apart from comment wording, which is exactly why
// nobody noticed one had moved.
//
// Same shape as js/redact.js and js/photos.js before it: the page nobody is
// looking at keeps the old behaviour, and nothing fails. Do not inline any
// part of this back into a page, and do not copy it to a third picker.
//
// WHAT THIS MODULE DOES NOT OWN
//
// Deliberately narrow. The page still owns its own state, its CATEGORIES
// list, and these call sites, which remain duplicated between the two pages
// and are the obvious next extraction:
//
//   renderParts, buildCategoryBlock, categoryPickerState,
//   customFormFieldsHtml, filterCards, togglePicker, toggleCustomForm,
//   addCatalogPart, addCustomPart, removePart, loadCatalog
//
// THE PAGE MUST DEFINE TWO GLOBALS
//
// partCardHtml() and selectedPartHtml() emit inline onclick attributes that
// call addCatalogPart(catKey, itemId) and removePart(uid) by name, because
// both pages already define them under exactly those names. init() checks for
// them and throws if either is missing — a missing handler otherwise shows up
// as a card that renders perfectly and does nothing when clicked, which is
// the kind of failure that reaches a person as "the button is broken" with
// nothing in the console.

(function (global) {
  'use strict';

  // Page-supplied accessors, installed by init(). Every one is a FUNCTION,
  // and that is not style — the same rule js/photos.js documents. A captured
  // value is wrong for all three:
  //   - CATALOG is REASSIGNED wholesale, by loadCatalog() (`CATALOG = grouped`)
  //     and again by the admin page's postAnother() (`CATALOG = {}`), so a
  //     captured reference would keep serving the previous platform's parts.
  //   - state is read after every mutation the page makes to state.parts.
  //   - renderParts/onChange do not exist yet when the script tag is parsed.
  var cfg = null;

  function need() {
    if (!cfg) throw new Error('PartPicker: init() has not been called');
    return cfg;
  }

  // ===== CATALOG LOOKUP =====

  // Resolve a products.id back to its catalog row, across every category.
  //
  // The selected-part cards need an image and a price, and state.parts carries
  // neither on purpose: parts_snapshot has no image or price column, so a part
  // hydrated from an armory draft or from an edit would render a blank
  // thumbnail and no price if the card read from state. So look them up here,
  // at render time. Both hydration paths await loadCatalog() before they call
  // renderParts(), which is what makes this safe — and is the thing to
  // re-check if a third hydration path ever appears.
  //
  // Searches all categories rather than taking a category key, because a
  // snapshot's category has been through normalizePartCategory() and need not
  // be the key this product was bucketed under. refId is a products.id, so it
  // is unique across the whole catalog either way.
  function findCatalogItem(refId) {
    if (!refId) return null;
    var catalog = need().catalog() || {};
    var keys = Object.keys(catalog);
    for (var i = 0; i < keys.length; i++) {
      var rows = catalog[keys[i]] || [];
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].id === refId) return rows[j];
      }
    }
    return null;
  }

  // Attribute-safe escaping. Used for the variant field's value, which is
  // free text the builder typed. (brand/name around it are interpolated raw,
  // inherited from the pages this was extracted from — not widened here.)
  function escAttr(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Longest a variant note may be. Enforced here as well as by maxlength,
  // because maxlength is a UI hint a paste or a devtools edit walks straight
  // past, and this value goes into parts_snapshot.
  var VARIANT_MAX = 60;

  // Writes the variant straight to the matching state.parts entry and
  // RE-RENDERS NOTHING.
  //
  // That is the whole point: renderParts() rebuilds the section's innerHTML,
  // so re-rendering per keystroke would destroy the input the user is typing
  // into and drop focus on the first character. The input keeps its own
  // value; only the trimmed copy goes to state, so trailing spaces mid-word
  // still type normally.
  function noteVariant(uid, value) {
    var st = need().state();
    var parts = (st && st.parts) || [];
    var v = String(value == null ? '' : value).trim().slice(0, VARIANT_MAX);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].uid === uid) {
        // undefined, not '' — buildPartsSnapshot() tests truthiness and must
        // omit the key entirely when the field is blank.
        parts[i].variant = v || undefined;
        return;
      }
    }
  }

  // ===== CARD MARKUP =====

  // Product-thumbnail slot. Uses the default variant's primary_image_url when
  // we have one, else the "Photo coming soon" placeholder.
  //
  // Sizing and fit live entirely in the .part-card-img img rule below. This
  // used to carry style="...object-fit:cover..." inline, which silently
  // outranked the stylesheet and made any CSS change a no-op. Don't put it
  // back — and note the admin page still carried that inline style two
  // releases after the post-build page dropped it.
  function partImageHtml(item) {
    if (!item || !item.image) {
      return '<div class="part-card-img"><div class="part-card-img-bg">' +
               '<div class="part-card-img-label">Photo coming soon</div>' +
             '</div></div>';
    }
    var alt = ((item.brand ? item.brand + ' ' : '') + (item.name || '')).replace(/"/g, '&quot;');
    return '<div class="part-card-img">' +
             '<img src="' + item.image + '" alt="' + alt + '" loading="lazy" ' +
               'onerror="this.parentElement.innerHTML=\'<div class=&quot;part-card-img-bg&quot;><div class=&quot;part-card-img-label&quot;>No photo</div></div>\'"/>' +
           '</div>';
  }

  // The one copy of the picker card. buildCategoryBlock() and filterCards()
  // both render these, on both pages — four call sites that used to be four
  // near-identical strings, and had already drifted: the search results
  // printed a bare "$0" where the initial grid printed an em dash.
  function partCardHtml(catKey, item) {
    return '<div class="part-card">' +
      partImageHtml(item) +
      '<div class="part-card-body">' +
        '<div class="part-card-brand">' + item.brand + '</div>' +
        '<div class="part-card-name">'  + item.name  + '</div>' +
        '<div class="part-card-desc">'  + item.desc  + '</div>' +
      '</div>' +
      '<div class="part-card-footer">' +
        (item.price ? '<div class="part-card-price">$' + item.price + '</div>' : '<div class="part-card-price">&mdash;</div>') +
        // "Choose color →" when a choice follows, "+ Add" when it does not.
        // A button promising an add and then asking a question is the small
        // dishonesty that makes people stop trusting a control.
        '<button class="part-card-add add" onclick="addCatalogPart(\'' + catKey + '\',\'' + item.id + '\')">' +
          (hasColorChoice(item) ? 'Choose color &rarr;' : '+ Add') + '</button>' +
      '</div>' +
    '</div>';
  }

  // Thumbnail for a part the user has already added.
  //
  // A part with a CHOSEN VARIANT (part.variantId, set by the pages'
  // addPartWithVariant) shows that variant: its own photo, else its swatch —
  // drawn by the same variantMediaHtml the color step uses, so the row
  // matches the row it was picked from. Never item.image here: that is the
  // DEFAULT variant's photo, and a Black barrel's photo over the words
  // "Gold / TiN" looks like an answer. That was this function's bug — it read
  // item.image unconditionally, so every non-default pick showed the default.
  // part.imageUrl is deliberately null for a chosen variant with no photo
  // (38% of live variants), which is exactly when the swatch is the honest
  // answer. Its onerror degrades to the swatch too, not to a blank box.
  //
  // A part with NO chosen variant — custom, or hydrated from a snapshot that
  // predates variants — keeps the product photo as before, then a swatch if a
  // colour is known, then the label box. A pending custom part has no catalog
  // row to photograph, so it says so rather than showing an empty grey square
  // that reads like a broken image.
  function selectedPartThumbHtml(part, item) {
    if (part.variantId) {
      return global.variantMediaHtml({
        primary_image_url: part.imageUrl || null,
        color:             part.variantColor || null,
        finish:            part.variantFinish || null,
        variant_label:     part.variantLabel || null,
      }, 'selected-part-thumb');
    }
    var src = part.imageUrl || (item && item.image) || null;
    if (!src) {
      if (part.variantColor) {
        return global.variantMediaHtml({ color: part.variantColor }, 'selected-part-thumb');
      }
      return '<div class="selected-part-thumb"><div class="selected-part-thumb-label">' +
               (part.pending ? 'Pending' : 'No photo') + '</div></div>';
    }
    var alt = ((part.brand ? part.brand + ' ' : '') + (part.name || '')).replace(/"/g, '&quot;');
    return '<div class="selected-part-thumb">' +
             '<img src="' + src + '" alt="' + alt + '" loading="lazy" ' +
               'onerror="this.parentElement.innerHTML=\'<div class=&quot;selected-part-thumb-label&quot;>No photo</div>\'"/>' +
           '</div>';
  }

  // One row per added part: photo, brand, name, price, and a remove button.
  // Price comes from the catalog, not from the part, so it is absent rather
  // than wrong for a pending part or a product that has since lost its MSRP.
  function selectedPartHtml(part) {
    var item = findCatalogItem(part.refId);
    return '<div class="selected-part">' +
      selectedPartThumbHtml(part, item) +
      '<div class="selected-part-body">' +
        '<div class="selected-part-brand">' + part.brand + '</div>' +
        '<div class="selected-part-name">'  + part.name  + '</div>' +
        // The colour they picked, under the name — the photo alone does not
        // say "Gold / TiN", and a swatch says even less.
        (part.variantLabel
          ? '<div class="selected-part-variant-label">' + escAttr(part.variantLabel) + '</div>'
          : '') +
        // "2 MOA · Red dot" — stored on the part by addPartWithVariant().
        (part.variantSpecs
          ? '<div class="selected-part-variant-specs">' + escAttr(part.variantSpecs) + '</div>'
          : '') +
        (part.pending
          ? '<div class="selected-part-pending"><span class="selected-part-dot"></span>Pending review</div>'
          : (item && item.price ? '<div class="selected-part-price">$' + item.price + '</div>' : '')) +
        // Free text, for a part with NO chosen variant: a product hydrated
        // from a snapshot that predates variants, or one with no variant
        // coverage, where a builder who owns it in a colour we do not carry
        // has nowhere else to say so. Named `variant` rather than `variantId`
        // so it never collides with the real thing. When a variant WAS picked
        // the label above already says it, and a second box asking the same
        // question invites an answer that contradicts it.
        // Not offered on custom/pending parts — the builder typed the full
        // name there already.
        (part.pending || part.variantLabel ? '' :
          '<input type="text" class="selected-part-variant" maxlength="' + VARIANT_MAX + '"' +
            ' value="' + escAttr(part.variant || '') + '"' +
            ' data-uid="' + escAttr(part.uid) + '"' +
            ' placeholder="Variant / colour (optional) — e.g. FDE, Coyote, 2-tone"' +
            ' aria-label="Variant or colour for ' + escAttr(part.name) + '"' +
            ' oninput="PartPicker.noteVariant(this.dataset.uid, this.value)" />') +
      '</div>' +
      '<button class="selected-part-remove" onclick="removePart(\'' + part.uid + '\')">Remove</button>' +
    '</div>';
  }

  // The whole selected-parts strip for one category, or '' when it has none.
  function selectedPartsHtml(parts) {
    if (!parts || !parts.length) return '';
    return '<div class="selected-parts-list">' + parts.map(selectedPartHtml).join('') + '</div>';
  }

  // ===== GROUP HEADINGS =====

  // The heading over each of the four stages — Core build, Controls,
  // Magazine, Carry and finish. The groups and their order come from
  // js/build-categories.js; this is only how one is drawn.
  //
  // IT COUNTS SECTIONS, NOT PARTS. A builder with three optics and nothing
  // else has covered one section of Core build, not three — a parts count
  // would read as progress for buying the same thing again. So each segment
  // is a section, lit when that section holds at least one part, and the
  // tally says "2 of 5". That is also why the segment row is the progress
  // bar rather than decoration: it is the same fact twice, once for scanning
  // and once for reading.
  //
  // DELIBERATELY UNNUMBERED. The page's own cards are steps 1-4 and Parts is
  // step 4; numbering the four groups inside it would put a second, competing
  // 1-4 on the same screen.
  //
  // NOT CLICKABLE. Everything else in this section opens on click, so a
  // heading that looked the same and did nothing would read as broken —
  // hence an <h3>, no cursor and no toggle affordance.
  //
  // Lives here rather than in either page because .category-group's CSS does.
  // It was a `categoryGroupHeadHtml` in both pages for exactly one PR (#114),
  // which is one PR longer than this repo's record suggests is safe.
  function groupHeadHtml(g) {
    var parts = need().state().parts || [];
    var filled = 0;
    var segs = g.categories.map(function (cat) {
      var on = parts.some(function (p) { return p.category === cat.key; });
      if (on) filled++;
      return '<span class="category-group-seg' + (on ? ' on' : '') + '"></span>';
    }).join('');
    var total = g.categories.length;
    // role="img" with one label, because the segments are decorative spans:
    // without it a screen reader walks eighteen empty elements and reports
    // nothing. The tally text is inside the labelled element on purpose —
    // sighted readers get it either way, and it keeps the two in one place.
    return '<div class="category-group-head">' +
        '<h3 class="category-group-name">' + g.group.label + '</h3>' +
        '<div class="category-group-progress' + (filled ? ' has-parts' : '') + '" role="img"' +
            ' aria-label="' + filled + ' of ' + total + ' sections have a part">' +
          '<span class="category-group-segs">' + segs + '</span>' +
          '<span class="category-group-tally"><b>' + filled + '</b> of ' + total + '</span>' +
        '</div>' +
        '<div class="category-group-blurb">' + g.group.blurb + '</div>' +
      '</div>';
  }

  // ===== POST-ADD BEHAVIOUR =====

  // renderParts() replaces the whole section, so the element has to be looked
  // up after the re-render, not before it — hence the deferred lookup by id.
  function scrollToCategory(k) {
    setTimeout(function () {
      var el = document.getElementById('cat-' + k);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  // Collapse the picker after a successful add and put the user back on the
  // category they just added to. Without this the panel stays open over a grid
  // that has just lost the card they clicked, which reads as "did that work?"
  // — and the collapse alone would scroll the page out from under them.
  //
  // Both pages' addCatalogPart() and both branches of addCustomPart() end
  // here. The admin page went two releases without it.
  function closePickerAfterAdd(k) {
    var c = need();
    var state = c.state();
    // Before the render: a "Use this" from the catalog-match prompt swaps the
    // catalog part into the typed part's place. See CATALOG MATCH below.
    applySwap(state);
    state.openPicker = null;
    state.customOpen = null;
    c.render();
    if (c.onChange) c.onChange();
    scrollToCategory(k);
  }

  // ===== COLOR STEP =====
  //
  // WHERE IT SITS IN THE FLOW
  // Open a category -> grid of product cards -> "Choose color →" -> this list
  // -> the part is added and the picker closes, exactly as a single-variant
  // "+ Add" does today. It replaces the contents of #cards-<catKey>, which is
  // the same container filterCards() already rewrites — so neither page's
  // buildCategoryBlock() needs to change, and the two copies of it stay
  // identical rather than drifting on a change like this.
  //
  // NOT inline inside the card. The grid is sized to its photo and collapses
  // to one column under 560px (#82, after #81 shipped 1:1 cards that painted a
  // barrel at 98x55 on a phone). A variable-height swatch row inside a card
  // reintroduces exactly that problem and reflows the grid around whichever
  // card is open. A full-width row per color gives each one a swatch, a label
  // and a price without fighting for space.
  //
  // And it is the same list as gunforma-build-detail.html's "See other
  // options" panel — same rows, same swatch, same label. Designed once.

  // Live variants for a catalog item, default first, then by label so the
  // order is stable between renders. PostgREST returns embedded rows in
  // arbitrary order; without the second key the list reshuffles per request.
  function variantsOf(item) {
    var vs = (item && item.variants) || [];
    return vs.slice().sort(function (a, b) {
      if (!!b.is_default !== !!a.is_default) return a.is_default ? -1 : 1;
      var al = global.variantLabel(a), bl = global.variantLabel(b);
      if (al !== bl) return al < bl ? -1 : 1;
      // Same label — the Holosun 407C X3's three "Black · Anodized" rows —
      // so the spec line decides, and Gold / Green / Red read in order
      // rather than in id order.
      var as = global.variantSpecs(a), bs = global.variantSpecs(b);
      if (as !== bs) return as < bs ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  }

  // THE SINGLE-VARIANT RULE. 81 of 231 products have exactly one live variant,
  // and for those this step must not exist: "+ Add" adds in one click and
  // records that sole variant. Keyed on LIVE variants, so a product that drops
  // to one through retirement stops offering a choice with nobody editing a
  // flag.
  function hasColorChoice(item) {
    return variantsOf(item).length > 1;
  }

  function priceLineFor(v) {
    // MSRP only, and labelled. The picker has no listing data — affiliate.js
    // is not loaded on the post pages — so quoting a bare number here would
    // put an unlabelled MSRP where a builder reads a buy price. The live
    // retailer price belongs on the build page, which has the listings.
    if (v.msrp == null || v.msrp === '') return '';
    return '<span class="variant-row-price">$' + Number(v.msrp).toFixed(2) +
           '<span class="variant-row-msrp">MSRP</span></span>';
  }

  function variantRowHtml(catKey, item, v) {
    var label = global.variantLabel(v);
    var specs = global.variantSpecs(v);
    return '<button type="button" class="variant-row" ' +
             'onclick="pickVariant(\'' + catKey + '\',\'' + escAttr(item.id) + '\',\'' + escAttr(v.id) + '\')">' +
        global.variantMediaHtml(v, 'variant-media') +
        '<span class="variant-row-body">' +
          '<span class="variant-row-label">' + (label || 'This color') + '</span>' +
          // What tells two rows with the same label apart. Absent, not
          // empty, for a part with no spec columns, so its row is unchanged.
          (specs ? '<span class="variant-row-specs">' + escAttr(specs) + '</span>' : '') +
          (v.is_default ? '<span class="variant-row-std">Standard</span>' : '') +
        '</span>' +
        priceLineFor(v) +
        '<span class="variant-row-go">Add →</span>' +
      '</button>';
  }

  // The whole step. Rendered into #cards-<catKey>; the page's back button
  // restores the grid by re-rendering.
  function variantListHtml(catKey, item) {
    var vs = variantsOf(item);
    return '<div class="variant-step">' +
        '<div class="variant-step-head">' +
          '<button type="button" class="variant-step-back" onclick="cancelVariantPick(\'' + catKey + '\')">← All options</button>' +
          '<div class="variant-step-title">' +
            '<span class="variant-step-brand">' + escAttr(item.brand || '') + '</span>' +
            '<span class="variant-step-name">' + escAttr(item.name || '') + '</span>' +
          '</div>' +
          '<div class="variant-step-count">' + vs.length + ' colors</div>' +
        '</div>' +
        '<div class="variant-list">' + vs.map(function (v) {
          return variantRowHtml(catKey, item, v);
        }).join('') + '</div>' +
      '</div>';
  }

  // Swap the grid for the color step. Returns false when the product has no
  // choice to offer, so the caller adds straight away — the branch is here
  // rather than in each page, because there are two pages.
  function openColorStep(catKey, item) {
    if (!hasColorChoice(item)) return false;
    var host = document.getElementById('cards-' + catKey);
    if (!host) return false;           // grid not open: caller falls through
    host.innerHTML = variantListHtml(catKey, item);
    var count = document.getElementById('picker-count-' + catKey);
    if (count) count.textContent = variantsOf(item).length + ' colors';
    host.scrollIntoView({ block: 'nearest' });
    return true;
  }

  // ===== CATALOG MATCH =====
  //
  // WHAT THIS IS FOR
  // A builder who cannot find their part types it by hand: "Holosun", "407k".
  // That entry is a pending custom part — no photo, no price, no buy link, and
  // a job for whoever reviews the build. Very often the part IS in the catalog
  // and they looked in the wrong section, or searched for "407" where the
  // catalog says "407K X2". A typed part that could have been a catalog part
  // is a buy link the build does not have.
  //
  // So the catalog is searched for them, in two places:
  //   while they type   — under the custom form's Brand / Part name inputs
  //                       (suggestWhileTyping), before the typed part exists
  //   before they submit — a prompt in the sidebar listing every typed part
  //                       that looks like a catalog part (renderUnlinkedNudge)
  //
  // IT ONLY EVER OFFERS. Nothing is replaced without a click, nothing blocks
  // submitting, and "Keep what I typed" removes a part from the prompt for
  // good — the builder knows what is on their gun and this does not.
  //
  // WHY IT LIVES HERE: both builder pages need it, and the two pages' copies
  // of customFormFieldsHtml and renderSidebar are exactly the duplication this
  // file's header warns about. Each page adds two attributes, one mount and
  // one call; the matching, the markup and the CSS exist once.

  // Lowercased words. Single characters are dropped: the "x" of "X2" and the
  // "7" of "TLR 7" say nothing alone, and squash() below still sees them.
  function words(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter(function (w) { return w.length > 1; });
  }
  // Words a builder adds to say WHICH ONE they have, not what it is: a colour,
  // a dot size, the kind of thing. The catalog keeps those on the variant, not
  // in the product's name, so "Holosun EPS Carry green 2 MOA" would otherwise
  // look like a name the catalog only half explains. Left out of the typed
  // words before anything is scored.
  var DESCRIPTOR = {};
  ('black fde green red gold silver grey gray tan coyote bronze od blue purple ' +
   'stainless nitride cerakote dlc tin moa dot reticle optic sight light ' +
   'for with and the').split(' ').forEach(function (w) { DESCRIPTOR[w] = true; });
  function isDescriptor(w) { return !!DESCRIPTOR[w] || /^\d+moa$/.test(w); }

  // Letters and digits only, so "TLR-7 Sub", "tlr7 sub" and "TLR 7 SUB" are
  // one string. This is what makes a missing hyphen not matter.
  function squash(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // One searchable row per catalog item, built once per catalog OBJECT. The
  // pages reassign CATALOG wholesale on every platform change, so a new
  // object is a new index and a stale one cannot be served.
  var indexCache = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function indexOf(catalog) {
    if (!catalog || typeof catalog !== 'object') return [];
    if (indexCache && indexCache.has(catalog)) return indexCache.get(catalog);
    var rows = [];
    Object.keys(catalog).forEach(function (catKey) {
      (catalog[catKey] || []).forEach(function (item) {
        if (!item || !item.id) return;
        var text = (item.brand || '') + ' ' + (item.name || '');
        var set = {};
        words(text).forEach(function (w) { set[w] = true; });
        // Where a BRAND can be found: the brand field, and the first word of
        // the name — "PMM P365 Compensator" is filed under Parker Mountain
        // Machine, and "PMM" is what people type. Not the rest of the name:
        // "Strike Industries SIG P365 Grip Module" is not a Sig part.
        var brandSet = {};
        words(item.brand).forEach(function (w) { brandSet[w] = true; });
        var lead = words(item.name)[0];
        if (lead) brandSet[lead] = true;
        rows.push({
          catKey: catKey, item: item,
          tokens: set, tokenList: Object.keys(set),
          brandList: Object.keys(brandSet),
          squash: squash(text),
          nameSquash: squash(item.name || ''),
        });
      });
    });
    if (indexCache) indexCache.set(catalog, rows);
    return rows;
  }

  // Does this catalog row contain this typed word?
  //   exact      "407k"  is a word of "Holosun 407K X2"
  //   prefix     "comp"  starts "compensator"            (3+ characters)
  //   squashed   "tlr7"  is inside "streamlighttlr7sub"  (4+ characters)
  function rowHas(row, w) {
    if (row.tokens[w]) return true;
    if (w.length >= 3) {
      for (var i = 0; i < row.tokenList.length; i++) {
        if (row.tokenList[i].indexOf(w) === 0) return true;
      }
    }
    return w.length >= 4 && row.squash.indexOf(w) !== -1;
  }

  // Is this typed word the row's brand? Exact, or a 3+ character start of it
  // ("tyrant" for Tyrant CNC, "wilson" for Wilson Combat).
  function rowHasBrand(row, w) {
    for (var i = 0; i < row.brandList.length; i++) {
      var b = row.brandList[i];
      if (b === w || (w.length >= 3 && b.indexOf(w) === 0)) return true;
    }
    return false;
  }

  // The catalog parts a typed Brand + Part name most likely means, best first.
  //
  // PURE: takes the catalog, returns rows. No DOM, no cfg — so
  // scripts/part-match.test.mjs can run it against real catalog names.
  //
  // HOW IT SCORES. Each typed word is worth more the fewer catalog parts
  // contain it: "p365" is in a hundred names and says almost nothing, "407k"
  // is in one and says nearly everything. A candidate's score is the sum of
  // the words it contains.
  //
  // THE BRAND DECIDES TIES THAT WORDS CANNOT. "Sig" + "P365 XL grip module"
  // shares more words with Wilson Combat's "WCP365 XL Grip Module" than with
  // Sig's own "P365 XL OEM". So a typed brand that is a brand we carry adds
  // to the candidates that have it and halves the ones that do not. A brand
  // we have never heard of does neither — it is a typo or a new maker, and
  // either way it is not evidence against a match.
  //
  // WHAT COUNTS AS A MATCH AT ALL. One common word is not enough: "Custom" +
  // "my trigger job" contains "trigger" and nothing else, and offering three
  // triggers for it is noise. A candidate needs the brand, or two words, or
  // one word that is almost unique.
  //
  // `strong` is the stricter bar the sidebar prompt uses: it makes a specific
  // claim ("this looks like X") and stays on screen, where the typing list is
  // a glance that disappears. It needs the catalog name to explain nearly all
  // of what was typed. "Sig" + "Romeo Zero" is offered the Romeo-X while
  // typing, which is fair — but "Zero" is the model, the catalog does not
  // have it, and the prompt must not tell that builder their optic "looks
  // like" a different one.
  //
  // opts.exclude   { <products.id>: true } — parts already on the build
  // opts.fromKey   the section being typed in; a small nudge toward it
  // opts.limit     default 3
  function matchIn(catalog, brand, name, opts) {
    opts = opts || {};
    var rows = indexOf(catalog);
    var N = rows.length;
    if (!N) return [];

    var brandWords = words(brand);
    var nameWords = words(name).filter(function (w) { return !isDescriptor(w); });
    var seen = {};
    var q = brandWords.concat(nameWords).filter(function (w) {
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    });
    // "Whole name" matching is for a name typed in pieces that the catalog
    // joins differently — "tlr 7 sub" for "TLR-7 Sub". One bare word is not
    // that: "grip" sits inside every grip module's name, and saying so is
    // the single-common-word noise the rules below exist to refuse.
    var qNameSquash = squash(name);
    var pieces = String(name == null ? '' : name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).length;
    var wholeable = pieces >= 2 && qNameSquash.length >= 4;
    // A brand alone is not a part. With only "Holosun" typed there are
    // nineteen candidates and no reason to show three of them.
    if (!nameWords.length && !wholeable) return [];

    // How many catalog parts contain each typed word, and so what it is worth.
    var df = {}, weight = {};
    q.forEach(function (w) {
      var n = 0;
      for (var i = 0; i < N; i++) if (rowHas(rows[i], w)) n++;
      df[w] = n;
      // A word no catalog part has ("green", "v2") still counts against how
      // much of what was typed a candidate explains — lightly.
      weight[w] = n ? Math.log(1 + N / n) : 2;
    });
    var total = q.reduce(function (sum, w) { return sum + weight[w]; }, 0);
    var knownBrand = brandWords.some(function (w) {
      for (var i = 0; i < N; i++) if (rowHasBrand(rows[i], w)) return true;
      return false;
    });

    var out = [];
    rows.forEach(function (row) {
      if (opts.exclude && opts.exclude[row.item.id]) return;
      var matched = 0, hits = 0, rarest = Infinity;
      q.forEach(function (w) {
        if (!rowHas(row, w)) return;
        matched += weight[w];
        hits++;
        if (df[w] < rarest) rarest = df[w];
      });
      // A name word that narrows things down: in at most a tenth of the
      // catalog. "trigger" and "ramjet" do; "p365" does not.
      var distinctive = nameWords.some(function (w) {
        return df[w] > 0 && df[w] <= Math.max(2, N * 0.1) && rowHas(row, w);
      });
      // The whole typed name, punctuation aside, sitting inside the catalog
      // name: "tlr 7 sub" in "TLR-7 Sub".
      var whole = wholeable && row.nameSquash.indexOf(qNameSquash) !== -1;
      if (!hits && !whole) return;

      var hasBrand = brandWords.some(function (w) { return rowHasBrand(row, w); });
      var nameHits = nameWords.filter(function (w) { return rowHas(row, w); }).length;
      if (!(hasBrand || hits >= 2 || rarest <= 2 || whole)) return;

      var score = matched + (whole ? 4 : 0);
      if (knownBrand) score = hasBrand ? score + 3 : score * 0.5;
      if (opts.fromKey && row.catKey === opts.fromKey) score += 1;

      var coverage = total ? matched / total : 0;
      out.push({
        catKey: row.catKey, item: row.item, score: score, nameHits: nameHits,
        // Never strong against a brand we carry that this part is not: the
        // builder named the maker, and a different maker's part is at best
        // an alternative to show while typing.
        strong: !(knownBrand && !hasBrand) &&
                (whole || (coverage >= 0.8 && distinctive && (hasBrand || hits >= 2))),
        // Fewer words left over is the closer name: "TLR-7 Sub" before
        // "TLR-7 HL-X Sub USB" when both contain everything typed.
        extra: row.tokenList.length - hits,
      });
    });
    if (!out.length) return [];

    out.sort(function (a, b) {
      return (b.score - a.score) || (a.extra - b.extra) ||
             String(a.item.name).localeCompare(String(b.item.name));
    });
    // Only what is in the same league as the best. "Holosun" + "407k" must
    // not trail every other Holosun optic behind the one that was meant: once
    // the best candidate matches the NAME, a candidate that matches only the
    // brand is not a candidate.
    var floor = out[0].score * 0.7;
    var needName = out[0].nameHits > 0;
    return out.filter(function (m) { return m.score >= floor && (!needName || m.nameHits > 0); })
              .slice(0, opts.limit || 3);
  }

  // Products already on the build, so they are never offered twice.
  function addedIds() {
    var parts = need().state().parts || [];
    var ids = {};
    parts.forEach(function (p) { if (p.refId) ids[p.refId] = true; });
    return ids;
  }

  // A section only gets suggestions if the catalog has parts in it for this
  // pistol. Magazines, holsters and knives are typed-only sections, and
  // searching the catalog for one finds things it is not: a typed "Sig 17rd
  // magazine" is a close match for a +3 basepad, and offering that is wrong.
  function sectionHasCatalog(catalog, catKey) {
    return !!(catalog && catalog[catKey] && catalog[catKey].length);
  }

  function matchThumbHtml(item) {
    return item.image
      ? '<span class="match-thumb"><img src="' + escAttr(item.image) + '" alt="" loading="lazy" onerror="this.remove()"/></span>'
      : '<span class="match-thumb"></span>';
  }
  // The catalog name, without repeating a brand the name already starts with
  // ("Holosun" + "Holosun 407K X2").
  function matchNameHtml(item) {
    var brand = String(item.brand || ''), name = String(item.name || '');
    var rest = name.toLowerCase().indexOf(brand.toLowerCase()) === 0 ? name.slice(brand.length).trim() : name;
    return '<span class="match-name"><b>' + escAttr(brand) + '</b> ' + escAttr(rest || name) + '</span>';
  }

  // ----- while they type -----
  //
  // Called from the custom form's Brand and Part name inputs, on every
  // keystroke. Writes into #cs-<catKey> and NOTHING ELSE — the same reason
  // noteVariant() re-renders nothing: renderParts() would rebuild the form
  // and drop focus on the first character.
  function suggestWhileTyping(catKey) {
    var host = document.getElementById('cs-' + catKey);
    if (!host) return;
    var c = need(), catalog = c.catalog() || {};
    var b = document.getElementById('cb-' + catKey);
    var n = document.getElementById('cn-' + catKey);
    var brand = b ? b.value : '', name = n ? n.value : '';
    var list = sectionHasCatalog(catalog, catKey)
      ? matchIn(catalog, brand, name, { exclude: addedIds(), fromKey: catKey })
      : [];
    host.innerHTML = typingSuggestHtml(list);
  }
  function typingSuggestHtml(list) {
    if (!list || !list.length) return '';
    return '<div class="custom-suggest-title">Already in the catalog?</div>' +
      list.map(function (m) {
        return '<button type="button" class="match-row" onclick="PartPicker.useMatch(\'' + m.catKey + '\',\'' + m.item.id + '\')">' +
            matchThumbHtml(m.item) + matchNameHtml(m.item) +
            '<span class="match-go">Add this instead &rarr;</span>' +
          '</button>';
      }).join('') +
      '<div class="custom-suggest-foot">Catalog parts show a photo, a price and where to buy. Not it? Keep typing and add yours below.</div>';
  }

  // ----- the swap -----
  //
  // "Use this" on a typed part must REPLACE it, in the same position, and
  // only once the catalog part has really been added — a product with colours
  // goes through the colour step first, and the builder can back out of that.
  // So the typed part is left alone here and the intent is remembered; every
  // add on both pages ends in closePickerAfterAdd(), which calls applySwap().
  var pendingSwap = null;   // { uid: <typed part>, itemId: <products.id> }

  function applySwap(state) {
    var sw = pendingSwap;
    pendingSwap = null;      // one add consumes it, whatever that add was
    if (!sw) return;
    var parts = (state && state.parts) || [];
    var added = parts[parts.length - 1];
    // The add that just finished has to be the product that was offered. If
    // they backed out of the colour step and added something else, this was
    // not a swap and the typed part stays.
    if (!added || added.refId !== sw.itemId) return;
    var at = -1;
    for (var i = 0; i < parts.length - 1; i++) if (parts[i].uid === sw.uid) at = i;
    if (at === -1) return;
    if (cfg.canSwap && !cfg.canSwap(sw.uid)) return;
    // In place: the catalog part takes the typed part's position, so the
    // order the builder listed their parts in does not change.
    parts.splice(at, 1, parts.pop());
  }

  // Add a catalog part that was offered as a match. With swapUid, it replaces
  // that typed part once the add completes.
  //
  // Opens the part's own section first: the colour step renders into that
  // section's grid, and a match can come from a different section than the
  // one being typed in.
  function useMatch(catKey, itemId, swapUid) {
    var c = need(), st = c.state();
    pendingSwap = swapUid ? { uid: swapUid, itemId: itemId } : null;
    st.openPicker = catKey;
    st.customOpen = null;
    c.render();
    global.addCatalogPart(catKey, itemId);
    // A direct add has already closed the picker and scrolled. If the colour
    // step is what opened instead, bring it into view.
    if (st.openPicker === catKey) scrollToCategory(catKey);
  }

  // ----- before they submit -----

  // Typed parts the builder said are right as typed. In memory only: it is
  // about this sitting, and a reload asking once more is not a cost.
  var dismissed = {};
  function dismissMatch(uid) {
    dismissed[uid] = true;
    var c = need();
    if (c.onChange) c.onChange();
  }

  // Every typed part that looks like a catalog part: [{ part, matches }].
  // Strong matches only — see matchIn().
  function unlinkedMatches() {
    var c = need(), catalog = c.catalog() || {};
    var parts = c.state().parts || [];
    var exclude = addedIds();
    var out = [];
    parts.forEach(function (p) {
      // A typed part: pending, no catalog id. `finish` marks a Paint Job &
      // Finish entry, which is a description, not a product.
      if (!p.pending || p.refId || p.finish) return;
      if (dismissed[p.uid]) return;
      if (!sectionHasCatalog(catalog, p.category)) return;
      // Not offered where the page will not allow the swap (a part pinned
      // under a reviewer's correction).
      if (c.canSwap && !c.canSwap(p.uid)) return;
      var m = matchIn(catalog, p.brand, p.name, { exclude: exclude, fromKey: p.category, limit: 2 })
        .filter(function (x) { return x.strong; });
      if (m.length) out.push({ part: p, matches: m });
    });
    return out;
  }

  function unlinkedNudgeHtml(found) {
    if (!found || !found.length) return '';
    var n = found.length;
    return '<div class="unlinked-nudge">' +
      '<div class="unlinked-nudge-title">' + n + ' typed part' + (n === 1 ? ' looks' : 's look') + ' like ' + (n === 1 ? 'a catalog part' : 'catalog parts') + '</div>' +
      '<div class="unlinked-nudge-sub">Switch and the build shows the part&rsquo;s photo, price and where to buy, with nothing left to review.</div>' +
      found.map(function (f) {
        var typed = ((f.part.brand ? f.part.brand + ' ' : '') + (f.part.name || '')).trim();
        return '<div class="unlinked-row">' +
            '<div class="unlinked-typed">You typed <b>' + escAttr(typed) + '</b></div>' +
            f.matches.map(function (m) {
              return '<div class="match-row static">' +
                  matchThumbHtml(m.item) + matchNameHtml(m.item) +
                  '<button type="button" class="match-use" onclick="PartPicker.useMatch(\'' + m.catKey + '\',\'' + m.item.id + '\',\'' + escAttr(f.part.uid) + '\')">Use this</button>' +
                '</div>';
            }).join('') +
            '<button type="button" class="unlinked-keep" onclick="PartPicker.dismissMatch(\'' + escAttr(f.part.uid) + '\')">Keep what I typed</button>' +
          '</div>';
      }).join('') +
    '</div>';
  }

  // Called from each page's renderSidebar(). Draws the prompt into the mount,
  // or empties it. Never throws into the page: this is an offer beside the
  // submit button, and a failure here must not stop a build being submitted.
  function renderUnlinkedNudge(mountId) {
    var host = document.getElementById(mountId || 'unlinked-nudge');
    if (!host) return;
    var html = '';
    try { html = unlinkedNudgeHtml(unlinkedMatches()); }
    catch (e) { if (global.console) global.console.warn('[part-picker] catalog-match prompt skipped', e); }
    host.innerHTML = html;
  }

  // ===== CSS =====

  var CSS = `
/* ============ PARTS SECTION ============ */
.parts-disabled-note { text-align: center; padding: 32px 20px; color: #bbb; font-size: 13px; line-height: 1.7; }

/* ============ GROUP HEADINGS ============ */
/* The parts step reads as four stages of a build — Core build, Controls,
   Magazine, Carry and finish — rather than eighteen accordions in a row. The
   group names and their order come from js/build-categories.js; the markup is
   groupHeadHtml() above.

   A REAL HEADING, NOT AN EYEBROW. #114 drew these as 11px uppercase blue,
   which is the page's own .page-eyebrow treatment — so four stage headings
   read as four captions and the accordion rows under them, at 13px bold
   black, outranked their own heading. 17px/700 near-black puts them above
   what they label and gives the step a spine to scan down.

   THE HEAD IS A GRID, NOT A FLEX ROW. Name and progress sit on one line, the
   blurb spans both columns beneath. minmax(0, 1fr) on the name column is
   load-bearing: a bare 1fr takes its min-content width from the longest word
   and refuses to shrink, which on a phone is one of the two things that used
   to push the page sideways.

   Headings only: NOT clickable and NOT collapsible. Everything else in this
   section opens on click, so no cursor:pointer and no toggle affordance.

   This lives here rather than in either page because .category-block's CSS
   does, and gunforma-post-build.html and gunforma-admin-post.html are the only
   two pages that load this module. Note gunforma-armory.html deliberately does
   NOT, so none of these selectors can reach its grid. */
.category-groups { display: flex; flex-direction: column; gap: 28px; }
.category-group { display: flex; flex-direction: column; gap: 10px; }
.category-group-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 14px; row-gap: 2px; align-items: center; }
.category-group-name { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; color: #1a1a1a; }
.category-group-blurb { grid-column: 1 / -1; font-size: 12px; color: #777; line-height: 1.5; }
/* One segment per SECTION in the group, lit when that section holds a part —
   so the bar and the tally are the same fact, and neither of them counts a
   third optic as progress. */
.category-group-progress { display: flex; align-items: center; gap: 9px; }
.category-group-segs { display: flex; gap: 3px; }
.category-group-seg { width: 18px; height: 5px; border-radius: 3px; background: #e4e3de; }
.category-group-seg.on { background: #4a9edd; }
/* tabular-nums so the tally does not jiggle as the first digit changes. */
.category-group-tally { font-size: 11px; font-weight: 600; color: #999; white-space: nowrap; font-variant-numeric: tabular-nums; }
.category-group-tally b { font-weight: 700; }
.category-group-progress.has-parts .category-group-tally b { color: #1a1a1a; }
.category-group-blocks { display: flex; flex-direction: column; gap: 8px; }

/* Category row — closed state */
.category-block { border: 0.5px solid #e8e8e8; border-radius: 8px; overflow: hidden; transition: box-shadow 0.2s; }
.category-block.open { box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-color: #4a9edd; }
.category-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; background: #fafaf8; cursor: pointer; user-select: none; transition: background 0.15s; }
.category-block.open .category-head { background: #0e0f11; }
.category-name-wrap { display: flex; align-items: center; gap: 10px; }
.category-icon { font-size: 16px; width: 28px; text-align: center; }
.category-name { font-size: 13px; font-weight: 700; color: #1a1a1a; transition: color 0.15s; }
.category-block.open .category-name { color: #e8e6e1; }
.category-added-count { font-size: 10px; background: #4a9edd; color: #fff; padding: 2px 8px; border-radius: 20px; font-weight: 700; }
.category-toggle { font-size: 11px; color: #2a7bbd; font-weight: 700; font-family: inherit; background: none; border: 0.5px solid #a7cdec; padding: 5px 12px; border-radius: 4px; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
.category-block.open .category-toggle { color: #6fb4e8; border-color: #3a3b3e; background: rgba(255,255,255,0.06); }

/* Selected parts — one card per added part.
   Deliberately not a chip: a chip says "something is in this slot", and the
   whole point of this strip is confirming the builder picked the RIGHT
   product, which needs the photo they recognised it by. Replaced
   .added-parts-strip / .added-chip*. */
.selected-parts-list { display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; border-bottom: 0.5px solid #efece3; background: #fff; }
.selected-part { display: flex; align-items: center; gap: 12px; background: #fafaf8; border: 0.5px solid #e5e2d8; border-radius: 8px; padding: 8px; }
/* 96x72 (4:3), matching the card box above and for the same reason: at 72x72
   a 978x550 photo painted 58x33, leaving most of the square empty. Measured
   at 96x72 it paints 82x46 — the 6px padding and the 0.5px border are why
   that is not the full 96 wide. */
.selected-part-thumb { flex-shrink: 0; width: 96px; height: 72px; background: #f0f2f5; border: 0.5px solid #eee; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
/* Same contain treatment as .part-card-img img — a product shot cropped to
   fill tells the builder less than the whole product on white does. */
.selected-part-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 6px; box-sizing: border-box; background: #fff; display: block; }
.selected-part-thumb-label { font-size: 9px; color: #bbb; letter-spacing: 0.06em; text-transform: uppercase; text-align: center; padding: 4px; }
.selected-part-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.selected-part-brand { font-size: 9px; color: #2a7bbd; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.selected-part-name { font-size: 13px; font-weight: 700; line-height: 1.3; color: #1a1a1a; }
.selected-part-price { font-size: 12px; font-weight: 700; color: #1a1a1a; }
/* The picked colour. Quiet, like the meta around it — it confirms the pick,
   it is not a heading. */
.selected-part-variant-label { font-size: 11px; color: #666; line-height: 1.3; }
/* The spec line under it — quieter still: it qualifies the label. */
.selected-part-variant-specs { font-size: 10.5px; color: #8a8a8a; line-height: 1.3; }
/* The swatch, when the chosen variant has no photo. variantMediaHtml names
   it <cls>-swatch; it fills the thumb box the way the picker's fills its. */
.selected-part-thumb-swatch { display: block; width: 100%; height: 100%; }
/* Variant note. Deliberately quiet until focused — it is optional, and most
   parts will not need it, so it should not shout on every row. */
.selected-part-variant { width: 100%; margin-top: 3px; font-family: inherit; font-size: 11px; color: #1a1a1a; background: #fff; border: 0.5px solid #e5e2d8; border-radius: 4px; padding: 4px 7px; box-sizing: border-box; }
.selected-part-variant::placeholder { color: #b8b5ac; }
.selected-part-variant:hover { border-color: #d5d3ca; }
.selected-part-variant:focus { outline: none; border-color: #4a9edd; }
.selected-part-pending { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 600; color: #8a6d3b; }
.selected-part-dot { width: 8px; height: 8px; border-radius: 50%; background: #f9b860; flex-shrink: 0; }
.selected-part-remove { flex-shrink: 0; align-self: center; background: none; border: 0.5px solid #e5e2d8; border-radius: 4px; cursor: pointer; color: #888; font-size: 11px; font-weight: 700; padding: 6px 12px; font-family: inherit; transition: all 0.15s; }
.selected-part-remove:hover { background: #fde8e2; color: #c25d3a; border-color: #f9c4b6; }

/* Picker panel — expanded */
.picker-panel { display: none; background: #fafaf8; border-top: 0.5px solid #e5e5e5; }
.picker-panel.open { display: block; animation: slideDown 0.18s ease; }
@keyframes slideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

.picker-toolbar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 0.5px solid #e5e5e5; background: #fff; }
.picker-search-wrap { flex: 1; }
.picker-search { width: 100%; font-size: 13px; padding: 8px 10px; border: 0.5px solid #e5e5e5; border-radius: 6px; font-family: inherit; background: #fafaf8; }
.picker-search:focus { outline: none; border-color: #4a9edd; background: #fff; }
.picker-count { font-size: 11px; color: #999; white-space: nowrap; }

/* Part cards grid */
.part-cards-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 14px 16px; }
.part-card { background: #fff; border: 0.5px solid #e5e5e5; border-radius: 8px; overflow: hidden; transition: border-color 0.15s, box-shadow 0.15s; display: flex; flex-direction: column; }
.part-card:hover { border-color: #4a9edd; box-shadow: 0 2px 12px rgba(74,158,221,0.1); }
.part-card.added { border-color: #22a06b; background: #f6fdf9; }

/* 4:3, not 1:1. The fit is contain, so the BOX ratio only has to be close to
   the photo's — whatever gap is left is dead space the card still pays full
   height for. Catalog photos are ~978x550 (16:9-ish), and a square box was
   mostly that gap. Measured at a 1282px layout viewport, same photo both
   ways: before, a 398x398 box painting 382x215 inside a 514px-tall card;
   after, a 398x299 box painting the same 382x215 inside 415px. The photo is
   identical and 99px of emptiness is gone. Nothing is cropped either way —
   contain never crops. If catalog photos ever standardise on a different
   ratio, this is the number to move, not object-fit. */
.part-card-img { aspect-ratio: 4 / 3; height: auto; background: #f0f2f5; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; flex-shrink: 0; }
/* contain + padding + white, so the whole product is visible and nothing is
   cropped. partImageHtml() must NOT re-declare object-fit inline: an inline
   style beats this rule and the crop comes straight back. */
.part-card-img img { width: 100%; height: 100%; object-fit: contain; padding: 8px; box-sizing: border-box; background: #fff; display: block; }
.part-card-img-bg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px; }
.part-card-img-label { font-size: 9px; color: #bbb; letter-spacing: 0.06em; text-transform: uppercase; }
.part-card.added .part-card-img { background: #e8f5ee; }
.part-card-added-badge { position: absolute; top: 8px; right: 8px; background: #22a06b; color: #fff; font-size: 9px; font-weight: 700; padding: 3px 8px; border-radius: 20px; letter-spacing: 0.04em; text-transform: uppercase; }

.part-card-body { padding: 10px 12px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.part-card-brand { font-size: 9px; color: #2a7bbd; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.part-card-name { font-size: 13px; font-weight: 700; line-height: 1.3; color: #1a1a1a; }
.part-card-desc { font-size: 11px; color: #777; line-height: 1.5; flex: 1; }

.part-card-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-top: 0.5px solid #f0f0f0; background: #fafaf8; }
.part-card-price { font-size: 13px; font-weight: 700; color: #1a1a1a; }
/* nowrap: at 390px the two columns are ~116px, and without it "+ Add"
   breaks across two lines inside the button. */
.part-card-add { font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-family: inherit; border: none; transition: all 0.15s; letter-spacing: 0.04em; white-space: nowrap; }
.part-card-add.add    { background: #4a9edd; color: #fff; }
.part-card-add.add:hover { background: #2a7bbd; }
.part-card-add.remove { background: #f4f3ee; color: #888; border: 0.5px solid #e5e2d8; }
.part-card-add.remove:hover { background: #fde8e2; color: #c25d3a; border-color: #f9c4b6; }

/* Empty + custom form */
.picker-empty-state { text-align: center; padding: 28px 20px; color: #bbb; font-size: 12px; }
.custom-part-section { border-top: 0.5px solid #e5e5e5; padding: 14px 16px; background: #fff; }
.custom-part-toggle { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #2a7bbd; font-weight: 700; cursor: pointer; background: none; border: none; font-family: inherit; padding: 0; }
.custom-part-toggle:hover { text-decoration: underline; }
.custom-part-toggle-icon { font-size: 14px; transition: transform 0.15s; }
.custom-part-toggle-icon.open { transform: rotate(45deg); }
.custom-part-form { display: none; margin-top: 12px; background: #fafaf8; border: 0.5px solid #e5e5e5; border-radius: 6px; padding: 14px; }
.custom-part-form.open { display: block; animation: slideDown 0.15s ease; }
.custom-part-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.custom-part-grid input, .custom-link-input { font-size: 12px; padding: 8px 10px; border: 0.5px solid #e5e5e5; border-radius: 4px; font-family: inherit; width: 100%; background: #fff; }
.custom-link-input { margin-bottom: 8px; display: block; }
.custom-part-note { font-size: 10px; color: #999; line-height: 1.6; margin-bottom: 10px; }
.custom-part-submit { font-size: 11px; color: #fff; background: #1a1a1a; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 700; text-transform: uppercase; font-family: inherit; letter-spacing: 0.04em; }
.custom-part-submit:hover { background: #4a9edd; }

/* One full-width card on phones, two everywhere else.
   #81 removed the collapse entirely on the strength of a comment claiming two
   columns gave ~165px cards. Measured, they do not: at a 390px viewport the
   columns are 130.7px and a 978x550 photo paints 113x64 — a product shot
   about the width of a thumbnail, which is not something you can check a
   purchase against. The breakpoint is 560px rather than 900px so tablets and
   split-screen windows keep the two-up comparison; below it one card is worth
   more than two unreadable ones. Measured after the change at the same 390px:
   one 295.5px column, photo 277x156. */
@media (max-width: 560px) {
  .part-cards-grid { grid-template-columns: 1fr; }

  .category-groups { gap: 24px; }
  .category-group-name { font-size: 16px; }
  /* 18px x 6 segments plus the tally does not fit beside "Carry and finish"
     at 320px. 11px does, and the bar is read as a proportion rather than by
     counting pixels. */
  .category-group-seg { width: 11px; }

  /* AN ADDED PART, RESTACKED — and this is the row that used to push the
     whole page sideways.

     Measured at 375px: .layout keeps its 36px side padding and .card its
     20px, and .layout's column was a bare 1fr, which sizes to MIN-CONTENT
     and then refuses to shrink below it. The row's min-content width is the
     96px photo + the longest unbreakable word in a product name + the Remove
     button, and that total is wider than what is left of the screen — so the
     grid column grew, the card grew, and the document scrolled sideways.
     Every other symptom on the page was that one overflow. The fix is both
     halves: minmax(0, 1fr) on the page's own .layout so the column MAY
     shrink, and this, so the row WANTS less.

     Three columns and six rows: the photo spans the text rows on the left,
     brand/name/variant label/specs/price/pending stack beside it, and the
     variant field and Remove sit on a full-width last row where the field
     can actually be typed in. display: contents on the body is what lets its children become
     grid items of the row itself rather than a nested flex column — THE
     MARKUP IS UNCHANGED, which is the point: one set of elements, two shapes.

     16px on the two text inputs is not a type choice. iOS Safari zooms the
     page when a field under 16px takes focus and does not zoom back out, so
     an 11px input turns one tap into a pinch-and-pan. The placeholder stays
     13px because it is not what is being typed into. */
  .selected-parts-list { padding: 10px 12px; }
  /* Six rows: brand / name / variant label / spec line / price stack
     beside the photo, and the action row is always LAST. Every stacked line
     added has needed a row added here — with too few, auto-placement puts
     the price into the row Remove is pinned to and drops it BELOW Remove,
     which is what the variant label did in #122 and the spec line would
     have done here. */
  .selected-part { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; grid-template-rows: auto auto auto auto 1fr auto; column-gap: 10px; row-gap: 2px; align-items: start; padding: 10px; }
  .selected-part-thumb { grid-column: 1; grid-row: 1 / span 5; width: 72px; height: 54px; }
  .selected-part-body { display: contents; }
  .selected-part-brand, .selected-part-name, .selected-part-variant-label, .selected-part-variant-specs, .selected-part-price, .selected-part-pending { grid-column: 2 / -1; }
  .selected-part-variant { grid-column: 1 / 3; grid-row: 6; margin-top: 8px; min-width: 0; padding: 7px 9px; }
  .selected-part-remove { grid-column: 3; grid-row: 6; margin-top: 8px; align-self: stretch; }
  .selected-part-variant, .picker-search { font-size: 16px; }
  .selected-part-variant::placeholder, .picker-search::placeholder { font-size: 13px; }

  /* The custom-part form's Brand / Part name / link inputs, for the same
     reason and at the same width. They are rendered by both builder pages but
     styled here, so this is where they get it — the pages' own 560px block
     covers the three their own CSS owns. Miss either half and a phone
     zooms on some fields and not others, which reads as the page glitching
     rather than as a setting. */
  .custom-part-grid input, .custom-link-input { font-size: 16px; }
  .custom-part-grid input::placeholder, .custom-link-input::placeholder { font-size: 13px; }
}

/* ============ COLOR STEP ============ */
/* Replaces the card grid inside #cards-<k>. Full-width rows, not a grid: each
   color gets a swatch, a label and a price without competing for width, and
   the same shape is reused by the build page's "See other options" panel. */
.variant-step { padding: 4px 0 2px; }
.variant-step-head { display: flex; align-items: center; gap: 12px; padding: 4px 4px 12px; border-bottom: 0.5px solid #e8e8e8; margin-bottom: 8px; }
.variant-step-back { background: none; border: 0; padding: 4px 6px; margin-left: -6px; font: inherit; font-size: 11px; font-weight: 600; color: #4a9edd; cursor: pointer; border-radius: 4px; }
.variant-step-back:hover { background: #f2f8fd; }
.variant-step-back:focus-visible { outline: 2px solid #4a9edd; outline-offset: 1px; }
.variant-step-title { flex: 1; min-width: 0; }
.variant-step-brand { display: block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #a8a5a0; }
.variant-step-name { display: block; font-size: 12.5px; font-weight: 600; color: #1a1a1a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.variant-step-count { font-size: 10px; color: #a8a5a0; white-space: nowrap; }

.variant-list { display: flex; flex-direction: column; gap: 6px; }

/* A row is a button: the whole thing is the target, so there is no small
   "add" link to miss on a phone. */
.variant-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 10px; background: #fff; border: 0.5px solid #e8e8e8; border-radius: 6px; cursor: pointer; text-align: left; font: inherit; transition: border-color 0.12s, background 0.12s; }
.variant-row:hover { border-color: #4a9edd; background: #fbfdff; }
.variant-row:focus-visible { outline: 2px solid #4a9edd; outline-offset: 1px; }

/* The media slot. object-fit: contain, never cover — a catalog shot on white
   identifies the part, and cropping hides the thing being chosen by. Build
   photos are the opposite case and stay cover; see CLAUDE.md. */
.variant-media { flex-shrink: 0; width: 46px; height: 46px; border-radius: 4px; background: #f7f7f5; border: 0.5px solid #eee; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.variant-media img { width: 100%; height: 100%; object-fit: contain; padding: 3px; box-sizing: border-box; background: #fff; display: block; }
/* The swatch fills its slot. A swatch plus the label is a complete answer;
   an empty box is a bug. */
.variant-media-swatch { display: block; width: 100%; height: 100%; }

.variant-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.variant-row-label { font-size: 12.5px; font-weight: 600; color: #1a1a1a; }
.variant-row-specs { font-size: 11px; color: #777; line-height: 1.3; }
.variant-row-std { font-size: 9px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #6b6b6b; }
.variant-row-price { font-size: 12px; font-weight: 700; color: #1a1a1a; white-space: nowrap; }
.variant-row-msrp { font-size: 8.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #6b6b6b; background: #f2f1ee; border: 0.5px solid #d8d5cd; border-radius: 3px; padding: 1px 3px; margin-left: 4px; vertical-align: 1px; }
.variant-row-go { font-size: 11px; font-weight: 700; color: #4a9edd; white-space: nowrap; }

@media (max-width: 560px) {
  .variant-step-count { display: none; }
  .variant-row { padding: 7px 8px; gap: 9px; }
  .variant-media { width: 40px; height: 40px; }
  .variant-row-go { display: none; }   /* the whole row is the target anyway */
}
/* ============ CATALOG MATCH ============ */
/* One row shape for both places a catalog part is offered: under the custom
   form while typing (a button, the whole row is the target) and in the
   sidebar prompt (.static, with its own "Use this" button). */
.custom-suggest:empty { display: none; }
.custom-suggest { margin: 10px 0 4px; padding: 10px; background: #f3f8fd; border: 0.5px solid #cfe2f3; border-radius: 6px; }
.custom-suggest-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #1c4f7c; margin-bottom: 7px; }
.custom-suggest-foot { font-size: 10.5px; color: #6b8299; line-height: 1.5; margin-top: 7px; }
.match-row { display: flex; align-items: center; gap: 9px; width: 100%; min-width: 0; padding: 6px 8px; margin-top: 5px; background: #fff; border: 0.5px solid #dbe6f0; border-radius: 5px; font-family: inherit; font-size: 12px; color: #1a1a1a; text-align: left; }
button.match-row { cursor: pointer; transition: border-color 0.15s, background 0.15s; }
button.match-row:hover, button.match-row:focus-visible { border-color: #4a9edd; background: #f7fbff; outline: none; }
.match-thumb { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 4px; background: #f1f0ea; overflow: hidden; }
.match-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
/* min-width: 0 or a long catalog name refuses to shrink and pushes the
   button out of the row — the sidebar is 300px wide. */
.match-name { flex: 1 1 auto; min-width: 0; line-height: 1.35; overflow-wrap: anywhere; }
.match-go { flex: 0 0 auto; font-size: 11px; font-weight: 700; color: #2a7bbd; white-space: nowrap; }
.match-use { flex: 0 0 auto; font-family: inherit; font-size: 11px; font-weight: 700; color: #fff; background: #2a7bbd; border: none; border-radius: 4px; padding: 6px 9px; cursor: pointer; white-space: nowrap; }
.match-use:hover { background: #1c5f96; }

.unlinked-nudge { margin-bottom: 12px; padding: 12px; background: #f3f8fd; border: 0.5px solid #cfe2f3; border-radius: 6px; }
.unlinked-nudge-title { font-size: 12px; font-weight: 700; color: #1c4f7c; margin-bottom: 4px; }
.unlinked-nudge-sub { font-size: 11px; color: #4a6781; line-height: 1.55; }
.unlinked-row { margin-top: 11px; padding-top: 10px; border-top: 0.5px solid #d9e6f2; }
.unlinked-typed { font-size: 11px; color: #555; overflow-wrap: anywhere; }
.unlinked-typed b { color: #1a1a1a; }
.unlinked-keep { margin-top: 7px; padding: 0; background: none; border: none; font-family: inherit; font-size: 11px; color: #6b8299; text-decoration: underline; cursor: pointer; }
.unlinked-keep:hover { color: #1c4f7c; }
@media (max-width: 560px) {
  .match-go { display: none; }   /* the whole row is the target anyway */
}
`;

  var cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var el = document.createElement('style');
    el.setAttribute('data-part-picker', '');
    el.textContent = CSS;
    // Appended to <head> at init time, i.e. after the page's own inline
    // <style>. Equal-specificity rules therefore resolve to this module's,
    // which is what we want: the module is the single source for these
    // selectors and a page must not keep a copy to "override" it.
    document.head.appendChild(el);
  }

  // ===== PUBLIC SURFACE =====

  function init(options) {
    options = options || {};
    ['catalog', 'state', 'render'].forEach(function (k) {
      if (typeof options[k] !== 'function') {
        throw new Error('PartPicker.init: ' + k + ' must be a function, got ' + typeof options[k]);
      }
    });
    if (options.onChange != null && typeof options.onChange !== 'function') {
      throw new Error('PartPicker.init: onChange must be a function when given');
    }
    // Optional: (uid) => may this typed part be replaced by a catalog match?
    // gunforma-post-build.html says no for a part pinned under a reviewer's
    // correction. Absent means every typed part may.
    if (options.canSwap != null && typeof options.canSwap !== 'function') {
      throw new Error('PartPicker.init: canSwap must be a function when given');
    }
    // Fail at mount rather than at first click. These are the two globals the
    // emitted onclick attributes name; a page that renamed one would ship
    // cards that look right and do nothing.
    ['addCatalogPart', 'removePart', 'pickVariant', 'cancelVariantPick'].forEach(function (fn) {
      if (typeof global[fn] !== 'function') {
        throw new Error('PartPicker.init: the page must define a global ' + fn + '()');
      }
    });
    cfg = options;
    injectCss();
  }

  global.PartPicker = {
    init: init,
    findCatalogItem: findCatalogItem,
    partImageHtml: partImageHtml,
    partCardHtml: partCardHtml,
    selectedPartThumbHtml: selectedPartThumbHtml,
    selectedPartHtml: selectedPartHtml,
    selectedPartsHtml: selectedPartsHtml,
    groupHeadHtml: groupHeadHtml,
    scrollToCategory: scrollToCategory,
    closePickerAfterAdd: closePickerAfterAdd,
    noteVariant: noteVariant,
    hasColorChoice: hasColorChoice,
    variantsOf: variantsOf,
    variantListHtml: variantListHtml,
    openColorStep: openColorStep,
    // Catalog match.
    matchIn: matchIn,
    suggestWhileTyping: suggestWhileTyping,
    typingSuggestHtml: typingSuggestHtml,
    useMatch: useMatch,
    dismissMatch: dismissMatch,
    unlinkedMatches: unlinkedMatches,
    unlinkedNudgeHtml: unlinkedNudgeHtml,
    renderUnlinkedNudge: renderUnlinkedNudge,
  };
})(window);
