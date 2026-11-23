// fragment-audit.mjs — in-page links on a page that sets <base href>.
//
// A page whose head carries <base href="/"/> resolves EVERY relative URL
// against "/", fragments included: a bare href="#barrels" is "/#barrels",
// the homepage, not a jump down this page. /parts shipped exactly that —
// every category link went home, and nothing failed. So on such a page an
// in-page link must name the page: href="/parts#barrels".
//
// Not a check on its own (no check-/test name, so check-all's audit does not
// expect a registry line): imported by scripts/parts-index-anchors.test.mjs
// (the build, stubbed catalog) and scripts/check-routes.mjs (the wire).
//
// auditFragments(html, selfPath) →
//   { hasBase, bare: [href…], selfLinks: [id…], missing: [id…] }
// bare      — hrefs starting with "#" (only reported when <base href> is set)
// selfLinks — fragment ids of hrefs naming selfPath ("/parts#x" → "x")
// missing   — selfLinks with no element carrying that id on the page
export function auditFragments(html, selfPath) {
  const hasBase = /<base\s+href=/i.test(html);
  const hrefs = [...html.matchAll(/\shref\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]);
  const bare = hasBase ? hrefs.filter((h) => h.startsWith('#')) : [];
  const ids = new Set([...html.matchAll(/\sid\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]));
  const prefix = selfPath + '#';
  const selfLinks = hrefs.filter((h) => h.startsWith(prefix)).map((h) => h.slice(prefix.length));
  const missing = [...new Set(selfLinks.filter((id) => !ids.has(id)))];
  return { hasBase, bare, selfLinks, missing };
}
