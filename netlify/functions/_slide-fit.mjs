// _slide-fit.mjs — the server's handle on js/slide-fit.js, the ONE P365
// slide-on-grip rule (Alex, 2026-10-29). Not a copy: it reads the browser
// file the Armory and the catalog load and evaluates it, so a product page's
// "Fits on" grid and the Armory's tags cannot disagree by construction. A
// server copy plus a parity test was the other shape (maker-link,
// build-url); Alex ruled "no second copy of the rule" for this one.
//
// The file ships inside the function through included_files in netlify.toml
// ([functions."product-page"]), the same way build-og.mjs reads its page.
// When it cannot be read the loader answers null and the page renders
// without the grid; product-page.mjs reports that as `x-fits-on: no-rule`,
// and scripts/check-routes.mjs asserts on the wire that it never is.
//
// js/slide-fit.js is a plain script: `(function (global) { … global.SlideFit
// = … })(window)`. Evaluated with `window` bound to a fresh object it touches
// nothing else — exactly how scripts/slide-fit.test.mjs has always loaded it.
import { readFile } from 'node:fs/promises';

const RULE_CANDIDATES = [
  'js/slide-fit.js',
  './js/slide-fit.js',
  new URL('../../js/slide-fit.js', import.meta.url),
];

let cached = null;
export async function loadSlideFit() {
  if (cached) return cached;
  for (const candidate of RULE_CANDIDATES) {
    let src;
    try { src = await readFile(candidate, 'utf8'); } catch { continue; }
    const scope = {};
    new Function('window', src)(scope);
    if (scope.SlideFit && typeof scope.SlideFit.tag === 'function') {
      cached = scope.SlideFit;
      return cached;
    }
  }
  return null;
}
