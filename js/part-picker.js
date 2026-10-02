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

  // Thumbnail for a part the user has already added. A pending custom part has
  // no catalog row to photograph, so it says so rather than showing an empty
  // grey square that reads like a broken image.
  function selectedPartThumbHtml(part, item) {
    if (!item || !item.image) {
      return '<div class="selected-part-thumb"><div class="selected-part-thumb-label">' +
               (part.pending ? 'Pending' : 'No photo') + '</div></div>';
    }
    var alt = ((part.brand ? part.brand + ' ' : '') + (part.name || '')).replace(/"/g, '&quot;');
    return '<div class="selected-part-thumb">' +
             '<img src="' + item.image + '" alt="' + alt + '" loading="lazy" ' +
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
        (part.pending
          ? '<div class="selected-part-pending"><span class="selected-part-dot"></span>Pending review</div>'
          : (item && item.price ? '<div class="selected-part-price">$' + item.price + '</div>' : '')) +
        // Free text on purpose: the catalog has no variant coverage yet, so a
        // builder who owns this product in a colour we do not carry has
        // nowhere else to say so. Named `variant` rather than `variantId`
        // precisely so it will not collide when real product_variants
        // coverage lands.
        // Not offered on custom/pending parts — the builder typed the full
        // name there already.
        (part.pending ? '' :
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
      return al < bl ? -1 : al > bl ? 1 : (a.id < b.id ? -1 : 1);
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
    return '<button type="button" class="variant-row" ' +
             'onclick="pickVariant(\'' + catKey + '\',\'' + escAttr(item.id) + '\',\'' + escAttr(v.id) + '\')">' +
        global.variantMediaHtml(v, 'variant-media') +
        '<span class="variant-row-body">' +
          '<span class="variant-row-label">' + (label || 'This color') + '</span>' +
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

  // ===== CSS =====

  var CSS = `
/* ============ PARTS SECTION ============ */
.parts-disabled-note { text-align: center; padding: 32px 20px; color: #bbb; font-size: 13px; line-height: 1.7; }

/* ============ GROUP HEADINGS ============ */
/* The parts step reads as four stages of a build — Core build, Controls,
   Magazine, Carry and finish — rather than eighteen accordions in a row. The
   group names and their order come from js/build-categories.js.

   Headings only: NOT clickable and NOT collapsible. Everything else in this
   section opens on click, so a heading that looked the same and did nothing
   would read as broken — hence no cursor:pointer, no toggle affordance, and a
   different type treatment from .category-head below.

   This lives here rather than in either page because .category-block's CSS
   does, and gunforma-post-build.html and gunforma-admin-post.html are the only
   two pages that load this module. Note gunforma-armory.html deliberately does
   NOT, so none of these selectors can reach its grid. */
.category-groups { display: flex; flex-direction: column; gap: 20px; }
.category-group { display: flex; flex-direction: column; gap: 7px; }
.category-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 7px; border-bottom: 0.5px solid #e8e8e8; }
.category-group-name { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #2a7bbd; }
.category-group-count { font-size: 10px; font-weight: 700; color: #a8a8a8; letter-spacing: 0.04em; white-space: nowrap; }
.category-group-count.has-parts { color: #fff; background: #4a9edd; padding: 2px 8px; border-radius: 20px; letter-spacing: 0; }
.category-group-blurb { font-size: 11.5px; color: #777; line-height: 1.55; }
.category-group-blocks { display: flex; flex-direction: column; gap: 8px; margin-top: 3px; }

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

  /* "Carry and finish" plus a count is the widest heading row; at 390px it
     still fits on one line at this tracking. Measured at 375px and 320px. */
  .category-group-name { font-size: 10.5px; letter-spacing: 0.09em; }
  .category-groups { gap: 18px; }
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
    scrollToCategory: scrollToCategory,
    closePickerAfterAdd: closePickerAfterAdd,
    noteVariant: noteVariant,
    hasColorChoice: hasColorChoice,
    variantsOf: variantsOf,
    variantListHtml: variantListHtml,
    openColorStep: openColorStep,
  };
})(window);
