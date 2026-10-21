// display-name — what a product is CALLED on a page. BROWSER copy.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_display-name.mjs is the server copy, and its header
// holds the reasoning: products.name is the model alone, the brand is
// manufacturers.name, and a page prints displayProductName() (brand + ' '
// + name) or the { brand, model } pair from displayProductParts() — never
// the stored name, never brand + name assembled by hand. The one rule the
// pair still applies is for a FROZEN name — a build's parts_snapshot, a
// typed part — that opens with its brand: one leading brand form is
// stripped. The two files are duplicated because these pages load plain
// <script> globals with no module loader — the same split as
// js/maker-link.js ↔ _maker-link.mjs. scripts/display-name.test.mjs runs
// both over every live product name and fails the deploy if they differ
// by a character, so change them together, and keep the bodies below
// identical to the server's line for line.
//
// Globals: window.displayProductName, window.displayProductParts,
// window.brandForms, window.hasDoubledBrand, window.BRAND_ALIASES.
(function (global) {
  // Aliases the generic forms cannot derive — keyed by the brand in lower
  // case, values in lower case. Add a line here AND in _display-name.mjs.
  var BRAND_ALIASES = {
    'maskas precision': ['mpi'],
  };

  var squash = function (s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); };
  var escapeRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  // The forms a frozen name may open with, lower case, longest first: the
  // full brand, every shorter run of its leading words ("Timber Creek" and
  // "Timber" for Timber Creek Outdoors), its initials, and a listed alias.
  // Empty for an empty brand.
  function brandForms(brand) {
    var b = squash(brand).toLowerCase();
    if (!b) return [];
    var forms = [b];
    var add = function (f) { if (forms.indexOf(f) === -1) forms.push(f); };
    var words = b.split(' ').filter(Boolean);
    if (words.length >= 2) {
      for (var n = words.length - 1; n >= 1; n--) {
        var lead = words.slice(0, n).join(' ');
        if (lead.length >= 2) add(lead);
      }
      var initials = words.map(function (w) { return w[0]; }).join('');
      if (/^[a-z0-9]{2,}$/.test(initials)) add(initials);
    }
    (BRAND_ALIASES[b] || []).forEach(add);
    return forms.sort(function (x, y) { return y.length - x.length; });
  }

  // `text` opens with `form` as a whole word: a space or the end follows it.
  var opensWith = function (text, form) { return new RegExp('^' + escapeRe(form) + '(?=\\s|$)', 'i').test(text); };

  // { name, brand } → { brand, model }: the two lines a card prints. For a
  // catalog row `model` IS the stored name; for a frozen snapshot name it
  // is the name with one leading brand form removed.
  function displayProductParts(p) {
    var name  = squash(p && p.name);
    var brand = squash(p && p.brand);
    if (!name || !brand) return { brand: brand, model: name };
    var forms = brandForms(brand), form = null;
    for (var i = 0; i < forms.length; i++) { if (opensWith(name, forms[i])) { form = forms[i]; break; } }
    if (!form) return { brand: brand, model: name };
    var model = name.slice(form.length).replace(/^[\s\-–—:·|,]+/, '').trim();
    return { brand: brand, model: model || name };
  }

  // { name, brand } → the name a reader sees: brand + ' ' + model. A name
  // that is nothing but its brand ("Olight" / "Olight") is printed once.
  // Nothing else is collapsed: a frozen name that opened with TWO forms
  // of its brand loses one and is printed as the maker wrote it.
  function displayProductName(p) {
    var np = displayProductParts(p);
    if (!np.brand || !np.model) return np.brand || np.model;
    return np.model.toLowerCase() === np.brand.toLowerCase() ? np.brand : np.brand + ' ' + np.model;
  }

  // True when `text` opens with two forms of the same brand.
  function hasDoubledBrand(text, brand) {
    var t = squash(text);
    var forms = brandForms(brand);
    for (var i = 0; i < forms.length; i++) {
      var first = forms[i];
      if (!opensWith(t, first)) continue;
      var rest = t.slice(first.length).trim();
      if (forms.some(function (second) { return opensWith(rest, second); })) return true;
    }
    return false;
  }

  global.BRAND_ALIASES       = BRAND_ALIASES;
  global.brandForms          = brandForms;
  global.displayProductParts = displayProductParts;
  global.displayProductName  = displayProductName;
  global.hasDoubledBrand     = hasDoubledBrand;
})(window);
