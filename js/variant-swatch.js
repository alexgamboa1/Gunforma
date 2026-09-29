// variant-swatch — what a variant looks like when there is no photo of it.
// ─────────────────────────────────────────────────────────────────────────
// 244 of 649 live variants have no primary_image_url, so this is not a
// fallback for an edge case — it is 38% of the catalog, and 34 of 41 Gold
// variants, 15 of 15 ODG. A swatch plus the label is a COMPLETE card. A blank
// box is a bug, and the default variant's photo standing in for a different
// colour is worse than either: seven default variants were doing exactly that
// until 2026-09-29 (a Black/DLC barrel illustrated with the gold one), which
// is what scripts/check-variant-image-sku.mjs now watches for.
//
// Browser-only, so ONE file and no parity test — unlike js/variant-label.js,
// which the server also needs. netlify/functions/product-page.mjs renders its
// own variant table and does not use this; if it ever does, mirror it and add
// a parity test then rather than reaching across.
//
// Loaded by js/part-picker.js (the picker's colour step) and by
// gunforma-build-detail.html (the "See other options" panel). Read
// window.variantSwatch AT CALL TIME — these are separate <script> tags.
//
// THE COLOUR NAMES ARE REAL, AND THEY ARE MESSY. Measured over all 649 live
// variants: 54 distinct `color` values. Black alone is 349 of them (54%); the
// top fifteen reach ~89%. Sixteen values are TWO-TONE ("Black/Black",
// "Bronze/Black", "Gold/Red", "Hyena/Black"), which is why a swatch is not
// simply one fill. Three are not colours at all — "Spectrum" (10, iridescent
// PVD), "Rainbow" (1) and "Clear" (2) — and those get their own treatment
// rather than a wrong flat colour.
//
// An unmapped name is NOT an error and must not render as a guess. It gets a
// neutral outlined chip, and the label beside it carries the meaning. An
// honest grey chip reading "Midnight Bronze" beats an invented hex.
(function (global) {

  // Base tokens. Deliberately a small set that many names map onto, rather
  // than one entry per distinct string — "Gray", "Stealth Gray", "Sniper Gray"
  // and "Gun Metal Gray" are four names for approximately one swatch.
  var TOKENS = {
    black:      '#1b1b1b',
    graphite:   '#3a3a3c',
    gray:       '#8a8d91',
    silver:     '#c9ccd1',
    stainless:  '#d2d5d9',
    white:      '#f2f2f0',
    fde:        '#9c8055',
    fdeBrown:   '#7a6242',
    tan:        '#c2a678',
    coyote:     '#8f7351',
    odg:        '#5c5f45',
    green:      '#3f6b45',
    bronze:     '#7d5a3c',
    copper:     '#a5683f',
    gold:       '#c2953f',
    roseGold:   '#c98f79',
    rose:       '#c77b8b',
    blue:       '#3a5f9b',
    red:        '#9b3232',
    purple:     '#6b4a8c',
    tungsten:   '#6e7276',
    cherry:     '#7b3b3b',
  };

  // Exact name → token. Lowercased, punctuation-normalised on lookup.
  var NAMED = {
    'black': 'black', 'matte black': 'black', 'flat black': 'black',
    'black distressed': 'graphite',
    'gray': 'gray', 'grey': 'gray', 'stealth gray': 'graphite',
    'sniper gray': 'gray', 'gun metal gray': 'graphite',
    'tiger stripe gray': 'gray',
    'silver': 'silver',
    'stainless steel': 'stainless', 'satin stainless steel': 'stainless',
    'satin': 'stainless',
    'fde': 'fde', 'flat dark earth': 'fde',
    'fdeb': 'fdeBrown', 'flat dark earth brown': 'fdeBrown',
    'tan': 'tan', 'desert tan': 'tan', 'coyote tan': 'coyote',
    'coyote': 'coyote', 'hyena': 'coyote', 'coyote bronze': 'bronze',
    'odg': 'odg', 'olive drab': 'odg', 'olive drab green': 'odg',
    'green': 'green',
    'bronze': 'bronze', 'midnight bronze': 'graphite',
    'burnt bronze': 'bronze', 'red bronze': 'copper',
    'copper': 'copper',
    'gold': 'gold', 'rose gold': 'roseGold', 'matte rose gold': 'roseGold',
    'rose': 'rose',
    'blue': 'blue', 'red': 'red', 'purple': 'purple',
    'tungsten': 'tungsten',
    // Sharps Bros grips: black aluminium with a cherry wood insert. A real
    // second colour, so the swatch must split rather than read as plain black.
    'cherry': 'cherry',
    // Finish words that arrive in the colour field on some rows.
    'nitride': 'black', 'dlc': 'black', 'anodized': 'black',
    'tin': 'gold', 'ticn': 'copper', 'tialn': 'copper',
  };

  // Not colours. A flat fill would be a lie, so they say what they are.
  var SPECIAL = {
    'spectrum': 'iridescent',
    'rainbow':  'iridescent',
    'clear':    'clear',
  };

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // "Black/Cherry" and "Bronze/Black" are one variant with two colours, not a
  // choice between them. Split on / and + only — a hyphen is part of names
  // like "Gun-Metal" on some rows.
  function parts(color) {
    return norm(color).split(/\s*[/+]\s*/).filter(Boolean);
  }

  function tokenFor(name) {
    var n = norm(name);
    if (NAMED[n]) return TOKENS[NAMED[n]];
    // Suffix/prefix tolerance, longest match first, so "matte black anodized"
    // still resolves rather than falling through to the neutral chip.
    var keys = Object.keys(NAMED).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      if (n.indexOf(keys[i]) !== -1) return TOKENS[NAMED[keys[i]]];
    }
    return null;
  }

  function specialFor(color) {
    var ps = parts(color);
    for (var i = 0; i < ps.length; i++) if (SPECIAL[ps[i]]) return SPECIAL[ps[i]];
    return null;
  }

  // Returns {kind, css} describing the swatch, or kind 'unknown' when the name
  // resolves to nothing. Exposed separately from the markup so a caller can
  // decide its own size and shape.
  function swatchFor(color) {
    var special = specialFor(color);
    if (special === 'iridescent') {
      return { kind: 'iridescent',
               css: 'background:conic-gradient(from 210deg,#8f7bb5,#5f9bb5,#7fb58f,#c2b06a,#c2856a,#8f7bb5);' };
    }
    if (special === 'clear') {
      return { kind: 'clear',
               css: 'background:repeating-linear-gradient(45deg,#e9e9e6 0 3px,#f7f7f5 3px 6px);' +
                    'box-shadow:inset 0 0 0 1px rgba(0,0,0,0.18);' };
    }
    var ps = parts(color);
    var a = ps.length ? tokenFor(ps[0]) : null;
    var b = ps.length > 1 ? tokenFor(ps[1]) : null;

    if (a && b && a !== b) {
      // Two-tone: a hard diagonal split, so it reads as one object in two
      // colours rather than as two swatches.
      return { kind: 'split',
               css: 'background:linear-gradient(135deg,' + a + ' 0 49.5%,' + b + ' 50.5% 100%);' };
    }
    if (a) return { kind: 'solid', css: 'background:' + a + ';' };
    return { kind: 'unknown',
             css: 'background:#f2f1ee;box-shadow:inset 0 0 0 1px #d8d5cd;' };
  }

  global.variantSwatch = swatchFor;

  // The media slot for a variant: its own photo when it has one, else a
  // swatch. NEVER another variant's photo — the caller must not pass a
  // product-level fallback in here.
  //
  // `cls` lets the two call sites size their own box. Both pass a class whose
  // CSS sets object-fit: contain on the img — a catalog shot on white is
  // identifying the part, and cropping it hides the thing being chosen by.
  function variantMediaHtml(variant, cls) {
    var c = cls || 'variant-media';
    var label = global.variantLabel ? global.variantLabel(variant) : '';
    var alt = String(label || variant && variant.color || 'variant').replace(/"/g, '&quot;');
    var url = variant && variant.primary_image_url;
    if (url) {
      var sw = swatchFor(variant && variant.color);
      // onerror falls back to the SWATCH, not to an empty box: a dead image
      // URL is common in this catalog and should degrade to the same honest
      // answer as having no URL at all.
      return '<div class="' + c + '">' +
               '<img src="' + String(url).replace(/"/g, '&quot;') + '" alt="' + alt + '" loading="lazy" ' +
                 'onerror="this.parentElement.innerHTML=&quot;<span class=\\&quot;' + c + '-swatch\\&quot; style=\\&quot;' +
                   sw.css.replace(/"/g, '') + '\\&quot;></span>&quot;"/>' +
             '</div>';
    }
    var s = swatchFor(variant && variant.color);
    return '<div class="' + c + '">' +
             '<span class="' + c + '-swatch" style="' + s.css + '"></span>' +
           '</div>';
  }

  global.variantMediaHtml = variantMediaHtml;
})(window);
