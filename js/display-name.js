// display-name — what a product is CALLED on a page. BROWSER copy.
// ─────────────────────────────────────────────────────────────────────────
// netlify/functions/_display-name.mjs is the server copy, and its header
// holds the reasoning: products.name carries the brand only when the maker
// writes it that way, so every page prints displayProductName() —
// "{brand} {name}" unless the name already carries the brand — and never
// the stored name. The two are duplicated because these pages load plain
// <script> globals with no module loader — the same split as
// js/maker-link.js ↔ _maker-link.mjs. scripts/display-name.test.mjs runs
// both over every live product name and fails the deploy if they differ
// by a character, so change them together, and keep the bodies below
// identical to the server's line for line.
//
// Globals: window.displayProductName, window.nameCarriesBrand,
// window.brandForms, window.hasDoubledBrand, window.BRAND_ALIASES.
(function (global) {
  // Aliases the generic rules cannot derive — keyed by the brand in lower
  // case, values in lower case. Add a line here AND in _display-name.mjs.
  var BRAND_ALIASES = {
    'maskas precision': ['mpi'],
  };

  var squash = function (s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); };
  var escapeRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  // The forms a name may START with to count as already branded, lower
  // case, longest first. Empty for an empty brand.
  function brandForms(brand) {
    var b = squash(brand).toLowerCase();
    if (!b) return [];
    var forms = [b];
    var add = function (f) { if (forms.indexOf(f) === -1) forms.push(f); };
    var words = b.split(' ').filter(Boolean);
    if (words.length >= 2) {
      if (words[0].length >= 2) add(words[0]);
      var initials = words.map(function (w) { return w[0]; }).join('');
      if (/^[a-z0-9]{2,}$/.test(initials)) add(initials);
    }
    (BRAND_ALIASES[b] || []).forEach(add);
    return forms.sort(function (x, y) { return y.length - x.length; });
  }

  // A whole-word match: nothing alphanumeric may follow the form, and when
  // anchored mid-string nothing alphanumeric may precede it.
  var startsWithWord = function (text, form) { return new RegExp('^' + escapeRe(form) + '(?![a-z0-9])', 'i').test(text); };
  var containsWord   = function (text, form) { return new RegExp('(^|[^a-z0-9])' + escapeRe(form) + '(?![a-z0-9])', 'i').test(text); };

  function nameCarriesBrand(name, brand) {
    var n = squash(name);
    var b = squash(brand).toLowerCase();
    if (!n || !b) return false;
    if (brandForms(b).some(function (f) { return startsWithWord(n, f); })) return true;
    return containsWord(n, b);
  }

  // { name, brand } → the name a reader sees. Never returns the brand twice.
  function displayProductName(p) {
    var name  = squash(p && p.name);
    var brand = squash(p && p.brand);
    if (!name) return brand;
    if (!brand || nameCarriesBrand(name, brand)) return name;
    return brand + ' ' + name;
  }

  // True when `text` opens with two forms of the same brand.
  function hasDoubledBrand(text, brand) {
    var t = squash(text);
    var forms = brandForms(brand);
    for (var i = 0; i < forms.length; i++) {
      var first = forms[i];
      if (!startsWithWord(t, first)) continue;
      var rest = t.slice(first.length).trim();
      if (forms.some(function (second) { return startsWithWord(rest, second); })) return true;
    }
    return false;
  }

  global.BRAND_ALIASES      = BRAND_ALIASES;
  global.brandForms         = brandForms;
  global.nameCarriesBrand   = nameCarriesBrand;
  global.displayProductName = displayProductName;
  global.hasDoubledBrand    = hasDoubledBrand;
})(window);
