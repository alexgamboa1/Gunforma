// _variant-label — the one source of truth for a variant's display label on
// the SERVER side. Mirror of js/variant-label.js; read that file's header for
// what this replaced and why the formula is absolute rather than differential.
//
// KEEP THE TWO IN SYNC. scripts/variant-label.test.mjs runs both over the same
// inputs and fails the deploy if they disagree.
//
//   variant_label, verbatim, when non-empty
//   else  color + " / " + finish   (finish dropped when it says nothing new)
//   else  whichever of the two is present
//   else  ""
//
// "Says nothing new" means every WORD of the finish already appears in the
// colour, so {color:'Satin Stainless Steel', finish:'Satin'} reads "Satin
// Stainless Steel". Word-level and every-word are both load-bearing — see the
// long note in js/variant-label.js for the two cases they protect.
function clean(s) { return typeof s === 'string' ? s.trim() : ''; }

function words(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function finishAddsNothing(color, finish) {
  const fw = words(finish);
  if (!fw.length) return true;
  const cw = words(color);
  return fw.every((w) => cw.includes(w));
}

export function variantLabel(v) {
  if (!v) return '';
  const override = clean(v.variant_label);
  if (override) return override;

  const color  = clean(v.color);
  const finish = clean(v.finish);

  if (color && finish) {
    if (finishAddsNothing(color, finish)) return color;
    return color + ' / ' + finish;
  }
  return color || finish || '';
}

export function variantLabelOr(v, fallback = '') {
  return variantLabel(v) || fallback;
}
