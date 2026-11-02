// _build-categories — js/build-categories.js, evaluated on the server.
// ─────────────────────────────────────────────────────────────────────────
// The parts taxonomy (sections, their order, BuildCategories.orderParts())
// has one copy, the browser file, and a server copy would be the drift
// scripts/check-categories.mjs exists to refuse. So a function that needs
// build order evaluates the browser file itself — the shape _slide-fit.mjs
// uses for js/slide-fit.js. js/build-categories.js reads categoryPlural()
// from js/category-map.js at load, so that one is evaluated first, into the
// same scope.
//
// A function using this must ship both files (`included_files` in
// netlify.toml). Missing from the bundle, this answers null and the caller
// decides what that means — for the share card, og-default.png.
import { readFile } from 'node:fs/promises';

const FILES = ['js/category-map.js', 'js/build-categories.js'];
const candidatesFor = (rel) => [rel, './' + rel, new URL('../../' + rel, import.meta.url)];

let cached = null;
export async function loadBuildCategories() {
  if (cached) return cached;
  const scope = {};
  for (const rel of FILES) {
    let src = null;
    for (const c of candidatesFor(rel)) {
      try { src = await readFile(c, 'utf8'); break; } catch { /* next */ }
    }
    if (src == null) return null;
    new Function('window', src)(scope);
  }
  if (!scope.BuildCategories || typeof scope.BuildCategories.orderParts !== 'function') return null;
  cached = scope.BuildCategories;
  return cached;
}
