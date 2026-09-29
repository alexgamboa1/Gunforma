// _variant-label — the one source of truth for a variant's display label on
// the SERVER side. Mirror of js/variant-label.js; read that file's header for
// what this replaced and why the formula is absolute rather than differential.
//
// KEEP THE TWO IN SYNC. scripts/variant-label.test.mjs runs both over the same
// inputs and fails the deploy if they disagree.
//
//   variant_label, verbatim, when non-empty
//   else  color + " / " + finish   (collapsed when the two are the same word)
//   else  whichever of the two is present
//   else  ""
function clean(s) { return typeof s === 'string' ? s.trim() : ''; }

export function variantLabel(v) {
  if (!v) return '';
  const override = clean(v.variant_label);
  if (override) return override;

  const color  = clean(v.color);
  const finish = clean(v.finish);

  if (color && finish) {
    if (color.toLowerCase() === finish.toLowerCase()) return color;
    return color + ' / ' + finish;
  }
  return color || finish || '';
}

export function variantLabelOr(v, fallback = '') {
  return variantLabel(v) || fallback;
}
