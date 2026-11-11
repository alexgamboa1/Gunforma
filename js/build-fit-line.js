// build-fit-line — "Fits your build" on a product page, judged by the SAME
// module as the Armory (js/armory-fit.js), over the build in progress.
// ─────────────────────────────────────────────────────────────────────────
// PR 2 of the 2026-11-10 Armory design. The server renders one placeholder
// (`#build-fit-line`, with the product's id and category as data
// attributes) and this script decides whether it says anything:
//
//   - no build in progress (no gf-armory-build-v2, or one carrying an
//     identity — an open saved build belongs to its ?edit=): NO line, no
//     reads. The page is exactly what the crawler saw.
//   - a build in progress: the rows the verdict needs are read (the gun,
//     the picked core parts' specs, and the product's own fit rows), the
//     context is built the way gunforma-armory.html builds it, and the
//     verdict renders as the line — "Fits your build", the catch, or why
//     not. The verdicts themselves are pinned by scripts/armory-fit.test.mjs;
//     what THIS file is trusted with — reading the right rows and never
//     judging without them — is pinned by scripts/build-fit-line.test.mjs.
//
// Dark until its data: any failed read renders NOTHING, never a guess — a
// missing line is the honest degraded state on a page that sells the part
// either way. Depends on globals: sb (supabase-client), SlideFit,
// ArmoryFit. Loaded by netlify/functions/product-page.mjs only.
(function (global) {
  'use strict';

  var BUILD_KEY = 'gf-armory-build-v2';
  var CORE = ['slide', 'frame', 'barrel', 'compensator'];

  function readBuild() {
    var d = null;
    try { d = JSON.parse(global.localStorage.getItem(BUILD_KEY) || 'null'); } catch (e) { return null; }
    if (!d || d.savedId || d.draftOf || !d.platformId) return null;
    return d;
  }

  function pickId(draft, cat) {
    var p = draft.picks && draft.picks[cat];
    return p && p.productId ? p.productId : null;
  }

  // One row per product id out of a PostgREST read.
  function byProduct(rows) {
    var out = {};
    (rows || []).forEach(function (r) { out[r.product_id] = r; });
    return out;
  }

  async function buildContext(sb, draft, product) {
    var AF = global.ArmoryFit;
    var ids = {};
    CORE.forEach(function (c) { ids[c] = pickId(draft, c); });
    var specIds = function (cat) {
      var list = [];
      if (ids[cat]) list.push(ids[cat]);
      if (product.category === cat) list.push(product.id);
      return list;
    };
    var inList = function (q, col, list) { return list.length ? q.in(col, list) : q.in(col, ['00000000-0000-4000-8000-000000000000']); };

    var reads = [
      draft.gunId
        ? sb.from('guns').select('id, slug, name, housing_class, barrel_length_in, slide_length_in, integrated_comp, grip_fit_tier, slide_fit_tier, slide_comp_style').eq('id', draft.gunId)
        : Promise.resolve({ data: [], error: null }),
      inList(sb.from('slide_specs').select('product_id, slide_length_in, barrel_length_in, integrated_comp, internally_ported, threaded_barrel_ok, port_style, fit_tier, comp_style, includes_barrel'), 'product_id', specIds('slide')),
      inList(sb.from('frame_specs').select('product_id, housing_class, fit_tier'), 'product_id', specIds('frame')),
      inList(sb.from('barrel_specs').select('product_id, barrel_length_in, barrel_type, thread_pitch, port_style'), 'product_id', specIds('barrel')),
      inList(sb.from('compensator_specs').select('product_id, mounting_type, requires_threaded_barrel, thread_pitch, comes_with_barrel, barrel_length_in, fit_result'), 'product_id', specIds('compensator')),
      // The picked grip's maker decides whether the magazine question is a
      // SIG class or "ask the grip maker"; the picked parts' names never
      // render here, so only the brand is read.
      ids.frame
        ? sb.from('products').select('id, brands:manufacturers(name)').eq('id', ids.frame)
        : Promise.resolve({ data: [], error: null }),
    ];
    var r = await Promise.all(reads);
    for (var i = 0; i < r.length; i++) { if (r[i].error) return null; }

    var gun = (r[0].data || [])[0] || null;
    var SS = byProduct(r[1].data), FS = byProduct(r[2].data), BS = byProduct(r[3].data), CS = byProduct(r[4].data);
    var gripBrand = r[5].data && r[5].data[0] && r[5].data[0].brands ? r[5].data[0].brands.name : null;

    var fcu = draft.gunMode === 'fcu' || (!gun && draft.gunMode !== 'model');
    var slideRef = null;
    if (ids.slide) {
      var srow = SS[ids.slide] || {};
      slideRef = AF.slideRef({ id: ids.slide, brand: null }, srow, srow);
    } else if (gun && !fcu) {
      // The stock slide carries the gun's optic-cut rows only when this
      // page needs them (an optic page) — read lazily below.
      slideRef = AF.stockSlideRef(gun, null);
    }

    var ctx = {
      tierMode: true,   // null tiers fall out as 'unconfirmed' in the module either way
      gun: gun && !fcu ? gun : null,
      fcu: fcu,
      slide: slideRef,
      grip: ids.frame ? {
        product: { id: ids.frame, brand: gripBrand },
        spec: FS[ids.frame] || null,
        fitRow: FS[ids.frame] || { fit_tier: null },
      } : null,
      stockGripProduct: null,
      barrel: ids.barrel ? { spec: BS[ids.barrel] || {}, locks: null } : null,
      comp: ids.compensator ? { spec: CS[ids.compensator] || {}, fitRow: CS[ids.compensator] || null } : null,
      optics: null,
      _specs: { SS: SS, FS: FS, BS: BS, CS: CS },
    };
    ctx.gripHC = AF.gripHousingClass(ctx);

    // The side reads one category needs, each fatal to the line, never to
    // the page: the verdict is not given without its data.
    if (product.category === 'barrel' || (ids.barrel && product.category === 'slide')) {
      var lockIds = [product.category === 'barrel' ? product.id : null, ids.barrel].filter(Boolean);
      var lr = await sb.from('barrel_slide_requirements').select('barrel_product_id, slide_product_id').in('barrel_product_id', lockIds);
      if (lr.error) return null;
      var locks = {};
      (lr.data || []).forEach(function (row) {
        (locks[row.barrel_product_id] = locks[row.barrel_product_id] || []).push({ slide: row.slide_product_id });
      });
      ctx._locks = locks;
      if (ids.barrel && ctx.barrel) ctx.barrel.locks = locks[ids.barrel] || null;
    }
    if (product.category === 'magazine') {
      var mf = await sb.from('magazine_housing_fit').select('housing_class, fit, note').eq('magazine_product_id', product.id);
      if (mf.error) return null;
      ctx._magRows = {};
      (mf.data || []).forEach(function (row) { ctx._magRows[row.housing_class] = { fit: row.fit, note: row.note || '' }; });
    }
    if (product.category === 'magwell') {
      var wr = await sb.from('magwell_frame_requirements').select('frame_product_id, compatibility_note').eq('magwell_product_id', product.id);
      if (wr.error) return null;
      ctx._magwellFits = (wr.data || []).map(function (row) { return { frame: row.frame_product_id, note: row.compatibility_note || '' }; });
      if (!ids.frame && gun && !fcu) {
        // The stock grip's OEM product (gun_stock_parts) — absent before
        // the migration, and the verdict then reads unconfirmed.
        try {
          var sp = await sb.from('gun_stock_parts').select('product_id').eq('gun_id', gun.id).eq('category', 'frame');
          if (!sp.error && sp.data && sp.data[0]) {
            ctx.stockGripProduct = { id: sp.data[0].product_id, brand: 'Sig Sauer', stock: true };
          }
        } catch (e) {}
      }
    }
    if (product.category === 'recoil_spring') {
      var rs = await sb.from('recoil_spring_specs').select('product_id, slide_length_in').eq('product_id', product.id);
      if (rs.error) return null;
      ctx._springSpec = (rs.data || [])[0] || null;
    }
    if (product.category === 'optic' && ctx.slide && ctx.slide.stock && gun) {
      var opt = await Promise.all([
        sb.from('optic_specs').select('product_id, footprint_id').eq('product_id', product.id),
        sb.from('gun_optic_cuts').select('optic_cut, applies_to, confidence').eq('gun_id', gun.id),
        sb.from('optic_cut_footprints').select('optic_cut, footprint_id, fit'),
        sb.from('footprints').select('id, common_name'),
      ]);
      for (var j = 0; j < opt.length; j++) { if (opt[j].error) return null; }
      ctx._opticFootprint = (opt[0].data || [])[0] ? opt[0].data[0].footprint_id : null;
      ctx.slide.cuts = opt[1].data || [];
      var cf = {};
      (opt[2].data || []).forEach(function (m) {
        var map = cf[m.optic_cut] = cf[m.optic_cut] || {};
        if (map[m.footprint_id] !== 'direct') map[m.footprint_id] = m.fit;
      });
      var names = {};
      (opt[3].data || []).forEach(function (f) { names[f.id] = f.common_name || null; });
      ctx.optics = { cutFootprints: cf, footprintName: function (id) { return names[id] || null; } };
    }
    return ctx;
  }

  // The verdict for THIS product against the context — the same dispatch
  // gunforma-armory.html's verdictFor() does, over rows fetched here.
  function judge(product, ctx) {
    var AF = global.ArmoryFit;
    var cat = product.category;
    var S = ctx._specs;
    if (cat === 'frame') return AF.gripVerdict(S.FS[product.id] || { fit_tier: null }, ctx);
    if (cat === 'slide') {
      var row = S.SS[product.id] || {};
      return AF.slideVerdict(AF.slideRef(product, row, row), ctx);
    }
    if (cat === 'barrel') return AF.barrelVerdict({ spec: S.BS[product.id] || {}, locks: (ctx._locks || {})[product.id] || null }, ctx);
    if (cat === 'compensator') return AF.compVerdict({ spec: S.CS[product.id] || {} }, ctx);
    if (cat === 'magazine') return AF.magazineVerdict(ctx._magRows || null, ctx);
    if (cat === 'magwell') return AF.magwellVerdict(ctx._magwellFits || null, ctx);
    if (cat === 'recoil_spring') return AF.springVerdict(ctx._springSpec || null, ctx);
    if (cat === 'optic') return AF.opticVerdict({ footprintId: ctx._opticFootprint || null }, ctx);
    return AF.verdict('na');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function lineHtml(tag, inBuild) {
    if (inBuild) {
      return '<span class="bfl-tag green">In your build</span>' +
        '<a class="bfl-link" href="gunforma-armory.html#build">Open your build ›</a>';
    }
    if (!tag || tag.key === 'na' || !tag.label) return '';
    var head = tag.key === 'wont_fit' ? 'Doesn’t fit your build'
      : tag.ok ? 'Fits your build'
      : tag.label;
    return '<span class="bfl-tag ' + esc(tag.color) + '">' + esc(head) + '</span>' +
      (tag.reason ? '<span class="bfl-why">' + esc(tag.reason) + '</span>' : '') +
      '<a class="bfl-link" href="gunforma-armory.html#build">Open your build ›</a>';
  }

  async function init() {
    var el = global.document.getElementById('build-fit-line');
    if (!el || !global.sb || !global.ArmoryFit) return;
    var draft = readBuild();
    if (!draft) return;                        // no build → no line, no reads
    var product = { id: el.getAttribute('data-product-id'), category: el.getAttribute('data-category') };
    if (!product.id || !product.category) return;
    var inBuild = pickId(draft, product.category) === product.id;
    var html = '';
    if (inBuild) {
      html = lineHtml(null, true);
    } else {
      var ctx = null;
      try { ctx = await buildContext(global.sb, draft, product); } catch (e) { ctx = null; }
      if (!ctx) return;                        // a failed read renders nothing, never a guess
      html = lineHtml(judge(product, ctx), false);
    }
    if (!html) return;
    el.innerHTML = html;
    el.hidden = false;
  }

  global.BuildFitLine = { init: init, readBuild: readBuild, buildContext: buildContext, judge: judge, lineHtml: lineHtml };
  if (global.document && global.document.getElementById) init();
})(typeof window !== 'undefined' ? window : this);
