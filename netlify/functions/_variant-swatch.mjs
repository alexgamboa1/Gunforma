// _variant-swatch — what a variant looks like when there is no photo of it.
// SERVER copy, for netlify/functions/product-page.mjs.
// ─────────────────────────────────────────────────────────────────────────
// js/variant-swatch.js is the browser copy and holds the reasoning: a
// swatch plus the label is a complete answer, a blank box is a bug, and a
// sibling variant's photo standing in for a different colour is worse than
// either. The product page is a Netlify function with no module boundary to
// the browser, so this is the same split as js/maker-link.js ↔
// _maker-link.mjs: two files, one rule, and scripts/variant-swatch.test.mjs
// holds the colour tables and swatchFor() below BYTE-IDENTICAL to the
// browser file and runs both over the same names on every deploy. Change
// the browser file first, then paste the block here, or the deploy fails.
//
// The block between the markers is the browser file's, verbatim.
// ── begin verbatim block ─────────────────────────────────────────────────
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

  // Makers whose two-part colour names a FRAME and an ACCENT, not an object in
  // two colours. Icarus Precision writes "<frame>/<panel>" — "FDE/Gold" is an
  // FDE grip module with a brass panel, "ODG/Hogue" an ODG one with a Hogue
  // G10 panel — so the swatch is the frame colour alone (Alex, 2026-10-30).
  // Keyed by brand, not category: Sharps Bros grips are frames too, and
  // their "Black/Cherry" is a real second colour that must still split.
  var FRAME_COLOUR_BRANDS = {
    'icarus precision': true,
  };

  // Returns {kind, css} describing the swatch, or kind 'unknown' when the name
  // resolves to nothing. Exposed separately from the markup so a caller can
  // decide its own size and shape. `brand` is optional; it only matters for
  // FRAME_COLOUR_BRANDS.
  function swatchFor(color, brand) {
    if (FRAME_COLOUR_BRANDS[norm(brand)]) color = parts(color)[0] || color;
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
// ── end verbatim block ───────────────────────────────────────────────────

export { TOKENS, NAMED, SPECIAL, swatchFor };
