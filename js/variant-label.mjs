// variant-label — the one place a variant's display label is decided.
//
// ONE FILE, imported by both sides. Not a browser copy plus a server copy
// with a parity test (the js/build-url.js ↔ _build-url.mjs pattern); that
// pattern exists because those two predate this one, and it costs a test
// whose only job is to prove two files still agree. Here the server imports
// this module directly and the browser loads it with <script type="module">,
// so "they agree" is true by construction and there is nothing to guard.
//
// It is the FIRST ES module in this repo's pages — everything else is a
// classic <script src> exposing a global. The shim each page uses is:
//
//   <script type="module">
//     import { variantLabel } from './js/variant-label.mjs';
//     window.variantLabel = variantLabel;
//   </script>
//
// A module script is deferred: it runs after parsing and before
// DOMContentLoaded. Every caller here renders from an async data load or a
// click, so the global is always set by call time — but read it AT CALL
// TIME, never captured into a variable at script-load time, because a
// classic <script> body runs BEFORE the module does.
//
// WHAT IT REPLACED, and why the old shape was wrong.
// Three copies (js/affiliate.js, netlify/functions/product-page.mjs,
// gunforma-build-detail.html) each carried a *differential* formula: show
// only the axes on which a product's listings disagree. Two problems, both
// live on the site when this was written:
//
//   1. The copies had drifted. `finish` was an axis on the server-rendered
//      product page and not in the other two, so True Precision P365-FUSE
//      read "Black / DLC" and "Black / Nitride" at /parts/slides/..., and
//      "Black" twice — $375.25 and $318.99, indistinguishable — in the
//      catalog buy row and on every build page. Same listing, same day.
//   2. Differential labels are unstable by design: a label changes meaning
//      when a SIBLING variant is added or retired. That is survivable in a
//      table the reader is comparing rows in, and wrong for a build page,
//      where the label names the one part someone actually owns and gets
//      written into parts_snapshot.
//
// So the formula is now absolute: the same variant always produces the same
// label, whatever its siblings do.
//
//   variant_label, verbatim, when non-empty  (hand-set override)
//   else  color + " / " + finish
//   else  color alone when finish is empty
//   else  "" — the caller decides what an unlabelled variant reads as
//
// No "Standard" fallback. It said nothing, and it read as a product tier.
//
// Worked examples, all real rows:
//   {color:'Black',  finish:'DLC'}          -> "Black / DLC"
//   {color:'FDE',    finish:'Cerakote'}     -> "FDE / Cerakote"
//   {color:'Satin Stainless Steel'}         -> "Satin Stainless Steel"
//   {color:'Black'}                         -> "Black"
//   {variant_label:'2 MOA Red Dot', ...}    -> "2 MOA Red Dot"

const clean = (s) => (typeof s === 'string' ? s.trim() : '');

/**
 * @param {{variant_label?:string, color?:string, finish?:string}|null|undefined} v
 * @returns {string} the label, or '' when the row carries nothing to say
 */
export function variantLabel(v) {
  if (!v) return '';
  const override = clean(v.variant_label);
  if (override) return override;

  const color  = clean(v.color);
  const finish = clean(v.finish);

  if (color && finish) {
    // "Black / Black" and "Satin / Satin" are real in this catalogue —
    // colour and finish genuinely carry the same word on some rows. Printing
    // it twice looks like a rendering bug, so collapse it.
    if (color.toLowerCase() === finish.toLowerCase()) return color;
    return color + ' / ' + finish;
  }
  return color || finish || '';
}

/**
 * What a row reads as when variantLabel() returns ''. Separate from the
 * formula so a caller that would rather render nothing can tell the two
 * apart, instead of every caller inventing its own placeholder.
 */
export function variantLabelOr(v, fallback = '') {
  return variantLabel(v) || fallback;
}
