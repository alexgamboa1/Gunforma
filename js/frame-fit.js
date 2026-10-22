// frame-fit — does a grip module fit the gun a shopper picked? The ONE rule,
// for the catalog's grip filter and its "does this fit MY gun" badge.
// ─────────────────────────────────────────────────────────────────────────
// A grip module is a housing class (frame_specs.housing_class) and a gun is
// one too (guns.housing_class). The base rule is equality: same class, fits.
//
// THE FUSE EXCEPTION. Sig ships the XMACRO-size module on the P365 FUSE: its
// own listing for SKU 8901773 says "Factory grip module of the P365-FUSE"
// and lists XL/XMACRO-length slides as compatible. So the FUSE (class
// `fuse`) takes TWO classes of module — `fuse`, the aftermarket modules
// whose longer dust cover runs flush with the 4.3" slide, and `xmacro`, the
// factory-size module the slide overhangs — and equality alone told every
// FUSE and FUSE Comp owner that the FUSE's own factory grip "may not fit"
// and hid it from the filter (2026-10-21 audit, item 1).
//
// The exception is NARROW, and it is the maker's claim, not ours: a
// `fuse`-class gun accepts an `xmacro`-class module only when the maker
// states FUSE fit, and MAKER_STATES_FUSE_FIT below is that list, slug by
// slug, each with the page that says it. Everything else in the xmacro
// class is SILENT on the FUSE (sixteen of twenty on 2026-10-22: Icarus lists
// "P365 XL (3.7") or MACRO (3.1")" and reserves 4.3" for its FUSE models,
// Wilson says "fits P365-XMACRO, XL Models", Shalotek names only the FCU and
// the magazine), and silence is not a fit and not a refusal: those modules
// stay OUT of the filter (it shows confirmed fits only) and the badge says
// so in words — `unjudged`, "FUSE fit not stated by the maker" — never a
// confident ✓ the maker did not state, and never the ✗ that equality
// produced. No maker says no. The other direction is unchanged: an
// `xmacro`-class gun on a `fuse`-class module stays ✗ — ECM's and
// Mischief's Fuse sizes want a FUSE slide, or an XL slide with a comp,
// which is a compensator question this rule cannot answer.
//
// THE LIST IN CODE IS TEMPORARY. It is a maker's fitment claim with a
// source, which is exactly what magazine_housing_fit holds for magazines;
// a frame_housing_fit table (frame, housing class, fit, source) replaces
// it in a follow-up, so add-a-part can record the claim and nothing here
// has to be edited when a maker publishes one. Until then: a slug goes in
// here only with the maker's own sentence behind the URL.
//
// Browser-only (the catalog is the only reader) — ONE file, no server
// copy, no parity test. scripts/frame-fit.test.mjs pins every verdict.
//
// Global: window.FrameFit = { verdict, unjudgedText, MAKER_STATES_FUSE_FIT }.
(function (global) {
  // products.slug → the maker's page stating P365 FUSE fit (read 2026-10-22).
  var MAKER_STATES_FUSE_FIT = {
    // "Factory grip module of the P365-FUSE"; model list P365-XMACRO,
    // P365-XMACRO COMP, P365-FUSE.
    'sig-sauer-p365-fuse-xmacro-gm-oem': 'https://www.sigsauer.com/p365-xmacro-9mm-380-laser-engraved-grip-module-black.html',
    // Model list "P365-XMACRO, P365-XMACRO COMP, P365-FUSE"; "a compatible
    // slide assembly (P365-XL or XMACRO length)".
    'sig-sauer-p365-xmacro-gm-oem': 'https://www.sigsauer.com/p365-xmacro-grip-standard-module-black.html',
    // "This grip size comes stock on P365 XMACRO models as well as the new
    // P365 FUSE models."
    'armory-craft-grip-module-p365xmacro': 'https://www.armorycraft.com/product-page/sig-sauer-armory-craft-p365-macro-grip-module',
    // "Macro frames are the same size as the OEM X-Macro and the Fuse"; the
    // size option is named "X Macro, Tac Ops, Fuse".
    'mischief-machine-com-g2-xmacro': 'https://mischiefmachine.com/gen-2-p365-commander-series-metal-grip-modules/',
  };

  // The verdict for one grip module against one gun:
  //   'fits'      — same class, or the FUSE exception with the maker's word
  //   'no'        — a different class the gun does not take, or no spec at
  //                 all (frames fail closed: a missing spec is unknown-not-safe)
  //   'unjudged'  — nothing was compared: no gun chosen, a class no gun in
  //                 `guns` carries (fuse-xl, xmacro-sub), or the FUSE
  //                 exception without the maker's word
  // `guns` is the catalog's GUNS list, optional; it only feeds the
  // no-gun-has-this-class case.
  function verdict(frame, gun, guns) {
    if (!gun || !gun.housing_class) return 'unjudged';
    var fs = frame && frame.frame_specs;
    if (!fs || !fs.housing_class) return 'no';
    if (fs.housing_class === gun.housing_class) return 'fits';
    if (Array.isArray(guns) && guns.length &&
        !guns.some(function (g) { return g && g.housing_class === fs.housing_class; })) return 'unjudged';
    if (gun.housing_class === 'fuse' && fs.housing_class === 'xmacro') {
      return Object.prototype.hasOwnProperty.call(MAKER_STATES_FUSE_FIT, frame.slug) ? 'fits' : 'unjudged';
    }
    return 'no';
  }

  // The words for an 'unjudged' verdict, or '' when there is nothing to say
  // (no gun chosen; a class no gun carries — the badge stays empty there,
  // as it always has).
  function unjudgedText(frame, gun) {
    if (!gun || !gun.housing_class) return '';
    var fs = frame && frame.frame_specs;
    if (!fs || !fs.housing_class) return '';
    if (gun.housing_class === 'fuse' && fs.housing_class === 'xmacro' &&
        !Object.prototype.hasOwnProperty.call(MAKER_STATES_FUSE_FIT, frame.slug)) {
      return 'FUSE fit not stated by the maker';
    }
    return '';
  }

  global.FrameFit = { verdict: verdict, unjudgedText: unjudgedText, MAKER_STATES_FUSE_FIT: MAKER_STATES_FUSE_FIT };
})(window);
