// variant-label — the one source of truth for a variant's display label on
// the browser side. Used by the buy row, the part picker and the build page.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_variant-label.mjs holds a mirror of this. Duplicated on
// purpose, for the same reason js/build-url.js ↔ _build-url.mjs and
// js/category-map.js ↔ _category-meta.mjs are: the functions are ESM on
// Netlify, the pages load plain <script> globals with no module loader.
// A shared import would mean introducing `type="module"` on pages that have
// never had one — a change to how this site loads scripts, which is not
// something a label formula should drag in behind it.
//
// KEEP THE TWO IN SYNC. scripts/variant-label.test.mjs runs both over the
// same inputs and fails the deploy if they disagree on any of them.
//
// WHAT THIS REPLACED, and why the old shape was wrong.
// Three copies — here, product-page.mjs and gunforma-build-detail.html —
// each carried a *differential* formula: show only the axes on which a
// product's listings disagreed. Two problems, both live when this was
// written:
//
//   1. The copies had drifted. `finish` was an axis in product-page.mjs and
//      in neither of the other two, so True Precision P365-FUSE read
//      "Black / DLC" at /parts/slides/true-precision-p365-fuse and "Black"
//      twice — $375.25 and $318.99, indistinguishable — in the catalog buy
//      row and on every build page. Same listing, same day, two answers.
//   2. A differential label is unstable by design: its meaning changes when
//      a SIBLING variant is added or retired. Survivable in a table someone
//      is comparing rows in; wrong for a build page, where the label names
//      the one part a person owns and is written into parts_snapshot.
//
// So the formula is absolute. The same variant always produces the same
// label, whatever its siblings do:
//
//   variant_label, verbatim, when non-empty   (hand-set override)
//   else  color + " / " + finish
//   else  whichever of the two is present
//   else  "" — the caller decides what an unlabelled variant reads as
//
// No "Standard" fallback: it said nothing and read as a product tier. The
// "Stainless Steel / —" placeholder went with it.
//
// Worked examples, all real rows:
//   {color:'Black',  finish:'DLC'}        -> "Black / DLC"
//   {color:'FDE',    finish:'Cerakote'}   -> "FDE / Cerakote"
//   {color:'Satin Stainless Steel'}       -> "Satin Stainless Steel"
//   {color:'Black'}                       -> "Black"
//   {variant_label:'2 MOA Red Dot', …}    -> "2 MOA Red Dot"
(function (global) {
  function clean(s) { return typeof s === 'string' ? s.trim() : ''; }

  global.variantLabel = function (v) {
    if (!v) return '';
    var override = clean(v.variant_label);
    if (override) return override;

    var color  = clean(v.color);
    var finish = clean(v.finish);

    if (color && finish) {
      // "Black / Black" and "Satin / Satin" are real rows here — colour and
      // finish genuinely carry the same word on some variants. Printed twice
      // it reads as a rendering bug, so collapse it.
      if (color.toLowerCase() === finish.toLowerCase()) return color;
      return color + ' / ' + finish;
    }
    return color || finish || '';
  };

  // What a row reads as when variantLabel() returns ''. Separate from the
  // formula so a caller that would rather render nothing can tell the two
  // apart, instead of every caller inventing its own placeholder.
  global.variantLabelOr = function (v, fallback) {
    return global.variantLabel(v) || (fallback || '');
  };
})(window);
