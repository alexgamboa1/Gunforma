// part-redirects — the browser copy of netlify/functions/_part-redirects.mjs:
// every /parts/ address netlify.toml answers with a 301.
// -----------------------------------------------------------------------------
// Four discontinued rows were never separate products — two RAMM kits merged
// into one, a duplicate SIG manual-safety kit, an Icarus "311 FUSE SL" Icarus
// never made — and their addresses 301 to the real product. A real
// discontinued part is offered (the build pickers) or one toggle away (the
// catalog, the Armory); these must not be, or a builder is offered a
// duplicate of the part beside it. So every catalog read that loads
// discontinued parts drops a row for which isRedirectedPart() is true.
//
// scripts/discontinued.test.mjs holds this list, the server copy and the
// /parts/ 301s in netlify.toml equal, path for path.
//
// Global: window.isRedirectedPart(category, slug) — reads window.productPath
// (js/category-map.js) at call time.
(function (global) {
  var PART_REDIRECTS = [
    '/parts/triggers/ramm-tactical-leverage-c-p365',
    '/parts/triggers/ramm-tactical-leverage-nc-p365',
    '/parts/basepads/tti-xmacro-completed-mag-w-basepad',
    '/parts/safety-selectors/sig-sauer-manual-safety-parts-kit-black-p365',
    '/parts/frames/icarus-precision-311-fuse-sl',
    '/parts/slides/arc-division-reactor-365f-p365-xmacro',
  ];
  global.PART_REDIRECTS = PART_REDIRECTS;
  global.isRedirectedPart = function (category, slug) {
    if (!slug || typeof global.productPath !== 'function') return false;
    return PART_REDIRECTS.indexOf(global.productPath(category, slug)) !== -1;
  };
})(window);
