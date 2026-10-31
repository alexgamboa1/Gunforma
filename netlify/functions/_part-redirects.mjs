// _part-redirects — every /parts/ address netlify.toml answers with a 301.
// -----------------------------------------------------------------------------
// A discontinued part stays live: its page renders, the sitemap lists it and
// /parts links it (CLAUDE.md, "Discontinued parts"). Four discontinued rows
// are not that: they were never separate products — two RAMM kits merged into
// one, a duplicate SIG manual-safety kit, and an Icarus "311 FUSE SL" Icarus
// never made — and their addresses 301 to the real product. A sitemap must not
// submit a URL that redirects, and an index must not link one, so the readers
// that list parts skip every path in this set.
//
// The set is the `from` of every exact /parts/ 301 rule in netlify.toml, and
// scripts/discontinued.test.mjs fails the build when the two differ by one
// path in either direction. Adding a 301 for a part means adding its line here
// in the same commit — the test names it.
export const PART_REDIRECTS = new Set([
  '/parts/triggers/ramm-tactical-leverage-c-p365',
  '/parts/triggers/ramm-tactical-leverage-nc-p365',
  '/parts/basepads/tti-xmacro-completed-mag-w-basepad',
  '/parts/safety-selectors/sig-sauer-manual-safety-parts-kit-black-p365',
  '/parts/frames/icarus-precision-311-fuse-sl',
  '/parts/slides/arc-division-reactor-365f-p365-xmacro',
]);
