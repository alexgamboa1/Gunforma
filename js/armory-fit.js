// armory-fit — ONE fit verdict per (category, part, build) for the Armory's
// build list and part pages, and for the product page's "Fits your build"
// line (PR 2 of the 2026-11-10 Armory design). Shared so the two surfaces
// can never disagree about the same pairing.
// ─────────────────────────────────────────────────────────────────────────
// This module judges; it never hides. Every verdict is
//   { key, label, color, selectable, reason, ok }
// with key one of:
//   flush        a confirmed fit (green)
//   extended     fits, sits longer than the grip (neutral; magazines use it
//                for "Extends below grip" / "Fits with included baseplate")
//   needs_comp   selectable, but Save is held until a comp resolves it
//   wont_fit     shown disabled with the reason — never hidden silently
//   unconfirmed  the data cannot back a verdict; never a guess
//   na           no fit data exists for the category: no tag at all
// Slide-on-grip verdicts COME FROM window.SlideFit (the 2026-10-29 tier
// rule) and keep its richer keys (comp_flush, extended, …) — this module
// adds no second copy of that rule, it only routes to it. Everything else
// here is the PARTS_BUILDER_COMPATIBILITY_LOGIC rules plus the 2026-11-10
// Armory design's new checks (magazines, magwells on stock grips, recoil
// springs, optics on stock slides), each over anon-readable tables.
//
// "Never show a Fits tag the data can't back": a missing spec row, a maker
// who is silent, an aftermarket slide with no optic cut — each is
// 'unconfirmed' (or na), with the reason in words.
//
// Pure functions over a BUILD CONTEXT object; no globals, no fetches, so
// node:vm can pin every verdict (scripts/armory-fit.test.mjs) and the
// product page can feed it rows it fetched itself. The context:
//
//   ctx = {
//     tierMode:  true on the P365 once the fit-tier columns exist (the
//                caller's tierMode() — P320 and a pre-migration database
//                stay on the old behaviour and most verdicts read na),
//     gun:       the guns row or null — slug, housing_class, barrel_length_in,
//                slide_length_in, integrated_comp, grip_fit_tier,
//                slide_fit_tier, slide_comp_style (numbers as PostgREST
//                returns them: strings; compare with Number()),
//     fcu:       true for "Just the FCU" — nothing is stock,
//     slide:     slideRef (below) for the EFFECTIVE slide: the picked one,
//                else the stock slide, else null,
//     grip:      { fitRow: {fit_tier}, product } for the picked grip, or null,
//     gripHC:    gripHousingClass() below — the magazine question's subject,
//     stockGripProduct: the gun's factory grip as a catalog product
//                (gun_stock_parts), or null — the magwell question's subject
//                when no grip is picked,
//     barrel:    { spec } for the picked barrel, or null,
//     comp:      { spec, fitRow } for the picked add-on comp, or null,
//     optics:    { cutFootprints: { [optic_cut]: { [footprint_id]: 'direct'|'via-plate' } },
//                  footprintName: fn(footprint_id) -> common name or null }
//   }
//
// slideRef — one shape for a picked slide and a stock one, built by the
// callers through slideRef()/stockSlideRef() here:
//   { stock, tier, compStyle, includesBarrel, barrelLen, slideLen, ported,
//     integrated, threadedOk, portStyle, productId, brand, cuts }
//   cuts: the gun's gun_optic_cuts rows on a STOCK slide; null on a picked
//   slide (aftermarket slides have no cut in the data yet — the stated gap).
(function (global) {
  'use strict';

  var COLORS = { flush: 'green', extended: 'neutral', needs_comp: 'amber', wont_fit: 'red', unconfirmed: 'muted', na: '' };

  function v(key, label, reason, opts) {
    return {
      key: key,
      label: label || ({ flush: 'Fits', extended: 'Extended', needs_comp: 'Needs comp', wont_fit: 'Won’t fit', unconfirmed: 'Fit not confirmed', na: '' })[key],
      color: (opts && opts.color) || COLORS[key],
      selectable: key !== 'wont_fit',
      reason: reason || '',
      ok: key === 'flush' || key === 'extended',
    };
  }

  var num = function (x) { return x == null ? null : Number(x); };
  var isThreadedType = function (t) { return t === 'threaded' || t === 'threaded-and-ported'; };

  // ── slide references ──────────────────────────────────────────────────────
  function slideRef(product, spec, fitRow) {
    spec = spec || {};
    fitRow = fitRow || {};
    return {
      stock: false,
      tier: fitRow.fit_tier || null,
      compStyle: fitRow.comp_style || null,
      includesBarrel: fitRow.includes_barrel === true,
      barrelLen: num(spec.barrel_length_in),
      slideLen: num(spec.slide_length_in),
      ported: spec.internally_ported === true,
      integrated: spec.integrated_comp === true,
      threadedOk: spec.threaded_barrel_ok === true ? true : spec.threaded_barrel_ok === false ? false : null,
      portStyle: spec.port_style || null,
      productId: product ? product.id : null,
      brand: product ? product.brand : null,
      cuts: null,
    };
  }

  // The model's factory slide, from the guns row (the fit-tier migration's
  // columns). A comp model's slide cannot take an add-on comp and usually
  // wants its maker's barrel; threadedOk mirrors that (a plain factory slide
  // takes a threaded barrel, a comp one doesn't).
  function stockSlideRef(gun, cuts) {
    if (!gun) return null;
    var integrated = gun.integrated_comp === true || (gun.slide_comp_style && gun.slide_comp_style !== 'none');
    return {
      stock: true,
      tier: gun.slide_fit_tier || null,
      compStyle: gun.slide_comp_style || (integrated ? 'short_barrel' : 'none'),
      includesBarrel: false,
      barrelLen: num(gun.barrel_length_in),
      slideLen: num(gun.slide_length_in),
      ported: false,
      integrated: integrated,
      threadedOk: integrated ? false : true,
      portStyle: null,
      productId: null,
      brand: 'Sig Sauer',
      cuts: Array.isArray(cuts) ? cuts : null,
    };
  }

  // ── slide ↔ grip (the tier rule — delegated to window.SlideFit) ──────────
  // A grip's verdict against the effective slide, or a slide's against the
  // picked grip (else the gun's own grip tier, the prefill).
  function gripVerdict(gripFitRow, ctx) {
    if (!ctx.tierMode) return v('na');
    if (!ctx.slide) return v('unconfirmed', null, 'Pick a slide to check.');
    return global.SlideFit.tag(
      { fit_tier: ctx.slide.tier, comp_style: ctx.slide.compStyle },
      gripFitRow || { fit_tier: null },
      ctx.comp ? (ctx.comp.fitRow || { fit_result: null }) : null);
  }
  function slideVerdict(ref, ctx) {
    // The picked barrel binds first (Rules 1–2 in reverse): a slide that
    // cannot take the barrel on the build is wont_fit whatever its tier.
    if (ctx.barrel) {
      var bs = ctx.barrel.spec || {};
      var bl = num(bs.barrel_length_in);
      if (bl != null && ref.barrelLen != null && bl !== ref.barrelLen) {
        return v('wont_fit', null, 'Your barrel is ' + bl + '", and this slide takes ' + ref.barrelLen + '".');
      }
      var locks = ctx.barrel.locks && ctx.barrel.locks.length ? ctx.barrel.locks : null;
      if (locks && (!ref.productId || !locks.some(function (l) { return l.slide === ref.productId; }))) {
        return v('wont_fit', null, 'Your barrel only fits its maker’s named slides, and this isn’t one of them.');
      }
      if (isThreadedType(bs.barrel_type) && ref.threadedOk === false) {
        return v('wont_fit', null, 'This slide can’t take your threaded barrel.');
      }
    }
    if (!ctx.tierMode) return v('na');
    var gripTier = ctx.grip && ctx.grip.fitRow ? ctx.grip.fitRow.fit_tier
      : (ctx.gun ? ctx.gun.grip_fit_tier : null);
    if (!gripTier) return v('unconfirmed', null, 'Pick a grip to check.');
    return global.SlideFit.tag(
      { fit_tier: ref.tier, comp_style: ref.compStyle },
      { fit_tier: gripTier },
      ctx.comp ? (ctx.comp.fitRow || { fit_result: null }) : null);
  }

  // ── barrel ↔ slide ───────────────────────────────────────────────────────
  // Rules 1–3: length match; a ported slide takes only its maker's matched
  // barrel (barrel_slide_requirements); a locked barrel fits only its named
  // slides; threaded barrels need threaded_barrel_ok. A factory comp slide
  // with an aftermarket barrel is unconfirmed, never a guess.
  //   b = { spec, locks } — locks: [{ slide }] from barrel_slide_requirements,
  //       or null/[] for an open barrel.
  function barrelVerdict(b, ctx) {
    var s = ctx.slide;
    var spec = b.spec || {};
    if (!s) return v('unconfirmed', null, 'Pick a slide to check.');
    if (s.includesBarrel) return v('na', '', 'Barrel included with this kit.');
    var bl = num(spec.barrel_length_in);
    if (bl != null && s.barrelLen != null && bl !== s.barrelLen) {
      return v('wont_fit', null, (s.stock ? 'Your stock slide' : 'This slide') + ' takes a ' + s.barrelLen + '" barrel, and this barrel is ' + bl + '".');
    }
    if (s.stock && s.integrated) {
      return v('unconfirmed', null, 'Factory comp slides usually need the maker’s matched barrel, so check with the barrel maker.');
    }
    var locks = b.locks && b.locks.length ? b.locks : null;
    if (s.ported || s.compStyle === 'ported_barrel') {
      if (locks && s.productId && locks.some(function (l) { return l.slide === s.productId; })) {
        return v('flush', 'Matched barrel');
      }
      if (isThreadedType(spec.barrel_type) && s.threadedOk !== false) {
        // FDEZ's shape: threaded barrels stay listed on a ported-barrel comp
        // slide, for a suppressor or thread protector — the ports just don't
        // work. The pickers badge the matched barrel instead.
        return v('extended', 'Fits', 'The slide’s comp ports only work with its maker’s ported barrel — pick this for a suppressor or thread protector.');
      }
      return v('wont_fit', null, 'This ported slide needs its maker’s matched barrel.');
    }
    if (spec.barrel_type === 'ported') {
      return v('wont_fit', null, 'A ported barrel only works in its maker’s matching ported slide.');
    }
    if (locks && (!s.productId || !locks.some(function (l) { return l.slide === s.productId; }))) {
      return v('wont_fit', null, 'The maker says this barrel should only be used in specific slides.');
    }
    if (isThreadedType(spec.barrel_type) && s.threadedOk === false) {
      return v('wont_fit', null, 'This slide can’t take a threaded barrel.');
    }
    // Rule 3 in reverse: a picked add-on comp asks the barrel for its thread.
    var c = ctx.comp ? ctx.comp.spec : null;
    if (c && !c.comes_with_barrel) {
      if (c.requires_threaded_barrel && !isThreadedType(spec.barrel_type)) {
        return v('wont_fit', null, 'Your comp needs a threaded barrel, and this barrel isn’t threaded.');
      }
      if (c.thread_pitch && spec.thread_pitch && c.thread_pitch !== spec.thread_pitch) {
        return v('wont_fit', null, 'Your comp is ' + c.thread_pitch + ', and this barrel is ' + spec.thread_pitch + '.');
      }
    }
    return v('flush', 'Fits');
  }

  // The STOCK barrel in the picked slide — the build list's "Must fix" when
  // a ported or wrong-length slide is picked and no barrel is.
  function stockBarrelVerdict(ctx) {
    var s = ctx.slide;
    if (!ctx.gun || ctx.fcu || !s || s.stock) return v('flush', 'Factory');
    var gunBl = num(ctx.gun.barrel_length_in);
    if (s.includesBarrel) return v('na', '', 'Barrel included with this kit.');
    if (s.barrelLen != null && gunBl != null && s.barrelLen !== gunBl) {
      return v('wont_fit', null, 'Your stock barrel is ' + gunBl + '", and this slide takes ' + s.barrelLen + '".');
    }
    if (s.ported || s.compStyle === 'ported_barrel') {
      return v('wont_fit', null, 'This ported slide needs its maker’s matched barrel.');
    }
    if (s.integrated || (s.compStyle && s.compStyle !== 'none')) {
      return v('unconfirmed', null, 'Comp slides often need a specific barrel, so check with the slide maker.');
    }
    return v('flush', 'Fits');
  }

  // ── compensator ──────────────────────────────────────────────────────────
  // Hidden reason when the slide has its comp built in; thread pitch must
  // match; a kit comp (comes_with_barrel) must match the slide's length.
  function compVerdict(c, ctx) {
    var spec = c.spec || {};
    var s = ctx.slide;
    if (s && (s.integrated || (s.compStyle && s.compStyle !== 'none'))) {
      return v('wont_fit', null, s.stock
        ? 'The ' + (ctx.gun ? ctx.gun.name : 'factory') + '’s slide has a comp built in.'
        : 'This slide already has a comp built in.');
    }
    // An internally ported slide runs its maker's ported barrel — no threads
    // for a comp, and the porting already does the comp's job.
    if (s && s.ported) {
      return v('wont_fit', null, 'This ported slide’s barrel isn’t threaded, and its porting already reduces muzzle flip.');
    }
    if (spec.comes_with_barrel) {
      var kitLen = num(spec.barrel_length_in);
      if (kitLen != null && s && s.slideLen != null && kitLen !== s.slideLen) {
        return v('wont_fit', null, 'This kit’s barrel is ' + kitLen + '", and your slide is ' + s.slideLen + '".');
      }
      return v('flush', 'Includes barrel');
    }
    var b = ctx.barrel ? ctx.barrel.spec : null;
    if (!b) {
      if (s && s.stock && s.threadedOk === false) {
        return v('wont_fit', null, 'Needs a threaded barrel, and your stock barrel isn’t threaded.');
      }
      return v('needs_comp', 'Needs threaded barrel', 'Most comps need a threaded barrel with a matching thread — pick one first.');
    }
    if (!isThreadedType(b.barrel_type)) {
      return v('wont_fit', null, 'Your barrel isn’t threaded.');
    }
    if (spec.thread_pitch && b.thread_pitch && spec.thread_pitch !== b.thread_pitch) {
      return v('wont_fit', null, 'Your barrel is ' + b.thread_pitch + ' and this comp is ' + spec.thread_pitch + '.');
    }
    return v('flush', 'Fits');
  }

  // ── magazines ────────────────────────────────────────────────────────────
  // The grip module whose housing class the magazine question is asked of:
  //   a picked SIG grip     → its own frame_specs.housing_class
  //   a picked aftermarket  → { aftermarket } (no per-module claims yet)
  //   no grip, a model      → the gun's class; FUSE models use the 'fuse'
  //                           rows (SIG ships the XMacro-size module on the
  //                           FUSE, so guns.housing_class says 'xmacro', but
  //                           the maker's magazine claims for the FUSE are
  //                           its own rows)
  //   FCU only / nothing    → null
  function gripHousingClass(ctx) {
    if (ctx.grip && ctx.grip.product) {
      var p = ctx.grip.product;
      var hc = ctx.grip.spec ? ctx.grip.spec.housing_class : null;
      if (p.brand === 'Sig Sauer' && hc) return { hc: hc };
      return { aftermarket: true };
    }
    if (ctx.gun && !ctx.fcu) {
      return { hc: /(^|-)fuse(-|$)/.test(ctx.gun.slug || '') ? 'fuse' : ctx.gun.housing_class };
    }
    return null;
  }

  // magRows: { [housing_class]: { fit, note } } from magazine_housing_fit.
  function magazineVerdict(magRows, ctx) {
    var r = ctx.gripHC;
    if (!r) return v('unconfirmed', null, 'Pick a grip to check.');
    if (r.aftermarket) {
      return v('unconfirmed', null, 'Magazine fit depends on the grip module, so check with the grip maker.');
    }
    var m = magRows ? magRows[r.hc] : null;
    if (!m) return v('unconfirmed', null, 'The maker doesn’t say whether it fits this grip.');
    if (m.fit === 'flush') return v('flush', 'Flush', m.note || '');
    if (m.fit === 'extended') return v('extended', 'Extends below grip', m.note || '');
    if (m.fit === 'with_included_baseplate') return v('extended', 'Fits with included baseplate', m.note || '');
    return v('wont_fit', null, m.note || 'The maker says it doesn’t fit this grip.');
  }

  // ── magwells ─────────────────────────────────────────────────────────────
  // magwell_frame_requirements against the picked grip, or the stock grip's
  // OEM product (gun_stock_parts). No rule rows → unconfirmed, never a guess.
  //   fits: [{ frame, note }] or null/[].
  function magwellVerdict(fits, ctx) {
    var gripProduct = ctx.grip && ctx.grip.product ? ctx.grip.product : ctx.stockGripProduct;
    if (!gripProduct) {
      if (!ctx.gun || ctx.fcu) return v('unconfirmed', null, 'Pick a grip to check.');
      return v('unconfirmed', null, 'We don’t have magwell data for this grip yet.');
    }
    if (!fits || !fits.length) {
      return v('unconfirmed', null, 'The maker doesn’t list which grips it fits.');
    }
    var hit = null;
    for (var i = 0; i < fits.length; i++) if (fits[i].frame === gripProduct.id) { hit = fits[i]; break; }
    if (hit) return v('flush', 'Fits', hit.note || '');
    return v('wont_fit', null, 'Made for specific grip modules, and ' +
      (gripProduct.stock ? 'your stock grip' : 'your grip') + ' isn’t one of them.');
  }

  // ── recoil springs ───────────────────────────────────────────────────────
  // recoil_spring_specs.slide_length_in must equal the slide's length; comp
  // slides are unconfirmed (they can need a specific spring).
  function springVerdict(spec, ctx) {
    var s = ctx.slide;
    if (!s) return v('unconfirmed', null, 'Pick a slide to check.');
    var forLen = spec ? num(spec.slide_length_in) : null;
    if (forLen == null) return v('unconfirmed', null, 'The maker doesn’t state a slide length.');
    if (s.integrated || s.ported || (s.compStyle && s.compStyle !== 'none')) {
      return v('unconfirmed', null, 'Comp slides can need a specific spring, so check with the slide maker.');
    }
    if (s.slideLen == null) return v('unconfirmed', null, 'This slide’s length isn’t in the data yet.');
    if (forLen === s.slideLen) return v('flush', 'Fits');
    return v('wont_fit', null, 'Made for ' + forLen + '" slides, and your slide is ' + s.slideLen + '".');
  }

  // ── optics ───────────────────────────────────────────────────────────────
  // Stock slide only: the gun's gun_optic_cuts default row against the
  // optic's footprint, through optic_cut_footprints. Aftermarket slides have
  // no cut in the data yet → na (no tag), and the page says so once.
  //   o = { footprintId }.
  function opticVerdict(o, ctx) {
    var s = ctx.slide;
    if (!ctx.tierMode || !s) return v('na');
    if (!s.stock || !s.cuts || !ctx.optics) return v('na');
    var def = null, alts = [], none = null;
    s.cuts.forEach(function (c) {
      if (c.optic_cut === 'none') { none = c; return; }
      if (c.applies_to === 'default' || c.applies_to === 'all-current-skus') def = c;
      else alts.push(c);
    });
    if (!def) return v('na');
    if (!o.footprintId) return v('unconfirmed', null, 'This optic’s footprint isn’t in the data yet.');
    var map = ctx.optics.cutFootprints[def.optic_cut] || {};
    var fit = map[o.footprintId] || null;
    if (fit === 'direct') return v('flush', 'Fits your slide’s cut');
    if (fit === 'via-plate') return v('flush', 'Fits with adapter plate');
    // Not the default cut — but maybe another SKU's.
    for (var i = 0; i < alts.length; i++) {
      var am = ctx.optics.cutFootprints[alts[i].optic_cut] || {};
      if (am[o.footprintId]) {
        return v('unconfirmed', 'Depends on your SKU', 'Fits the ' + (alts[i].applies_to || 'other') +
          ' SKUs’ ' + alts[i].optic_cut + ' cut, not the default cut — check your slide’s cut.');
      }
    }
    var fpName = ctx.optics.footprintName ? ctx.optics.footprintName(o.footprintId) : null;
    return v('wont_fit', null, 'Your stock slide’s ' + def.optic_cut + ' cut doesn’t take the ' +
      (fpName || 'this optic’s') + ' footprint.');
  }

  global.ArmoryFit = {
    verdict: v,
    slideRef: slideRef,
    stockSlideRef: stockSlideRef,
    gripVerdict: gripVerdict,
    slideVerdict: slideVerdict,
    barrelVerdict: barrelVerdict,
    stockBarrelVerdict: stockBarrelVerdict,
    compVerdict: compVerdict,
    gripHousingClass: gripHousingClass,
    magazineVerdict: magazineVerdict,
    magwellVerdict: magwellVerdict,
    springVerdict: springVerdict,
    opticVerdict: opticVerdict,
  };
})(typeof window !== 'undefined' ? window : this);
