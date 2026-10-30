// slide-fit — where does a P365 slide end against a grip module? The ONE
// rule, signed off by Alex 2026-10-29, for every page that judges
// slide-on-grip fit on the P365 platform.
// ─────────────────────────────────────────────────────────────────────────
// The old rule (js/frame-fit.js) used the model as a filter: pick a FUSE and
// every XMacro grip disappeared. Wrong — every P365 slide mechanically goes
// on every P365 grip (FCU permitting); what changes is where the front of
// the slide lands. So fit is a TIER COMPARISON, never a hide:
//
//   tier      label     grips                      slides that end here
//   short     Short     P365, X, XL grips          3.1" slides
//   xmacro    XMacro    XMacro, AXG, OEM FUSE      3.7" XL/XMacro slides;
//                                                  XL-length comp slides
//   fuse      FUSE      aftermarket full-FUSE-     4.3" FUSE slides;
//                       length grips only          FUSE-length comp slides
//
// Tiers are NAMES, never inches: a comp slide's barrel length is not where
// the slide ends (an XMacro Comp slide carries a 3.1" barrel), which is the
// whole reason slide_specs.fit_tier exists apart from barrel_length_in.
//
// d = tierIndex(slide) - tierIndex(grip):
//   d == 0   the slide ends where the grip ends          -> flush
//   d  > 0   the slide runs past the grip (underbite —   -> extended
//            the factory P365 XL and factory FUSE both ship this way)
//   d == -1  the grip runs one tier past the slide: an add-on comp can
//            fill the gap, so a plain slide reads needs_comp; a comp slide
//            has its comp inside and cannot take another -> wont_fit
//   d <= -2  nothing bridges two tiers                   -> wont_fit
//
// With an add-on comp picked (only a comp_style 'none' slide can take one):
//   d >= 0   the comp hangs past the grip               -> comp_extends
//   d == -1  the comp fills the gap; the comp's own fit_result says how
//            (comp_flush / comp_partial / comp_extends), and a comp with no
//            fit_result — makers don't publish it — hedges honestly
//                                                       -> comp_flush_or_partial
//   d <= -2  still two tiers short                      -> wont_fit
//
// Any side unclassified (fit_tier null) is 'unconfirmed' — never a guess —
// and a plain-vs-comp question (d == -1) on a slide whose comp_style is not
// stated is unconfirmed too, since needs_comp vs wont_fit turns on it.
//
// P365 ONLY. P320 grips keep js/frame-fit.js's housing-class behaviour; the
// pages gate on the platform and on the columns existing (null tiers fall
// out as 'unconfirmed' here either way).
//
// ONE file, and no server copy: the Armory and the catalog load it as a
// browser global, and product-page.mjs's "Fits on" grids read and evaluate
// this very file (netlify/functions/_slide-fit.mjs, shipped through
// included_files) — Alex's ruling, "no second copy of the rule". So it must
// stay a plain script that only touches the `global` it is handed.
// scripts/slide-fit.test.mjs pins all 30 cells of the signed-off matrix plus
// every label, colour and reason; scripts/fits-on.test.mjs pins the grids.
//
// Global: window.SlideFit = { tag, sortRank, TAGS, TIER_INDEX, TIER_LABEL }.
(function (global) {
  var TIER_INDEX = { short: 0, xmacro: 1, fuse: 2 };
  var TIER_LABEL = { short: 'Short', xmacro: 'XMacro', fuse: 'FUSE' };

  // The signed-off tag table, verbatim. `selectable: false` means the option
  // is shown DISABLED with its reason — never hidden; `needs_comp` is
  // selectable but the pages hold Save until a comp resolves it.
  var TAGS = {
    flush:                 { label: 'Flush',                        color: 'green',   selectable: true },
    extended:              { label: 'Extended slide',               color: 'neutral', selectable: true },
    comp_flush:            { label: 'Comp flush',                   color: 'green',   selectable: true },
    comp_partial:          { label: 'Comp partially flush',         color: 'neutral', selectable: true },
    comp_flush_or_partial: { label: 'Comp flush / partially flush', color: 'neutral', selectable: true },
    comp_extends:          { label: 'Comp extends',                 color: 'neutral', selectable: true },
    needs_comp:            { label: 'Needs comp',                   color: 'amber',   selectable: true },
    wont_fit:              { label: 'Won’t fit',               color: 'red',     selectable: false },
    unconfirmed:           { label: 'Fit not confirmed',            color: 'muted',   selectable: true },
  };

  // Picker order: Flush, Comp flush, Extended, Comp partially flush / Comp
  // extends, Needs comp, Fit not confirmed, Won't fit last.
  var SORT = {
    flush: 0, comp_flush: 1, extended: 2,
    comp_flush_or_partial: 3, comp_partial: 3, comp_extends: 3,
    needs_comp: 4, unconfirmed: 5, wont_fit: 6,
  };
  function sortRank(key) { return SORT.hasOwnProperty(key) ? SORT[key] : SORT.unconfirmed; }

  function make(key, reason) {
    var t = TAGS[key];
    return { key: key, label: t.label, color: t.color, selectable: t.selectable, reason: reason || '' };
  }

  function tierOf(x) {
    return x && TIER_INDEX.hasOwnProperty(x.fit_tier) ? TIER_INDEX[x.fit_tier] : null;
  }

  function cantCover(slide, grip) {
    return 'A ' + TIER_LABEL[slide.fit_tier] + ' slide can’t cover a ' +
           TIER_LABEL[grip.fit_tier] + ' grip, even with a comp.';
  }

  // The verdict for one slide (or a model's stock slide) against one grip
  // module, with an add-on compensator or not.
  //   slide     { fit_tier, comp_style } — comp_style 'none' | 'short_barrel'
  //             | 'ported_barrel' | null (not stated)
  //   grip      { fit_tier }
  //   addOnComp the picked comp's compensator_specs row ({ fit_result }) or
  //             null. Ignored unless the slide's comp_style is 'none' — the
  //             pages never offer a comp on a comp slide, and a stale pick
  //             must not move the verdict.
  // Returns { key, label, color, selectable, reason }.
  function tag(slide, grip, addOnComp) {
    var st = tierOf(slide), gt = tierOf(grip);
    if (st === null || gt === null) return make('unconfirmed');
    var d = st - gt;
    var style = slide.comp_style || null;

    if (addOnComp && style === 'none') {
      if (d >= 0) return make('comp_extends');
      if (d === -1) {
        var r = addOnComp.fit_result;
        if (r === 'flush') return make('comp_flush');
        if (r === 'partial') return make('comp_partial');
        if (r === 'extends') return make('comp_extends');
        return make('comp_flush_or_partial');
      }
      return make('wont_fit', cantCover(slide, grip));
    }

    if (d === 0) return make('flush');
    if (d > 0) return make('extended');
    if (d === -1) {
      if (style === 'none') {
        return make('needs_comp', 'Add a threaded barrel and comp to finish this build.');
      }
      if (style === 'short_barrel' || style === 'ported_barrel') {
        return make('wont_fit', 'This comp slide can’t take an add-on comp, so it can’t cover a ' +
                                TIER_LABEL[grip.fit_tier] + ' grip.');
      }
      return make('unconfirmed');   // tier known, comp style not stated
    }
    return make('wont_fit', cantCover(slide, grip));
  }

  global.SlideFit = {
    tag: tag,
    sortRank: sortRank,
    TAGS: TAGS,
    TIER_INDEX: TIER_INDEX,
    TIER_LABEL: TIER_LABEL,
  };
})(window);
