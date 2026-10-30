// option-price — the one rule for a part's headline price when that price is
// an option's MSRP, not a live retailer price (Alex, 2026-10-30):
//
//   - an option is selected        → that option's price
//   - nothing is selected          → "From $<lowest priced option>", or the
//                                    plain price when every option costs
//                                    the same
//   - the selected option has none → no number, never another option's —
//                                    the one wording, CHECK_PRICE
//
// It exists because the catalog's buy box on a maker-only part showed the
// FIRST option alphabetically whatever was selected: the Icarus AXG FUSE
// read "MSRP $519.99" (Black / Black) with FDE / Gold ($584.99) selected,
// while its cheapest option is $449.99. Read by js/affiliate.js (the buy
// box's maker headline), the catalog's grid cards and detail panel, the
// Armory's part cards and picked card, the builder pages' picker cards and
// selected rows (js/part-picker.js), the profile's Favorite parts cards, and
// the build page's maker-only row;
// scripts/option-price.test.mjs pins it. A card has nothing selected, so it
// reads "From $<lowest>" — the same number its panel opens with.
//
// Retailer prices are NOT this rule. A partner listing's headline is
// js/affiliate.js's own fresh-price logic and does not follow selection.
(function (global) {
  var CHECK_PRICE = 'Check price';

  function money(n) { return '$' + Number(n).toFixed(2); }

  // options: the product's live options, [{ id, msrp }], msrp null when the
  // option has no price. selectedId: the chosen option's id, or null/undefined
  // when nothing is selected. Returns { kind, amount, text }:
  //   kind 'option' — one option's price (text "$584.99")
  //   kind 'from'   — nothing selected, several options ("From $449.99")
  //   kind 'check'  — no number to stand behind (text CHECK_PRICE)
  // A selected id that is not among the options (a retired option, say) is a
  // selected option with no price: CHECK_PRICE, never a sibling's number.
  function optionHeadline(options, selectedId) {
    var list = options || [];
    if (selectedId != null) {
      var picked = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === selectedId) { picked = list[i]; break; }
      if (!picked || picked.msrp == null || isNaN(Number(picked.msrp))) return { kind: 'check', amount: null, text: CHECK_PRICE };
      return { kind: 'option', amount: Number(picked.msrp), text: money(picked.msrp) };
    }
    var prices = [];
    list.forEach(function (o) { if (o.msrp != null && !isNaN(Number(o.msrp))) prices.push(Number(o.msrp)); });
    if (!prices.length) return { kind: 'check', amount: null, text: CHECK_PRICE };
    var low = Math.min.apply(null, prices);
    // One option, or every option priced and at the same price: there is
    // nothing for "From" to range over, so the plain price (Alex,
    // 2026-10-30). An option with no price keeps the "From" — the unpriced
    // one could cost more.
    var allSame = prices.length === list.length && prices.every(function (n) { return n === low; });
    if (allSame) return { kind: 'option', amount: low, text: money(low) };
    return { kind: 'from', amount: low, text: 'From ' + money(low) };
  }

  // The same headline as card and panel text: cents only when the price has
  // them ("From $449.99", "$353"), so a card and the panel it opens print one
  // number the same way. The buy box keeps optionHeadline's own .text.
  // opts.msrp names the number for what it is — "MSRP from $X" / "MSRP $X" —
  // where a live retailer price sits beside it, so the retailer's number
  // reads as the deal and this one as the maker's list price.
  function optionPriceText(h, opts) {
    if (!h || h.kind === 'check' || h.amount == null) return CHECK_PRICE;
    var cents = Math.round(h.amount * 100) % 100 !== 0;
    var dollars = '$' + h.amount.toFixed(cents ? 2 : 0);
    if (opts && opts.msrp) return (h.kind === 'from' ? 'MSRP from ' : 'MSRP ') + dollars;
    return (h.kind === 'from' ? 'From ' : '') + dollars;
  }

  global.optionHeadline = optionHeadline;
  global.optionPriceText = optionPriceText;
  global.CHECK_PRICE = CHECK_PRICE;
})(window);
